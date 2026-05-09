/**
 * IPC handlers for RunPod provider configuration.
 *
 * Channels:
 *   runpod:get-config        — return config (api keys redacted, presence only)
 *   runpod:save-account-key  — encrypt + store API key for an account
 *   runpod:delete-account    — remove an account (config + stored key)
 *   runpod:add-account       — add a new account
 *   runpod:add-endpoint      — add an endpoint (probes for model ID)
 *   runpod:remove-endpoint   — remove an endpoint from an account
 *   runpod:probe-endpoint    — probe a URL with an API key, return model ID
 *   runpod:get-models        — return all configured RunPod ModelInfo entries
 */

import { ipcMain } from 'electron'
import { notifyWrite } from '../db'
import {
  getRunPodConfig,
  saveRunPodConfig,
  saveAccountApiKey,
  deleteAccountApiKey,
  getAccountKeyPresence,
  probeEndpoint,
  deriveLabel,
  getAllRunPodModels,
  type RunPodAccount,
  type RunPodEndpoint,
} from '../providers/runpod'

function genId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function registerRunPodHandlers() {
  // Get config (with API key presence flags, but NOT the keys themselves)
  ipcMain.handle('runpod:get-config', () => {
    const config = getRunPodConfig()
    const presence = getAccountKeyPresence()
    return {
      accounts: config.accounts.map(acc => ({
        ...acc,
        hasApiKey: presence[acc.id] === true,
      })),
    }
  })

  // Save / update an API key for an account
  ipcMain.handle('runpod:save-account-key', (_event, { accountId, apiKey }: { accountId: string; apiKey: string }) => {
    if (!accountId || !apiKey) {
      return { success: false, error: 'accountId and apiKey are required' }
    }
    const config = getRunPodConfig()
    const account = config.accounts.find(a => a.id === accountId)
    if (!account) {
      return { success: false, error: `Account not found: ${accountId}` }
    }
    saveAccountApiKey(accountId, apiKey.trim())
    notifyWrite()
    return { success: true }
  })

  // Test an API key by probing one of its endpoints
  ipcMain.handle('runpod:test-account-key', async (_event, { accountId, apiKey }: { accountId: string; apiKey: string }) => {
    const config = getRunPodConfig()
    const account = config.accounts.find(a => a.id === accountId)
    if (!account || account.endpoints.length === 0) {
      return { ok: false, error: 'No endpoints configured for this account to test against.' }
    }
    const ep = account.endpoints[0]
    const result = await probeEndpoint(ep.url, apiKey.trim())
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, modelId: result.modelId, endpointUrl: ep.url }
  })

  // Add a new account
  ipcMain.handle('runpod:add-account', (_event, { name }: { name: string }) => {
    const config = getRunPodConfig()
    const newAcc: RunPodAccount = {
      id: genId('acc'),
      name: name?.trim() || 'New RunPod Account',
      endpoints: [],
    }
    config.accounts.push(newAcc)
    saveRunPodConfig(config)
    notifyWrite()
    return { success: true, accountId: newAcc.id }
  })

  // Rename an account
  ipcMain.handle('runpod:rename-account', (_event, { accountId, name }: { accountId: string; name: string }) => {
    const config = getRunPodConfig()
    const acc = config.accounts.find(a => a.id === accountId)
    if (!acc) return { success: false, error: 'Account not found' }
    acc.name = name?.trim() || acc.name
    saveRunPodConfig(config)
    notifyWrite()
    return { success: true }
  })

  // Delete an account (config + stored key)
  ipcMain.handle('runpod:delete-account', (_event, { accountId }: { accountId: string }) => {
    const config = getRunPodConfig()
    const before = config.accounts.length
    config.accounts = config.accounts.filter(a => a.id !== accountId)
    if (config.accounts.length === before) {
      return { success: false, error: 'Account not found' }
    }
    saveRunPodConfig(config)
    deleteAccountApiKey(accountId)
    notifyWrite()
    return { success: true }
  })

  /**
   * Add an endpoint to an account. If `apiKey` is provided OR the account
   * already has a stored key, we probe the URL to fetch the actual model ID.
   * Otherwise the endpoint is added with the user-supplied modelId/label.
   */
  ipcMain.handle('runpod:add-endpoint', async (_event, payload: {
    accountId: string
    url: string
    apiKey?: string
    label?: string
  }) => {
    const { accountId, url, apiKey, label } = payload
    if (!accountId || !url) return { success: false, error: 'accountId and url are required' }

    const config = getRunPodConfig()
    const account = config.accounts.find(a => a.id === accountId)
    if (!account) return { success: false, error: 'Account not found' }

    let resolvedModelId = ''
    let probeError: string | undefined
    const cleanUrl = url.trim().replace(/\/$/, '')

    const keyToUse = apiKey?.trim() || ''
    if (keyToUse) {
      const result = await probeEndpoint(cleanUrl, keyToUse)
      if (result.ok) resolvedModelId = result.modelId
      else probeError = result.error
    }

    const endpoint: RunPodEndpoint = {
      id: genId('ep'),
      url: cleanUrl,
      modelId: resolvedModelId || 'unknown/model',
      label: label?.trim() || (resolvedModelId ? deriveLabel(resolvedModelId) : 'Untitled Endpoint'),
      fetchedAt: resolvedModelId ? Date.now() : undefined,
    }
    account.endpoints.push(endpoint)
    saveRunPodConfig(config)
    notifyWrite()

    return { success: true, endpoint, probeError }
  })

  // Remove an endpoint from an account
  ipcMain.handle('runpod:remove-endpoint', (_event, { accountId, endpointId }: { accountId: string; endpointId: string }) => {
    const config = getRunPodConfig()
    const account = config.accounts.find(a => a.id === accountId)
    if (!account) return { success: false, error: 'Account not found' }
    const before = account.endpoints.length
    account.endpoints = account.endpoints.filter(e => e.id !== endpointId)
    if (account.endpoints.length === before) {
      return { success: false, error: 'Endpoint not found' }
    }
    saveRunPodConfig(config)
    notifyWrite()
    return { success: true }
  })

  // Probe a URL standalone (used in forms before saving)
  ipcMain.handle('runpod:probe-endpoint', async (_event, { url, apiKey }: { url: string; apiKey: string }) => {
    if (!url || !apiKey) return { ok: false, error: 'url and apiKey are required' }
    const result = await probeEndpoint(url.trim().replace(/\/$/, ''), apiKey.trim())
    return result
  })

  // Sync: re-probe every endpoint of every account that has a stored key,
  // refreshing the served modelId. Used after the user enters a new key.
  ipcMain.handle('runpod:sync-account', async (_event, { accountId }: { accountId: string }) => {
    const config = getRunPodConfig()
    const account = config.accounts.find(a => a.id === accountId)
    if (!account) return { success: false, error: 'Account not found' }

    const { getAccountApiKey } = await import('../providers/runpod')
    const apiKey = getAccountApiKey(accountId)
    if (!apiKey) return { success: false, error: 'No API key stored for this account' }

    const results: Array<{ endpointId: string; ok: boolean; modelId?: string; error?: string }> = []
    for (const ep of account.endpoints) {
      const r = await probeEndpoint(ep.url, apiKey)
      if (r.ok) {
        ep.modelId = r.modelId
        ep.label = ep.label || deriveLabel(r.modelId)
        ep.fetchedAt = Date.now()
        results.push({ endpointId: ep.id, ok: true, modelId: r.modelId })
      } else {
        results.push({ endpointId: ep.id, ok: false, error: r.error })
      }
    }
    saveRunPodConfig(config)
    notifyWrite()
    return { success: true, results }
  })

  // Get the flat list of all RunPod ModelInfo entries (for model picker)
  ipcMain.handle('runpod:get-models', () => {
    return getAllRunPodModels()
  })
}
