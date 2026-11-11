import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { asMember, createMigratedDatabase, seedMember } from './testDatabase.ts'

type Job = { job_id: string; lease_token: string; email: string; waiting: number; promotion: number | null }

const DAILY_BUDGET = 20

describe('E-mails asking the team to approve newcomers', { concurrency: false }, () => {
  let db: PGlite
  let owner: string, admin: string, moderator: string, otherModerator: string

  const signUp = async (email: string, graduationYear: number, confirmed = true) => (await db.query<{ id: string }>(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
     values (gen_random_uuid(), $1, case when $2 then clock_timestamp() end, $3, '{"provider":"email"}') returning id`,
    [email, confirmed, JSON.stringify({ first_name: 'Nouveau', last_name: 'Venu', member_role: 'alumni', graduation_year: graduationYear })])).rows[0]!.id
  const confirm = (id: string) => db.query('update auth.users set email_confirmed_at = clock_timestamp() where id = $1', [id])
  const queued = async () => (await db.query<{ recipient_id: string }>(
    "select recipient_id from private.approval_email_queue where status = 'pending' order by recipient_id")).rows.map((row) => row.recipient_id)
  const claim = async () => (await db.query<Job>('select * from public.hub_claim_approval_emails(10)')).rows
  const finish = (job: Job, success = true) =>
    db.query('select public.hub_finish_approval_email($1, $2, $3)', [job.job_id, job.lease_token, success])
  const asStaff = async <T = any>(id: string, sql: string, params: unknown[] = []) =>
    asMember(db, id, async () => (await db.query<{ value: T }>(sql, params)).rows[0]!.value)
  const sorted = (ids: string[]) => [...ids].sort()

  before(async () => { db = await createMigratedDatabase() })
  after(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('truncate auth.users, private.hub_audit, private.approval_email_budget cascade')
    owner = await seedMember(db, { email: 'owner@example.test', graduationYear: 2018 })
    admin = await seedMember(db, { email: 'admin@example.test', graduationYear: 2019 })
    moderator = await seedMember(db, { email: 'moderator@example.test', graduationYear: 2020 })
    otherModerator = await seedMember(db, { email: 'other-moderator@example.test', graduationYear: 2021 })
    await db.query(`insert into private.hub_staff (user_id, role, graduation_year)
      values ($1, 'super_admin', null), ($2, 'admin', null), ($3, 'moderator', 2020), ($4, 'moderator', 2021)`,
    [owner, admin, moderator, otherModerator])
  })

  it('puts a newcomer forward once their address is confirmed, to their promotion’s moderators and every administrator', async () => {
    const newcomer = await signUp('newcomer@example.test', 2020, false)
    assert.deepEqual(await queued(), [])
    await confirm(newcomer)
    assert.deepEqual(await queued(), sorted([owner, admin, moderator]))
  })

  it('puts a Google newcomer forward when their profile is complete', async () => {
    const google = (await db.query<{ id: string }>(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
      values (gen_random_uuid(), 'google@example.test', '{"full_name":"Awa Test"}', '{"provider":"google"}') returning id`)).rows[0]!.id
    assert.deepEqual(await queued(), [])
    await asMember(db, google, () => db.query(`select public.complete_member_profile('Awa', 'Test', 'alumni', 2021, 'Sciences',
      'Paris', 'France', 'Développement logiciel', null, true, false, true)`))
    assert.deepEqual(await queued(), sorted([owner, admin, otherModerator]))
  })

  it('sends each team member one e-mail that counts what waits in their scope, then keeps quiet for twelve hours', async () => {
    await signUp('first@example.test', 2020)
    const jobs = await claim()
    assert.deepEqual(jobs.map((job) => [job.email, job.waiting, job.promotion]).sort(), [
      ['admin@example.test', 1, null], ['moderator@example.test', 1, 2020], ['owner@example.test', 1, null],
    ])
    for (const job of jobs) await finish(job)
    await signUp('second@example.test', 2020)
    assert.deepEqual(await claim(), [])
    await db.exec(`update private.approval_email_queue
      set last_sent_at = last_sent_at - interval '13 hours', next_attempt_at = next_attempt_at - interval '13 hours'`)
    assert.deepEqual((await claim()).map((job) => job.waiting), [2, 2, 2])
  })

  it('drops an e-mail once nothing waits any more', async () => {
    const newcomer = await signUp('newcomer@example.test', 2020)
    await asMember(db, moderator, () => db.query('select public.hub_approve_member($1)', [newcomer]))
    assert.deepEqual(await claim(), [])
    assert.deepEqual(await queued(), [])
  })

  it('never sends more than twenty approval e-mails a day', async () => {
    await signUp('newcomer@example.test', 2020)
    assert.equal((await claim()).length, 3)
    const budget = async () => Number((await db.query<{ n: number }>('select first_attempts as n from private.approval_email_budget')).rows[0]!.n)
    assert.equal(await budget(), 3)
    await db.exec(`update private.approval_email_budget set first_attempts = ${DAILY_BUDGET}`)
    await db.exec("update private.approval_email_queue set status = 'pending', first_attempt_at = null, lease_until = null, lease_token = null")
    assert.deepEqual(await claim(), [])
    assert.equal((await queued()).length, 3)
  })

  it('retries a failed e-mail later, and keeps the queue from members and visitors', async () => {
    await signUp('newcomer@example.test', 2020)
    const [job] = await claim()
    await finish(job!, false)
    const retry = (await db.query<{ status: string; due_later: boolean }>(
      'select status, next_attempt_at > clock_timestamp() as due_later from private.approval_email_queue where id = $1', [job!.job_id])).rows[0]
    assert.deepEqual(retry, { status: 'pending', due_later: true })
    await assert.rejects(asMember(db, admin, () => db.query('select * from public.hub_claim_approval_emails(5)')), /permission denied/)
    await assert.rejects(asMember(db, null, () =>
      db.query('select public.hub_finish_approval_email(gen_random_uuid(), gen_random_uuid(), true)'), 'anon'), /permission denied/)
  })

  it('keeps unconfirmed sign-ups out of the hub’s list and badges', async () => {
    await signUp('unconfirmed@example.test', 2020, false)
    const confirmed = await signUp('confirmed@example.test', 2020)
    const list = await asStaff<{ items: { id: string; awaits_approval: boolean }[] }>(moderator, "select public.hub_members('', null, 'pending', 1) as value")
    assert.deepEqual(list.items.map((member) => [member.id, member.awaits_approval]), [[confirmed, true]])
    assert.equal((await asStaff<{ pending_approvals: number }>(moderator, 'select public.hub_context() as value')).pending_approvals, 1)
  })
})
