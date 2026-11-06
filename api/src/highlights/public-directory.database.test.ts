import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { asMember, createMigratedDatabase, seedMember } from './testDatabase.ts'

let db: PGlite
type Listing = Record<string, unknown> & { id: string; first_name: string }

const listedBy = async (member: string | null, role = 'anon') =>
  asMember(db, member, async () => (await db.query<Listing>('select * from public.public_directory_profiles()')).rows, role)

describe('Public member directory', { concurrency: false }, () => {
  before(async () => { db = await createMigratedDatabase() })
  beforeEach(async () => {
    await db.exec('truncate public.weekly_highlights, auth.users cascade; update private.hub_maintenance set enabled = false, ends_at = null')
  })
  after(async () => { await db?.close() })

  it('shows visitors the active alumni, without students, inactive or suspended members', async () => {
    const alumni = await seedMember(db, { firstName: 'Awa', mentor: true })
    await seedMember(db, { firstName: 'Élève', student: true })
    await seedMember(db, { firstName: 'Inactif', inactive: true })
    const suspended = await seedMember(db, { firstName: 'Suspendu' })
    await db.query('insert into private.hub_suspensions (user_id) values ($1)', [suspended])
    const listing = await listedBy(null)
    assert.deepEqual(listing.map((row) => row.id), [alumni])
    assert.equal(listing[0]?.offers_mentoring, true)
  })

  it('exposes only what a directory card shows', async () => {
    await seedMember(db)
    const [row] = await listedBy(null)
    assert.deepEqual(Object.keys(row!).sort(), [
      'city', 'country', 'domain', 'first_name', 'graduation_year', 'id', 'last_name', 'member_role',
      'offers_mentoring', 'photo_url', 'specialties', 'specialty',
    ])
  })

  it('lets members leave the public directory while staying visible to signed-in members', async () => {
    const hidden = await seedMember(db, { firstName: 'Discrète' })
    const viewer = await seedMember(db)
    const updated = await asMember(db, hidden, () => db.query('update public.profiles set listed_publicly = false where id = $1 returning id', [hidden]))
    assert.equal(updated.rows.length, 1)
    assert.deepEqual((await listedBy(null)).map((row) => row.id), [viewer])
    const seenByMember = await asMember(db, viewer, () => db.query('select id from public.profiles where id = $1', [hidden]))
    assert.equal(seenByMember.rows.length, 1)
  })

  it('shows nothing while the site is in maintenance', async () => {
    await seedMember(db)
    await db.exec('update private.hub_maintenance set enabled = true')
    assert.deepEqual(await listedBy(null), [])
  })

  it('still keeps the profiles table itself closed to visitors', async () => {
    await seedMember(db)
    // Supabase grants visitors table access by default: only row security keeps them out.
    await db.exec('grant select on public.profiles to anon')
    const rows = await asMember(db, null, async () => (await db.query('select id from public.profiles')).rows, 'anon')
    assert.deepEqual(rows, [])
  })
})
