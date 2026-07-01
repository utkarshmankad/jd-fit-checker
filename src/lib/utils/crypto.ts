import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12 // 96-bit nonce, recommended size for GCM
const LEGACY_ALGO = 'aes-256-cbc'

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_SECRET ?? process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('ENCRYPTION_SECRET (or ENCRYPTION_KEY) not set')
  // Accept 64-char hex or base64
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex')
  return Buffer.from(raw, 'base64')
}

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':')
}

export function decrypt(encoded: string): string {
  const parts = encoded.split(':')

  if (parts.length === 3) {
    const [ivHex, tagHex, encHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(tagHex, 'hex')
    const encrypted = Buffer.from(encHex, 'hex')
    const decipher = createDecipheriv(ALGO, getKey(), iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  }

  // Legacy format (iv:ciphertext, no auth tag) written before the AES-256-GCM
  // migration — decrypt with the old CBC cipher so existing keys keep working.
  const [ivHex, encHex] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const encrypted = Buffer.from(encHex, 'hex')
  const decipher = createDecipheriv(LEGACY_ALGO, getKey(), iv)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}
