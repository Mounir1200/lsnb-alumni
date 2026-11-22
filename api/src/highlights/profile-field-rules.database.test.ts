import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { asMember, createMigratedDatabase, seedMember } from './testDatabase.ts'

/** Where Storage serves the project's avatars: the only photo host besides Google. */
const AVATARS = 'https://yesumbhssechcrlgpgqj.supabase.co/storage/v1/object/public/avatars/'
const REFUSED = /violates check constraint/

describe('What a member may write in their profile', { concurrency: false }, () => {
  let db: PGlite
  let member: string, other: string

  const update = (values: Record<string, unknown>) => asMember(db, member, async () => {
    const columns = Object.keys(values)
    const assignments = columns.map((column, index) => `${column} = $${index + 2}`).join(', ')
    const { rows } = await db.query(`update public.profiles set ${assignments} where id = $1 returning id`, [member, ...Object.values(values)])
    assert.equal(rows.length, 1)
  })

  before(async () => { db = await createMigratedDatabase() })
  after(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('truncate auth.users cascade')
    member = await seedMember(db, { email: 'member@example.test' })
    other = await seedMember(db, { email: 'other@example.test' })
  })

  it('shows only their own stored photo or their Google photo, never an image hosted elsewhere', async () => {
    for (const photo of [`${AVATARS}${member}/avatar?v=1763712000000`, `${AVATARS}${member}/avatar`,
      'https://lh3.googleusercontent.com/a/ACg8ocJ_x-Y2=s96-c', null]) {
      await update({ photo_url: photo })
    }
    for (const photo of ['javascript:alert(1)', 'http://lh3.googleusercontent.com/a/photo', 'https://tracker.example/pixel.gif',
      `${AVATARS}${other}/avatar`, `${AVATARS}${member}/avatar/../../${other}/avatar`, `${AVATARS}${member}/avatar?v=1&track=me`,
      `https://yesumbhssechcrlgpgqj.supabase.co.tracker.example/storage/v1/object/public/avatars/${member}/avatar`,
      'https://lh3.googleusercontent.com.tracker.example/a/photo']) {
      await assert.rejects(update({ photo_url: photo }), REFUSED, photo)
    }
  })

  it('keeps the Google photo of an account created with Google, never one hosted elsewhere, and cuts long names', async () => {
    const signUpWithGoogle = async (metadata: Record<string, unknown>) => {
      const { rows: [account] } = await db.query<{ id: string }>(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
        values (gen_random_uuid(), 'google@example.test', $1, '{"provider":"google"}') returning id`, [JSON.stringify(metadata)])
      return (await db.query('select first_name, last_name, photo_url from public.profiles where id = $1', [account!.id])).rows[0]
    }
    const google = 'https://lh5.googleusercontent.com/a-/AOh14Gh_x=s96-c'
    assert.deepEqual(await signUpWithGoogle({ full_name: 'Awa Ouédraogo', picture: google }),
      { first_name: 'Awa', last_name: 'Ouédraogo', photo_url: google })
    await db.exec("delete from auth.users where email = 'google@example.test'")
    assert.deepEqual(await signUpWithGoogle({ given_name: 'A'.repeat(300), name: `Awa ${'B'.repeat(300)}`, avatar_url: 'https://tracker.example/pixel.gif' }),
      { first_name: 'A'.repeat(100), last_name: 'B'.repeat(100), photo_url: null })
  })

  it('keeps each text within what the forms accept', async () => {
    await update({ first_name: 'A'.repeat(100), last_name: 'B'.repeat(100), specialty: 'C'.repeat(200), domain: 'D'.repeat(200),
      city: 'E'.repeat(150), country: 'F'.repeat(150), experience: 'G'.repeat(5000) })
    for (const [column, length] of [['first_name', 101], ['last_name', 101], ['specialty', 201], ['domain', 201],
      ['city', 151], ['country', 151], ['experience', 5001]] as const) {
      await assert.rejects(update({ [column]: 'x'.repeat(length) }), REFUSED, column)
    }
  })

  it('keeps specialties and mentoring topics to twenty short items', async () => {
    const twenty = Array.from({ length: 20 }, (_, index) => `${index}`.padEnd(120, '.'))
    await update({ specialties: twenty, mentoring_topics: twenty })
    for (const column of ['specialties', 'mentoring_topics']) {
      await assert.rejects(update({ [column]: [...twenty, 'one more'] }), REFUSED, column)
      await assert.rejects(update({ [column]: ['x'.repeat(121)] }), REFUSED, column)
    }
  })

  it('shows the address of their account as their contact, whatever the site sends', async () => {
    for (const email of ['someone.else@example.test', 'x'.repeat(100_000)]) {
      await asMember(db, member, () => db.query(`insert into public.profile_contacts (profile_id, email, is_visible) values ($1, $2, true)
        on conflict (profile_id) do update set email = excluded.email, is_visible = excluded.is_visible`, [member, email]))
      const { rows } = await db.query<{ email: string }>('select email from public.profile_contacts where profile_id = $1', [member])
      assert.equal(rows[0]!.email, 'member@example.test')
    }
  })
})
