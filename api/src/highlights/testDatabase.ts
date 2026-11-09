import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createProof, importDeviceKey, type MessagingDevice } from '../../../src/lib/messagingDevice.ts'

const migrationsUrl = new URL('../../../supabase/migrations/', import.meta.url)

// What device-bound messaging also needs from Supabase: sign-in sessions, the JWT and Vault.
const messagingStubs = `
  create table auth.sessions (id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default clock_timestamp(), not_after timestamptz, user_agent text);
  create function auth.jwt() returns jsonb language sql as
    'select coalesce(nullif(current_setting(''request.jwt.claims'', true), ''''), ''{}'')::jsonb';
  create schema vault;
  create table vault.secrets (name text primary key, secret text not null, description text);
  create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text, new_description text) returns text
    language sql as 'insert into vault.secrets values ($2, $1, $3) returning name';
`

/**
 * A local Postgres with Supabase's roles and auth stubs, then every migration in
 * order, or only those before `before` to test what a migration does to data.
 * `messaging` adds what signed messaging calls need (see seedMessagingMember).
 */
export async function createMigratedDatabase({ before, messaging = false }: { before?: string; messaging?: boolean } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } })
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
  if (messaging) await db.exec(messagingStubs)
  for (const file of (await readdir(migrationsUrl)).filter((name) => name.endsWith('.sql')).sort()) {
    if (before === undefined || file < before) await applyMigration(db, file)
  }
  // Supabase grants table access by default; RLS and the triggers still apply.
  await db.exec('grant select, insert, update on public.profiles, public.profile_contacts to authenticated')
  return db
}

export async function applyMigration(db: PGlite, file: string) {
  await db.exec(await readFile(new URL(file, migrationsUrl), 'utf8'))
}

export type MemberOptions = {
  student?: boolean; mentor?: boolean; inactive?: boolean; email?: string; firstName?: string; graduationYear?: number
}

/** Signs a member up the way the site does; their profile is complete and active. */
export async function seedMember(db: PGlite, options: MemberOptions = {}) {
  const result = await db.query<{ id: string }>(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), $1, $2, '{"provider":"email"}') returning id`, [
    options.email ?? 'member@example.test',
    JSON.stringify({
      first_name: options.firstName ?? 'Membre', last_name: 'Test', member_role: options.student ? 'student' : 'alumni',
      offers_mentoring: options.mentor ?? false, graduation_year: options.graduationYear,
    }),
  ])
  const id = result.rows[0]!.id
  if (options.inactive) await db.query('update public.profiles set is_active = false where id = $1', [id])
  return id
}

/** Runs queries as a signed-in member (or a visitor with `null` and the anon role). */
export async function asMember<T>(db: PGlite, id: string | null, run: () => Promise<T>, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ''])
  await db.exec(`set role ${role}`)
  try { return await run() }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', '', false)") }
}

export const INTRODUCTION = 'Bonjour, je souhaite rejoindre votre réseau sur l’annuaire.'

export function sendRequest(db: PGlite, requester: string, recipient: string, kind = 'connection') {
  return asMember(db, requester, async () => (await db.query<{ id: string; status: string }>(
    'insert into public.connection_requests (requester_id, recipient_id, request_kind, message) values ($1, $2, $3, $4) returning id, status',
    [requester, recipient, kind, INTRODUCTION])).rows[0]!)
}

export function answerRequest(db: PGlite, recipient: string, requestId: string, status = 'accepted') {
  return asMember(db, recipient, () => db.query('update public.connection_requests set status = $2 where id = $1 returning id', [requestId, status]))
}

export type MessagingMember = { id: string; session: string; device: MessagingDevice }

/** Runs queries as a member signed in with this session: the claims messaging reads. */
export async function asSession<T>(db: PGlite, member: { id: string; session: string }, run: () => Promise<T>) {
  const claims = JSON.stringify({ sub: member.id, session_id: member.session })
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [member.id, claims])
  await db.exec('set role authenticated')
  try { return await run() }
  finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)")
  }
}

/** A member just signed in on a device registered for messaging, as the browser does after sign-in. */
export async function seedMessagingMember(db: PGlite, options: MemberOptions = {}): Promise<MessagingMember> {
  const id = await seedMember(db, options)
  const session = (await db.query<{ id: string }>('insert into auth.sessions (id, user_id) values (gen_random_uuid(), $1) returning id', [id])).rows[0]!.id
  const registered = await asSession(db, { id, session }, async () => (await db.query<{ value: { session_id: string; key: string; server_time: number } }>(
    'select to_jsonb(public.messaging_register_device()) as value')).rows[0]!.value)
  const device = { userId: id, sessionId: registered.session_id, key: await importDeviceKey(registered.key), clockOffset: registered.server_time - Date.now() }
  return { id, session, device }
}

/** Calls a messaging function as the site does: signed with the member's device key. */
export async function signedCall(db: PGlite, member: MessagingMember, name: string, args: unknown[], [action, payload]: readonly [string, string]) {
  const values = [...args, await createProof(member.device, action, payload)]
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ')
  return asSession(db, member, () => db.query(`select public.${name}(${placeholders})`, values))
}
