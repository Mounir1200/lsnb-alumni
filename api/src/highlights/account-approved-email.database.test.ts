import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { applyMigration, asMember, createMigratedDatabase, seedMember } from './testDatabase.ts'

type Job = { job_id: string; lease_token: string; email: string }

const MIGRATION = '20261123090001_account_approved_email.sql'
const DAILY_BUDGET = 30
const TOKEN = 'b'.repeat(64)
const ROUND_CALL = { url: 'https://lsnb-alumni-api.onrender.com/messaging/notifications/run', authorization: `Bearer ${TOKEN}` }
/** pg_net and Vault as Supabase provides them, reduced to what starting a round uses. */
const SUPABASE_STUBS = `
  create schema net;
  create table net.calls (url text, headers jsonb, body jsonb, timeout_milliseconds integer);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
    headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint
    language sql as 'insert into net.calls values ($1, $4, $2, $5); select 1::bigint';
  create schema vault;
  create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
  insert into vault.decrypted_secrets values ('messaging_scheduler_token', '${TOKEN}');`

const claimFrom = (db: PGlite, limit: number | null = 10) => asMember(db, null, async () =>
  (await db.query<Job>('select * from public.claim_account_approved_emails($1)', [limit])).rows, 'service_role')
const approveIn = (db: PGlite, staff: string, member: string) =>
  asMember(db, staff, () => db.query('select public.hub_approve_member($1)', [member]))

describe('The e-mail telling a member the team approved their account', { concurrency: false }, () => {
  let db: PGlite
  let admin: string, moderator: string, newcomer: string

  const claim = (limit?: number | null) => claimFrom(db, limit)
  const emails = async () => (await claim()).map((job) => job.email)
  const finish = (job: Job, success = true, token = job.lease_token) => asMember(db, null, () =>
    db.query('select public.finish_account_approved_email($1, $2, $3)', [job.job_id, token, success]), 'service_role')
  const newMember = (email: string) => seedMember(db, { email, graduationYear: 2020, pending: true })
  const approve = (member: string, staff = moderator) => approveIn(db, staff, member)
  const moderate = (staff: string, member: string, active: boolean) => asMember(db, staff, () =>
    db.query('select public.hub_moderate_member($1, $2, $3)', [member, active, 'Motif vérifié avec la promotion']))
  const statuses = async () => (await db.query<{ status: string }>(
    'select status from private.account_approved_email_queue order by status')).rows.map((row) => row.status)
  const dueNow = () => db.exec('update private.account_approved_email_queue set next_attempt_at = clock_timestamp()')
  const roundsStartedBy = async (action: () => Promise<unknown>) => {
    await db.exec('truncate net.calls')
    await action()
    return (await db.query("select url, headers->>'Authorization' as authorization from net.calls")).rows
  }

  before(async () => {
    db = await createMigratedDatabase()
    await db.exec(SUPABASE_STUBS)
  })
  after(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec(`truncate auth.users, private.hub_audit, private.account_approved_email_budget cascade;
      update private.hub_maintenance set enabled = false, ends_at = null`)
    admin = await seedMember(db, { email: 'admin@example.test', graduationYear: 2018 })
    moderator = await seedMember(db, { email: 'moderator@example.test', graduationYear: 2020 })
    newcomer = await newMember('newcomer@example.test')
    await db.query("insert into private.hub_staff (user_id, role, graduation_year) values ($1, 'admin', null), ($2, 'moderator', 2020)",
      [admin, moderator])
  })

  it('tells the member once, in a round started as soon as the team approves their account', async () => {
    assert.deepEqual(await roundsStartedBy(() => approve(newcomer)), [ROUND_CALL])
    const [job, ...others] = await claim()
    assert.equal(job?.email, 'newcomer@example.test')
    assert.deepEqual(others, [])
    assert.deepEqual(await claim(), [], 'nor is it claimed again while its lease runs')
    await finish(job!)
    await dueNow()
    assert.deepEqual(await claim(), [], 'a sent e-mail never leaves again')
  })

  it('sends nothing when the approval leaves a refused account suspended', async () => {
    await moderate(moderator, newcomer, false)
    await approve(newcomer, admin)
    assert.deepEqual(await claim(), [])
    assert.deepEqual(await statuses(), [])
  })

  it('tells a refused member once their account, restored to the queue, is approved', async () => {
    await moderate(moderator, newcomer, false)
    await moderate(admin, newcomer, true)
    await approve(newcomer)
    assert.deepEqual(await emails(), ['newcomer@example.test'])
  })

  it('never tells an account twice, even approved again after waiting anew', async () => {
    await approve(newcomer)
    await finish((await claim())[0]!)
    await db.query('update public.profiles set approval_pending = true where id = $1', [newcomer])
    assert.deepEqual(await roundsStartedBy(() => approve(newcomer)), [])
    await dueNow()
    assert.deepEqual(await claim(), [])
    assert.deepEqual(await statuses(), ['sent'])
  })

  it('drops the e-mail of an account that lost access, or whose address was never confirmed, before it leaves', async () => {
    const unconfirmed = await newMember('unconfirmed@example.test')
    await db.query('update auth.users set email_confirmed_at = null where id = $1', [unconfirmed])
    await approve(unconfirmed)
    const lostAccess = [
      (id: string) => moderate(moderator, id, false),
      (id: string) => db.query('update public.profiles set is_active = false where id = $1', [id]),
      (id: string) => db.query('insert into private.hub_suspensions (user_id) values ($1)', [id]),
    ]
    for (const [index, loseAccess] of lostAccess.entries()) {
      const member = await newMember(`member${index}@example.test`)
      await approve(member)
      await loseAccess(member)
    }
    assert.deepEqual(await claim(), [])
    assert.deepEqual(await statuses(), ['cancelled', 'cancelled', 'cancelled', 'cancelled'])
  })

  it('forgets the e-mail of an account erased before it leaves', async () => {
    await approve(newcomer)
    await db.query('delete from auth.users where id = $1', [newcomer])
    assert.deepEqual(await claim(), [])
    assert.deepEqual(await statuses(), [])
  })

  it('counts each e-mail once, thirty a day; beyond that, it waits for the next day', async () => {
    const sentToday = async () => (await db.query<{ n: number }>('select first_attempts as n from private.account_approved_email_budget')).rows[0]?.n
    await approve(newcomer)
    await approve(await newMember('second@example.test'))
    const jobs = await claim()
    assert.equal(await sentToday(), 2)
    await finish(jobs[0]!, false)
    await dueNow()
    assert.equal((await claim()).length, 1, 'the failed e-mail is tried again')
    assert.equal(await sentToday(), 2, 'without counting twice')
    await db.exec(`update private.account_approved_email_budget set first_attempts = ${DAILY_BUDGET - 1}`)
    await approve(await newMember('third@example.test'))
    await approve(await newMember('fourth@example.test'))
    assert.deepEqual(await emails(), ['third@example.test'], 'the thirtieth e-mail of the day leaves, the thirty-first waits')
    await db.exec('update private.account_approved_email_budget set day = day - 1')
    assert.deepEqual(await emails(), ['fourth@example.test'], 'until the next day')
  })

  it('retries a failed delivery later, under a new lease', async () => {
    await approve(newcomer)
    const [first] = await claim()
    await assert.rejects(finish(first!, true, '00000000-0000-4000-8000-000000000000'), /lease/)
    await assert.rejects(finish(first!, null as unknown as boolean), /result is required/)
    await finish(first!, false)
    assert.deepEqual(await claim(), [], 'waits before retrying')
    await dueNow()
    const [retry] = await claim()
    assert.equal(retry?.job_id, first!.job_id)
    assert.notEqual(retry?.lease_token, first!.lease_token)
    await assert.rejects(finish(first!), /lease/, 'the first lease no longer counts')
    await db.exec('update private.account_approved_email_queue set lease_until = clock_timestamp()')
    await assert.rejects(finish(retry!), /lease/, 'nor does an expired one')
    await finish((await claim())[0]!)
    assert.deepEqual(await statuses(), ['sent'])
  })

  it('gives up after five attempts, whether the sender reported a failure or never answered', async () => {
    await approve(newcomer)
    await approve(await newMember('silent@example.test'))
    for (let attempt = 1; attempt <= 5; attempt++) {
      const jobs = await claim()
      assert.equal(jobs.length, 2, `attempt ${attempt}`)
      await finish(jobs.find((job) => job.email === 'newcomer@example.test')!, false)
      await db.exec('update private.account_approved_email_queue set next_attempt_at = clock_timestamp(), lease_until = clock_timestamp()')
    }
    assert.deepEqual(await statuses(), ['failed', 'processing'], 'a reported fifth failure ends at once')
    assert.deepEqual(await claim(), [], 'an unanswered fifth attempt ends with the next round')
    assert.deepEqual(await statuses(), ['failed', 'failed'])
  })

  it('gives up rather than retry once Brevo’s thirty-minute idempotency window nears', async () => {
    const minutesLater = (minutes: number) => db.exec(`update private.account_approved_email_queue
      set first_attempt_at = first_attempt_at - interval '${minutes} minutes', next_attempt_at = clock_timestamp()`)
    await approve(newcomer)
    await finish((await claim())[0]!, false)
    await minutesLater(20)
    await finish((await claim())[0]!, false)
    await minutesLater(6)
    assert.deepEqual(await claim(), [], 'twenty-six minutes after the first attempt')
    assert.deepEqual(await statuses(), ['failed'])
  })

  it('holds e-mails back while the site is under maintenance', async () => {
    await approve(newcomer)
    await db.exec('update private.hub_maintenance set enabled = true')
    assert.deepEqual(await claim(), [])
    await db.exec('update private.hub_maintenance set enabled = false')
    assert.deepEqual(await emails(), ['newcomer@example.test'])
  })

  it('claims no more than the round asks for, and only for the server', async () => {
    await approve(newcomer)
    await approve(await newMember('second@example.test'))
    assert.equal((await claim(1)).length, 1)
    for (const size of [0, 101, null]) await assert.rejects(claim(size), /Invalid batch size/)
    await assert.rejects(asMember(db, newcomer, () => db.query('select * from public.claim_account_approved_emails(5)')), /permission denied/)
    await assert.rejects(asMember(db, admin, () => db.query('select * from private.account_approved_email_queue')), /permission denied/)
    await assert.rejects(asMember(db, null, () =>
      db.query('select public.finish_account_approved_email(gen_random_uuid(), gen_random_uuid(), true)'), 'anon'), /permission denied/)
  })
})

describe('Accounts approved before this e-mail existed', () => {
  it('are never told; an account still waiting is, once approved', async () => {
    const db = await createMigratedDatabase({ before: MIGRATION })
    try {
      await db.exec(SUPABASE_STUBS)
      const admin = await seedMember(db, { email: 'admin@example.test', graduationYear: 2018 })
      await db.query("insert into private.hub_staff (user_id, role, graduation_year) values ($1, 'admin', null)", [admin])
      const early = await seedMember(db, { email: 'early@example.test', graduationYear: 2020, pending: true })
      const waiting = await seedMember(db, { email: 'waiting@example.test', graduationYear: 2020, pending: true })
      await approveIn(db, admin, early)
      await applyMigration(db, MIGRATION)
      assert.deepEqual(await claimFrom(db), [])
      await approveIn(db, admin, waiting)
      assert.deepEqual((await claimFrom(db)).map((job) => job.email), ['waiting@example.test'])
    } finally { await db.close() }
  })
})
