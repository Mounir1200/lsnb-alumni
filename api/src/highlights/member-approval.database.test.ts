import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { applyMigration, asMember, createMigratedDatabase, seedMember, sendRequest } from './testDatabase.ts'

const APPROVAL_MIGRATION = '20261111005158_member_approval.sql'
const GOOGLE_SIGN_UP = `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (gen_random_uuid(), $1, '{"full_name":"Awa Test"}', '{"provider":"google"}') returning id`

describe('Approval of new member accounts', { concurrency: false }, () => {
  let db: PGlite
  let admin: string, moderator: string, member: string, newcomer: string, outsider: string

  const value = async <T = any>(sql: string, params: unknown[] = []) => (await db.query<{ value: T }>(sql, params)).rows[0]!.value
  const rpc = <T = any>(id: string, name: string, args: unknown[] = []) => asMember(db, id, () =>
    value<T>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args))
  const account = async (id: string) => (await db.query<{ approval_pending: boolean; is_active: boolean }>(
    'select approval_pending, is_active from public.profiles where id = $1', [id])).rows[0]
  const readable = (viewer: string, table: string, column: string) => asMember(db, viewer, async () =>
    (await db.query<{ id: string }>(`select ${column} as id from public.${table} order by 1`)).rows.map((row) => row.id))

  before(async () => { db = await createMigratedDatabase() })
  after(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('truncate auth.users, private.hub_audit cascade')
    admin = await seedMember(db, { email: 'admin@example.test', graduationYear: 2018 })
    moderator = await seedMember(db, { email: 'moderator@example.test', graduationYear: 2020 })
    member = await seedMember(db, { email: 'member@example.test', graduationYear: 2020 })
    newcomer = await seedMember(db, { email: 'newcomer@example.test', graduationYear: 2020, pending: true })
    outsider = await seedMember(db, { email: 'outsider@example.test', graduationYear: 2021, pending: true })
    await db.query("insert into private.hub_staff (user_id, role, graduation_year) values ($1, 'admin', null), ($2, 'moderator', 2020)", [admin, moderator])
    await db.query('update public.profile_contacts set is_visible = true')
  })

  it('keeps a new account out of sight, and out of the members’ profiles and contacts, until it is approved', async () => {
    assert.deepEqual(await account(newcomer), { approval_pending: true, is_active: false })
    assert.ok(!(await readable(member, 'profiles', 'id')).includes(newcomer))
    assert.ok(!(await readable(member, 'profile_contacts', 'profile_id')).includes(newcomer))
    assert.deepEqual(await readable(newcomer, 'profiles', 'id'), [newcomer])
    assert.deepEqual(await readable(newcomer, 'profile_contacts', 'profile_id'), [newcomer])
  })

  it('lets a waiting member edit their own profile without locking them out', async () => {
    assert.deepEqual(await rpc(newcomer, 'member_access_status'), { active: true })
    await asMember(db, newcomer, () => db.query("update public.profiles set city = 'Bobo-Dioulasso' where id = $1", [newcomer]))
    assert.equal(await value('select city as value from public.profiles where id = $1', [newcomer]), 'Bobo-Dioulasso')
  })

  it('lets no request through, either way, before approval', async () => {
    await assert.rejects(sendRequest(db, newcomer, member))
    await assert.rejects(sendRequest(db, member, newcomer))
  })

  it('never lets a member approve their own account', async () => {
    await assert.rejects(asMember(db, newcomer, () =>
      db.query('update public.profiles set approval_pending = false where id = $1', [newcomer])), /server-managed/)
    await assert.rejects(rpc(newcomer, 'hub_approve_member', [newcomer]), /staff access required/)
    assert.deepEqual(await account(newcomer), { approval_pending: true, is_active: false })
  })

  it('lets the promotion’s moderator or an administrator approve, once, with a trace in the journal', async () => {
    await assert.rejects(rpc(moderator, 'hub_approve_member', [outsider]), /own promotion/)
    await rpc(moderator, 'hub_approve_member', [newcomer])
    assert.deepEqual(await account(newcomer), { approval_pending: false, is_active: true })
    assert.ok((await readable(member, 'profiles', 'id')).includes(newcomer))
    await assert.rejects(rpc(admin, 'hub_approve_member', [newcomer]), /not awaiting approval/)
    await rpc(admin, 'hub_approve_member', [outsider])
    assert.deepEqual(await account(outsider), { approval_pending: false, is_active: true })
    const journal = (await db.query('select action, target_id from private.hub_audit order by id')).rows
    assert.deepEqual(journal, [{ action: 'member_approved', target_id: newcomer }, { action: 'member_approved', target_id: outsider }])
  })

  it('refuses an account by suspending it, and restoring it puts it back in the queue', async () => {
    await rpc(moderator, 'hub_moderate_member', [newcomer, false, 'Pas élève du lycée, vérifié'])
    assert.deepEqual(await rpc(newcomer, 'member_access_status'), { active: false })
    await rpc(admin, 'hub_moderate_member', [newcomer, true, 'Erreur de vérification'])
    assert.deepEqual(await account(newcomer), { approval_pending: true, is_active: false })
  })

  it('puts a Google account in the queue once its profile is completed', async () => {
    const google = (await db.query<{ id: string }>(GOOGLE_SIGN_UP, ['google@example.test'])).rows[0]!.id
    assert.deepEqual(await account(google), { approval_pending: false, is_active: false })
    await rpc(google, 'complete_member_profile', [
      'Awa', 'Test', 'alumni', 2020, 'Sciences', 'Paris', 'France', 'Développement logiciel', null, true, false, true,
    ])
    assert.deepEqual(await account(google), { approval_pending: true, is_active: false })
  })

  it('shows the queue in the hub, promotion by promotion, never as suspensions', async () => {
    const queue = await rpc(moderator, 'hub_members', ['', null, 'pending', 1])
    assert.deepEqual(queue.items.map((m: any) => [m.id, m.approval_pending, m.is_suspended]), [[newcomer, true, false]])
    assert.equal((await rpc(admin, 'hub_members', ['', null, 'pending', 1])).total, 2)
    const dashboard = await rpc(moderator, 'hub_dashboard')
    assert.equal(dashboard.pending_members, 1)
    assert.equal(dashboard.suspended_members, 0)
  })
})

describe('Members who joined before approval existed', () => {
  it('stay approved and visible', async () => {
    const db = await createMigratedDatabase({ before: APPROVAL_MIGRATION })
    try {
      const early = (await db.query<{ id: string }>(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
        values (gen_random_uuid(), 'early@example.test', '{"first_name":"Awa","graduation_year":2019}', '{"provider":"email"}') returning id`)).rows[0]!.id
      const onboarding = (await db.query<{ id: string }>(GOOGLE_SIGN_UP, ['onboarding@example.test'])).rows[0]!.id
      await applyMigration(db, APPROVAL_MIGRATION)
      const state = async (id: string) => (await db.query('select approval_pending, is_active from public.profiles where id = $1', [id])).rows[0]
      assert.deepEqual(await state(early), { approval_pending: false, is_active: true })
      assert.deepEqual(await state(onboarding), { approval_pending: false, is_active: false })
    } finally { await db.close() }
  })
})
