import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { signedCalls } from '../../../src/lib/messagingData.ts'
import { REPORTED_MESSAGE_COUNT } from '../../../src/lib/safety.ts'
import {
  answerRequest, asMember, createMigratedDatabase, seedMember, seedMessagingMember, sendRequest, signedCall, type MessagingMember,
} from './testDatabase.ts'

let db: PGlite
const DAILY_REPORTS = 5

type StoredReport = { reporter_id: string | null; reason: string; details: string; status: string; conversation_id: string | null; evidence: Uint8Array | null }
type HubMessage = { from: string; text: string }
type HubReport = {
  id: string; reason: string; details: string; status: string; resolution: string | null
  reported: { id: string; graduation_year: number | null }; reporter: { id: string } | null; messages: HubMessage[] | null
}

const report = (reporter: string, reported: string, reason = 'harassment', details = '') =>
  asMember(db, reporter, () => db.query('select public.report_member($1, $2, $3)', [reported, reason, details]))
const storedReportsAbout = async (reported: string) => (await db.query<StoredReport>(
  `select reporter_id, reason, details, status, conversation_id, evidence from private.member_reports
   where reported_id = $1 order by created_at`, [reported])).rows
const hubReports = async (staff: string, status = 'open') => asMember(db, staff, async () =>
  (await db.query<{ value: { items: HubReport[]; total: number } }>('select public.hub_reports($1, 1) as value', [status])).rows[0]!.value)
const settle = (staff: string, reportId: string, outcome = 'resolved', note = 'Membre averti, propos retirés.') =>
  asMember(db, staff, () => db.query('select public.hub_resolve_report($1, $2, $3)', [reportId, outcome, note]))
const makeStaff = (member: string, role: 'admin' | 'moderator', promotion: number | null) =>
  db.query('insert into private.hub_staff (user_id, role, graduation_year) values ($1, $2, $3)', [member, role, promotion])

async function conversationBetween(first: MessagingMember, second: MessagingMember) {
  const conversation = (await sendRequest(db, first.id, second.id, 'contact')).id
  await answerRequest(db, second.id, conversation)
  return conversation
}
function sendMessage(member: MessagingMember, conversation: string, text: string) {
  const nonce = randomUUID()
  return signedCall(db, member, 'messaging_send_message', [conversation, text, nonce], signedCalls.send(conversation, nonce, text))
}
function reportConversation(member: MessagingMember, conversation: string, reason = 'harassment', details = 'Messages insistants.') {
  return signedCall(db, member, 'messaging_report_conversation', [conversation, reason, details], signedCalls.report(conversation, reason, details))
}

describe('Reporting a member', { concurrency: false }, () => {
  before(async () => { db = await createMigratedDatabase({ messaging: true }) })
  beforeEach(async () => { await db.exec('truncate public.weekly_highlights, auth.users cascade; truncate private.member_reports') })
  after(async () => { await db?.close() })

  it('files an open report that neither member can read back', async () => {
    const reporter = await seedMember(db); const reported = await seedMember(db)
    await report(reporter, reported, 'scam', '  Il demande de l’argent pour un stage.  ')
    const [stored] = await storedReportsAbout(reported)
    assert.deepEqual([stored?.reporter_id, stored?.reason, stored?.details, stored?.status, stored?.evidence],
      [reporter, 'scam', 'Il demande de l’argent pour un stage.', 'open', null])
    for (const member of [reporter, reported]) {
      await asMember(db, member, () => assert.rejects(db.query('select * from private.member_reports'), /permission denied/))
    }
  })

  it('checks the reason and the details before filing', async () => {
    const reporter = await seedMember(db); const reported = await seedMember(db)
    await assert.rejects(report(reporter, reported, 'rumour'), /reason/)
    await assert.rejects(report(reporter, reported, 'other', 'court'), /10 to 1000/)
    await assert.rejects(report(reporter, reported, 'harassment', 'x'.repeat(1001)), /10 to 1000/)
    await assert.rejects(report(reporter, reporter), /yourself/)
    await assert.rejects(report(reporter, randomUUID()), /not found/)
    await report(reporter, reported, 'other', 'Il se fait passer pour un professeur.')
    assert.equal((await storedReportsAbout(reported)).length, 1)
  })

  it('keeps one open report per member and five reports a day per reporter', async () => {
    const reporter = await seedMember(db); const first = await seedMember(db)
    await report(reporter, first)
    await assert.rejects(report(reporter, first), /already reported/)
    for (let count = 1; count < DAILY_REPORTS; count++) await report(reporter, await seedMember(db))
    await assert.rejects(report(reporter, await seedMember(db)), /wait/)
    // Older reports leave the daily count.
    await db.query("update private.member_reports set created_at = created_at - interval '25 hours' where reporter_id = $1", [reporter])
    await report(reporter, await seedMember(db))
  })

  it('refuses visitors and members without an active account', async () => {
    const reported = await seedMember(db); const inactive = await seedMember(db, { inactive: true })
    await asMember(db, null, () => assert.rejects(db.query("select public.report_member($1, 'scam', '')", [reported]), /permission denied/), 'anon')
    await assert.rejects(report(inactive, reported), /active member/)
  })

  it('hands moderators the latest messages of a reported conversation, sealed like the messages', async () => {
    const reporter = await seedMessagingMember(db); const reported = await seedMessagingMember(db)
    const conversation = await conversationBetween(reporter, reported)
    for (let index = 1; index <= REPORTED_MESSAGE_COUNT + 1; index++) {
      await sendMessage(index % 2 ? reported : reporter, conversation, `Message ${index}`)
    }
    await reportConversation(reporter, conversation)
    const [stored] = await storedReportsAbout(reported.id)
    assert.equal(stored?.conversation_id, conversation)
    assert.ok(stored?.evidence)
    assert.doesNotMatch(Buffer.from(stored.evidence).toString('latin1'), /Message \d/)
  })

  it('needs the device signature and a member of the conversation', async () => {
    const reporter = await seedMessagingMember(db); const reported = await seedMessagingMember(db); const stranger = await seedMessagingMember(db)
    const conversation = await conversationBetween(reporter, reported)
    await assert.rejects(signedCall(db, reporter, 'messaging_report_conversation', [conversation, 'harassment', ''],
      signedCalls.report(conversation, 'scam', '')), /Invalid or expired messaging proof/)
    await assert.rejects(reportConversation(stranger, conversation), /accepted conversation is required/)
    assert.deepEqual(await storedReportsAbout(reported.id), [])
  })
})

describe('Settling reports in the hub', { concurrency: false }, () => {
  let admin: string, moderator: string, colleague: string, samePromotion: string, otherPromotion: string, reporter: string

  before(async () => { db = await createMigratedDatabase({ messaging: true }) })
  beforeEach(async () => {
    await db.exec('truncate public.weekly_highlights, auth.users cascade; truncate private.member_reports')
    admin = await seedMember(db, { graduationYear: 2019 }); await makeStaff(admin, 'admin', null)
    moderator = await seedMember(db, { graduationYear: 2021 }); await makeStaff(moderator, 'moderator', 2021)
    colleague = await seedMember(db, { graduationYear: 2021 }); await makeStaff(colleague, 'moderator', 2021)
    samePromotion = await seedMember(db, { graduationYear: 2021 })
    otherPromotion = await seedMember(db, { graduationYear: 2022 })
    reporter = await seedMember(db, { graduationYear: 2023 })
    for (const reported of [samePromotion, otherPromotion, colleague]) await report(reporter, reported)
  })
  after(async () => { await db?.close() })

  it('shows administrators every report, and moderators those about their promotion except team members', async () => {
    assert.equal((await hubReports(admin)).total, 3)
    const seenByModerator = await hubReports(moderator)
    assert.deepEqual(seenByModerator.items.map((item) => item.reported.id), [samePromotion])
    assert.equal(seenByModerator.items[0]?.reporter?.id, reporter)
    await assert.rejects(hubReports(reporter), /staff access required/)
  })

  it('shows staff the reported conversation, oldest kept message first', async () => {
    const author = await seedMessagingMember(db); const target = await seedMessagingMember(db)
    const conversation = await conversationBetween(author, target)
    for (let index = 1; index <= REPORTED_MESSAGE_COUNT + 2; index++) {
      await sendMessage(index % 2 ? target : author, conversation, `Message ${index}`)
    }
    await reportConversation(author, conversation)
    const item = (await hubReports(admin)).items.find((entry) => entry.reported.id === target.id)
    const messages = item?.messages ?? []
    assert.equal(messages.length, REPORTED_MESSAGE_COUNT)
    // Messages 1 and 2 are left out; odd ones came from the reported member.
    assert.deepEqual([messages[0]?.from, messages[0]?.text], ['reported', 'Message 3'])
    assert.deepEqual([messages.at(-1)?.from, messages.at(-1)?.text], ['reporter', `Message ${REPORTED_MESSAGE_COUNT + 2}`])
  })

  it('settles a report once, with an outcome and a note, and writes it to the journal', async () => {
    const [item] = (await hubReports(moderator)).items
    await assert.rejects(settle(moderator, item!.id, 'ignored'), /outcome/)
    await assert.rejects(settle(moderator, item!.id, 'resolved', 'Vu.'), /10 to 500/)
    await settle(moderator, item!.id)
    await assert.rejects(settle(admin, item!.id), /already settled/)
    const handled = await hubReports(admin, 'handled')
    assert.deepEqual(handled.items.map((entry) => [entry.status, entry.resolution]), [['resolved', 'Membre averti, propos retirés.']])
    assert.equal((await hubReports(moderator)).total, 0)
    const journal = await db.query<{ action: string; target_id: string; reason: string }>(
      "select action, target_id, reason from private.hub_audit where action like 'report_%'")
    assert.deepEqual(journal.rows, [{ action: 'report_resolved', target_id: samePromotion, reason: 'Membre averti, propos retirés.' }])
  })

  it('keeps moderators to their scope and out of the reports they filed', async () => {
    const outside = (await hubReports(admin)).items.find((item) => item.reported.id === otherPromotion)!
    await assert.rejects(settle(moderator, outside.id), /outside your scope/)
    await report(moderator, otherPromotion)
    await db.query('update public.profiles set graduation_year = 2021 where id = $1', [otherPromotion])
    const own = (await hubReports(moderator)).items.find((item) => item.reporter?.id === moderator)!
    await assert.rejects(settle(moderator, own.id, 'dismissed'), /filed yourself/)
    await settle(admin, own.id, 'dismissed', 'Doublon d’un autre signalement.')
  })
})
