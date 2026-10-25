import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, beforeEach, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migrationsUrl = new URL('../../../supabase/migrations/', import.meta.url)
const contactMessage = 'Bonjour, quelles sont les conditions pour postuler à cette offre ?'
let db: PGlite

type Offer = { id: string; author_id: string; kind: string; title: string; organization: string; location: string; description: string; link_url: string | null; deadline: string | null; created_at: Date; updated_at: Date }
type Request = { id: string; requester_id: string; recipient_id: string; request_kind: string; message: string; status: string; offer_id: string | null }

const validOffer = {
  kind: 'internship', title: '  Stage en analyse de données  ', organization: ' Laboratoire Exemple ',
  location: ' Ouagadougou ', description: '  Six mois au sein d’une équipe de recherche en santé publique.  ',
  link_url: 'https://example.org/stage', deadline: null as string | null,
}

async function seed(options: { student?: boolean; mentor?: boolean; incomplete?: boolean; inactive?: boolean } = {}) {
  const result = await db.query<{ id: string }>(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), 'member@example.test', $1, $2) returning id`, [
    JSON.stringify({ first_name: 'Membre', last_name: 'Test', member_role: options.student ? 'student' : 'alumni', offers_mentoring: options.mentor ?? false }),
    JSON.stringify({ provider: options.incomplete ? 'google' : 'email' }),
  ])
  const id = result.rows[0]!.id
  if (options.inactive) await db.query('update public.profiles set is_active = false where id = $1', [id])
  return id
}

async function asUser<T>(id: string | null, run: () => Promise<T>, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ''])
  await db.exec(`set role ${role}`)
  try { return await run() }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', '', false)") }
}

const publish = (author: string, overrides: Partial<typeof validOffer> = {}) => asUser(author, async () => {
  const offer = { ...validOffer, ...overrides }
  const result = await db.query<Offer>(`insert into public.offers (author_id, kind, title, organization, location, description, link_url, deadline)
    values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
  [author, offer.kind, offer.title, offer.organization, offer.location, offer.description, offer.link_url, offer.deadline])
  return result.rows[0]!
})
const visibleOffers = (viewer: string | null, role = 'authenticated') =>
  asUser(viewer, async () => (await db.query<Offer>('select * from public.offers')).rows, role)
const ask = (requester: string, recipient: string, offerId: string, kind = 'contact') => asUser(requester, async () => {
  const result = await db.query<Request>(`insert into public.connection_requests (requester_id, recipient_id, request_kind, message, offer_id)
    values ($1, $2, $3, $4, $5) returning *`, [requester, recipient, kind, contactMessage, offerId])
  return result.rows[0]!
})
const storedRequest = async (id: string) => (await db.query<Request>('select * from public.connection_requests where id = $1', [id])).rows[0]

describe('Mentor offers and offer questions', { concurrency: false }, () => {
  before(async () => {
    db = new PGlite({ extensions: { pgcrypto } })
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create schema auth; grant usage on schema auth to anon, authenticated, service_role;
      create schema storage;
      create table auth.users (id uuid primary key, email text,
        raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1, ''/'')';
    `)
    for (const file of (await readdir(migrationsUrl)).filter((file) => file.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, migrationsUrl), 'utf8'))
    }
    // Match Supabase's table access: RLS and the guards still apply.
    await db.exec('grant select, insert, update on public.profiles, public.profile_contacts to authenticated')
  })
  beforeEach(async () => { await db.exec('truncate public.weekly_highlights, auth.users cascade') })
  after(async () => { await db?.close() })

  it('lets a mentor publish a trimmed offer with server-owned identity and timestamps', async () => {
    const mentor = await seed({ mentor: true }); const student = await seed({ student: true })
    const offer = await asUser(mentor, async () => (await db.query<Offer>(`insert into public.offers
      (author_id, kind, title, organization, description) values ($1, 'scholarship', '  Bourse d’excellence  ', ' Fondation ', $2) returning *`,
    [mentor, '  Une bourse complète pour un master en sciences de l’ingénieur.  '])).rows[0]!)
    assert.equal(offer.title, 'Bourse d’excellence')
    assert.equal(offer.organization, 'Fondation')
    assert.equal(offer.description, 'Une bourse complète pour un master en sciences de l’ingénieur.')
    assert.equal(offer.location, ''); assert.equal(offer.link_url, null)
    assert.deepEqual((await visibleOffers(student)).map((item) => item.id), [offer.id])
    for (const column of ['id', 'created_at', 'updated_at']) {
      await asUser(mentor, () => assert.rejects(db.query(`insert into public.offers (author_id, kind, title, organization, description, ${column})
        values ($1, 'internship', 'Stage spoofé', 'Entreprise', $2, $3)`,
      [mentor, validOffer.description, column === 'id' ? '00000000-0000-0000-0000-000000000001' : '1999-01-01']), /permission denied/))
    }
  })

  it('reserves publishing to active completed alumni who offer mentoring, for themselves only', async () => {
    const mentor = await seed({ mentor: true })
    for (const options of [{ student: true }, {}, { incomplete: true }, { mentor: true, inactive: true }]) {
      await assert.rejects(publish(await seed(options)), /Only active alumni who offer mentoring/)
    }
    await asUser(await seed({ mentor: true }), () => assert.rejects(db.query(`insert into public.offers (author_id, kind, title, organization, description)
      values ($1, 'internship', 'Stage usurpé', 'Entreprise', $2)`, [mentor, validOffer.description]), /row-level security|Only the author/))
    await asUser(null, () => assert.rejects(db.query(`insert into public.offers (author_id, kind, title, organization, description)
      values ($1, 'internship', 'Stage anonyme', 'Entreprise', $2)`, [mentor, validOffer.description]), /permission denied/), 'anon')
    await asUser(null, () => assert.rejects(db.query('select * from public.offers'), /permission denied/), 'anon')
    assert.equal((await db.query('select * from public.offers')).rows.length, 0)
  })

  it('validates lengths, public HTTPS links and future deadlines', async () => {
    const mentor = await seed({ mentor: true })
    await assert.rejects(publish(mentor, { title: '  abc  ' }), /offers_title_check/)
    await assert.rejects(publish(mentor, { organization: ' ' }), /offers_organization_check/)
    await assert.rejects(publish(mentor, { description: 'Trop court.' }), /offers_description_check/)
    await assert.rejects(publish(mentor, { description: 'x'.repeat(3001) }), /offers_description_check/)
    for (const link of ['http://example.org/stage', 'https://localhost/stage', 'https://192.168.1.10/stage', 'javascript:alert(1)']) {
      await assert.rejects(publish(mentor, { link_url: link }), /offers_link_url_check/)
    }
    await assert.rejects(publish(mentor, { deadline: '2000-01-01' }), /deadline cannot be in the past/)
    const today = (await db.query<{ today: string }>('select current_date::text as today')).rows[0]!.today
    assert.equal((await publish(mentor, { deadline: today, link_url: '  ' })).link_url, null)
  })

  it('lets only the author edit or delete, keeps authorship immutable and tolerates expired deadlines', async () => {
    const mentor = await seed({ mentor: true }); const other = await seed({ mentor: true })
    const offer = await publish(mentor)
    assert.equal((await asUser(other, () => db.query("update public.offers set title = 'Titre détourné' where id = $1 returning id", [offer.id]))).rows.length, 0)
    assert.equal((await asUser(other, () => db.query('delete from public.offers where id = $1 returning id', [offer.id]))).rows.length, 0)
    for (const [column, value] of [['author_id', other], ['id', '00000000-0000-0000-0000-000000000002'], ['created_at', '1999-01-01'], ['updated_at', '1999-01-01']]) {
      await asUser(mentor, () => assert.rejects(db.query(`update public.offers set ${column} = $2 where id = $1`, [offer.id, value]), /permission denied/))
    }
    const edited = (await asUser(mentor, () => db.query<Offer>("update public.offers set title = '  Stage révisé  ', kind = 'admission' where id = $1 returning *", [offer.id]))).rows[0]!
    assert.equal(edited.title, 'Stage révisé'); assert.equal(edited.kind, 'admission')
    assert.ok(edited.updated_at > offer.updated_at)
    // Simulate time passing: the guard forbids setting a past deadline directly.
    await db.exec('alter table public.offers disable trigger guard_offer')
    await db.query('update public.offers set deadline = current_date - 3 where id = $1', [offer.id])
    await db.exec('alter table public.offers enable trigger guard_offer')
    assert.equal((await asUser(mentor, () => db.query("update public.offers set location = 'Bobo-Dioulasso' where id = $1 returning id", [offer.id]))).rows.length, 1)
    await asUser(mentor, () => assert.rejects(db.query('update public.offers set deadline = current_date - 1 where id = $1', [offer.id]), /deadline cannot be in the past/))
    assert.equal((await asUser(mentor, () => db.query('delete from public.offers where id = $1 returning id', [offer.id]))).rows.length, 1)
  })

  it('keeps own offers accessible during mentoring pauses but blocks all access for suspended authors', async () => {
    const mentor = await seed({ mentor: true }); const viewer = await seed({ student: true })
    const offer = await publish(mentor)
    for (const ineligible of [await seed({ incomplete: true }), await seed({ inactive: true })]) {
      assert.equal((await visibleOffers(ineligible)).length, 0)
    }
    for (const change of ['offers_mentoring = false', 'is_active = false']) {
      await db.query(`update public.profiles set ${change} where id = $1`, [mentor])
      assert.equal((await visibleOffers(viewer)).length, 0)
      assert.deepEqual((await visibleOffers(mentor)).map((item) => item.id), change === 'is_active = false' ? [] : [offer.id])
      if (change === 'is_active = false') {
        assert.equal((await asUser(mentor, () => db.query("update public.offers set title='Modification interdite' where id=$1 returning id", [offer.id]))).rows.length, 0)
        assert.equal((await asUser(mentor, () => db.query('delete from public.offers where id=$1 returning id', [offer.id]))).rows.length, 0)
        assert.equal((await db.query<Offer>('select * from public.offers where id=$1', [offer.id])).rows[0]?.title, offer.title)
      }
      await db.query('update public.profiles set offers_mentoring = true, is_active = true where id = $1', [mentor])
    }
    assert.equal((await visibleOffers(viewer)).length, 1)
  })

  it('accepts an offer question only as a contact request to the author of a readable offer', async () => {
    const mentor = await seed({ mentor: true }); const otherMentor = await seed({ mentor: true }); const student = await seed({ student: true })
    const offer = await publish(mentor)
    await assert.rejects(ask(student, mentor, offer.id, 'mentoring'), /offer question must be a contact request/)
    await assert.rejects(ask(student, otherMentor, offer.id), /offer question must be a contact request/)
    await db.query('update public.profiles set offers_mentoring = false where id = $1', [mentor])
    await assert.rejects(ask(student, mentor, offer.id), /offer question must be a contact request/)
    await db.query('update public.profiles set offers_mentoring = true where id = $1', [mentor])
    const question = await ask(student, mentor, offer.id)
    assert.equal(question.offer_id, offer.id); assert.equal(question.request_kind, 'contact')
    const joined = await asUser(mentor, async () => (await db.query<{ title: string }>(`select o.title from public.connection_requests r
      join public.offers o on o.id = r.offer_id where r.id = $1`, [question.id])).rows)
    assert.equal(joined[0]?.title, 'Stage en analyse de données')
    await asUser(mentor, () => assert.rejects(db.query('update public.connection_requests set offer_id = null where id = $1', [question.id]), /permission denied/))
    await assert.rejects(ask(student, mentor, (await publish(mentor, { title: 'Second stage' })).id), /unique constraint/)
  })

  it('detaches questions from a deleted offer while keeping the request answerable', async () => {
    const mentor = await seed({ mentor: true }); const student = await seed({ student: true })
    const offer = await publish(mentor)
    const question = await ask(student, mentor, offer.id)
    assert.equal((await asUser(mentor, () => db.query('delete from public.offers where id = $1 returning id', [offer.id]))).rows.length, 1)
    const detached = (await storedRequest(question.id))!
    assert.equal(detached.offer_id, null); assert.equal(detached.message, contactMessage); assert.equal(detached.status, 'pending')
    assert.equal((await asUser(mentor, () => db.query<Request>("update public.connection_requests set status = 'accepted' where id = $1 returning *", [question.id]))).rows[0]?.status, 'accepted')
  })

  it('cascades account deletion without a member session through offers and their questions', async () => {
    const mentor = await seed({ mentor: true }); const student = await seed({ student: true }); const other = await seed()
    const offer = await publish(mentor)
    const fromStudent = await ask(student, mentor, offer.id)
    const fromOther = await ask(other, mentor, offer.id)
    await db.query('delete from auth.users where id = $1', [student])
    assert.equal(await storedRequest(fromStudent.id), undefined)
    assert.equal((await storedRequest(fromOther.id))?.offer_id, offer.id)
    await db.query('delete from auth.users where id = $1', [mentor])
    assert.equal((await db.query('select * from public.offers')).rows.length, 0)
    assert.equal((await db.query('select * from public.connection_requests')).rows.length, 0)
  })
})
