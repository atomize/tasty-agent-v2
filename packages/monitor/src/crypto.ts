import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 16
const TAG_LEN = 16

let encryptionKey: Buffer | null = null

export function initEncryption(): boolean {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) return false

  const key = Buffer.from(raw, 'hex')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
  }
  encryptionKey = key
  return true
}

export function isEncryptionEnabled(): boolean {
  return encryptionKey !== null
}

export function encrypt(plaintext: string): string {
  if (!encryptionKey) throw new Error('Encryption not initialized')
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decrypt(ciphertext: string): string {
  if (!encryptionKey) throw new Error('Encryption not initialized')
  const buf = Buffer.from(ciphertext, 'base64')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const encrypted = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, encryptionKey, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final('utf8')
}

export function maskApiKey(key: string): string {
  if (key.length <= 12) return '****'
  return key.slice(0, 10) + '****' + key.slice(-3)
}
