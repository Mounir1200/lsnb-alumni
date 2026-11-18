import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { signedCalls } from '../../../src/lib/messagingData.ts'
import { asSession, createMigratedDatabase, seedMessagingMember, signedCall, signInForMessaging, type MessagingMember } from './testDatabase.ts'

let db: PGlite
let fatou: MessagingMember, phone: MessagingMember

const unread = (member: MessagingMember) => signedCall(db, member, 'messaging_unread_count', [], signedCalls.unread())
const removeDevice = (member: MessagingMember, session: string) =>
  signedCall(db, member, 'messaging_revoke_device', [session], signedCalls.revoke(session))
const registerAgain = (member: MessagingMember) => asSession(db, member, () => db.query('select public.messaging_register_device()'))

describe('Removing a messaging device', { concurrency: false }, () => {
  before(async () => { db = await createMigratedDatabase({ messaging: true }) })
  beforeEach(async () => {
    await db.exec('truncate auth.users cascade')
    fatou = await seedMessagingMember(db, { email: 'fatou@example.test', firstName: 'Fatou' })
    phone = await signInForMessaging(db, fatou.id)
  })
  after(async () => { await db?.close() })

  it('signs the removed device out, so it cannot take a new key even minutes after its sign-in', async () => {
    await removeDevice(fatou, phone.session)
    await assert.rejects(registerAgain(phone), /Sign in again/)
    await assert.rejects(unread(phone), /Sign in again/)
    await unread(fatou)
  })

  it('never ends the sign-in of another member', async () => {
    const awa = await seedMessagingMember(db, { email: 'awa@example.test', firstName: 'Awa' })
    await removeDevice(awa, phone.session)
    await unread(phone)
  })
})
