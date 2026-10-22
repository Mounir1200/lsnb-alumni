import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, beforeEach, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { normalizeProfileLink } from '../../../src/lib/profileLinks.ts'

let db: PGlite
let legacyProfile: Record<string, unknown>

async function value<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<{ result: T }>(sql, params)
  assert.ok(result.rows[0])
  return result.rows[0].result
}

async function seed(provider = 'google', metadata: Record<string, unknown> = {}, email: string | null = 'member@example.test') {
  const id = await value<string>('select gen_random_uuid()::text as result')
  await db.query('insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3, $4)', [
    id, email, JSON.stringify(metadata), JSON.stringify({ provider }),
  ])
  return id
}

const profile = (id: string) => value<Record<string, unknown>>(
  'select to_jsonb(p) as result from public.profiles p where id = $1', [id],
)
const contact = (id: string) => value<Record<string, unknown>>(
  'select to_jsonb(c) as result from public.profile_contacts c where profile_id = $1', [id],
)

const completionValues: unknown[] = [
  ' Awa ', ' Ouédraogo ', 'alumni', 2020, ' Informatique ', ' Ouagadougou ',
  ' Burkina Faso ', ' Ingénieure logiciel. ', 'female', true, true, true,
]
const complete = (params = completionValues) => value<boolean>(
  'select public.complete_member_profile($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) as result', params,
)

async function asUser<T>(id: string | null, run: () => Promise<T>, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ''])
  await db.exec(`set role ${role}`)
  try { return await run() }
  finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', '', false)")
  }
}

describe('Google OAuth profile provisioning and completion', { concurrency: false }, () => {
  before(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create schema auth;
      grant usage on schema auth to anon, authenticated, service_role;
      create schema storage;
      create table auth.users (
        id uuid primary key, email text,
        raw_user_meta_data jsonb not null default '{}',
        raw_app_meta_data jsonb not null default '{}'
      );
      create function auth.uid() returns uuid language sql as
        'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1, ''/'')';
    `)
    for (const file of ['202609040001_initial_schema.sql', '202609050001_weekly_highlights.sql']) {
      await db.exec(await readFile(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
    }
    const legacyId = await seed('email', { first_name: 'Ancien', last_name: 'Membre', member_role: 'alumni', gender: 'male' })
    await db.exec(await readFile(new URL('../../../supabase/migrations/202609050002_google_auth_onboarding.sql', import.meta.url), 'utf8'))
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261021181216_optional_profile_links.sql', import.meta.url), 'utf8'))
    await db.exec(await readFile(new URL('../../../supabase/migrations/20261021182359_public_https_profile_links.sql', import.meta.url), 'utf8'))
    legacyProfile = await profile(legacyId)
    // Match Supabase's table access: RLS and the completion guard still apply.
    await db.exec('grant select, insert, update on public.profiles, public.profile_contacts to authenticated')
  })
  beforeEach(async () => { await db.exec('truncate public.weekly_highlights, auth.users cascade') })
  after(async () => { await db?.close() })

  it('preserves legacy members and the email signup role, gender and contact contract', async () => {
    assert.equal(legacyProfile.profile_completed, true)
    assert.equal(legacyProfile.is_active, true)
    assert.equal(legacyProfile.first_name, 'Ancien')
    assert.equal(legacyProfile.member_role, 'alumni')
    assert.equal(legacyProfile.gender, 'male')
    assert.equal(legacyProfile.linkedin_url, null)
    assert.equal(legacyProfile.portfolio_url, null)
    for (const role of ['alumni', 'student']) {
      const id = await seed('email', {
        first_name: 'Email', last_name: 'Membre', member_role: role, graduation_year: 2022,
        gender: 'female', specialty: 'Sciences', city: 'Bobo', country: 'Burkina Faso',
        experience: 'Études et projets.', offers_mentoring: true, contact_visible: true,
        provider: 'google', profile_completed: false,
      })
      const member = await profile(id)
      assert.equal(member.profile_completed, true)
      assert.equal(member.is_active, true)
      assert.equal(member.member_role, role)
      assert.equal(member.gender, 'female')
      assert.equal(member.graduation_year, 2022)
      assert.equal(member.offers_mentoring, role === 'alumni')
      assert.equal((await contact(id)).is_visible, true)
    }
  })

  it('provisions Google names and HTTPS avatar while ignoring unconfirmed membership metadata', async () => {
    const id = await seed('google', {
      given_name: ' Awa ', family_name: ' Ouédraogo ', name: 'Another Display Name',
      avatar_url: 'https://lh3.googleusercontent.com/avatar', member_role: 'alumni',
      profile_completed: true, is_active: true, gender: 'female', graduation_year: 2020,
      specialty: 'Invented', city: 'Paris', country: 'France', experience: 'Unconfirmed',
      offers_mentoring: true, contact_visible: true,
    })
    const member = await profile(id)
    assert.equal(member.first_name, 'Awa')
    assert.equal(member.last_name, 'Ouédraogo')
    assert.equal(member.photo_url, 'https://lh3.googleusercontent.com/avatar')
    assert.equal(member.profile_completed, false)
    assert.equal(member.is_active, false)
    assert.equal(member.member_role, 'student')
    assert.equal(member.graduation_year, null)
    assert.equal(member.gender, null)
    assert.equal(member.city, null)
    assert.equal(member.country, null)
    assert.equal(member.specialty, '')
    assert.equal(member.experience, '')
    assert.equal(member.offers_mentoring, false)
    assert.equal((await contact(id)).is_visible, false)
  })

  it('falls back to provider display names without inventing missing information or accepting unsafe avatar URLs', async () => {
    for (const [metadata, first, last, photo] of [
      [{ full_name: '  Awa   Marie Ouédraogo  ', picture: 'https://example.test/avatar.png' }, 'Awa', 'Marie Ouédraogo', 'https://example.test/avatar.png'],
      [{ name: 'Awa' }, 'Awa', '', null],
      [{ avatar_url: 'javascript:alert(1)' }, '', '', null],
      [{ avatar_url: 'http://example.test/avatar.png' }, '', '', null],
      [{ avatar_url: 'https://example.test/with space' }, '', '', null],
    ] as const) {
      const member = await profile(await seed('google', metadata))
      assert.equal(member.first_name, first)
      assert.equal(member.last_name, last)
      assert.equal(member.photo_url, photo)
    }
  })

  it('keeps incomplete profiles out of the member directory and weekly Highlights', async () => {
    const googleId = await seed('google', { member_role: 'alumni' })
    const observer = await seed('email')
    await asUser(observer, async () => {
      assert.equal(await value<number>('select count(*)::integer as result from public.profiles where id = $1', [googleId]), 0)
    })
    await asUser(googleId, async () => {
      assert.equal((await profile(googleId)).profile_completed, false)
    })
    const week = await value<string>("select date_trunc('week', timezone('Africa/Ouagadougou', clock_timestamp()))::date::text as result")
    const claim = await value<{ outcome: string }>('select public.claim_weekly_highlight($1::date) as result', [week])
    assert.equal(claim.outcome, 'empty')
  })

  it('completes only the signed-in member, trims fields and uses the authoritative account email', async () => {
    const id = await seed('google', {}, 'google@example.test')
    const otherId = await seed()
    await db.query("update public.profile_contacts set email = 'stale@example.test' where profile_id = $1", [id])
    assert.equal(await asUser(id, () => complete()), true)
    const member = await profile(id)
    assert.equal(member.profile_completed, true)
    assert.equal(member.is_active, true)
    assert.equal(member.first_name, 'Awa')
    assert.equal(member.last_name, 'Ouédraogo')
    assert.equal(member.member_role, 'alumni')
    assert.equal(member.graduation_year, 2020)
    assert.equal(member.specialty, 'Informatique')
    assert.equal(member.city, 'Ouagadougou')
    assert.equal(member.country, 'Burkina Faso')
    assert.equal(member.experience, 'Ingénieure logiciel.')
    assert.equal(member.gender, 'female')
    assert.equal(member.offers_mentoring, true)
    assert.equal((await contact(id)).email, 'google@example.test')
    assert.equal((await contact(id)).is_visible, true)
    assert.equal((await profile(otherId)).profile_completed, false)
  })

  it('permits explicit student membership and unspecified gender without enabling mentoring', async () => {
    const id = await seed()
    const params = [...completionValues]
    params[2] = 'student'
    params[8] = null
    assert.equal(await asUser(id, () => complete(params)), true)
    const member = await profile(id)
    assert.equal(member.member_role, 'student')
    assert.equal(member.gender, null)
    assert.equal(member.offers_mentoring, false)
    assert.equal(member.is_active, true)
  })

  it('rejects incomplete, invalid or unconsented forms without activating the profile', async () => {
    const id = await seed()
    const invalid: Array<[number, unknown]> = [
      [0, '   '], [1, null], [2, null], [2, 'administrator'], [3, null], [3, 2016], [3, 2041],
      [4, ''], [5, ''], [6, ''], [7, null], [8, 'inferred'], [11, false], [11, null],
    ]
    await asUser(id, async () => {
      for (const [index, replacement] of invalid) {
        const params = [...completionValues]
        params[index] = replacement
        await assert.rejects(complete(params), /required|Choose|Graduation|Invalid|Accept/)
        assert.equal((await profile(id)).profile_completed, false)
        assert.equal((await contact(id)).is_visible, false)
      }
    })
  })

  it('requires a signed-in identity with an email, and denies anonymous/service execution', async () => {
    const id = await seed()
    for (const role of ['anon', 'service_role']) {
      await asUser(id, () => assert.rejects(complete(), /permission denied/), role)
    }
    await asUser(null, () => assert.rejects(complete(), /Authentication required/))
    await asUser('00000000-0000-0000-0000-000000000099', () => assert.rejects(complete(), /Member profile not found/))
    const noEmail = await seed('google', {}, null)
    await asUser(noEmail, () => assert.rejects(complete(), /email address is required/))
    assert.equal((await profile(noEmail)).is_active, false)
  })

  it('blocks direct activation/completion and preserves ordinary profile editing after completion', async () => {
    const id = await seed()
    await asUser(id, async () => {
      await assert.rejects(db.query('update public.profiles set profile_completed = true, is_active = true where id = $1', [id]), /Complete the member form/)
      await assert.rejects(db.query('update public.profiles set is_active = true where id = $1', [id]), /profiles_incomplete_members_inactive/)
      await assert.rejects(db.query("update public.profiles set member_role = 'alumni' where id = $1", [id]), /profiles_incomplete_members_inactive/)
      assert.equal(await complete(), true)
      await db.query("update public.profiles set city = 'Bobo-Dioulasso' where id = $1", [id])
      await assert.rejects(db.query('update public.profiles set profile_completed = false where id = $1', [id]), /Complete the member form/)
    })
    assert.equal((await profile(id)).city, 'Bobo-Dioulasso')
    const unprovisioned = await seed()
    await db.query('delete from public.profiles where id = $1', [unprovisioned])
    await asUser(unprovisioned, () => assert.rejects(db.query(
      "insert into public.profiles (id, first_name, last_name, member_role) values ($1, 'Injected', 'Member', 'alumni')", [unprovisioned],
    ), /Complete the member form/))
  })

  it('does not overwrite a completed profile on duplicate submission or account linking', async () => {
    const id = await seed()
    await asUser(id, async () => {
      assert.equal(await complete(), true)
      const changed = [...completionValues]
      changed[0] = 'Overwrite'
      assert.equal(await complete(changed), false)
    })
    assert.equal((await profile(id)).first_name, 'Awa')
    const emailId = await seed('email', { first_name: 'Existing', last_name: 'Member', member_role: 'alumni' })
    await db.query("update auth.users set raw_app_meta_data = '{\"provider\":\"google\"}', raw_user_meta_data = '{\"name\":\"Google Name\"}' where id = $1", [emailId])
    assert.equal((await profile(emailId)).first_name, 'Existing')
    assert.equal((await profile(emailId)).profile_completed, true)
    assert.equal(await asUser(emailId, () => complete()), false)
  })

  it('rolls back the profile update if saving its contact fails', async () => {
    const id = await seed()
    await db.exec(`
      create function public.reject_test_contact() returns trigger language plpgsql as $$
        begin raise exception 'Simulated contact failure'; end;
      $$;
      create trigger reject_test_contact before insert or update on public.profile_contacts
        for each row execute function public.reject_test_contact();
    `)
    try {
      await asUser(id, () => assert.rejects(complete(), /Simulated contact failure/))
      const member = await profile(id)
      assert.equal(member.profile_completed, false)
      assert.equal(member.is_active, false)
      assert.equal(member.first_name, '')
    } finally {
      await db.exec('drop trigger reject_test_contact on public.profile_contacts; drop function public.reject_test_contact()')
    }
  })

  it('allows email registration with neither link, either link or both, and stores empty links as null', async () => {
    const cases = [
      {},
      { linkedin_url: '', portfolio_url: ' \t\r\n ' },
      { linkedin_url: null, portfolio_url: null },
      { linkedin_url: ' https://www.linkedin.com/in/awa-test/ ' },
      { portfolio_url: ' https://portfolio.example.test/awa?from=lsnb#projects ' },
      { linkedin_url: 'https://fr.linkedin.com/in/awa-test', portfolio_url: 'https://awa.example.test/' },
    ]
    for (const links of cases) {
      const id = await seed('email', { first_name: 'Awa', last_name: 'Test', ...links })
      const member = await profile(id)
      assert.equal(member.profile_completed, true)
      assert.equal(member.is_active, true)
      assert.equal(member.linkedin_url, links.linkedin_url?.trim() || null)
      assert.equal(member.portfolio_url, links.portfolio_url?.trim() || null)
    }
  })

  it('keeps a single completion RPC signature and supports both legacy and new Google clients', async () => {
    assert.equal(await value<number>("select count(*)::integer as result from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'complete_member_profile'"), 1)
    const legacyId = await seed()
    assert.equal(await asUser(legacyId, () => complete()), true)
    assert.equal((await profile(legacyId)).linkedin_url, null)
    assert.equal((await profile(legacyId)).portfolio_url, null)

    for (const links of [
      [null, null], ['', ' \t '],
      [' https://www.linkedin.com/in/awa-test/ ', null],
      [null, ' https://awa.example.test/ '],
      ['https://www.linkedin.com/in/awa-test/', 'https://awa.example.test/'],
    ] as const) {
      const id = await seed()
      assert.equal(await asUser(id, () => value<boolean>(
        'select public.complete_member_profile($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) as result',
        [...completionValues, ...links],
      )), true)
      const member = await profile(id)
      assert.equal(member.profile_completed, true)
      assert.equal(member.linkedin_url, links[0]?.trim() || null)
      assert.equal(member.portfolio_url, links[1]?.trim() || null)
    }
  })

  it('does not populate Google links from unconfirmed provider metadata', async () => {
    const member = await profile(await seed('google', {
      linkedin_url: 'https://www.linkedin.com/in/unconfirmed/',
      portfolio_url: 'https://unconfirmed.example.test/',
    }))
    assert.equal(member.linkedin_url, null)
    assert.equal(member.portfolio_url, null)
    assert.equal(member.profile_completed, false)
  })

  it('lets members update and remove their own links while preserving RLS ownership', async () => {
    const ownerId = await seed('email')
    const otherId = await seed('email')
    await asUser(ownerId, async () => {
      await db.query('update public.profiles set linkedin_url = $2, portfolio_url = $3 where id = $1', [
        ownerId, ' https://linkedin.com/in/awa-test ', ' https://awa.example.test ',
      ])
      assert.equal((await profile(ownerId)).linkedin_url, 'https://linkedin.com/in/awa-test')
      assert.equal((await profile(ownerId)).portfolio_url, 'https://awa.example.test')
      const otherUpdate = await db.query('update public.profiles set portfolio_url = $2 where id = $1 returning id', [
        otherId, 'https://unauthorized.example.test/',
      ])
      assert.equal(otherUpdate.rows.length, 0)
    })
    await asUser(otherId, async () => {
      assert.equal((await profile(ownerId)).linkedin_url, 'https://linkedin.com/in/awa-test')
    })
    await asUser(ownerId, async () => {
      await db.query("update public.profiles set linkedin_url = '', portfolio_url = '   ' where id = $1", [ownerId])
      assert.equal((await profile(ownerId)).linkedin_url, null)
      assert.equal((await profile(ownerId)).portfolio_url, null)
    })
    assert.equal((await profile(otherId)).portfolio_url, null)
    await asUser(null, () => assert.rejects(profile(ownerId), /permission denied/), 'anon')
  })

  it('rejects unsafe or malformed links on direct writes and during email registration', async () => {
    const invalidPortfolio = [
      'javascript:alert(1)', 'data:text/html,test', 'ftp://example.test/file', '//example.test/', 'http://example.test/',
      'https:///example.test', 'https://', 'https://user:password@example.test/',
      'https://example.test/with space', 'https://example.test/\npath', 'https://example.test\\@evil.test/',
      'https://example.test:99999/', `https://example.test/${'a'.repeat(2048)}`,
    ]
    const invalidLinkedin = [
      ...invalidPortfolio, 'https://example.test/in/awa', 'https://linkedin.com.evil.test/in/awa',
      'https://notlinkedin.com/in/awa', 'https://linkedin.com/', 'https://linkedin.com/company/lsnb',
      'https://linkedin.com/in/', 'https://linkedin.com/in/awa/extra', 'https://linkedin.com:8443/in/awa',
    ]
    const id = await seed('email')
    for (const [column, invalidValues] of [['linkedin_url', invalidLinkedin], ['portfolio_url', invalidPortfolio]] as const) {
      for (const url of invalidValues) {
        await asUser(id, () => assert.rejects(
          db.query(`update public.profiles set ${column} = $2 where id = $1`, [id, url]),
          new RegExp(`profiles_${column}_check`),
        ))
        await assert.rejects(seed('email', { [column]: url }), new RegExp(`profiles_${column}_check`))
      }
    }
    assert.equal((await profile(id)).linkedin_url, null)
    assert.equal((await profile(id)).portfolio_url, null)
  })

  it('rolls back Google completion when a supplied link is invalid', async () => {
    const id = await seed()
    await asUser(id, () => assert.rejects(value<boolean>(
      'select public.complete_member_profile($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) as result',
      [...completionValues, 'https://notlinkedin.com/in/awa', 'https://awa.example.test/'],
    ), /profiles_linkedin_url_check/))
    const member = await profile(id)
    assert.equal(member.profile_completed, false)
    assert.equal(member.is_active, false)
    assert.equal(member.linkedin_url, null)
    assert.equal(member.portfolio_url, null)
    assert.equal((await contact(id)).is_visible, false)
  })

  it('accepts public HTTPS links, localized LinkedIn hosts, query strings and boundary lengths', async () => {
    const id = await seed('email')
    for (const url of [
      'https://linkedin.com/in/awa', 'https://fr.linkedin.com/in/awa/',
      'HTTPS://WWW.LINKEDIN.COM/in/awa?trk=profile#about',
      'https://linkedin.com:443/in/awa', 'https://linkedin.com./in/awa',
    ]) {
      await db.query('update public.profiles set linkedin_url = $2 where id = $1', [id, url])
      assert.equal((await profile(id)).linkedin_url, url)
    }
    const longUrl = `https://example.test/${'a'.repeat(2048 - 'https://example.test/'.length)}`
    for (const url of ['https://portfolio.example.test:8443/', 'https://8.8.8.8/path', 'https://[2606:4700:4700::1111]/path', longUrl]) {
      await db.query('update public.profiles set portfolio_url = $2 where id = $1', [id, url])
      assert.equal((await profile(id)).portfolio_url, url)
    }
  })

  it('rejects local names and non-public or obfuscated IPs through every profile write path', async () => {
    const invalidLinks = [
      'https://localhost/', 'https://LOCALHOST./', 'https://foo.localhost./',
      'https://intranet/', 'https://machine.local/', 'https://service.internal/', 'https://printer.home.arpa/',
      'https://0.1.2.3/', 'https://10.1.2.3/', 'https://100.64.0.1/', 'https://100.127.255.255/',
      'https://127.0.0.1/', 'https://127.255.255.255./', 'https://169.254.169.254/',
      'https://172.16.0.1/', 'https://172.31.255.255/', 'https://192.168.1.1/',
      'https://224.0.0.1/', 'https://255.255.255.255/',
      'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/',
      'https://0x7f.0.0.1/', 'https://%31%32%37.0.0.1/',
      'https://[::]/', 'https://[::1]/', 'https://[::127.0.0.1]/',
      'https://[fc00::1]/', 'https://[fdff::1]/', 'https://[fe80::1]/', 'https://[fec0::1]/', 'https://[ff02::1]/',
      'https://[::ffff:127.0.0.1]/', 'https://[::ffff:192.168.1.1]/',
      'https://[64:ff9b::a00:1]/', 'https://[64:ff9b:1::808:808]/',
      'https://[2002:7f00:1::]/', 'https://[2002:c0a8:101::]/', 'https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/',
      'https://[:::]/', 'https://[127.0.0.1]/', 'https://256.0.0.1/',
    ]
    const memberId = await seed('email')
    const googleId = await seed()
    for (const url of invalidLinks) {
      await asUser(memberId, () => assert.rejects(
        db.query('update public.profiles set portfolio_url = $2 where id = $1', [memberId, url]),
        /profiles_portfolio_url_check/,
      ))
      await assert.rejects(seed('email', { portfolio_url: url }), /profiles_portfolio_url_check/)
      await asUser(googleId, () => assert.rejects(value<boolean>(
        'select public.complete_member_profile($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) as result',
        [...completionValues, null, url],
      ), /profiles_portfolio_url_check/))
    }
    assert.equal((await profile(memberId)).portfolio_url, null)
    assert.equal((await profile(googleId)).profile_completed, false)
  })

  it('allows public IP boundaries and public IPv4 addresses embedded in IPv6', async () => {
    const id = await seed('email')
    for (const url of [
      'https://100.63.255.255/', 'https://100.128.0.1/', 'https://172.15.255.255/',
      'https://172.32.0.1/', 'https://192.169.1.1/', 'https://223.255.255.255/',
      'https://[::ffff:8.8.8.8]/', 'https://[64:ff9b::808:808]/', 'https://[2002:808:808::]/',
    ]) {
      await asUser(id, () => db.query('update public.profiles set portfolio_url = $2 where id = $1', [id, url]))
      assert.equal((await profile(id)).portfolio_url, url)
    }
  })

  it('aborts the HTTPS migration atomically when an existing link violates the new constraints', async () => {
    const migrationDb = new PGlite()
    try {
      await migrationDb.exec(`
        create role anon;
        create role authenticated;
        create role service_role;
        create function public.is_valid_profile_link(text, boolean) returns boolean
          language sql immutable as 'select true';
        create table public.profiles (
          linkedin_url text,
          portfolio_url text,
          constraint profiles_linkedin_url_check check (public.is_valid_profile_link(linkedin_url, true)),
          constraint profiles_portfolio_url_check check (public.is_valid_profile_link(portfolio_url, false))
        );
        insert into public.profiles (portfolio_url) values ('http://existing.example.test/');
      `)
      const migration = await readFile(new URL('../../../supabase/migrations/20261021182359_public_https_profile_links.sql', import.meta.url), 'utf8')
      await assert.rejects(migrationDb.exec(migration), /profiles_portfolio_url_check/)
      await migrationDb.exec('rollback')
      const preserved = await migrationDb.query<{ portfolio_url: string; valid: boolean }>(
        'select portfolio_url, public.is_valid_profile_link(portfolio_url, false) as valid from public.profiles',
      )
      assert.equal(preserved.rows[0]?.portfolio_url, 'http://existing.example.test/')
      assert.equal(preserved.rows[0]?.valid, true)
      const missingHelper = await migrationDb.query<{ helper: string | null }>("select to_regprocedure('public.is_public_profile_ip(inet)')::text as helper")
      assert.equal(missingHelper.rows[0]?.helper, null)
    } finally {
      await migrationDb.close()
    }
  })

  it('shares the public HTTPS host contract with the form for raw and canonical addresses', async () => {
    const fixture = JSON.parse(await readFile(new URL('./fixtures/profile-links.json', import.meta.url), 'utf8')) as {
      allowed: string[]; rejected: string[];
    }
    const id = await seed('email')
    const validInDb = (url: string) => asUser(id, () => value<boolean>(
      'select public.is_valid_profile_link($1, false) as result', [url],
    ))
    for (const url of fixture.allowed) {
      assert.equal(await validInDb(url), true, url)
      assert.equal(await validInDb(normalizeProfileLink(url, 'portfolio')!), true, `canonical ${url}`)
    }
    for (const url of fixture.rejected) {
      assert.equal(await validInDb(url), false, url)
      assert.equal(await validInDb(new URL(url).href), false, `canonical ${url}`)
    }
    for (const url of [
      'https://portfolio😀.example/', 'https://%70ortfolio.example/',
      'https://010.010.010.010/', 'https://0x08080808/', 'https://134744072/',
    ]) {
      // Direct SQL requires canonical ASCII. Forms canonicalize with URL first.
      assert.equal(await validInDb(url), false, url)
      assert.equal(await validInDb(normalizeProfileLink(url, 'portfolio')!), true, `canonical ${url}`)
    }
    for (const url of [
      `https://${'a'.repeat(64)}.example/`,
      `https://${Array(4).fill('a'.repeat(63)).join('.')}/`,
      'https://portfolio.123/', 'https://portfolio.0x/', 'https://portfolio.0xff/',
    ]) {
      assert.equal(await validInDb(url), false, url)
      assert.throws(() => normalizeProfileLink(url, 'portfolio'), Error, url)
    }
  })
})
