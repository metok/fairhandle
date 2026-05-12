import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Encrypted blob layout (base64): nonce(12) || ciphertext || tag(16).
 */
export function encryptToRoomKey(key: Uint8Array, plaintext: string): string {
  if (key.length !== 32) throw new Error('room key must be 32 bytes')
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), nonce)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([nonce, ct, tag]).toString('base64')
}

export function decryptFromRoomKey(key: Uint8Array, blobBase64: string): string {
  if (key.length !== 32) throw new Error('room key must be 32 bytes')
  const blob = Buffer.from(blobBase64, 'base64')
  const nonce = blob.subarray(0, 12)
  const tag = blob.subarray(blob.length - 16)
  const ct = blob.subarray(12, blob.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
