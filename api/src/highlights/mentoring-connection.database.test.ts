import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { answerRequest, applyMigration, asMember, createMigratedDatabase, INTRODUCTION, seedMember, sendRequest } from './testDatabase.ts'

const MIGRATION = '20261106101133_mentoring_asks_to_connect.sql'
let db: PGlite
type Request = { id: string; request_kind: string; status: string; requester_id: string; message: string }

const requestRows = (viewer: string, other: string) => asMember(db, viewer, async () => (await db.query<Request>(
  `select id, request_kind, status, requester_id, message from public.connection_requests
   where (requester_id = $1 and recipient_id = $2) or (requester_id = $2 and recipient_id = $1)`, [viewer, other])).rows)

/** The requests between two members as the first one reads them: "kind status sent|received". */
const requestsBetween = async (viewer: string, other: string) => (await requestRows(viewer, other))
  .map((row) => `${row.request_kind} ${row.status} ${row.requester_id === viewer ? 'sent' : 'received'}`).sort()

const areConnected = (member: string, other: string) => asMember(db, member, async () => (await db.query(
  'select 1 from public.member_connections where member_a = least($1::uuid, $2::uuid) and member_b = greatest($1::uuid, $2::uuid)',
  [member, other])).rows.length === 1)

describe('A mentoring request also asks to connect', { concurrency: false }, () => {
  before(async () => { db = await createMigratedDatabase() })
  beforeEach(async () => { await db.exec('truncate public.weekly_highlights, auth.users cascade') })
  after(async () => { await db?.close() })

  it('sends a connection request along with the mentoring request, with the same message', async () => {
    const student = await seedMember(db, { student: true }); const mentor = await seedMember(db, { mentor: true })
    await sendRequest(db, student, mentor, 'mentoring')
    assert.deepEqual(await requestsBetween(student, mentor), ['connection pending sent', 'mentoring pending sent'])
    assert.deepEqual((await requestRows(mentor, student)).map((row) => row.message), [INTRODUCTION, INTRODUCTION])
  })

  it('sends nothing more with a connection request', async () => {
    const member = await seedMember(db); const mentor = await seedMember(db, { mentor: true })
    await sendRequest(db, member, mentor)
    assert.deepEqual(await requestsBetween(member, mentor), ['connection pending sent'])
  })

  it('adds no connection request when the members are connected or a connection request is already waiting', async () => {
    const connected = await seedMember(db); const mentor = await seedMember(db, { mentor: true })
    await answerRequest(db, mentor, (await sendRequest(db, connected, mentor)).id)
    await sendRequest(db, connected, mentor, 'mentoring')
    assert.deepEqual(await requestsBetween(connected, mentor), ['connection accepted sent', 'mentoring pending sent'])

    const invited = await seedMember(db); const inviting = await seedMember(db, { mentor: true })
    await sendRequest(db, inviting, invited)
    await sendRequest(db, invited, inviting, 'mentoring')
    assert.deepEqual(await requestsBetween(invited, inviting), ['connection pending received', 'mentoring pending sent'])

    const early = await seedMember(db); const asked = await seedMember(db, { mentor: true })
    await sendRequest(db, early, asked)
    await sendRequest(db, early, asked, 'mentoring')
    assert.deepEqual(await requestsBetween(early, asked), ['connection pending sent', 'mentoring pending sent'])
  })

  it('connects the members once the mentor accepts, leaving the mentoring request as their only one', async () => {
    const student = await seedMember(db, { student: true }); const mentor = await seedMember(db, { mentor: true })
    const mentoring = await sendRequest(db, student, mentor, 'mentoring')
    await answerRequest(db, mentor, mentoring.id)
    assert.equal(await areConnected(student, mentor), true)
    assert.deepEqual(await requestsBetween(student, mentor), ['mentoring accepted sent'])
  })

  it('connects them too when the mentor had asked to connect first', async () => {
    const student = await seedMember(db, { student: true }); const mentor = await seedMember(db, { mentor: true })
    await sendRequest(db, mentor, student)
    const mentoring = await sendRequest(db, student, mentor, 'mentoring')
    await answerRequest(db, mentor, mentoring.id)
    assert.equal(await areConnected(student, mentor), true)
    assert.deepEqual(await requestsBetween(student, mentor), ['mentoring accepted sent'])
  })

  it('leaves the connection request to answer on its own when the mentoring is declined', async () => {
    const student = await seedMember(db, { student: true }); const mentor = await seedMember(db, { mentor: true })
    const mentoring = await sendRequest(db, student, mentor, 'mentoring')
    await answerRequest(db, mentor, mentoring.id, 'declined')
    assert.deepEqual(await requestsBetween(student, mentor), ['connection pending sent', 'mentoring declined sent'])
    assert.equal(await areConnected(student, mentor), false)
    const companion = (await requestRows(mentor, student)).find((row) => row.request_kind === 'connection')
    await answerRequest(db, mentor, companion!.id)
    assert.equal(await areConnected(student, mentor), true)
  })
})

describe('Members already in a mentorship when the rule arrives', { concurrency: false }, () => {
  it('are connected through their active mentorship, not through an ended one', async () => {
    const earlier = await createMigratedDatabase({ before: MIGRATION })
    try {
      const mentee = await seedMember(earlier, { student: true }); const mentor = await seedMember(earlier, { mentor: true })
      const formerMentee = await seedMember(earlier, { student: true })
      const active = await sendRequest(earlier, mentee, mentor, 'mentoring')
      await answerRequest(earlier, mentor, active.id)
      await answerRequest(earlier, mentor, (await sendRequest(earlier, formerMentee, mentor, 'mentoring')).id)
      await asMember(earlier, mentor, () => earlier.query(
        'update public.mentorships set ended_at = now() where mentor_id = $1 and mentee_id = $2', [mentor, formerMentee]))
      await applyMigration(earlier, MIGRATION)
      const connections = await earlier.query<{ member_a: string; member_b: string; request_id: string }>(
        'select member_a, member_b, request_id from public.member_connections')
      assert.deepEqual(connections.rows, [{ member_a: [mentee, mentor].sort()[0], member_b: [mentee, mentor].sort()[1], request_id: active.id }])
    } finally {
      await earlier.close()
    }
  })
})
