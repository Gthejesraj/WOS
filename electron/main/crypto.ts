import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { app } from 'electron'
import os from 'node:os'

function getMachineId(): string {
  // Use hostname + username as machine-specific salt
  return `${os.hostname()}-${os.userInfo().username}`
}

function getDerivedKey(): Buffer {
  const machineId = getMachineId()
  const salt = app.getPath('userData')
  return scryptSync(`${machineId}:wos`, salt, 32) as Buffer
}

export function encryptApiKey(plaintext: string): { encrypted: string; iv: string } {
  const iv = randomBytes(12)
  const key = getDerivedKey()
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    encrypted: Buffer.concat([encrypted, tag]).toString('hex'),
    iv: iv.toString('hex'),
  }
}

export function decryptApiKey(encrypted: string, iv: string): string {
  try {
    const key = getDerivedKey()
    const ivBuf = Buffer.from(iv, 'hex')
    const data = Buffer.from(encrypted, 'hex')
    const tag = data.subarray(data.length - 16)
    const ciphertext = data.subarray(0, data.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', key, ivBuf)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Failed to decrypt API key — may be from a different machine')
  }
}
