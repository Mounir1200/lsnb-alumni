import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { asMember, createMigratedDatabase, seedMember } from './testDatabase.ts'

let db: PGlite

const saveList = (member: string, column: 'specialties' | 'mentoring_topics', value: string) =>
  asMember(db, member, () => db.query(`update public.profiles set ${column} = $1::text[] where id = $2`, [value, member]))

describe('A member’s lists of specialties and mentoring topics', { concurrency: false }, () => {
  before(async () => { db = await createMigratedDatabase() })
  after(async () => { await db?.close() })

  it('stay flat lists of text, as the profile form writes them', async () => {
    const awa = await seedMember(db)
    await assert.rejects(saveList(awa, 'specialties', '{{Mathématiques,Statistiques}}'), /profiles_specialties_flat/)
    await assert.rejects(saveList(awa, 'mentoring_topics', '{{Orientation}}'), /profiles_mentoring_topics_flat/)
    await saveList(awa, 'specialties', '{Mathématiques,Statistiques}')
    await saveList(awa, 'mentoring_topics', '{}')
    const saved = await db.query<{ specialties: string[]; mentoring_topics: string[] }>(
      'select specialties, mentoring_topics from public.profiles where id = $1', [awa])
    assert.deepEqual(saved.rows[0], { specialties: ['Mathématiques', 'Statistiques'], mentoring_topics: [] })
  })
})
