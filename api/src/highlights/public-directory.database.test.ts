import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { applyMigration, asMember, createMigratedDatabase, seedMember } from './testDatabase.ts'

let db: PGlite
type Listing = Record<string, unknown> & { id: string; first_name: string }

const listedBy = async (member: string | null, role = 'anon') =>
  asMember(db, member, async () => (await db.query<Listing>('select * from public.public_directory_profiles()')).rows, role)
type HighlightClaim = { outcome: string; articles: { profile_id: string }[] }
const claimThisWeek = async () => (await db.query<{ result: HighlightClaim }>(
  "select public.claim_weekly_highlight(date_trunc('week', timezone('Africa/Ouagadougou', clock_timestamp()))::date) as result",
)).rows[0]!.result

describe('Public member directory', { concurrency: false }, () => {
  before(async () => { db = await createMigratedDatabase() })
  beforeEach(async () => {
    await db.exec('truncate public.weekly_highlights, auth.users cascade; update private.hub_maintenance set enabled = false, ends_at = null')
  })
  after(async () => { await db?.close() })

  it('lists an alumnus only once they chose it at sign-up, and never a student', async () => {
    const quiet = await seedMember(db, { firstName: 'Discrète' })
    const listed = await seedMember(db, { firstName: 'Awa', listed: true })
    const student = await seedMember(db, { firstName: 'Élève', student: true, listed: true })
    assert.deepEqual((await listedBy(null)).map((row) => row.id), [listed])
    const flags = await db.query<{ id: string; listed_publicly: boolean }>('select id, listed_publicly from public.profiles where id = any($1)', [[quiet, student]])
    assert.deepEqual(flags.rows.map((row) => row.listed_publicly), [false, false])
  })

  it('keeps the choice of the members who joined before they were asked', async () => {
    const earlier = await createMigratedDatabase({ before: '20261123120903_public_listing_consent.sql' })
    try {
      const member = await seedMember(earlier, { firstName: 'Ancienne' })
      await applyMigration(earlier, '20261123120903_public_listing_consent.sql')
      const newcomer = await seedMember(earlier, { firstName: 'Nouvelle', email: 'new@example.test' })
      const { rows } = await earlier.query<{ id: string; listed_publicly: boolean }>('select id, listed_publicly from public.profiles')
      assert.deepEqual(Object.fromEntries(rows.map((row) => [row.id, row.listed_publicly])), { [member]: true, [newcomer]: false })
    } finally { await earlier.close() }
  })

  it('shows visitors the active alumni, without students, inactive or suspended members', async () => {
    const alumni = await seedMember(db, { firstName: 'Awa', mentor: true, listed: true })
    await seedMember(db, { firstName: 'Élève', student: true, listed: true })
    await seedMember(db, { firstName: 'Inactif', inactive: true, listed: true })
    const suspended = await seedMember(db, { firstName: 'Suspendu', listed: true })
    await db.query('insert into private.hub_suspensions (user_id) values ($1)', [suspended])
    const listing = await listedBy(null)
    assert.deepEqual(listing.map((row) => row.id), [alumni])
    assert.equal(listing[0]?.offers_mentoring, true)
  })

  it('exposes only what a directory card shows', async () => {
    await seedMember(db, { listed: true })
    const [row] = await listedBy(null)
    assert.deepEqual(Object.keys(row!).sort(), [
      'city', 'country', 'domain', 'first_name', 'graduation_year', 'id', 'last_name', 'member_role',
      'offers_mentoring', 'photo_url', 'specialties', 'specialty',
    ])
  })

  it('lets members leave the public directory while staying visible to signed-in members', async () => {
    const hidden = await seedMember(db, { firstName: 'Discrète', listed: true })
    const viewer = await seedMember(db, { listed: true })
    const updated = await asMember(db, hidden, () => db.query('update public.profiles set listed_publicly = false where id = $1 returning id', [hidden]))
    assert.equal(updated.rows.length, 1)
    assert.deepEqual((await listedBy(null)).map((row) => row.id), [viewer])
    const seenByMember = await asMember(db, viewer, () => db.query('select id from public.profiles where id = $1', [hidden]))
    assert.equal(seenByMember.rows.length, 1)
  })

  it('keeps members who left the public directory out of the weekly Highlight', async () => {
    const listed = await seedMember(db, { firstName: 'Awa', listed: true })
    const hidden = await seedMember(db, { firstName: 'Discrète', listed: true })
    await db.query('update public.profiles set listed_publicly = false where id = $1', [hidden])
    assert.equal((await claimThisWeek()).outcome, 'empty', 'one listed alumnus cannot make a duo')
    const other = await seedMember(db, { firstName: 'Binta', listed: true })
    const drawn = (await claimThisWeek()).articles.map((article) => article.profile_id).sort()
    assert.deepEqual(drawn, [listed, other].sort())
  })

  it('shows nothing while the site is in maintenance', async () => {
    await seedMember(db, { listed: true })
    await db.exec('update private.hub_maintenance set enabled = true')
    assert.deepEqual(await listedBy(null), [])
  })

  it('still keeps the profiles table itself closed to visitors', async () => {
    await seedMember(db, { listed: true })
    // Visitors hold no right on the table; were one granted again, row security would still keep them out.
    await db.exec('grant select on public.profiles to anon')
    const rows = await asMember(db, null, async () => (await db.query('select id from public.profiles')).rows, 'anon')
    assert.deepEqual(rows, [])
  })
})
