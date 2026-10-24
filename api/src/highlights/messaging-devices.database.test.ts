import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, beforeEach, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { createProof, importDeviceKey, type MessagingDevice } from '../../../src/lib/messagingDevice.ts'
import { signedCalls } from '../../../src/lib/messagingData.ts'

const migrationsUrl = new URL('../../../supabase/migrations/', import.meta.url)
const deviceMigration = '20261024191932_device_bound_messaging.sql'
const FRESH_SIGN_IN_LIMIT_MINUTES = 10
const PROOF_LIFETIME_MS = 300_000

// Supabase provides these schemas; the suite recreates the parts the migrations rely on.
const supabaseStubs = `
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon,authenticated,service_role;
  create schema auth; grant usage on schema auth to anon,authenticated,service_role;
  create schema storage; grant usage on schema storage to authenticated;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}',raw_app_meta_data jsonb not null default '{}');
  create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default clock_timestamp(),not_after timestamptz,user_agent text);
  create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
  create function auth.jwt() returns jsonb language sql as
    'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
  create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1,''/'')';
  create schema vault;
  create table vault.secrets(name text primary key,secret text not null,description text);
  create view vault.decrypted_secrets as select name,secret as decrypted_secret from vault.secrets;
  create function vault.create_secret(new_secret text,new_name text,new_description text) returns text
    language sql as 'insert into vault.secrets values($2,$1,$3) returning name';`

type Member = { id: string; session: string; device?: MessagingDevice }
let db: PGlite
let awa: Member, fatou: Member, paul: Member, conversation: string

async function initialize(target: PGlite, last = deviceMigration) {
  await target.exec(supabaseStubs)
  for (const file of (await readdir(migrationsUrl)).filter(file => file.endsWith('.sql') && file <= last).sort())
    await target.exec(await readFile(new URL(file, migrationsUrl), 'utf8'))
  await target.exec('grant select,insert,update on public.profiles,public.profile_contacts to authenticated')
}

async function asMember<T>(member: Member | null, run: () => Promise<T>, role = 'authenticated') {
  const claims = member ? JSON.stringify({ sub: member.id, session_id: member.session }) : ''
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [member?.id ?? '', claims])
  await db.exec(`set role ${role}`)
  try { return await run() }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','',false)") }
}

async function signIn(id: string, minutesAgo = 0) {
  return (await db.query<{ id: string }>(`insert into auth.sessions(id,user_id,created_at,user_agent)
    values(gen_random_uuid(),$1,clock_timestamp()-make_interval(mins=>$2),'Mozilla/5.0 (Windows NT 10.0) Chrome/130') returning id`,
  [id, minutesAgo])).rows[0]!.id
}

async function seed(name: string): Promise<Member> {
  const id = (await db.query<{ id: string }>(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
    values(gen_random_uuid(),$1,$2,'{"provider":"email"}') returning id`, [`${name}@example.test`, JSON.stringify({
    first_name: name, last_name: 'Test', graduation_year: 2020, member_role: 'alumni', offers_mentoring: true,
  })])).rows[0]!.id
  return { id, session: await signIn(id) }
}

const call = <T = any>(member: Member | null, name: string, args: unknown[] = [], role = 'authenticated') => asMember(member, async () => {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(',')
  return (await db.query<{ value: T }>(`select to_jsonb(public.${name}(${placeholders})) as value`, args)).rows[0]!.value
}, role)
const callSet = <T = any>(member: Member, name: string, args: unknown[]) => asMember(member, async () => {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(',')
  return (await db.query<{ value: T }>(`select coalesce(jsonb_agg(item),'[]'::jsonb) as value from public.${name}(${placeholders}) item`, args)).rows[0]!.value
})

async function register(member: Member) {
  const result = await call<{ session_id: string; key: string; server_time: number }>(member, 'messaging_register_device')
  member.device = { userId: member.id, sessionId: result.session_id, key: await importDeviceKey(result.key), clockOffset: result.server_time - Date.now() }
  return result
}
const proof = (member: Member, [action, payload]: readonly [string, string], now?: number) => createProof(member.device!, action, payload, now)
async function send(member: Member, text = 'Bonjour, comment vas-tu ?', nonce = randomUUID(), id = conversation) {
  return call(member, 'messaging_send_message', [id, text, nonce, await proof(member, signedCalls.send(id, nonce, text))])
}
async function history(member: Member, id = conversation) {
  return callSet(member, 'messaging_get_messages', [id, null, null, 50, await proof(member, signedCalls.messages(id, null, null, 50))])
}
async function unread(member: Member) { return call<number>(member, 'messaging_unread_count', [await proof(member, signedCalls.unread())]) }

async function request(from: Member, to: Member) {
  const id = await asMember(from, async () => (await db.query<{ id: string }>(`insert into public.connection_requests(requester_id,recipient_id,request_kind,message)
    values($1,$2,'contact','Ce texte de présentation reste dans Mes relations.') returning id`, [from.id, to.id])).rows[0]!.id)
  await asMember(to, () => db.query("update public.connection_requests set status='accepted' where id=$1", [id]))
  return id
}

describe('Device-bound messaging without personal keys', { concurrency: false }, () => {
  before(async () => { db = new PGlite({ extensions: { pgcrypto } }); await initialize(db) })
  beforeEach(async () => {
    await db.exec('truncate auth.users cascade; update private.hub_maintenance set enabled=false,ends_at=null')
    awa = await seed('Awa'); fatou = await seed('Fatou'); paul = await seed('Paul')
    // One connection carries the caller's claims: registrations must not interleave.
    for (const member of [awa, fatou, paul]) await register(member)
    conversation = await request(awa, fatou)
  })
  after(async () => { await db?.close() })

  it('lets two members write and read without any personal key, and keeps a third member out', async () => {
    const sent = await send(awa, '  Salut Fatou  ')
    assert.equal(sent.body, 'Salut Fatou'); assert.equal(sent.recipient_id, fatou.id)
    const reply = await send(fatou, 'Bonjour Awa, avec plaisir.')
    assert.deepEqual((await history(fatou)).map((message: any) => message.body), ['Bonjour Awa, avec plaisir.', 'Salut Fatou'])
    assert.equal(reply.sender_id, fatou.id)
    await assert.rejects(history(paul), /accepted conversation/)
    await assert.rejects(send(paul), /accepted conversation/)
    assert.equal(await unread(fatou), 1)
  })

  it('stores only ciphertext and refuses direct table access to members', async () => {
    await send(awa, 'Une phrase strictement privée')
    const stored = (await db.query<{ ciphertext: Uint8Array }>('select ciphertext from public.conversation_messages')).rows[0]!
    assert.equal(Buffer.from(stored.ciphertext).toString('latin1').includes('strictement'), false)
    await assert.rejects(asMember(fatou, () => db.exec('select * from public.conversation_messages')), /permission denied/)
    await assert.rejects(asMember(fatou, () => db.exec('select * from private.messaging_devices')), /permission denied/)
    await assert.rejects(call(awa, 'messaging_get_messages', [conversation, null, null, 50, null], 'anon'), /permission denied/)
  })

  it('refuses a session without a device key, which is all a copied access token provides', async () => {
    const copied: Member = { id: fatou.id, session: await signIn(fatou.id, 30) }
    await assert.rejects(call(copied, 'messaging_unread_count', [{ issued_at: Date.now(), signature: 'AAAA' }]), /not authorized for messaging/)
    await assert.rejects(call(copied, 'messaging_register_device'), /recent sign-in is required/)
    const sameSession: Member = { id: fatou.id, session: fatou.session }
    await assert.rejects(call(sameSession, 'messaging_register_device'), /already has a messaging device/)
  })

  it('registers a device only within ten minutes of signing in', async () => {
    const recent: Member = { id: awa.id, session: await signIn(awa.id, FRESH_SIGN_IN_LIMIT_MINUTES - 1) }
    await register(recent)
    assert.equal(await unread(recent), 0)
    const late: Member = { id: awa.id, session: await signIn(awa.id, FRESH_SIGN_IN_LIMIT_MINUTES + 1) }
    await assert.rejects(call(late, 'messaging_register_device'), /recent sign-in is required/)
    const forged: Member = { id: awa.id, session: randomUUID() }
    await assert.rejects(call(forged, 'messaging_register_device'), /Sign in again/)
  })

  it('rejects missing, expired, malformed or reused proofs', async () => {
    await assert.rejects(call(fatou, 'messaging_unread_count', [null]), /Invalid or expired/)
    await assert.rejects(call(fatou, 'messaging_unread_count', [await proof(fatou, signedCalls.unread(), Date.now() - PROOF_LIFETIME_MS - 60_000)]), /Invalid or expired/)
    await assert.rejects(call(fatou, 'messaging_unread_count', [{ ...(await proof(fatou, signedCalls.unread())), extra: true }]), /Invalid or expired/)
    const forHeartbeat = await proof(fatou, signedCalls.heartbeat())
    await assert.rejects(call(fatou, 'messaging_unread_count', [forHeartbeat]), /Invalid or expired/)
    const nonce = randomUUID()
    const signed = await proof(awa, signedCalls.send(conversation, nonce, 'Texte signé'))
    await assert.rejects(call(awa, 'messaging_send_message', [conversation, 'Texte modifié', nonce, signed]), /Invalid or expired/)
    const otherDevice: Member = { ...awa, device: paul.device }
    await assert.rejects(call(otherDevice, 'messaging_unread_count', [await proof(otherDevice, signedCalls.unread())]), /Invalid or expired/)
  })

  it('cuts messaging at once when the sign-in ends or the device is removed', async () => {
    const phone: Member = { id: fatou.id, session: await signIn(fatou.id) }
    await register(phone)
    const devices = await callSet(fatou, 'messaging_list_devices', [await proof(fatou, signedCalls.devices())])
    assert.deepEqual(devices.map((device: any) => device.is_current), [true, false])
    await call(fatou, 'messaging_revoke_device', [phone.session, await proof(fatou, signedCalls.revoke(phone.session))])
    await assert.rejects(unread(phone), /not authorized for messaging/)
    await db.query('delete from auth.sessions where id=$1', [fatou.session])
    await assert.rejects(unread(fatou), /Sign in again/)
  })

  it('deduplicates a retried send and refuses a nonce reused for other text', async () => {
    const nonce = randomUUID()
    const first = await send(awa, 'Message unique', nonce)
    const retry = await send(awa, 'Message unique', nonce)
    assert.equal(first.id, retry.id)
    await assert.rejects(send(awa, 'Texte différent', nonce), /nonce already/)
    await assert.rejects(send(awa, '   '), /between 1 and 4000/)
    await assert.rejects(send(awa, 'a'.repeat(4001)), /between 1 and 4000/)
    assert.equal((await history(awa)).length, 1)
  })

  it('refuses a ciphertext moved onto another message', async () => {
    const a = await send(awa, 'Premier message'); const b = await send(awa, 'Second message')
    await db.query('update public.conversation_messages set ciphertext=(select ciphertext from public.conversation_messages where id=$1) where id=$2', [a.id, b.id])
    await assert.rejects(history(fatou), /integrity check failed/)
  })

  it('previews, counts and marks read only what the recipient was shown', async () => {
    const first = await send(awa, 'Un premier message assez long pour un aperçu')
    const later = await send(awa, 'Arrivé pendant la lecture')
    const conversations = await callSet(fatou, 'messaging_list_conversations', [null, 100, await proof(fatou, signedCalls.list(null, 100))])
    assert.equal(conversations[0].last_message_preview, 'Arrivé pendant la lecture'); assert.equal(conversations[0].unread_count, 2)
    await call(fatou, 'messaging_mark_read', [conversation, [first.id], await proof(fatou, signedCalls.read(conversation, [first.id]))])
    assert.equal(await unread(fatou), 1)
    const page = await history(fatou)
    assert.ok(page.find((message: any) => message.id === first.id).read_at)
    assert.equal(page.find((message: any) => message.id === later.id).read_at, null)
    assert.equal(await scalarCount("select count(*) as value from private.messaging_email_queue where status='pending'"), 1)
  })

  it('keeps the e-mail preference and presence behind the device as well', async () => {
    assert.equal(await call(fatou, 'messaging_email_enabled', [await proof(fatou, signedCalls.email())]), true)
    await call(fatou, 'messaging_set_email_enabled', [false, await proof(fatou, signedCalls.emailSet(false))])
    assert.equal(await call(fatou, 'messaging_email_enabled', [await proof(fatou, signedCalls.email())]), false)
    await call(fatou, 'messaging_heartbeat', [await proof(fatou, signedCalls.heartbeat())])
    assert.ok(await scalarCount('select count(*) as value from private.messaging_members where last_seen_at is not null'))
  })

  it('blocks messaging during maintenance and for suspended members', async () => {
    await db.exec('update private.hub_maintenance set enabled=true')
    await assert.rejects(send(awa), /Messaging unavailable/)
    await db.exec('update private.hub_maintenance set enabled=false')
    await db.query('insert into private.hub_suspensions(user_id) values($1)', [fatou.id])
    await assert.rejects(send(awa), /Recipient is unavailable/)
    await assert.rejects(unread(fatou), /Messaging unavailable/)
  })

  it('refuses to replace an existing end-to-end history', async () => {
    const legacy = new PGlite({ extensions: { pgcrypto } })
    try {
      const previous = (await readdir(migrationsUrl)).filter(file => file.endsWith('.sql') && file < deviceMigration).sort().at(-1)!
      await initialize(legacy, previous)
      const sender = (await legacy.query<{ id: string }>(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
        values(gen_random_uuid(),'a@example.test','{"first_name":"A","last_name":"T","graduation_year":2020,"member_role":"alumni"}','{"provider":"email"}') returning id`)).rows[0]!.id
      const recipient = (await legacy.query<{ id: string }>(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
        values(gen_random_uuid(),'b@example.test','{"first_name":"B","last_name":"T","graduation_year":2020,"member_role":"alumni"}','{"provider":"email"}') returning id`)).rows[0]!.id
      const actAs = (id: string) => legacy.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
      await actAs(sender)
      const id = (await legacy.query<{ id: string }>(`insert into public.connection_requests(requester_id,recipient_id,request_kind,message)
        values($1,$2,'contact','Bonjour, je souhaite échanger.') returning id`, [sender, recipient])).rows[0]!.id
      await actAs(recipient)
      await legacy.query("update public.connection_requests set status='accepted' where id=$1", [id])
      await legacy.exec('alter table public.conversation_messages drop constraint conversation_messages_encrypted_body_check')
      await legacy.query(`insert into public.conversation_messages(conversation_id,sender_id,recipient_id,body,client_nonce)
        values($1,$2,$3,'ancien message',gen_random_uuid())`, [id, sender, recipient])
      await assert.rejects(legacy.exec(await readFile(new URL(deviceMigration, migrationsUrl), 'utf8')), /requires an explicit migration/)
    } finally { await legacy.close() }
  })
})

async function scalarCount(sql: string) { return Number((await db.query<{ value: number }>(sql)).rows[0]!.value) }
