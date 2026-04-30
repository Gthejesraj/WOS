import { eq } from 'drizzle-orm'
import { getDb } from './index'
import * as schema from './schema'

/**
 * Read a single value from the `settings` table and JSON-parse it.
 * Returns `defaultValue` when the key is missing or the value is not valid
 * JSON. Used by the boot path and IPC handlers in place of repeating the
 * select-row-then-parse boilerplate.
 */
export function getSettingJSON<T>(key: string, defaultValue: T): T {
  try {
    const db = getDb()
    const row = db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .get()
    if (!row) return defaultValue
    try {
      return JSON.parse(row.value as string) as T
    } catch {
      return (row.value as unknown as T) ?? defaultValue
    }
  } catch {
    return defaultValue
  }
}

/**
 * Read every row from the `settings` table into a plain `{ key: parsedValue }`
 * map. Each value is JSON-parsed; on parse error the raw string is kept so
 * callers can still do their own coercion.
 */
export function readAllSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  try {
    const db = getDb()
    for (const row of db.select().from(schema.settings).all()) {
      try {
        out[row.key] = JSON.parse(row.value as string)
      } catch {
        out[row.key] = row.value
      }
    }
  } catch {
    /* swallow — caller falls back to defaults */
  }
  return out
}
