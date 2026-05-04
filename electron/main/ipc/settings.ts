import { ipcMain, app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getDb, schema, notifyWrite } from '../db'
import { eq } from 'drizzle-orm'
import { encryptApiKey, decryptApiKey } from '../crypto'
import { getProviderByName, FALLBACK_MODELS } from '../providers'
import { WOS_FINE_TUNED_MODELS } from '../providers/vllm'
import { getDecryptedApiKeyOrNull } from '../providers/keystore'
import { resolveAgent, redactAgentConfig, type AgentConfig } from '../agent/settings'

type AgentSettingsUpdate = {
  agentKey: string
  inheritFrom?: string | null
  model?: string | null
  mode?: string | null
  systemPrompt?: string | null
  config?: AgentConfig
  apiKeys?: Partial<Record<'openai' | 'anthropic', string>>
}

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', () => {
    const db = getDb()
    const rows = db.select().from(schema.settings).all()
    const result: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value as string)
      } catch {
        result[row.key] = row.value
      }
    }
    return result
  })

  ipcMain.handle('settings:set', (_event, { key, value }: { key: string; value: unknown }) => {
    const db = getDb()
    db.insert(schema.settings)
      .values({ key, value: JSON.stringify(value), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: JSON.stringify(value), updatedAt: new Date() },
      })
      .run()
    notifyWrite()
    return { success: true }
  })

  ipcMain.handle('settings:agents:get', async () => {
    const db = getDb()
    const rows = db.select().from(schema.agentSettings).all()
    const direct = rows.map(row => ({
      agentKey: row.agentKey,
      inheritFrom: row.inheritFrom,
      model: row.model,
      mode: row.mode,
      systemPrompt: row.systemPrompt,
      config: redactAgentConfig((row.configJson ?? {}) as AgentConfig),
    }))
    const resolved = await Promise.all(['wos', 'meeting'].map(async key => {
      const agent = await resolveAgent(key)
      return {
        agentKey: key,
        inheritFrom: agent.inheritFrom,
        model: agent.model,
        mode: agent.mode,
        systemPrompt: agent.systemPrompt,
        config: redactAgentConfig(agent.config),
      }
    }))
    return { success: true, agents: direct, resolved }
  })

  ipcMain.handle('settings:agents:save', (_event, update: AgentSettingsUpdate) => {
    const db = getDb()
    const existing = db.select().from(schema.agentSettings).where(eq(schema.agentSettings.agentKey, update.agentKey)).get()
    const config: AgentConfig = {
      ...((existing?.configJson ?? {}) as AgentConfig),
      ...(update.config ?? {}),
    }
    for (const provider of ['openai', 'anthropic'] as const) {
      const key = update.apiKeys?.[provider]?.trim()
      if (!key) continue
      const { encrypted, iv } = encryptApiKey(key)
      if (provider === 'openai') {
        config.openaiApiKeyEncrypted = encrypted
        config.openaiApiKeyIv = iv
      } else {
        config.anthropicApiKeyEncrypted = encrypted
        config.anthropicApiKeyIv = iv
      }
    }
    const now = new Date()
    db.insert(schema.agentSettings)
      .values({
        agentKey: update.agentKey,
        inheritFrom: update.inheritFrom ?? null,
        model: update.model || null,
        mode: update.mode || null,
        systemPrompt: update.systemPrompt || null,
        configJson: config,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.agentSettings.agentKey,
        set: {
          inheritFrom: update.inheritFrom ?? null,
          model: update.model || null,
          mode: update.mode || null,
          systemPrompt: update.systemPrompt || null,
          configJson: config,
          updatedAt: now,
        },
      })
      .run()
    notifyWrite()
    return { success: true, config: redactAgentConfig(config) }
  })

  ipcMain.handle('settings:save-api-key', (_event, { provider, key }: { provider: 'openai' | 'anthropic' | 'hf' | 'openrouter' | 'together'; key: string }) => {
    const db = getDb()
    const { encrypted, iv } = encryptApiKey(key)
    const now = new Date()
    db.insert(schema.apiKeys)
      .values({ provider, encryptedKey: encrypted, iv, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.apiKeys.provider,
        set: { encryptedKey: encrypted, iv, updatedAt: now },
      })
      .run()
    notifyWrite()
    return { success: true }
  })

  ipcMain.handle('settings:get-api-keys-presence', () => {
    const db = getDb()
    const rows = db.select().from(schema.apiKeys).all()
    const result: Record<string, boolean> = {}
    for (const row of rows) {
      result[row.provider] = true
    }
    return result
  })

  ipcMain.handle(
    'settings:test-api-key',
    async (_event, { provider, key }: { provider: 'openai' | 'anthropic' | 'hf' | 'openrouter' | 'together'; key: string }) => {
      try {
        if (provider === 'hf' || provider === 'openrouter' || provider === 'together') {
          return { ok: true, modelCount: 1 }
        }
        const p = getProviderByName(provider)
        const models = await p.fetchModels(key)
        return { ok: true, modelCount: models.length }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    'models:fetch',
    async (_event, { provider, apiKey }: { provider: 'openai' | 'anthropic'; apiKey: string }) => {
      try {
        const p = getProviderByName(provider)
        const models = await p.fetchModels(apiKey)
        return { success: true, models }
      } catch (err) {
        return { success: false, error: (err as Error).message, models: [] }
      }
    }
  )

  ipcMain.handle('models:fallback', () => {
    return FALLBACK_MODELS
  })

  ipcMain.handle('models:fetch-saved', async () => {
    const results: Array<{ provider: 'openai' | 'anthropic'; models: unknown[]; error?: string }> = []
    for (const provider of ['openai', 'anthropic'] as const) {
      const key = await getDecryptedApiKeyOrNull(provider)
      if (!key) continue
      try {
        const p = getProviderByName(provider)
        const models = await p.fetchModels(key)
        results.push({ provider, models })
      } catch (err) {
        results.push({ provider, models: [], error: (err as Error).message })
      }
    }
    const merged = results.flatMap(r => r.models as Array<{ id: string }>)
    if (merged.length === 0) {
      return { success: false, models: FALLBACK_MODELS, errors: results.filter(r => r.error) }
    }
    return { success: true, models: [...merged, ...WOS_FINE_TUNED_MODELS], errors: results.filter(r => r.error) }
  })

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('app:open-logs', () => {
    shell.openPath(app.getPath('logs'))
  })

  ipcMain.handle('app:restart-and-update', () => {
    autoUpdater.quitAndInstall()
  })
}
