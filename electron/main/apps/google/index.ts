import type { AppModule } from '../types'
import { getUserInfo } from './api'
import type { GoogleCreds } from './api'
import { runOAuthFlow } from './oauth'
import { buildGoogleTools } from './tools'

export const googleApp: AppModule = {
  manifest: {
    id: 'google',
    name: 'Google Workspace',
    description: 'Access Gmail, Google Calendar, and Google Drive from your WOS agent.',
    icon: 'google',
    authType: 'oauth',
    scopes: [
      'gmail.modify',
      'calendar',
      'drive',
    ],
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    authFields: [
      {
        key: 'clientId',
        label: 'Client ID',
        placeholder: '123456789012-abc….apps.googleusercontent.com',
        required: true,
        helper: 'From Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID.',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        placeholder: 'GOCSPX-…',
        required: true,
        secret: true,
        helper: 'Found next to the Client ID in Google Cloud Console.',
      },
    ],
  },

  async test(creds) {
    if (!creds.accessToken) return { ok: false, error: 'No access token. Please authorize first.' }
    try {
      const user = await getUserInfo(creds as unknown as GoogleCreds)
      return {
        ok: true,
        identity: { email: user.email, name: user.name },
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },

  async initiateOAuth(creds) {
    if (!creds.clientId) return { ok: false, error: 'Client ID is required.' }
    if (!creds.clientSecret) return { ok: false, error: 'Client Secret is required.' }
    try {
      const tokens = await runOAuthFlow(creds.clientId, creds.clientSecret)
      const fullCreds: Record<string, string> = {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: String(tokens.expiresAt),
        redirectUri: tokens.redirectUri,
      }
      const user = await getUserInfo(fullCreds as unknown as GoogleCreds)
      return {
        ok: true,
        identity: { email: user.email, name: user.name },
        fullCreds,
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  },

  buildTools(creds) {
    return buildGoogleTools(creds as unknown as GoogleCreds)
  },
}
