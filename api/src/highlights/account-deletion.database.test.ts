import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { answerRequest, asMember, asSession, createMigratedDatabase, seedMember, sendRequest } from './testDatabase.ts'

describe('Members deleting their own account', { concurrency: false }, () => {
  let db: PGlite
  let leaving: string, staying: string, other: string

  const call = (id: string | null, name: string, args: unknown[] = [], role = 'authenticated') => asMember(db, id, () =>
    db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args), role)
  const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n)
  /** The member signed in on this browser `minutesAgo` minutes ago: the session their requests carry. */
  const signIn = async (id: string, minutesAgo = 0) => ({ id, session: (await db.query<{ id: string }>(
    `insert into auth.sessions (id, user_id, created_at) values (gen_random_uuid(), $1, clock_timestamp() - make_interval(mins => $2))
     returning id`, [id, minutesAgo])).rows[0]!.id })
  const asSignedIn = (member: { id: string; session: string }, name: string) =>
    asSession(db, member, async () => (await db.query<{ result: unknown }>(`select public.${name}() as result`)).rows[0]!.result)
  const exists = async (id: string) => await count('select count(*)::int as n from auth.users where id = $1', [id]) === 1

  before(async () => { db = await createMigratedDatabase({ messaging: true }) })
  after(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('truncate auth.users, private.avatar_removal_queue cascade')
    leaving = await seedMember(db, { email: 'leaving@example.test', graduationYear: 2020 })
    staying = await seedMember(db, { email: 'staying@example.test', graduationYear: 2020 })
    other = await seedMember(db, { email: 'other@example.test', graduationYear: 2020 })
  })

  it('erases the account and what is tied to it, and keeps the reports it filed without its name', async () => {
    const request = await sendRequest(db, leaving, staying)
    await answerRequest(db, staying, request.id)
    await call(other, 'block_member', [leaving])
    await call(leaving, 'report_member', [other, 'harassment', 'Messages insistants après un refus.'])
    await db.query("insert into private.hub_staff (user_id, role, graduation_year) values ($1, 'moderator', 2020)", [leaving])

    await asSignedIn(await signIn(leaving), 'delete_my_account')

    assert.equal(await exists(leaving), false)
    assert.equal(await count('select count(*)::int as n from public.profiles where id = $1', [leaving]), 0)
    assert.equal(await count('select count(*)::int as n from public.profile_contacts where profile_id = $1', [leaving]), 0)
    assert.equal(await count('select count(*)::int as n from public.member_connections where $1 in (member_a, member_b)', [leaving]), 0)
    assert.equal(await count('select count(*)::int as n from public.member_blocks where $1 in (blocker_id, blocked_id)', [leaving]), 0)
    assert.equal(await count('select count(*)::int as n from private.hub_staff where user_id = $1', [leaving]), 0)
    const reports = (await db.query('select reporter_id, reported_id from private.member_reports')).rows
    assert.deepEqual(reports, [{ reporter_id: null, reported_id: other }])
  })

  it('erases only the caller’s own account, and never for a visitor', async () => {
    await assert.rejects(call(null, 'delete_my_account', [], 'anon'), /permission denied/)
    await assert.rejects(call(null, 'account_deletion_status', [], 'anon'), /permission denied/)
    await asSignedIn(await signIn(staying), 'delete_my_account')
    assert.deepEqual((await db.query('select email from auth.users order by email')).rows.map((row: any) => row.email),
      ['leaving@example.test', 'other@example.test'])
  })

  it('asks for a sign-in of less than ten minutes, so an open session left behind cannot erase the account', async () => {
    const earlier = await signIn(leaving, 11)
    assert.equal(await asSignedIn(earlier, 'account_deletion_status'), 'sign_in_again')
    await assert.rejects(asSignedIn(earlier, 'delete_my_account'), (error: any) => error.code === 'LS428')
    await assert.rejects(call(leaving, 'delete_my_account'), (error: any) => error.code === 'LS428', 'a token without its session')
    await db.query('delete from auth.sessions where id = $1', [earlier.session])
    await assert.rejects(asSignedIn(earlier, 'delete_my_account'), (error: any) => error.code === 'LS428', 'a signed-out session')
    const someoneElse = await signIn(staying)
    await assert.rejects(asSignedIn({ id: leaving, session: someoneElse.session }, 'delete_my_account'),
      (error: any) => error.code === 'LS428', 'another account’s session')
    const expired = await signIn(leaving)
    await db.query("update auth.sessions set not_after = clock_timestamp() - interval '1 second' where id = $1", [expired.session])
    await assert.rejects(asSignedIn(expired, 'delete_my_account'), (error: any) => error.code === 'LS428', 'an expired session')
    assert.equal(await exists(leaving), true)

    const fresh = await signIn(leaving, 9)
    assert.equal(await asSignedIn(fresh, 'account_deletion_status'), 'ready')
    await asSignedIn(fresh, 'delete_my_account')
    assert.equal(await exists(leaving), false)
  })

  it('keeps the last super administrator, so someone still holds the keys of the hub', async () => {
    await db.query("insert into private.hub_staff (user_id, role, graduation_year) values ($1, 'super_admin', null)", [leaving])
    assert.equal(await asSignedIn(await signIn(leaving, 30), 'account_deletion_status'), 'last_super_admin',
      'signing in again would not help, so it is not asked first')
    const member = await signIn(leaving)
    assert.equal(await asSignedIn(member, 'account_deletion_status'), 'last_super_admin')
    await assert.rejects(asSignedIn(member, 'delete_my_account'), (error: any) => error.code === 'LS409')
    assert.equal(await exists(leaving), true)

    await db.query("insert into private.hub_staff (user_id, role, graduation_year) values ($1, 'super_admin', null)", [staying])
    assert.equal(await asSignedIn(member, 'account_deletion_status'), 'ready')
    await asSignedIn(member, 'delete_my_account')
    assert.equal(await exists(leaving), false)
  })

  it('leaves the photo of an erased account to the API, which removes it with its own key and retries', async () => {
    await asSignedIn(await signIn(leaving), 'delete_my_account')
    assert.deepEqual((await db.query('select owner_id, status from private.avatar_removal_queue')).rows, [{ owner_id: leaving, status: 'pending' }])

    await assert.rejects(call(staying, 'claim_avatar_removals', [5]), /permission denied/)
    await db.exec('set role service_role')
    try {
      const [job] = (await db.query<{ job_id: string; lease_token: string; owner_id: string }>('select * from public.claim_avatar_removals(5)')).rows
      assert.equal(job!.owner_id, leaving)
      assert.deepEqual((await db.query('select * from public.claim_avatar_removals(5)')).rows, [], 'a leased removal is not claimed twice')
      await db.query('select public.finish_avatar_removal($1, $2, false)', [job!.job_id, job!.lease_token])
      await assert.rejects(db.query('select public.finish_avatar_removal($1, $2, true)', [job!.job_id, job!.lease_token]), /lease/)
      await db.exec('reset role')
      await db.query("update private.avatar_removal_queue set next_attempt_at = clock_timestamp() - interval '1 second'")
      await db.exec('set role service_role')
      const [retry] = (await db.query<{ job_id: string; lease_token: string }>('select * from public.claim_avatar_removals(5)')).rows
      await db.query('select public.finish_avatar_removal($1, $2, true)', [retry!.job_id, retry!.lease_token])
    } finally { await db.exec('reset role') }
    assert.equal(await count('select count(*)::int as n from private.avatar_removal_queue'), 0)
  })

  it('gives a photo removal up after its eighth failed attempt', async () => {
    await asSignedIn(await signIn(leaving), 'delete_my_account')
    await db.query('update private.avatar_removal_queue set attempts = 7')
    await db.exec('set role service_role')
    try {
      const [job] = (await db.query<{ job_id: string; lease_token: string }>('select * from public.claim_avatar_removals(5)')).rows
      await db.query('select public.finish_avatar_removal($1, $2, false)', [job!.job_id, job!.lease_token])
      await db.exec('reset role')
      assert.deepEqual((await db.query('select status, attempts from private.avatar_removal_queue')).rows, [{ status: 'failed', attempts: 8 }])
      await db.query("update private.avatar_removal_queue set next_attempt_at = clock_timestamp() - interval '1 second'")
      await db.exec('set role service_role')
      assert.deepEqual((await db.query('select * from public.claim_avatar_removals(5)')).rows, [])
      // An eighth attempt cut short by a crash keeps its expired lease: it is not tried a ninth time.
      await db.exec('reset role')
      await db.query("update private.avatar_removal_queue set status = 'processing', lease_until = clock_timestamp() - interval '1 second'")
      await db.exec('set role service_role')
      assert.deepEqual((await db.query('select * from public.claim_avatar_removals(5)')).rows, [])
    } finally { await db.exec('reset role') }
  })
})
