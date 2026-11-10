import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { answerRequest, asMember, createMigratedDatabase, seedMember, sendRequest } from './testDatabase.ts'

describe('Members deleting their own account', { concurrency: false }, () => {
  let db: PGlite
  let leaving: string, staying: string, other: string

  const call = (id: string | null, name: string, args: unknown[] = [], role = 'authenticated') => asMember(db, id, () =>
    db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args), role)
  const count = async (sql: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(sql, params)).rows[0]!.n)

  before(async () => { db = await createMigratedDatabase() })
  after(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('truncate auth.users cascade')
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

    await call(leaving, 'delete_my_account')

    assert.equal(await count('select count(*)::int as n from auth.users where id = $1', [leaving]), 0)
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
    await call(staying, 'delete_my_account')
    assert.deepEqual((await db.query('select email from auth.users order by email')).rows.map((row: any) => row.email),
      ['leaving@example.test', 'other@example.test'])
  })
})
