import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { asMember, createMigratedDatabase, seedMember } from './testDatabase.ts'

// The site keeps one photo per member in the public "avatars" bucket, at <id>/avatar
// (src/lib/avatarPath.ts), and shows it through its public link.
describe('Member photos in Storage', { concurrency: false }, () => {
  let db: PGlite
  let alumna: string, pupil: string

  const avatar = (id: string) => `${id}/avatar`
  const listPhotos = (id: string | null, role = 'authenticated') => asMember(db, id, async () =>
    (await db.query<{ name: string }>("select name from storage.objects where bucket_id = 'avatars' order by name")).rows
      .map((row) => row.name), role)
  // What the site's upload does: replace the file when it exists, and read back what was written.
  const upload = (id: string, name: string) => asMember(db, id, () => db.query(`insert into storage.objects (bucket_id, name)
    values ('avatars', $1) on conflict (bucket_id, name) do update set name = excluded.name returning id`, [name]))
  // The least a direct Storage call can do: write without reading anything, so only the rules on writes can refuse it.
  const store = (id: string, name: string, bucket = 'avatars') => asMember(db, id, () =>
    db.query('insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]))
  const renameOwnObjects = (id: string, name: string) => asMember(db, id, () => db.query('update storage.objects set name = $1', [name]))
  const storedNames = async () => (await db.query<{ name: string }>('select name from storage.objects order by name')).rows.map((row) => row.name)

  before(async () => { db = await createMigratedDatabase() })
  after(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('truncate auth.users, storage.objects cascade')
    alumna = await seedMember(db, { email: 'alumna@example.test' })
    pupil = await seedMember(db, { email: 'pupil@example.test', student: true, pending: true })
    await upload(alumna, avatar(alumna))
    await upload(pupil, avatar(pupil))
  })

  it('lets no visitor list the photos, so those of pupils and waiting accounts cannot be collected', async () => {
    assert.deepEqual(await listPhotos(null, 'anon'), [])
  })

  it('shows each member only their own photo', async () => {
    assert.deepEqual(await listPhotos(alumna), [avatar(alumna)])
    assert.deepEqual(await listPhotos(pupil), [avatar(pupil)])
  })

  it('still lets a member replace and remove their photo', async () => {
    assert.equal((await upload(alumna, avatar(alumna))).rows.length, 1)
    const removed = await asMember(db, alumna, () =>
      db.query("delete from storage.objects where bucket_id = 'avatars' and name = $1 returning id", [avatar(alumna)]))
    assert.equal(removed.rows.length, 1)
  })

  it('keeps a member to one photo, at the path the site uses, so no account can fill the shared storage', async () => {
    const photos = await storedNames()
    for (const name of [`${alumna}/second`, `${alumna}/avatar.png`, `${alumna}/photos/avatar`, avatar(pupil)]) {
      await assert.rejects(store(alumna, name), /row-level security/, name)
    }
    await assert.rejects(store(alumna, avatar(alumna), 'documents'), /row-level security/, 'another bucket')
    assert.deepEqual(await storedNames(), photos)
  })

  it('never lets a member turn their photo into another file', async () => {
    const photos = await storedNames()
    await assert.rejects(renameOwnObjects(alumna, `${alumna}/copy`), /row-level security/)
    assert.deepEqual(await storedNames(), photos)
  })
})
