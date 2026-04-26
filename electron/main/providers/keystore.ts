import { getDb, schema } from '../db'
import { eq } from 'drizzle-orm'
import { decryptApiKey } from '../crypto'

export async function getDecryptedApiKey(provider: 'openai' | 'anthropic'): Promise<string> {
  const db = getDb()
  const row = db.select().from(schema.apiKeys).where(eq(schema.apiKeys.provider, provider)).get()
  if (!row) throw new Error(`No API key stored for ${provider}. Please add it in Settings.`)
  return decryptApiKey(row.encryptedKey, row.iv)
}

export async function getDecryptedApiKeyOrNull(provider: 'openai' | 'anthropic'): Promise<string | null> {
  try {
    return await getDecryptedApiKey(provider)
  } catch {
    return null
  }
}
