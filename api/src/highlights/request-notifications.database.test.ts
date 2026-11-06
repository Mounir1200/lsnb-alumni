import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { createNotificationScheduler } from '../messaging/scheduler.js'
import { INTRODUCTION, answerRequest, asMember, createMigratedDatabase, seedMember, sendRequest } from './testDatabase.ts'

let db: PGlite
type Job = { job_id: string; lease_token: string; request_id: string; event: string; request_kind: string; email: string }
type RoundCall = { url: string; authorization: string; body: unknown; timeout_milliseconds: number }

const TOKEN = 'a'.repeat(64)
const ROUND_CALL: RoundCall = { url: 'https://lsnb-alumni-api.onrender.com/messaging/notifications/run',
  authorization: `Bearer ${TOKEN}`, body: {}, timeout_milliseconds: 120000 }
/** pg_net and Vault as Supabase provides them, reduced to what the request queue uses. */
const SUPABASE_STUBS = `
  create schema net;
  create table net.calls (url text, headers jsonb, body jsonb, timeout_milliseconds integer);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
    headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint
    language sql as 'insert into net.calls values ($1, $4, $2, $5); select 1::bigint';
  create schema vault;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);`

const claim = () => asMember(db, null, async () =>
  (await db.query<Job>('select * from public.request_claim_notifications(20)')).rows, 'service_role')
const finish = (job: Job, success = true, token = job.lease_token) => asMember(db, null, () =>
  db.query('select public.request_finish_notification($1, $2, $3)', [job.job_id, token, success]), 'service_role')
const summary = (jobs: Job[]) => jobs.map((job) => `${job.event} ${job.request_kind} ${job.email}`).sort()
const storeToken = (token: string) => db.query(`insert into vault.decrypted_secrets values ('messaging_scheduler_token', $1)
  on conflict (name) do update set decrypted_secret = excluded.decrypted_secret`, [token])
const roundCalls = async () => (await db.query<RoundCall>(
  "select url, headers->>'Authorization' as authorization, body, timeout_milliseconds from net.calls")).rows
const withdraw = (requester: string, requestId: string) =>
  asMember(db, requester, () => db.query('delete from public.connection_requests where id = $1', [requestId]))

describe('Email notifications for requests and acceptances', { concurrency: false }, () => {
  before(async () => {
    db = await createMigratedDatabase()
    await db.exec(SUPABASE_STUBS)
  })
  beforeEach(async () => {
    await db.exec('truncate public.weekly_highlights, auth.users, net.calls cascade; update private.hub_maintenance set enabled = false, ends_at = null')
    await storeToken(TOKEN)
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

  it('sends one email for a mentoring request, though it also asks to connect', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const mentor = await seedMember(db, { mentor: true, email: 'mentor@example.test' })
    await sendRequest(db, awa, mentor, 'mentoring')
    assert.deepEqual(summary(await claim()), ['received mentoring mentor@example.test'])
  })

  it('sends one acceptance email when the accepted mentoring also connects the members', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const mentor = await seedMember(db, { mentor: true, email: 'mentor@example.test' })
    const mentoring = await sendRequest(db, awa, mentor, 'mentoring')
    for (const job of await claim()) await finish(job)
    await answerRequest(db, mentor, mentoring.id)
    assert.deepEqual(summary(await claim()), ['accepted mentoring awa@example.test'])
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

  it('asks the API for a round as soon as an email is queued, once Vault holds its token', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const binta = await seedMember(db, { email: 'binta@example.test' })
    const chris = await seedMember(db, { email: 'chris@example.test' })
    await storeToken('not-a-token')
    const waiting = await sendRequest(db, awa, chris)
    assert.equal(waiting.status, 'pending', 'the request goes through without a token')
    assert.deepEqual(await roundCalls(), [], 'and its email waits for the scheduled round')
    await storeToken(TOKEN)
    const request = await sendRequest(db, awa, binta)
    await answerRequest(db, binta, request.id)
    assert.deepEqual(await roundCalls(), [ROUND_CALL, ROUND_CALL])
  })

  it('computes in the database, from the Brevo key, the token that the API accepts', async () => {
    const brevoKey = 'test-brevo-key-never-log'
    const computed = await db.query<{ token: string }>(
      "select encode(extensions.hmac('lsnb-messaging-scheduler-v1', $1, 'sha256'), 'hex') as token", [brevoKey])
    const scheduler = createNotificationScheduler(brevoKey, async () => ({ claimed: 0, delivered: 0, failed: 0 }))
    assert.ok(scheduler.authorize(computed.rows[0]!.token))
    assert.ok(!scheduler.authorize(TOKEN))
  })

  it('emails a member once a day per requester, so withdrawing and asking again sends nothing more', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const binta = await seedMember(db, { email: 'binta@example.test' })
    const first = await sendRequest(db, awa, binta)
    for (const job of await claim()) await finish(job)
    await withdraw(awa, first.id)
    const again = await sendRequest(db, awa, binta)
    assert.equal(again.status, 'pending', 'the new request is still made')
    assert.deepEqual(await claim(), [])
    assert.equal((await roundCalls()).length, 1)
    await db.exec("update private.request_announcements set announced_at = announced_at - interval '1 day'")
    await withdraw(awa, again.id)
    await sendRequest(db, awa, binta)
    assert.deepEqual(summary(await claim()), ['received connection binta@example.test'], 'a day later, it is announced again')
  })

  it('emails ten members a day at most for one requester; later requests stay on the site', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    for (let index = 0; index < 11; index++) {
      await sendRequest(db, awa, await seedMember(db, { email: `member${index}@example.test` }))
    }
    assert.equal((await claim()).length, 10)
    assert.equal((await roundCalls()).length, 10)
    const requests = await db.query('select id from public.connection_requests where requester_id = $1', [awa])
    assert.equal(requests.rows.length, 11)
  })

  it('lets nobody send or accept a request in another member’s name', async () => {
    const awa = await seedMember(db, { email: 'awa@example.test' })
    const binta = await seedMember(db, { email: 'binta@example.test' })
    const intruder = await seedMember(db, { email: 'intruder@example.test' })
    await assert.rejects(asMember(db, intruder, () => db.query(
      'insert into public.connection_requests (requester_id, recipient_id, request_kind, message) values ($1, $2, $3, $4)',
      [awa, binta, 'connection', INTRODUCTION])), /Only the requester can send a request/)
    const request = await sendRequest(db, awa, binta)
    for (const job of await claim()) await finish(job)
    await answerRequest(db, intruder, request.id)
    assert.deepEqual(await claim(), [])
    const status = await db.query<{ status: string }>('select status from public.connection_requests where id = $1', [request.id])
    assert.equal(status.rows[0]?.status, 'pending')
  })

  it('keeps the log of who asked whom away from members', async () => {
    const awa = await seedMember(db)
    await asMember(db, awa, () => assert.rejects(db.query('select * from private.request_announcements'), /permission denied/))
  })
})
