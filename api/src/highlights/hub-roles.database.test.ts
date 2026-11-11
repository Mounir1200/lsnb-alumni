import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { asMember, createMigratedDatabase, seedMember } from './testDatabase.ts'

type Report = { id: string; reason: string; status: string; can_act: boolean; details: string | null; resolution: string | null
  handled_by_name: string | null; reported: { id: string }; reporter: { id: string } | null; messages: unknown }

describe('Three levels of team: super administrators, administrators and moderators', { concurrency: false }, () => {
  let db: PGlite
  let owner: string, admin: string, moderator: string, otherModerator: string, member: string, otherMember: string, candidate: string

  const value = async <T = any>(sql: string, params: unknown[] = []) => (await db.query<{ value: T }>(sql, params)).rows[0]!.value
  const rpc = <T = any>(id: string, name: string, args: unknown[] = []) => asMember(db, id, () =>
    value<T>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args))
  const roleOf = async (id: string) =>
    (await db.query<{ role: string }>('select role from private.hub_staff where user_id = $1', [id])).rows[0]?.role ?? null
  const staff = (id: string, role: string, promotion: number | null = null) =>
    db.query('insert into private.hub_staff (user_id, role, graduation_year) values ($1, $2, $3)', [id, role, promotion])
  const join = (email: string, graduationYear: number, pending = false) => seedMember(db, { email, graduationYear, pending })
  const report = (reporter: string, reported: string, reason = 'harassment', details = 'Messages insistants après un refus.') =>
    asMember(db, reporter, () => db.query('select public.report_member($1, $2, $3)', [reported, reason, details]))
  const reports = async (viewer: string, status = 'open') => (await rpc<{ items: Report[] }>(viewer, 'hub_reports', [status, 1])).items
  const reportedIds = async (viewer: string) => (await reports(viewer)).map((item) => item.reported.id).sort()

  before(async () => { db = await createMigratedDatabase() })
  after(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec(`truncate auth.users, private.hub_audit cascade;
      update private.hub_maintenance set enabled = false, ends_at = null, started_at = null, updated_by = null;`)
    owner = await join('owner@example.test', 2018)
    admin = await join('admin@example.test', 2019)
    moderator = await join('moderator@example.test', 2020)
    otherModerator = await join('other-moderator@example.test', 2021)
    member = await join('member@example.test', 2020)
    otherMember = await join('other-member@example.test', 2021)
    candidate = await join('candidate@example.test', 2020)
    await staff(owner, 'super_admin')
    await staff(admin, 'admin')
    await staff(moderator, 'moderator', 2020)
    await staff(otherModerator, 'moderator', 2021)
  })

  it('keeps at most three super administrators, whichever path writes the team', async () => {
    await rpc(owner, 'hub_set_staff', [await join('second@example.test', 2019), 'super_admin', null])
    await staff(await join('third@example.test', 2019), 'super_admin')
    await assert.rejects(rpc(owner, 'hub_set_staff', [candidate, 'super_admin', null]), /at most 3 super administrators/)
    await assert.rejects(staff(candidate, 'super_admin'), /at most 3 super administrators/)
    await assert.rejects(db.query("update private.hub_staff set role = 'super_admin' where user_id = $1", [admin]), /at most 3/)
  })

  it('lets each level manage only the levels below it', async () => {
    await rpc(owner, 'hub_set_staff', [candidate, 'admin', null])
    assert.equal(await roleOf(candidate), 'admin')
    await rpc(owner, 'hub_set_staff', [candidate, 'moderator', 2020])
    assert.equal(await roleOf(candidate), 'moderator')
    await rpc(admin, 'hub_set_staff', [candidate, null, null])
    assert.equal(await roleOf(candidate), null)
    await rpc(admin, 'hub_set_staff', [candidate, 'moderator', 2020])
    assert.equal(await roleOf(candidate), 'moderator')
    for (const role of ['admin', 'super_admin']) {
      await assert.rejects(rpc(admin, 'hub_set_staff', [member, role, null]), /roles below your own/)
    }
    const otherAdmin = await join('other-admin@example.test', 2019)
    await staff(otherAdmin, 'admin')
    await assert.rejects(rpc(admin, 'hub_set_staff', [otherAdmin, null, null]), /roles below your own/)
    await assert.rejects(rpc(moderator, 'hub_set_staff', [member, 'moderator', 2020]), /staff access required/)
    await assert.rejects(rpc(owner, 'hub_set_staff', [member, 'admin', 2020]), /network-wide/)
  })

  it('never removes a super administrator from the hub, nor lets anyone change their own role', async () => {
    const second = await join('second@example.test', 2019)
    await staff(second, 'super_admin')
    await assert.rejects(rpc(owner, 'hub_set_staff', [second, null, null]), /resigning or through the database/)
    await assert.rejects(rpc(owner, 'hub_set_staff', [second, 'admin', null]), /resigning or through the database/)
    await assert.rejects(rpc(owner, 'hub_set_staff', [owner, 'admin', null]), /own staff role/)
    await assert.rejects(rpc(admin, 'hub_set_staff', [admin, 'moderator', 2019]), /own staff role/)
    assert.deepEqual([await roleOf(owner), await roleOf(second), await roleOf(admin)], ['super_admin', 'super_admin', 'admin'])
  })

  it('lets a team member step down, except the last super administrator', async () => {
    await assert.rejects(rpc(owner, 'hub_leave_team'), /last super administrator/)
    await rpc(moderator, 'hub_leave_team')
    assert.equal(await roleOf(moderator), null)
    await staff(await join('second@example.test', 2019), 'super_admin')
    await rpc(owner, 'hub_leave_team')
    assert.equal(await roleOf(owner), null)
    await assert.rejects(rpc(member, 'hub_leave_team'), /staff access required/)
    const journal = (await db.query<{ action: string; target_id: string }>("select action, target_id from private.hub_audit order by id")).rows
    assert.deepEqual(journal, [{ action: 'staff_changed', target_id: moderator }, { action: 'staff_changed', target_id: owner }])
  })

  it('keeps maintenance for super administrators', async () => {
    await assert.rejects(rpc(admin, 'hub_set_maintenance', [true, 'Une amélioration est en cours.', null]), /staff access required/)
    await rpc(owner, 'hub_set_maintenance', [true, 'Une amélioration est en cours.', null])
    await rpc(owner, 'hub_set_maintenance', [false, 'Le site est de retour.', null])
  })

  it('restores accounts and corrects promotions from the network level only', async () => {
    await rpc(moderator, 'hub_moderate_member', [member, false, 'Comportement signalé à vérifier'])
    await assert.rejects(rpc(moderator, 'hub_moderate_member', [member, true, 'Vérification faite, accès rendu']), /own promotion/)
    await rpc(admin, 'hub_moderate_member', [member, true, 'Vérification faite, accès rendu'])
    await rpc(owner, 'hub_moderate_member', [otherMember, false, 'Comportement signalé à vérifier'])
    await assert.rejects(rpc(moderator, 'hub_change_promotion', [member, 2021, 'Correction vérifiée du dossier']), /staff access required/)
    await rpc(owner, 'hub_change_promotion', [member, 2021, 'Correction vérifiée du dossier'])
  })

  it('shows every team member the whole network’s statistics, and what waits within their scope', async () => {
    await join('waiting@example.test', 2021, true)
    const seenByModerator = await rpc(moderator, 'hub_dashboard')
    assert.equal(seenByModerator.members, 8)
    assert.deepEqual(seenByModerator.promotions.map((promotion: { year: number }) => promotion.year).sort(), [2018, 2019, 2020, 2021])
    assert.equal(seenByModerator.pending_members, 0)
    assert.equal((await rpc(otherModerator, 'hub_dashboard')).pending_members, 1)
    assert.equal((await rpc(owner, 'hub_dashboard')).pending_members, 1)
    assert.equal((await rpc(otherModerator, 'hub_context')).pending_approvals, 1)
    assert.equal((await rpc(moderator, 'hub_context')).pending_approvals, 0)
    assert.equal((await rpc(moderator, 'hub_members', ['', null, 'all', 1])).total, 3)
    assert.equal((await rpc(owner, 'hub_members', ['', null, 'all', 1])).total, 8)
  })

  it('alerts every moderator to a reported member, and lets only the promotion’s moderator act', async () => {
    await report(member, otherMember, 'scam', 'Il demande de l’argent pour un stage.')
    assert.equal((await rpc(moderator, 'hub_context')).open_reports, 1)
    const alert = await reports(moderator)
    assert.deepEqual(alert.map((item) => [item.reported.id, item.reason, item.can_act, item.details, item.reporter, item.messages]),
      [[otherMember, 'scam', false, null, null, null]])
    await assert.rejects(rpc(moderator, 'hub_resolve_report', [alert[0]!.id, 'resolved', 'Membre averti par l’équipe.']), /outside your scope/)
    const actionable = await reports(otherModerator)
    assert.deepEqual(actionable.map((item) => [item.can_act, item.details, item.reporter?.id]),
      [[true, 'Il demande de l’argent pour un stage.', member]])
    await rpc(otherModerator, 'hub_resolve_report', [actionable[0]!.id, 'resolved', 'Membre averti par l’équipe.'])
    assert.equal((await rpc(moderator, 'hub_context')).open_reports, 0)
    const handled = await reports(moderator, 'handled')
    assert.deepEqual(handled.map((item) => [item.status, item.resolution, item.handled_by_name]), [['resolved', null, null]])
  })

  it('sends a report about a team member to the level above, never to the person it names', async () => {
    const second = await join('second@example.test', 2019)
    await staff(second, 'super_admin')
    for (const reported of [moderator, admin, owner]) await report(member, reported)
    assert.deepEqual(await reportedIds(otherModerator), [])
    assert.deepEqual(await reportedIds(moderator), [])
    assert.deepEqual(await reportedIds(admin), [moderator])
    assert.deepEqual(await reportedIds(owner), [admin, moderator].sort())
    assert.deepEqual(await reportedIds(second), [admin, moderator, owner].sort())
    assert.ok((await reports(admin)).every((item) => item.can_act))
  })
})
