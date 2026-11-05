import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { answerRequest, asMember, createMigratedDatabase, seedMember, sendRequest } from './testDatabase.ts'

let db: PGlite
type Job = { job_id: string; lease_token: string; request_id: string; event: string; request_kind: string; email: string }

const claim = () => asMember(db, null, async () =>
  (await db.query<Job>('select * from public.request_claim_notifications(20)')).rows, 'service_role')
const finish = (job: Job, success = true, token = job.lease_token) => asMember(db, null, () =>
  db.query('select public.request_finish_notification($1, $2, $3)', [job.job_id, token, success]), 'service_role')
const summary = (jobs: Job[]) => jobs.map((job) => `${job.event} ${job.request_kind} ${job.email}`).sort()

describe('Email notifications for requests and acceptances', { concurrency: false }, () => {
  before(async () => { db = await createMigratedDatabase() })
  beforeEach(async () => {
    await db.exec('truncate public.weekly_highlights, auth.users cascade; update private.hub_maintenance set enabled = false, ends_at = null')
  })
  after(async () => { await db?.close() })

  it('tells the recipient of a connection or mentoring request, never of a plain contact', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const mentor = await seedMember(db, { mentor: true, email: 'mentor@example.test' })
    const other = await seedMember(db, { email: 'other@example.test' })
    const connection = await sendRequest(db, awa, other)
    await sendRequest(db, awa, mentor, 'mentoring')
    await sendRequest(db, other, mentor, 'contact')
    const jobs = await claim()
    assert.deepEqual(summary(jobs), ['received connection other@example.test', 'received mentoring mentor@example.test'])
    assert.equal(jobs.find((job) => job.request_kind === 'connection')?.request_id, connection.id)
    assert.deepEqual(await claim(), [])
  })

  it('tells the requester once their request is accepted, not when it is declined', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const binta = await seedMember(db, { email: 'binta@example.test' })
    const chris = await seedMember(db, { email: 'chris@example.test' })
    const accepted = await sendRequest(db, awa, binta)
    const declined = await sendRequest(db, awa, chris)
    for (const job of await claim()) await finish(job)
    await answerRequest(db, binta, accepted.id)
    await answerRequest(db, chris, declined.id, 'declined')
    const jobs = await claim()
    assert.deepEqual(summary(jobs), ['accepted connection awa@example.test'])
    assert.equal(jobs[0]?.request_id, accepted.id)
  })

  it('sends nothing for a request answered or withdrawn before its email left', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const binta = await seedMember(db, { email: 'binta@example.test' })
    const chris = await seedMember(db, { email: 'chris@example.test' })
    const answered = await sendRequest(db, awa, binta)
    const withdrawn = await sendRequest(db, awa, chris)
    await answerRequest(db, binta, answered.id)
    await asMember(db, awa, () => db.query('delete from public.connection_requests where id = $1', [withdrawn.id]))
    assert.deepEqual(summary(await claim()), ['accepted connection awa@example.test'])
  })

  it('respects members who turned email alerts off or lost access', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const quiet = await seedMember(db, { email: 'quiet@example.test' })
    const leaving = await seedMember(db, { email: 'leaving@example.test' })
    await db.query('insert into private.messaging_members (user_id, email_enabled) values ($1, false)', [quiet])
    await sendRequest(db, awa, quiet)
    await sendRequest(db, awa, leaving)
    await db.query('update public.profiles set is_active = false where id = $1', [leaving])
    assert.deepEqual(await claim(), [])
    const statuses = await db.query<{ status: string }>('select status from private.request_email_queue')
    assert.deepEqual(statuses.rows.map((row) => row.status), ['cancelled', 'cancelled'])
  })

  it('retries a failed delivery with a new lease and never claims a sent email again', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const binta = await seedMember(db, { email: 'binta@example.test' })
    await sendRequest(db, awa, binta)
    const [first] = await claim()
    await assert.rejects(finish(first!, true, '00000000-0000-4000-8000-000000000000'), /lease/)
    await finish(first!, false)
    assert.deepEqual(await claim(), [], 'waits before retrying')
    await db.exec('update private.request_email_queue set next_attempt_at = clock_timestamp()')
    const [retry] = await claim()
    assert.equal(retry?.job_id, first!.job_id)
    assert.notEqual(retry?.lease_token, first!.lease_token)
    await finish(retry!)
    await db.exec('update private.request_email_queue set next_attempt_at = clock_timestamp()')
    assert.deepEqual(await claim(), [])
  })

  it('keeps request emails within their daily budget', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const binta = await seedMember(db, { email: 'binta@example.test' })
    await db.exec(`set session_replication_role = replica;
      insert into public.connection_requests (requester_id, recipient_id, request_kind, message, status)
        select '${awa}', '${binta}', 'connection', 'Une ancienne demande déjà traitée.', 'declined' from generate_series(1, 60);
      insert into private.request_email_queue (request_id, recipient_id, event, status, attempts, first_attempt_at, finished_at)
        select id, recipient_id, 'received', 'sent', 1, clock_timestamp(), clock_timestamp() from public.connection_requests;
      set session_replication_role = origin;`)
    await sendRequest(db, awa, binta)
    assert.deepEqual(await claim(), [])
  })

  it('lets only the server role claim or finish notifications', async () => {
    const awa = await seedMember(db)
    await asMember(db, awa, () => assert.rejects(db.query('select * from public.request_claim_notifications(5)'), /permission denied/))
    await asMember(db, awa, () => assert.rejects(db.query('select * from private.request_email_queue'), /permission denied/))
  })
})
