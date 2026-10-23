import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, beforeEach, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationsUrl = new URL('../../../supabase/migrations/', import.meta.url)
let db: PGlite
let sender: string, recipient: string, stranger: string, conversation: string
type Message = { id: string; sequence: number; conversation_id: string; sender_id: string; recipient_id: string; body: string; client_nonce: string; read_at: string | null }
type Job = { job_id: string; lease_token: string; recipient_id: string; conversation_id: string; email: string; unread_count: number }

async function initialize(target: PGlite, includeMessaging = true) {
  await target.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create schema storage; grant usage on schema storage to authenticated;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}',raw_app_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1,''/'')';
  `)
  for (const file of (await readdir(migrationsUrl)).filter(file => file.endsWith('.sql')).sort()) {
    // This suite verifies the foundational queue/authorization migration. The
    // subsequent E2E contract is exercised by messaging-e2e.database.test.ts.
    if (file > '20261023221107_private_messaging.sql' || (!includeMessaging && file.includes('private_messaging'))) continue
    await target.exec(await readFile(new URL(file, migrationsUrl), 'utf8'))
  }
  await target.exec('grant select,insert,update on public.profiles,public.profile_contacts to authenticated')
}
async function seed(name: string, target = db) {
  return (await target.query<{id:string}>(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
    values(gen_random_uuid(),$1,$2,'{"provider":"email"}') returning id`, [`${name}@example.test`, JSON.stringify({
    first_name: name, last_name: 'Test', graduation_year: 2020, member_role: 'alumni', offers_mentoring: true,
  })])).rows[0]!.id
}
async function asUser<T>(id: string | null, run: () => Promise<T>, role = 'authenticated', target = db) {
  await target.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ''])
  await target.exec(`set role ${role}`)
  try { return await run() }
  finally { await target.exec('reset role'); await target.query("select set_config('request.jwt.claim.sub','',false)") }
}
const rpc = <T = any>(id: string, name: string, args: unknown[] = []) => asUser(id, async () =>
  (await db.query<{value:T}>(name === 'messaging_list_conversations'
    ? `select coalesce(jsonb_agg(v),'[]'::jsonb) as value from public.${name}(${args.map((_, i) => `$${i+1}`).join(',')}) v`
    : `select to_jsonb(public.${name}(${args.map((_, i) => `$${i+1}`).join(',')})) as value`, args)).rows[0]!.value)
const send = (actor = sender, body = 'Bonjour, comment vas-tu ?', nonce = randomUUID(), id = conversation) => rpc<Message>(actor, 'messaging_send_message', [id, body, nonce])
const rows = (actor: string) => asUser(actor, async () => (await db.query<Message>('select * from public.conversation_messages order by sequence')).rows)
const claim = () => asUser(null, async () => (await db.query<Job>('select * from public.messaging_claim_notifications()')).rows, 'service_role')
const finish = (job: Job, success = true) => asUser(null, () => db.query('select public.messaging_finish_notification($1,$2,$3)', [job.job_id, job.lease_token, success]), 'service_role')
const due = () => db.exec("update private.messaging_email_queue set next_attempt_at=clock_timestamp()-interval '1 minute'")
const scalar = async <T = any>(sql: string) => (await db.query<{value:T}>(sql)).rows[0]!.value
async function request(a = sender, b = recipient, accepted = true, target = db) {
  const id = await asUser(a, async () => (await target.query<{id:string}>(`insert into public.connection_requests(requester_id,recipient_id,request_kind,message)
    values($1,$2,'contact','Bonjour, je souhaite échanger avec toi sur le réseau.') returning id`, [a,b])).rows[0]!.id, 'authenticated', target)
  if (accepted) await asUser(b, () => target.query("update public.connection_requests set status='accepted' where id=$1",[id]), 'authenticated', target)
  return id
}

describe('Private messaging, receipts and absent-member notifications', { concurrency: false }, () => {
  before(async () => { db = new PGlite(); await initialize(db) })
  beforeEach(async () => {
    await db.exec('truncate auth.users cascade; update private.hub_maintenance set enabled=false,ends_at=null')
    sender = await seed('Awa'); recipient = await seed('Fatou'); stranger = await seed('Paul')
    conversation = await request()
  })
  after(async () => { await db?.close() })

  it('keeps accepted introductions outside message history without emailing historical text', async () => {
    const messages = await rows(recipient)
    assert.equal(messages.length,0)
    assert.equal(await rpc(recipient,'messaging_unread_count'),0)
    assert.equal(await scalar('select count(*) as value from private.messaging_email_queue'),0)
  })

  it('routes replies to the other participant and hides all messages from a third member', async () => {
    const a = await send(sender,'  Salut Fatou  ')
    const b = await send(recipient,'Bonjour Awa')
    assert.equal(a.body,'Salut Fatou'); assert.equal(a.sender_id,sender); assert.equal(a.recipient_id,recipient)
    assert.equal(b.sender_id,recipient); assert.equal(b.recipient_id,sender)
    assert.equal((await rows(stranger)).length,0)
    await assert.rejects(send(stranger), /accepted conversation/)
    assert.equal(await rpc(recipient,'messaging_unread_count'),1)
    assert.equal(await rpc(sender,'messaging_unread_count'),1)
  })

  it('rejects direct message writes, forged participants, receipts and anonymous access', async () => {
    const message = await send()
    await assert.rejects(asUser(sender,()=>db.query(`insert into public.conversation_messages(conversation_id,sender_id,recipient_id,body,client_nonce)
      values($1,$2,$3,'Forged',gen_random_uuid())`,[conversation,recipient,stranger])),/permission denied/)
    await assert.rejects(asUser(sender,()=>db.query('update public.conversation_messages set read_at=now() where id=$1',[message.id])),/permission denied/)
    await assert.rejects(asUser(sender,()=>db.query('delete from public.conversation_messages where id=$1',[message.id])),/permission denied/)
    await assert.rejects(asUser(null,()=>db.exec('select * from public.conversation_messages'),'anon'),/permission denied/)
    await assert.rejects(asUser(null,()=>db.exec('select public.messaging_heartbeat()'),'anon'),/permission denied/)
    await assert.rejects(asUser(sender,()=>db.exec('select * from private.messaging_members')),/permission denied/)
    await assert.rejects(asUser(sender,()=>db.exec('select * from private.messaging_email_queue')),/permission denied/)
    await assert.rejects(asUser(sender,()=>db.exec('select public.messaging_claim_notifications()')),/permission denied/)
    await assert.rejects(rpc(sender,'messaging_finish_notification',[randomUUID(),randomUUID(),true]),/permission denied/)
  })

  it('deduplicates retry nonces, rejects reusing one for different text, and validates empty/long messages', async () => {
    const nonce=randomUUID(); const a=await send(sender,'Message unique',nonce); const b=await send(sender,'Message unique',nonce)
    assert.equal(a.id,b.id); assert.equal((await rows(sender)).length,1)
    await assert.rejects(send(sender,'Texte modifié',nonce),/nonce already/)
    await assert.rejects(send(sender,'   '),/between 1 and 4000/)
    await assert.rejects(send(sender,'a'.repeat(4001)),/between 1 and 4000/)
    assert.equal((await send(sender,'a'.repeat(4000))).body.length,4000)
    assert.equal(await scalar('select count(*) as value from private.messaging_email_queue'),1)
  })

  it('requires acceptance and both active completed unsuspended participants', async () => {
    const pending=await request(sender,stranger,false)
    await assert.rejects(send(sender,'Pas encore accepté',randomUUID(),pending),/accepted conversation/)
    await asUser(stranger,()=>db.query("update public.connection_requests set status='declined' where id=$1",[pending]))
    await assert.rejects(send(sender,'Demande refusée',randomUUID(),pending),/accepted conversation/)
    await db.query('insert into private.hub_suspensions(user_id) values($1)',[recipient])
    await assert.rejects(send(),/Recipient is unavailable/)
    await assert.rejects(send(recipient),/Messaging unavailable/)
    await db.exec('delete from private.hub_suspensions')
    await db.query('update public.profiles set is_active=false where id=$1',[recipient])
    await assert.rejects(send(),/Recipient is unavailable/)
    await db.query("update public.profiles set is_active=false,profile_completed=false,member_role='student' where id=$1",[recipient])
    await assert.rejects(send(),/Recipient is unavailable/)
  })

  it('gates reads, writes, presence and email work during site maintenance', async () => {
    await send(); await due()
    await db.exec('update private.hub_maintenance set enabled=true')
    assert.equal((await rows(sender)).length,0)
    await assert.rejects(send(),/Messaging unavailable/)
    await assert.rejects(rpc(sender,'messaging_heartbeat'),/Messaging unavailable/)
    await assert.rejects(rpc(sender,'messaging_list_conversations'),/Messaging unavailable/)
    assert.deepEqual(await claim(),[])
  })

  it('marks only received messages through the rendered sequence without consuming later arrivals', async () => {
    const first=await send(); const reply=await send(recipient,'Ma réponse'); const later=await send(sender,'Arrivée pendant la lecture')
    await rpc(recipient,'messaging_mark_read',[conversation,first.sequence])
    const messages=await rows(recipient)
    assert.ok(messages.find(m=>m.id===first.id)!.read_at)
    assert.equal(messages.find(m=>m.id===reply.id)!.read_at,null)
    assert.equal(messages.find(m=>m.id===later.id)!.read_at,null)
    assert.equal(await rpc(recipient,'messaging_unread_count'),1)
    await assert.rejects(rpc(stranger,'messaging_mark_read',[conversation,later.sequence]),/accepted conversation/)
    await rpc(recipient,'messaging_mark_read',[conversation,later.sequence])
    await due()
    const jobs=await claim()
    assert.equal(jobs.length,1); assert.equal(jobs[0]!.recipient_id,sender)
  })

  it('returns participant-only paginated summaries and global unread counts', async () => {
    const other=await request(sender,stranger)
    await send(); await send(sender,'Une deuxième conversation',randomUUID(),other)
    const all=await rpc(sender,'messaging_list_conversations')
    assert.equal(all.length,2)
    const first=await rpc(sender,'messaging_list_conversations',[null,1])
    const second=await rpc(sender,'messaging_list_conversations',[first[0].conversation_id,1])
    assert.equal(second.length,1); assert.notEqual(first[0].conversation_id,second[0].conversation_id)
    assert.equal((await rpc(recipient,'messaging_list_conversations'))[0].unread_count,1)
    assert.equal((await rpc(stranger,'messaging_list_conversations')).length,1)
  })

  it('waits five minutes and suppresses e-mail while a recipient is active on the site', async () => {
    await send(); assert.deepEqual(await claim(),[])
    await due(); await rpc(recipient,'messaging_heartbeat')
    assert.deepEqual(await claim(),[])
    await db.query("update private.messaging_members set last_seen_at=clock_timestamp()-interval '3 minutes' where user_id=$1",[recipient])
    const jobs=await claim(); assert.equal(jobs.length,1)
    assert.equal(jobs[0]!.email,'Fatou@example.test'); assert.equal(jobs[0]!.unread_count,1)
    assert.deepEqual(await claim(),[])
  })

  it('coalesces unread messages and applies the hourly email limit across conversations', async () => {
    await send(); await send(sender,'Un second message')
    const other=await request(stranger,recipient)
    await send(stranger,'Une autre conversation',randomUUID(),other); await due()
    const jobs=await claim(); assert.equal(jobs.length,1)
    await finish(jobs[0]!); assert.deepEqual(await claim(),[])
    await db.query("update private.messaging_members set last_emailed_at=clock_timestamp()-interval '61 minutes' where user_id=$1",[recipient])
    assert.equal((await claim()).length,1)
  })

  it('honors private recipient preferences, read cancellation and suspended accounts', async () => {
    assert.equal(await rpc(recipient,'messaging_email_enabled'),true)
    await rpc(recipient,'messaging_set_email_enabled',[false])
    assert.equal(await rpc(recipient,'messaging_email_enabled'),false)
    assert.equal(await rpc(sender,'messaging_email_enabled'),true)
    await send(); await due(); assert.deepEqual(await claim(),[])
    await rpc(recipient,'messaging_set_email_enabled',[true])
    const message=await send(); await rpc(recipient,'messaging_mark_read',[conversation,message.sequence])
    await due(); assert.deepEqual(await claim(),[])
    await send(); await db.query('insert into private.hub_suspensions(user_id) values($1)',[recipient])
    await due(); assert.deepEqual(await claim(),[])
  })

  it('retries with the same job id and a fresh lease, rejecting stale worker acknowledgments', async () => {
    await send(); await due()
    const first=(await claim())[0]!; await finish(first,false)
    assert.deepEqual(await claim(),[])
    await due(); const retry=(await claim())[0]!
    assert.equal(retry.job_id,first.job_id); assert.notEqual(retry.lease_token,first.lease_token)
    await assert.rejects(finish(first),/lease is no longer valid/)
    await finish(retry)
    assert.equal(await scalar("select status as value from private.messaging_email_queue limit 1"),'sent')
  })

  it('fails closed after 25 minutes so a delayed run cannot reuse an expired provider idempotency key', async () => {
    await send(); await due(); const job=(await claim())[0]!
    await db.exec("update private.messaging_email_queue set first_attempt_at=clock_timestamp()-interval '26 minutes',lease_until=clock_timestamp()-interval '1 minute'; update private.messaging_members set delivery_lease_until=clock_timestamp()-interval '1 minute'")
    assert.deepEqual(await claim(),[])
    assert.equal(await scalar('select status as value from private.messaging_email_queue limit 1'),'failed')
    await assert.rejects(finish(job),/lease is no longer valid/)
  })

  it('preserves messages arriving during email delivery in a new delayed job', async () => {
    await send(); await due(); const job=(await claim())[0]!
    await send(sender,'Arrivé pendant l’envoi du mail'); await finish(job)
    assert.equal(await scalar("select count(*) as value from private.messaging_email_queue where status='pending'"),1)
    assert.deepEqual(await claim(),[])
  })

  it('stops after five failed deliveries and never exceeds 180 new email jobs per UTC day', async () => {
    await send(); await due()
    for(let attempt=0; attempt<5; attempt++) {
      const jobs=await claim(); assert.equal(jobs.length,1)
      await finish(jobs[0]!,false); await due()
    }
    assert.deepEqual(await claim(),[])
    assert.equal(await scalar('select status as value from private.messaging_email_queue limit 1'),'failed')
    await db.exec('delete from private.messaging_email_queue')
    await db.query(`insert into private.messaging_email_queue(recipient_id,conversation_id,status,first_attempt_at)
      select $1,$2,'sent',clock_timestamp() from generate_series(1,180)`,[recipient,conversation])
    await send(); await due(); assert.deepEqual(await claim(),[])
    await db.exec("update private.messaging_email_queue set first_attempt_at=date_trunc('day',clock_timestamp())-interval '1 day' where status='sent'")
    assert.equal((await claim()).length,1)
  })

  it('keeps notification content stable when retrying after newer messages arrive', async () => {
    await send(); await due(); const first=(await claim())[0]!
    await finish(first,false); await send(sender,'Un message plus récent'); await due()
    const retry=(await claim())[0]!
    assert.equal(retry.unread_count,first.unread_count)
    await finish(retry)
    assert.equal(await scalar("select count(*) as value from private.messaging_email_queue where status='pending'"),1)
  })

  it('keeps a pre-existing accepted request intact without copying its text to message history', async () => {
    const legacy=new PGlite()
    try {
      await initialize(legacy,false)
      const a=await seed('AvantA',legacy), b=await seed('AvantB',legacy)
      await request(a,b,true,legacy)
      await legacy.exec('create publication supabase_realtime')
      const migration=(await readdir(migrationsUrl)).find(file=>file.includes('private_messaging'))!
      await legacy.exec(await readFile(new URL(migration,migrationsUrl),'utf8'))
      assert.equal((await legacy.query('select * from public.conversation_messages')).rows.length,0)
      assert.equal((await legacy.query('select * from public.connection_requests')).rows.length,1)
      assert.equal((await legacy.query('select * from private.messaging_email_queue')).rows.length,0)
      assert.deepEqual((await legacy.query<{tablename:string}>("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows.map(row=>row.tablename), ['connection_requests','conversation_messages'])
    } finally { await legacy.close() }
  })
})
