import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { before, describe, it } from 'node:test'
import { decryptMessage, encryptMessage, generateMessagingIdentity, isEncryptedMessage,
  messagingPublicKeyFingerprint, unlockMessagingIdentity, validateMessagingPublicKey,
  type MessageCryptoContext } from '../../../src/lib/messagingCrypto.ts'

type Generated = Awaited<ReturnType<typeof generateMessagingIdentity>>
let a: Generated, b: Generated, c: Generated
const context = (): MessageCryptoContext => ({ conversationId: randomUUID(), senderId: a.identity.user_id, recipientId: b.identity.user_id, clientNonce: randomUUID() })
const alter = (text: string) => (text[0] === 'A' ? 'B' : 'A') + text.slice(1)

describe('Client-only encryption and identity recovery', () => {
  before(async () => { [a,b,c] = await Promise.all([generateMessagingIdentity(randomUUID()),generateMessagingIdentity(randomUUID()),generateMessagingIdentity(randomUUID())]) })

  it('generates a uniform 256-bit recovery secret and stores only an authenticated encrypted private key', async () => {
    assert.match(a.recoverySecret,/^LSNB1-[A-Za-z0-9_-]{43}$/)
    assert.equal(a.unlocked.privateKey.extractable,false)
    assert.equal(a.identity.public_key.length,87)
    assert.equal(JSON.stringify(a.identity).includes(a.recoverySecret),false)
    assert.equal(JSON.stringify(a.identity).includes('"d"'),false)
    await validateMessagingPublicKey(a.identity.public_key)
    assert.equal((await messagingPublicKeyFingerprint(a.identity.public_key)).length,43)
    await assert.rejects(crypto.subtle.exportKey('jwk',a.unlocked.privateKey))
    const unlocked=await unlockMessagingIdentity(a.identity,a.recoverySecret)
    assert.equal(unlocked.publicKey,a.identity.public_key)
    assert.equal(unlocked.privateKey.extractable,false)
  })

  it('a bearer token or wrong recovery secret cannot unlock the server-held vault', async () => {
    await assert.rejects(unlockMessagingIdentity(a.identity,'eyJhbGciOiJIUzI1NiJ9.stolen-session.signature'),/Impossible de déchiffrer/)
    await assert.rejects(unlockMessagingIdentity(a.identity,b.recoverySecret),/Impossible de déchiffrer/)
    await assert.rejects(unlockMessagingIdentity(a.identity,'LSNB1-password'),/Impossible de déchiffrer/)
    await assert.rejects(unlockMessagingIdentity({...a.identity,user_id:b.identity.user_id},a.recoverySecret),/Impossible de déchiffrer/)
    await assert.rejects(unlockMessagingIdentity({...a.identity,public_key:b.identity.public_key},a.recoverySecret),/Impossible de déchiffrer/)
    await assert.rejects(unlockMessagingIdentity({...a.identity,encrypted_private_key:{...a.identity.encrypted_private_key,ct:alter(a.identity.encrypted_private_key.ct)}},a.recoverySecret),/Impossible de déchiffrer/)
  })

  it('both participants decrypt history after unlocking on a new device; a third identity cannot', async () => {
    const ctx=context(), text='Bonjour Fatou 👋🏾\nVoici notre échange privé.'
    const body=await encryptMessage(a.unlocked,b.identity.public_key,ctx,text)
    assert.equal(isEncryptedMessage(body),true); assert.equal(body.includes('Bonjour'),false)
    assert.equal(await decryptMessage(a.unlocked,b.identity.public_key,ctx,body),text)
    const recovered=await unlockMessagingIdentity(b.identity,b.recoverySecret)
    assert.equal(await decryptMessage(recovered,a.identity.public_key,ctx,body),text)
    await assert.rejects(decryptMessage(c.unlocked,a.identity.public_key,ctx,body),/Impossible de déchiffrer/)
    const replyContext={...ctx,senderId:ctx.recipientId,recipientId:ctx.senderId,clientNonce:randomUUID()}
    const reply=await encryptMessage(b.unlocked,a.identity.public_key,replyContext,'Ma réponse')
    assert.equal(await decryptMessage(a.unlocked,b.identity.public_key,replyContext,reply),'Ma réponse')
  })

  it('authenticates ciphertext, public-key fingerprints and every routing field', async () => {
    const ctx=context(), body=await encryptMessage(a.unlocked,b.identity.public_key,ctx,'Une information personnelle')
    const envelope=JSON.parse(body)
    for(const field of ['ct','salt','iv','sender_key','recipient_key']) {
      await assert.rejects(decryptMessage(b.unlocked,a.identity.public_key,ctx,JSON.stringify({...envelope,[field]:alter(envelope[field])})),/Impossible de déchiffrer/)
    }
    for(const field of ['conversationId','senderId','recipientId','clientNonce']) {
      await assert.rejects(decryptMessage(b.unlocked,a.identity.public_key,{...ctx,[field]:randomUUID()},body),/Impossible de déchiffrer/)
    }
    await assert.rejects(decryptMessage(b.unlocked,c.identity.public_key,ctx,body),/Impossible de déchiffrer/)
    await assert.rejects(decryptMessage(b.unlocked,a.identity.public_key,{...ctx,senderId:ctx.recipientId,recipientId:ctx.senderId},body),/Impossible de déchiffrer/)
  })

  it('rejects plaintext, downgraded algorithms, malformed encodings and oversized envelopes', async () => {
    const ctx=context(), body=await encryptMessage(a.unlocked,b.identity.public_key,ctx,'Message')
    const parsed=JSON.parse(body)
    for(const bad of ['Bonjour',JSON.stringify({...parsed,v:0}),JSON.stringify({...parsed,alg:null}),JSON.stringify({...parsed,iv:'A'}),
      JSON.stringify({...parsed,ct:'x'.repeat(22000)}),JSON.stringify({...parsed,extra:'plaintext'}),JSON.stringify({...parsed,salt:parsed.salt+'='})]) {
      assert.equal(isEncryptedMessage(bad),false)
      await assert.rejects(decryptMessage(b.unlocked,a.identity.public_key,ctx,bad))
    }
  })

  it('uses a fresh salt and IV for each encryption and handles the full 4000-codepoint bound', async () => {
    const ctx=context(), one=await encryptMessage(a.unlocked,b.identity.public_key,ctx,'Bonjour'), two=await encryptMessage(a.unlocked,b.identity.public_key,ctx,'Bonjour')
    assert.notEqual(JSON.parse(one).salt,JSON.parse(two).salt); assert.notEqual(JSON.parse(one).iv,JSON.parse(two).iv)
    assert.notEqual(one,two)
    const max='🙂'.repeat(4000), maxContext=context(), body=await encryptMessage(a.unlocked,b.identity.public_key,maxContext,max)
    assert.ok(body.length<24000); assert.equal(isEncryptedMessage(body),true)
    assert.equal(await decryptMessage(b.unlocked,a.identity.public_key,maxContext,body),max)
    await assert.rejects(encryptMessage(a.unlocked,b.identity.public_key,ctx,' '),/entre 1 et 4 000/)
    await assert.rejects(encryptMessage(a.unlocked,b.identity.public_key,ctx,'a'.repeat(4001)),/entre 1 et 4 000/)
    await assert.rejects(encryptMessage(b.unlocked,a.identity.public_key,ctx,'Usurpation'))
  })
})
