import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, beforeEach, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationsUrl = new URL('../../../supabase/migrations/', import.meta.url)
let db: PGlite

const prepa = { kind: 'education', title: 'Classes préparatoires', organization: 'La Salle', location: 'Ouagadougou', start_year: 2020, end_year: 2022 }
const job = { kind: 'work', title: 'Développeur IA', organization: 'ESSCA', start_year: 2024, end_year: null }

async function signUp(metadata: Record<string, unknown> = {}, provider = 'email') {
  const result = await db.query<{ id: string }>(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), 'member@example.test', $1, $2) returning id`, [
    JSON.stringify({ first_name: 'Membre', last_name: 'Test', member_role: 'alumni', ...metadata }),
    JSON.stringify({ provider }),
  ])
  return result.rows[0]!.id
}

async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  await db.exec('set role authenticated')
  try { return await run() }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', '', false)") }
}

const stepsOf = async (id: string) =>
  (await db.query<{ career_steps: unknown[] }>('select career_steps from public.profiles where id = $1', [id])).rows[0]!.career_steps
const saveSteps = (id: string, steps: unknown) => asUser(id, () =>
  db.query('update public.profiles set career_steps = $2 where id = $1 returning id', [id, JSON.stringify(steps)]))

describe('Profile career steps', { concurrency: false }, () => {
  before(async () => {
    db = new PGlite()
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
    // Match Supabase's table access: RLS and the CHECK constraint still apply.
    await db.exec('grant select, insert, update on public.profiles, public.profile_contacts to authenticated')
  })
  beforeEach(async () => { await db.exec('truncate public.weekly_highlights, auth.users cascade') })
  after(async () => { await db?.close() })

  it('starts empty and lets members save their own ordered steps', async () => {
    const member = await signUp()
    assert.deepEqual(await stepsOf(member), [])
    assert.equal((await saveSteps(member, [prepa, job])).rows.length, 1)
    assert.deepEqual(await stepsOf(member), [prepa, job])
  })

  it('rejects malformed steps at the database boundary', async () => {
    const member = await signUp()
    const invalid: unknown[] = [
      { not: 'an array' },
      [{ ...prepa, salary: 1 }],
      [{ ...prepa, kind: 'hobby' }],
      [{ ...prepa, title: 'X' }],
      [{ ...prepa, title: '  Prépa  ' }],
      [{ ...prepa, organization: 'x'.repeat(121) }],
      [{ ...prepa, start_year: '2020' }],
      [{ ...prepa, start_year: 2020.5 }],
      [{ ...prepa, start_year: 1900 }],
      [{ ...prepa, end_year: 2019 }],
      [{ ...prepa, end_year: 'en cours' }],
      Array.from({ length: 13 }, () => prepa),
    ]
    for (const steps of invalid) {
      await assert.rejects(saveSteps(member, steps), /profiles_career_steps_check/, JSON.stringify(steps).slice(0, 80))
    }
    assert.deepEqual(await stepsOf(member), [])
  })

  it('keeps email sign-up steps from the metadata and ignores invalid ones without blocking sign-up', async () => {
    const withSteps = await signUp({ career_steps: [prepa, job] })
    assert.deepEqual(await stepsOf(withSteps), [prepa, job])
    const withInvalidSteps = await signUp({ career_steps: [{ ...prepa, kind: 'hobby' }] })
    assert.deepEqual(await stepsOf(withInvalidSteps), [])
    const google = await signUp({ full_name: 'Membre Google' }, 'google')
    assert.deepEqual(await stepsOf(google), [])
  })

  it('lets nobody else change a member’s steps', async () => {
    const member = await signUp({ career_steps: [prepa] })
    const other = await signUp()
    assert.equal((await asUser(other, () => db.query('update public.profiles set career_steps = $2 where id = $1 returning id', [member, JSON.stringify([job])]))).rows.length, 0)
    assert.deepEqual(await stepsOf(member), [prepa])
  })
})
