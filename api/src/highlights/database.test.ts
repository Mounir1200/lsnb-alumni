import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

type Article = {
  slot: number
  profile_id: string
  source_profile: Record<string, unknown>
  ai_attempted_at: string | null
  generated_at: string | null
}
type Claim = {
  outcome: 'claimed' | 'published' | 'busy' | 'empty'
  lease_token?: string
  articles: Article[]
}

let db: PGlite
let week: string
let legacyGender: unknown

async function value<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ result: T }>(sql, params)
  assert.ok(result.rows[0])
  return result.rows[0].result
}

async function seed(gender: string | null = null, memberRole = 'alumni', active = true) {
  const id = await value<string>('select gen_random_uuid()::text as result')
  await db.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [
    id,
    `${id}@private.example`,
    JSON.stringify({ first_name: 'Awa', last_name: 'Test', graduation_year: 2020, member_role: memberRole,
      gender, experience: 'Travaille dans le développement logiciel.', offers_mentoring: true }),
  ])
  if (!active) await db.query('update public.profiles set is_active = false where id = $1', [id])
  return id
}

const claim = () => value<Claim>('select public.claim_weekly_highlight($1::date) as result', [week])
const claimAi = (lease: string, slot = 1) => value<boolean>(
  'select public.claim_ai_highlight($1::date, $2, $3::uuid) as result', [week, slot, lease],
)
const save = (lease: string, slot = 1, method = 'fallback', paragraphs: unknown = ['Profil vérifié.']) => value<boolean>(
  'select public.save_highlight_article($1::date, $2, $3::uuid, $4, $5::jsonb, $6, $7) as result',
  [week, slot, lease, 'Un parcours à découvrir', JSON.stringify(paragraphs), method, 'mistral-small-latest'],
)
const publish = (lease: string) => value<boolean>(
  'select public.publish_weekly_highlight($1::date, $2::uuid) as result', [week, lease],
)
async function expireLease() {
  await db.query("update public.weekly_highlights set lease_expires_at = clock_timestamp() - interval '1 second' where week_start = $1::date", [week])
}
function leaseOf(result: Claim) {
  assert.equal(result.outcome, 'claimed')
  assert.ok(result.lease_token)
  return result.lease_token
}

describe('weekly Highlights PostgreSQL migration and RPCs', { concurrency: false }, () => {
  before(async () => {
    db = new PGlite()
    // Minimal Supabase-owned objects; both application migrations run verbatim.
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create schema auth;
      create schema storage;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1, ''/'')';
    `)
    await db.exec(await readFile(new URL('../../../supabase/migrations/202609040001_initial_schema.sql', import.meta.url), 'utf8'))
    await db.exec("insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'legacy@private.example')")
    await db.exec(await readFile(new URL('../../../supabase/migrations/202609050001_weekly_highlights.sql', import.meta.url), 'utf8'))
    legacyGender = await value('select gender as result from public.profiles limit 1')
    week = await value<string>("select date_trunc('week', timezone('Africa/Ouagadougou', clock_timestamp()))::date::text as result")
  })

  beforeEach(async () => { await db.exec('truncate public.weekly_highlights, auth.users cascade') })
  after(async () => { await db?.close() })

  it('keeps legacy gender unknown and validates explicit signup metadata', async () => {
    assert.equal(legacyGender, null)
    for (const gender of ['male', 'female', 'unspecified', 'invented', null]) {
      const id = await seed(gender)
      assert.equal(await value('select gender as result from public.profiles where id = $1', [id]), gender === 'invented' ? null : gender)
    }
    await assert.rejects(db.exec("update public.profiles set gender = 'inferred'"), /profiles_gender_check/)
  })

  it('does not freeze an empty week and can retry after another alumnus joins', async () => {
    await seed('male')
    assert.equal((await claim()).outcome, 'empty')
    assert.equal(await value<number>('select count(*)::integer as result from public.weekly_highlights'), 0)
    await seed('female')
    assert.equal((await claim()).outcome, 'claimed')
  })

  it('chooses distinct active alumni and a male/female duo, with only allowlisted snapshot fields', async () => {
    const male = await seed('male')
    const female = await seed('female')
    await seed(null)
    await seed('female', 'student')
    await seed('male', 'alumni', false)
    const result = await claim()
    assert.equal(result.outcome, 'claimed')
    assert.deepEqual(new Set(result.articles.map(article => article.profile_id)), new Set([male, female]))
    const expected = ['id', 'first_name', 'last_name', 'graduation_year', 'specialty', 'specialties', 'domain',
      'city', 'country', 'experience', 'photo_url', 'offers_mentoring', 'mentoring_topics'].sort()
    for (const article of result.articles) assert.deepEqual(Object.keys(article.source_profile).sort(), expected)
  })

  for (const gender of ['male', 'female', null, 'unspecified']) {
    it(`supports a duo when all eligible genders are ${String(gender)}`, async () => {
      const ids = [await seed(gender), await seed(gender)]
      const result = await claim()
      assert.equal(result.outcome, 'claimed')
      assert.deepEqual(new Set(result.articles.map(article => article.profile_id)), new Set(ids))
    })
  }

  it('uses the least-featured profiles before repeating a published duo', async () => {
    const previous = [await seed('male'), await seed('female')]
    await db.query("insert into public.weekly_highlights (week_start, status, published_at) values ($1::date - 7, 'published', now())", [week])
    for (const [index, id] of previous.entries()) {
      await db.query("insert into public.highlight_articles (week_start, slot, profile_id, source_profile, title, paragraphs, generation_method, generated_at) values ($1::date - 7, $2, $3, '{}', 'Titre', '[\"Texte\"]', 'fallback', now())", [week, index + 1, id])
    }
    const next = [await seed('male'), await seed('female')]
    const result = await claim()
    assert.deepEqual(new Set(result.articles.map(article => article.profile_id)), new Set(next))
  })

  it('serializes duplicate claims and preserves the selected duo and snapshot across lease recovery', async () => {
    await seed('male')
    await seed('female')
    const claims = await Promise.all([claim(), claim(), claim()])
    assert.deepEqual(claims.map(result => result.outcome).sort(), ['busy', 'busy', 'claimed'])
    const first = claims.find(result => result.outcome === 'claimed')!
    const firstLease = leaseOf(first)
    assert.equal(await claimAi(firstLease), true)
    await db.exec("update public.profiles set experience = 'Profil modifié depuis le tirage'")
    await seed('male')
    await expireLease()
    const recovered = await claim()
    const newLease = leaseOf(recovered)
    assert.notEqual(newLease, firstLease)
    assert.deepEqual(recovered.articles.map(article => article.source_profile), first.articles.map(article => article.source_profile))
    assert.ok(recovered.articles[0]!.ai_attempted_at)
    assert.equal(await claimAi(newLease), false)
    assert.equal(await save(firstLease), false)
    assert.equal(await publish(firstLease), false)
    assert.equal(await save(newLease), true)
  })

  it('marks the AI attempt exactly once and rejects work after lease expiry', async () => {
    await seed('male')
    await seed('female')
    const token = leaseOf(await claim())
    assert.equal(await save(token, 1, 'ai'), false)
    assert.equal(await claimAi(token), true)
    assert.equal(await claimAi(token), false)
    await expireLease()
    assert.equal(await claimAi(token, 2), false)
    assert.equal(await save(token), false)
    assert.equal(await publish(token), false)
  })

  it('publishes only after both articles are saved and never regenerates a published edition', async () => {
    await seed('male')
    await seed('female')
    const token = leaseOf(await claim())
    assert.equal(await publish(token), false)
    assert.equal(await claimAi(token), true)
    assert.equal(await save(token, 1, 'ai'), true)
    assert.equal(await publish(token), false)
    assert.equal(await save(token, 2), true)
    assert.equal(await save(token, 2), false)
    assert.equal(await publish(token), true)
    const result = await claim()
    assert.equal(result.outcome, 'published')
    assert.equal(result.lease_token, undefined)
    assert.equal(result.articles.filter(article => article.generated_at).length, 2)
    assert.equal(await claimAi(token), false)
    assert.equal(await save(token), false)
    assert.equal(await value('select model as result from public.highlight_articles where slot = 2'), null)
  })

  it('rejects malformed articles and protects selection, source, attempt markers and completed text', async () => {
    await seed('male')
    await seed('female')
    const token = leaseOf(await claim())
    for (const malformed of [null, {}, [], [''], [7], ['x'.repeat(2501)], ['a', 'b', 'c', 'd', 'e']]) {
      await assert.rejects(save(token, 1, 'fallback', malformed), /Highlight/)
    }
    await assert.rejects(db.exec("update public.highlight_articles set source_profile = '{}'"), /immutable/)
    assert.equal(await claimAi(token), true)
    await assert.rejects(db.exec('update public.highlight_articles set ai_attempted_at = null where slot = 1'), /cannot be reset/)
    assert.equal(await save(token), true)
    await assert.rejects(db.exec("update public.highlight_articles set title = 'Réécriture' where slot = 1"), /immutable/)
  })

  it('never replaces a selected profile deleted during generation', async () => {
    await seed('male')
    await seed('female')
    const initial = await claim()
    await seed('female')
    await db.query('delete from auth.users where id = $1', [initial.articles[0]!.profile_id])
    assert.equal((await claim()).outcome, 'empty')
    assert.equal(await value<number>('select count(*)::integer as result from public.highlight_articles'), 1)
    assert.equal((await claim()).outcome, 'empty')
  })

  it('rejects non-current and non-Monday generation requests', async () => {
    await assert.rejects(value('select public.claim_weekly_highlight($1::date - 7) as result', [week]), /current Monday/)
    await assert.rejects(value('select public.claim_weekly_highlight($1::date + 1) as result', [week]), /current Monday/)
    await assert.rejects(value('select public.claim_weekly_highlight(null) as result'), /current Monday/)
  })

  it('denies anonymous and member table/RPC access while allowing the service role only reads and RPC writes', async () => {
    await seed('male')
    await seed('female')
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      try {
        for (const table of ['weekly_highlights', 'highlight_articles']) {
          await assert.rejects(db.query(`select * from public.${table}`), /permission denied/)
        }
        await assert.rejects(claim(), /permission denied/)
        await assert.rejects(claimAi('00000000-0000-0000-0000-000000000000'), /permission denied/)
        await assert.rejects(save('00000000-0000-0000-0000-000000000000'), /permission denied/)
        await assert.rejects(publish('00000000-0000-0000-0000-000000000000'), /permission denied/)
      } finally { await db.exec('reset role') }
    }
    await db.exec('set role service_role')
    try {
      const token = leaseOf(await claim())
      assert.equal(await value<number>('select count(*)::integer as result from public.highlight_articles'), 2)
      await assert.rejects(db.exec("update public.highlight_articles set title = 'Unauthorized direct write'"), /permission denied/)
      assert.equal(await save(token, 1), true)
      assert.equal(await save(token, 2), true)
      assert.equal(await publish(token), true)
    } finally { await db.exec('reset role') }
  })
})
