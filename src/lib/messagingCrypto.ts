/**
 * Browser-only message encryption. No secrets are persisted by this module.
 * A random 256-bit recovery secret wraps one immutable P-256 private identity.
 * Static ECDH + per-message HKDF-SHA256 + AES-256-GCM protects the body from
 * database readers and a stolen bearer token alone. It has NO forward secrecy
 * and cannot protect an unlocked browser from XSS or malicious delivered code.
 * Algorithms: W3C Web Cryptography API Recommendation, sections 24, 27 and 31.
 */
export type EncryptedIdentityVault = { v: 1; alg: 'A256GCM'; iv: string; ct: string }
export type MessagingIdentity = { user_id: string; public_key: string; encrypted_private_key: EncryptedIdentityVault }
export type UnlockedMessagingIdentity = { userId: string; publicKey: string; privateKey: CryptoKey }
export type MessageCryptoContext = { conversationId: string; senderId: string; recipientId: string; clientNonce: string }
type MessageEnvelope = { v: 1; alg: 'P256-HKDF-SHA256-A256GCM'; salt: string; iv: string; ct: string; sender_key: string; recipient_key: string }

const MESSAGE_ALGORITHM = 'P256-HKDF-SHA256-A256GCM' as const
const MAX_BODY_BYTES = 16000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const cryptoError = () => new Error('Impossible de déchiffrer : clé incorrecte ou message altéré.')

function webCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error('Le chiffrement nécessite un navigateur compatible et une connexion HTTPS.')
  return globalThis.crypto
}
function uuid(value: string): string {
  if (!UUID.test(value)) throw new Error('Identifiant de messagerie invalide.')
  return value.toLowerCase()
}
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromBase64Url(value: unknown, min: number, max = min): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(max * 4 / 3)) throw cryptoError()
  let decoded: string
  try { decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)) }
  catch { throw cryptoError() }
  const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0))
  if (bytes.length < min || bytes.length > max || toBase64Url(bytes) !== value) throw cryptoError()
  return bytes
}
function record(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}
async function importPublic(publicKey: string): Promise<CryptoKey> {
  const raw = fromBase64Url(publicKey, 65)
  if (raw[0] !== 4) throw cryptoError()
  return webCrypto().subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
}
export async function validateMessagingPublicKey(publicKey: string): Promise<void> { await importPublic(publicKey) }
export async function messagingPublicKeyFingerprint(publicKey: string): Promise<string> {
  const raw = fromBase64Url(publicKey, 65)
  await importPublic(publicKey)
  return toBase64Url(new Uint8Array(await webCrypto().subtle.digest('SHA-256', raw)))
}
function vaultAad(userId: string, publicKey: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(['lsnb-identity-vault', 1, uuid(userId), publicKey]))
}
function recoveryBytes(recoverySecret: string): Uint8Array<ArrayBuffer> {
  const clean = recoverySecret.trim()
  if (!clean.startsWith('LSNB1-')) throw cryptoError()
  return fromBase64Url(clean.slice(6), 32)
}
async function vaultKey(secret: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return webCrypto().subtle.importKey('raw', secret, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function generateMessagingIdentity(userId: string): Promise<{
  recoverySecret: string; identity: MessagingIdentity; unlocked: UnlockedMessagingIdentity
}> {
  const actor = uuid(userId), crypto = webCrypto()
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  const exported = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const privateJwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: exported.x!, y: exported.y!, d: exported.d! }
  const clearPrivate = encoder.encode(JSON.stringify(privateJwk))
  const secret = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12))
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: vaultAad(actor, publicKey), tagLength: 128 }, await vaultKey(secret), clearPrivate)
    const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    return {
      recoverySecret: `LSNB1-${toBase64Url(secret)}`,
      identity: { user_id: actor, public_key: publicKey, encrypted_private_key: { v: 1, alg: 'A256GCM', iv: toBase64Url(iv), ct: toBase64Url(new Uint8Array(ciphertext)) } },
      unlocked: { userId: actor, publicKey, privateKey },
    }
  } finally { secret.fill(0); clearPrivate.fill(0) }
}

export async function unlockMessagingIdentity(identity: MessagingIdentity, recoverySecret: string): Promise<UnlockedMessagingIdentity> {
  let secret: Uint8Array<ArrayBuffer> | undefined, clear: Uint8Array<ArrayBuffer> | undefined
  try {
    const actor = uuid(identity.user_id), vault = identity.encrypted_private_key
    if (!record(vault, ['v', 'alg', 'iv', 'ct']) || vault.v !== 1 || vault.alg !== 'A256GCM') throw cryptoError()
    await importPublic(identity.public_key)
    secret = recoveryBytes(recoverySecret)
    const raw = await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(vault.iv, 12),
      additionalData: vaultAad(actor, identity.public_key), tagLength: 128 }, await vaultKey(secret), fromBase64Url(vault.ct, 17, 2048))
    clear = new Uint8Array(raw)
    const jwk: unknown = JSON.parse(decoder.decode(clear))
    if (!record(jwk, ['kty', 'crv', 'x', 'y', 'd']) || jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw cryptoError()
    const x = fromBase64Url(jwk.x, 32), y = fromBase64Url(jwk.y, 32)
    fromBase64Url(jwk.d, 32)
    const publicRaw = new Uint8Array(65); publicRaw[0] = 4; publicRaw.set(x, 1); publicRaw.set(y, 33)
    if (toBase64Url(publicRaw) !== identity.public_key) throw cryptoError()
    const privateKey = await webCrypto().subtle.importKey('jwk', jwk as JsonWebKey, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    return { userId: actor, publicKey: identity.public_key, privateKey }
  } catch { throw cryptoError() }
  finally { secret?.fill(0); clear?.fill(0) }
}

function parseEnvelope(body: string): MessageEnvelope {
  if (typeof body !== 'string' || body.length > 24000) throw cryptoError()
  let value: unknown
  try { value = JSON.parse(body) } catch { throw cryptoError() }
  if (!record(value, ['v', 'alg', 'salt', 'iv', 'ct', 'sender_key', 'recipient_key']) || value.v !== 1 || value.alg !== MESSAGE_ALGORITHM) throw cryptoError()
  fromBase64Url(value.salt, 32); fromBase64Url(value.iv, 12); fromBase64Url(value.ct, 17, MAX_BODY_BYTES + 16)
  fromBase64Url(value.sender_key, 32); fromBase64Url(value.recipient_key, 32)
  return value as MessageEnvelope
}
/** This validates the envelope format only. Only successful decryption authenticates it. */
export function isEncryptedMessage(body: string): boolean { try { parseEnvelope(body); return true } catch { return false } }

async function messageParameters(identity: UnlockedMessagingIdentity, peerPublicKey: string, context: MessageCryptoContext) {
  const actor = uuid(identity.userId), sender = uuid(context.senderId), recipient = uuid(context.recipientId)
  if (sender === recipient || (actor !== sender && actor !== recipient) || identity.privateKey.type !== 'private'
    || identity.privateKey.extractable || identity.privateKey.algorithm.name !== 'ECDH') throw cryptoError()
  const ownFingerprint = await messagingPublicKeyFingerprint(identity.publicKey), peerFingerprint = await messagingPublicKeyFingerprint(peerPublicKey)
  const senderKey = actor === sender ? ownFingerprint : peerFingerprint, recipientKey = actor === recipient ? ownFingerprint : peerFingerprint
  const aad = encoder.encode(JSON.stringify(['lsnb-message', 1, uuid(context.conversationId), sender, recipient, uuid(context.clientNonce), senderKey, recipientKey]))
  return { aad, senderKey, recipientKey, peerKey: await importPublic(peerPublicKey) }
}
async function deriveMessageKey(identity: UnlockedMessagingIdentity, peerKey: CryptoKey, salt: Uint8Array<ArrayBuffer>, aad: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const crypto = webCrypto()
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peerKey }, identity.privateKey, 256))
  try {
    const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
    return await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: aad }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  } finally { shared.fill(0) }
}

export async function encryptMessage(identity: UnlockedMessagingIdentity, peerPublicKey: string, context: MessageCryptoContext, plaintext: string): Promise<string> {
  if (uuid(identity.userId) !== uuid(context.senderId)) throw cryptoError()
  const text = plaintext.trim()
  if ([...text].length < 1 || [...text].length > 4000) throw new Error('Le message doit contenir entre 1 et 4 000 caractères.')
  const clear = encoder.encode(text)
  if (clear.length > MAX_BODY_BYTES) throw new Error('Le message est trop long.')
  try {
    const { aad, senderKey, recipientKey, peerKey } = await messageParameters(identity, peerPublicKey, context)
    const crypto = webCrypto(), salt = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveMessageKey(identity, peerKey, salt, aad)
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, clear)
    return JSON.stringify({ v: 1, alg: MESSAGE_ALGORITHM, salt: toBase64Url(salt), iv: toBase64Url(iv),
      ct: toBase64Url(new Uint8Array(encrypted)), sender_key: senderKey, recipient_key: recipientKey } satisfies MessageEnvelope)
  } finally { clear.fill(0) }
}

export async function decryptMessage(identity: UnlockedMessagingIdentity, peerPublicKey: string, context: MessageCryptoContext, body: string): Promise<string> {
  let clear: Uint8Array<ArrayBuffer> | undefined
  try {
    const envelope = parseEnvelope(body), { aad, senderKey, recipientKey, peerKey } = await messageParameters(identity, peerPublicKey, context)
    if (envelope.sender_key !== senderKey || envelope.recipient_key !== recipientKey) throw cryptoError()
    const key = await deriveMessageKey(identity, peerKey, fromBase64Url(envelope.salt, 32), aad)
    clear = new Uint8Array(await webCrypto().subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(envelope.iv, 12),
      additionalData: aad, tagLength: 128 }, key, fromBase64Url(envelope.ct, 17, MAX_BODY_BYTES + 16)))
    const text = decoder.decode(clear)
    if (text !== text.trim() || [...text].length < 1 || [...text].length > 4000) throw cryptoError()
    return text
  } catch { throw cryptoError() }
  finally { clear?.fill(0) }
}
