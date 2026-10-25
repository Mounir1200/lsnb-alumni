import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, beforeEach, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { generateMessagingIdentity, encryptMessage, decryptMessage, unlockMessagingIdentity } from '../../../src/lib/messagingCrypto.ts'

const migrationsUrl=new URL('../../../supabase/migrations/',import.meta.url)
const migrationName='20261025153330_messaging_enrollment_fairness.sql'
let db:PGlite
type Generated=Awaited<ReturnType<typeof generateMessagingIdentity>>
let a:Generated,b:Generated,c:Generated,conversation:string
const aid=()=>a.identity.user_id, bid=()=>b.identity.user_id, cid=()=>c.identity.user_id
async function asRole<T>(actor:string|null,run:()=>Promise<T>,role='authenticated') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor??''])
  await db.exec(`set role ${role}`)
  try{return await run()}finally{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub','',false)")}
}
const rpc=async<T=any>(actor:string|null,name:string,args:unknown[]=[],role='authenticated')=>asRole(actor,async()=>
  (await db.query<{v:T}>(`select to_jsonb(public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')})) as v`,args)).rows[0]!.v,role)
async function seed(name:string) {
  const user=(await db.query<{id:string}>(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
    values(gen_random_uuid(),$1,$2,'{"provider":"email"}') returning id`,[`${name}@example.test`,JSON.stringify({first_name:name,last_name:'Test',member_role:'alumni',graduation_year:2020})])).rows[0]!.id
  return generateMessagingIdentity(user)
}
const enroll=(identity:Generated)=>rpc(null,'messaging_register_identity',[identity.identity.user_id,identity.identity.public_key,identity.identity.encrypted_private_key],'service_role')
async function request(from=aid(),to=bid(),accept=true) {
  const id=await asRole(from,async()=>(await db.query<{id:string}>(`insert into public.connection_requests(requester_id,recipient_id,request_kind,message)
    values($1,$2,'contact','Ce texte initial appartient uniquement à la demande.') returning id`,[from,to])).rows[0]!.id)
  if(accept)await asRole(to,()=>db.query("update public.connection_requests set status='accepted' where id=$1",[id]))
  return id
}
async function prepare(text='Une conversation confidentielle',nonce=randomUUID(),from=a,to=b,id=conversation) {
  const context={conversationId:id,senderId:from.identity.user_id,recipientId:to.identity.user_id,clientNonce:nonce}
  return {body:await encryptMessage(from.unlocked,to.identity.public_key,context,text),nonce,context}
}
const send=(prepared:Awaited<ReturnType<typeof prepare>>,actor=aid())=>rpc<any>(actor,'messaging_send_message',[prepared.context.conversationId,prepared.body,prepared.nonce])
const codeHash='a'.repeat(64)
const beginEnrollment=(user=aid(),challenge=randomUUID(),hash=codeHash,email='Awa@example.test')=>
  rpc<string>(null,'messaging_begin_identity_enrollment',[user,challenge,hash,email],'service_role')
const completeEnrollment=(challenge:string,hash=codeHash,user=aid(),identity=a)=>
  rpc<boolean>(null,'messaging_complete_identity_enrollment',[user,challenge,hash,identity.identity.public_key,identity.identity.encrypted_private_key],'service_role')

describe('Encrypted messaging database boundary and immutable identities',{concurrency:false},()=>{
  before(async()=>{
    db=new PGlite()
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      create schema auth;grant usage on schema auth to anon,authenticated,service_role;
      create schema storage;grant usage on schema storage to authenticated;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb not null default '{}',raw_app_meta_data jsonb not null default '{}');
      create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql as 'select string_to_array($1,''/'')';`)
    for(const file of(await readdir(migrationsUrl)).filter(file=>file.endsWith('.sql')&&file<=migrationName).sort())await db.exec(await readFile(new URL(file,migrationsUrl),'utf8'))
    await db.exec('grant select,insert,update on public.profiles,public.profile_contacts to authenticated')
  })
  beforeEach(async()=>{
    await db.exec('truncate auth.users cascade;update private.hub_maintenance set enabled=false,ends_at=null')
    a=await seed('Awa');b=await seed('Fatou');c=await seed('Paul');conversation=await request()
  })
  after(async()=>{await db?.close()})

  it('requires server-authorized enrollment and makes registered keys immutable',async()=>{
    assert.equal(await rpc(aid(),'messaging_get_identity'),null)
    await assert.rejects(rpc(aid(),'messaging_register_identity',[aid(),a.identity.public_key,a.identity.encrypted_private_key]),/permission denied/)
    await assert.rejects(asRole(aid(),()=>db.query('insert into private.messaging_identities(user_id,public_key,encrypted_private_key) values($1,$2,$3)',[aid(),a.identity.public_key,a.identity.encrypted_private_key])),/permission denied/)
    await enroll(a);await enroll(a)
    assert.deepEqual(await rpc(aid(),'messaging_get_identity'),a.identity)
    await assert.rejects(rpc(null,'messaging_register_identity',[aid(),b.identity.public_key,b.identity.encrypted_private_key],'service_role'),/cannot be replaced/)
    await assert.rejects(db.query('update private.messaging_identities set public_key=$1 where user_id=$2',[b.identity.public_key,aid()]),/immutable/)
    await assert.rejects(asRole(null,()=>db.exec('select * from private.messaging_identities'),'service_role'),/permission denied/)
    await assert.rejects(rpc(null,'messaging_get_identity',[],'anon'),/permission denied/)
  })

  it('exposes only the own encrypted vault and an accepted peer public key',async()=>{
    await enroll(a);await enroll(b);await enroll(c)
    const peer=await rpc(aid(),'messaging_get_peer_key',[conversation])
    assert.deepEqual(peer,{user_id:bid(),public_key:b.identity.public_key})
    assert.equal('encrypted_private_key' in peer,false)
    await assert.rejects(rpc(cid(),'messaging_get_peer_key',[conversation]),/accepted conversation/)
    const pending=await request(aid(),cid(),false)
    await assert.rejects(rpc(aid(),'messaging_get_peer_key',[pending]),/accepted conversation/)
    await assert.rejects(asRole(cid(),()=>db.exec('select * from private.messaging_identities')),/permission denied/)
    const stolenSessionVault=await rpc(aid(),'messaging_get_identity')
    await assert.rejects(unlockMessagingIdentity(stolenSessionVault,b.recoverySecret),/Impossible de déchiffrer/)
  })

  it('never copies clear introductions and rejects plaintext or missing recipient identities',async()=>{
    assert.equal((await db.query('select * from public.conversation_messages')).rows.length,0)
    assert.equal((await db.query('select message from public.connection_requests')).rows.length,1)
    await assert.rejects(rpc(aid(),'messaging_send_message',[conversation,'Un message en clair',randomUUID()]),/encrypted message/)
    await enroll(a)
    const encrypted=await prepare()
    await assert.rejects(send(encrypted),/Both participants/)
    await enroll(b);const stored=await send(encrypted)
    assert.equal(stored.body,encrypted.body);assert.equal(stored.body.includes('confidentielle'),false)
    assert.equal(await decryptMessage(b.unlocked,a.identity.public_key,encrypted.context,stored.body),'Une conversation confidentielle')
  })

  it('protects ciphertext from third members including site staff and returns a generic preview',async()=>{
    await enroll(a);await enroll(b);const encrypted=await prepare();const stored=await send(encrypted)
    await db.query("insert into private.hub_staff(user_id,role) values($1,'admin')",[cid()])
    assert.deepEqual(await asRole(cid(),async()=>(await db.query('select * from public.conversation_messages')).rows),[])
    await assert.rejects(send(encrypted,cid()),/accepted conversation/)
    await assert.rejects(asRole(aid(),()=>db.query('update public.conversation_messages set body=$1 where id=$2',['text',stored.id])),/permission denied/)
    const summaries=await asRole(aid(),async()=>(await db.query<{last_message_body:string}>('select * from public.messaging_list_conversations()')).rows)
    assert.equal(summaries[0]!.last_message_body,'Message chiffré')
    await assert.rejects(asRole(null,()=>db.exec('select * from public.conversation_messages'),'anon'),/permission denied/)
  })

  it('enforces algorithm version, key binding, canonical encodings and strict envelope limits',async()=>{
    await enroll(a);await enroll(b);const encrypted=await prepare(), envelope=JSON.parse(encrypted.body)
    for(const invalid of [{...envelope,alg:null},{...envelope,v:'1'},{...envelope,salt:'abc'},{...envelope,ct:'a'.repeat(23000)},
      {...envelope,extra:'cleartext'},{...envelope,sender_key:envelope.recipient_key},{...envelope,recipient_key:null}]) {
      await assert.rejects(rpc(aid(),'messaging_send_message',[conversation,JSON.stringify(invalid),randomUUID()]))
    }
    const large=await prepare('🙂'.repeat(4000));assert.ok(large.body.length>4000)
    assert.equal((await send(large)).body,large.body)
    await assert.rejects(rpc(null,'messaging_register_identity',[cid(),c.identity.public_key,{...c.identity.encrypted_private_key,alg:null}],'service_role'),/Invalid encrypted identity/)
  })

  it('preserves exact ciphertext retries and rejects encrypting different bytes under a reused nonce',async()=>{
    await enroll(a);await enroll(b);const one=await prepare(), first=await send(one), retry=await send(one)
    assert.equal(first.id,retry.id)
    const reencrypted=await prepare('Une conversation confidentielle',one.nonce)
    await assert.rejects(send(reencrypted),/nonce already/)
    assert.equal((await db.query('select * from public.conversation_messages')).rows.length,1)
  })

  it('acknowledges only selected incoming IDs and leaves any undecrypted preceding message unread',async()=>{
    await enroll(a);await enroll(b)
    const first=await send(await prepare('Premier')),second=await send(await prepare('Second'))
    await rpc(bid(),'messaging_mark_decrypted_read',[conversation,[second.id]])
    const received=(await db.query<{id:string;read_at:string|null}>('select id,read_at from public.conversation_messages')).rows
    assert.equal(received.find(row=>row.id===first.id)!.read_at,null);assert.ok(received.find(row=>row.id===second.id)!.read_at)
    await rpc(aid(),'messaging_mark_decrypted_read',[conversation,[first.id]])
    assert.equal(await rpc(bid(),'messaging_unread_count'),1)
    await assert.rejects(rpc(cid(),'messaging_mark_decrypted_read',[conversation,[first.id]]),/accepted conversation/)
    await assert.rejects(rpc(bid(),'messaging_mark_read',[conversation,second.sequence]),/permission denied/)
    await assert.rejects(rpc(bid(),'messaging_mark_decrypted_read',[conversation,[]]),/Invalid message receipt/)
  })

  it('blocks encryption RPCs and enrollment during suspension or maintenance',async()=>{
    await enroll(a);await enroll(b);const encrypted=await prepare()
    await db.query('insert into private.hub_suspensions(user_id) values($1)',[bid()])
    await assert.rejects(send(encrypted),/Recipient is unavailable/)
    await assert.rejects(rpc(bid(),'messaging_get_identity'),/Messaging unavailable/)
    await db.exec('delete from private.hub_suspensions;update private.hub_maintenance set enabled=true')
    await assert.rejects(send(encrypted),/Messaging unavailable/)
    await assert.rejects(enroll(c),/Messaging unavailable/)
  })

  it('reserves the challenge APIs and private hashes to the server role',async()=>{
    const id=randomUUID()
    for(const role of ['anon','authenticated']) {
      await assert.rejects(rpc(aid(),'messaging_begin_identity_enrollment',[aid(),id,codeHash,'Awa@example.test'],role),/permission denied/)
      await assert.rejects(rpc(aid(),'messaging_complete_identity_enrollment',[aid(),id,codeHash,a.identity.public_key,a.identity.encrypted_private_key],role),/permission denied/)
    }
    await assert.rejects(asRole(null,()=>db.exec('select * from private.messaging_identity_challenges'),'service_role'),/permission denied/)
    await assert.rejects(beginEnrollment(aid(),id,'bad-hash'),/Invalid challenge/)
    await assert.rejects(beginEnrollment(aid(),id,codeHash,'attacker@example.test'),/Account unavailable/)
  })

  it('commits failed OTP attempts, enrolls atomically once, and rejects challenge replay',async()=>{
    const id=randomUUID();await beginEnrollment(aid(),id)
    assert.equal(await completeEnrollment(id,'b'.repeat(64)),false)
    assert.equal((await db.query<{attempts:number}>('select attempts from private.messaging_identity_challenges where id=$1',[id])).rows[0]!.attempts,1)
    assert.equal(await rpc(aid(),'messaging_get_identity'),null)
    assert.equal(await completeEnrollment(id),true)
    assert.deepEqual(await rpc(aid(),'messaging_get_identity'),a.identity)
    assert.equal(await completeEnrollment(id),false)
    const row=(await db.query<{attempts:number;consumed_at:string|null}>('select attempts,consumed_at from private.messaging_identity_challenges where id=$1',[id])).rows[0]!
    assert.equal(row.attempts,2);assert.ok(row.consumed_at)
  })

  it('caps OTP guesses at five, expires after ten minutes, and cannot move a challenge to another user',async()=>{
    const id=randomUUID();await beginEnrollment(aid(),id)
    assert.equal(await completeEnrollment(id,codeHash,bid(),b),false)
    assert.equal((await db.query<{attempts:number}>('select attempts from private.messaging_identity_challenges where id=$1',[id])).rows[0]!.attempts,0)
    for(let i=0;i<5;i++)assert.equal(await completeEnrollment(id,'b'.repeat(64)),false)
    assert.equal(await completeEnrollment(id),false)
    assert.equal((await db.query<{attempts:number}>('select attempts from private.messaging_identity_challenges where id=$1',[id])).rows[0]!.attempts,5)
    const later=randomUUID();await beginEnrollment(bid(),later,codeHash,'Fatou@example.test')
    const duration=(await db.query<{seconds:number}>('select extract(epoch from expires_at-created_at)::integer as seconds from private.messaging_identity_challenges where id=$1',[later])).rows[0]!.seconds
    assert.equal(duration,600)
    await db.query("update private.messaging_identity_challenges set expires_at=clock_timestamp()-interval '1 second' where id=$1",[later])
    assert.equal(await completeEnrollment(later,codeHash,bid(),b),false)
  })

  it('rechecks the account email and suspension before registering a key',async()=>{
    const id=randomUUID();await beginEnrollment(aid(),id)
    await db.query("update auth.users set email='changed@example.test' where id=$1",[aid()])
    assert.equal(await completeEnrollment(id),false);assert.equal(await rpc(aid(),'messaging_get_identity'),null)
    await db.query("update auth.users set email='Awa@example.test' where id=$1",[aid()])
    await db.query('insert into private.hub_suspensions(user_id) values($1)',[aid()])
    await assert.rejects(completeEnrollment(id),/Messaging unavailable/)
    assert.equal((await db.query('select * from private.messaging_identities')).rows.length,0)
  })

  it('invalidates older codes and prevents even a fresh OTP from replacing an existing identity',async()=>{
    const old=randomUUID(),fresh=randomUUID();await beginEnrollment(aid(),old)
    await assert.rejects(beginEnrollment(aid(),fresh),/Please wait/)
    await db.query("update private.messaging_identity_challenges set created_at=clock_timestamp()-interval '61 seconds' where id=$1",[old])
    await beginEnrollment(aid(),fresh)
    assert.equal(await completeEnrollment(old),false)
    await enroll(a)
    await assert.rejects(completeEnrollment(fresh,codeHash,aid(),b),/cannot be replaced/)
    assert.deepEqual(await rpc(aid(),'messaging_get_identity'),a.identity)
    assert.equal(await completeEnrollment(fresh),true)
  })

  it('limits enrollment to five per user per hour and sixty per UTC day',async()=>{
    await db.query(`insert into private.messaging_identity_challenges(id,user_id,email,code_hash,created_at)
      select gen_random_uuid(),$1,'Awa@example.test',$2,clock_timestamp()-interval '2 minutes' from generate_series(1,5)`,[aid(),codeHash])
    await assert.rejects(beginEnrollment(),/Please wait/)
    await db.exec('delete from private.messaging_identity_challenges')
    await db.query(`insert into private.messaging_identity_challenges(id,user_id,email,code_hash,created_at)
      select gen_random_uuid(),$1,'Paul@example.test',$2,clock_timestamp() from generate_series(1,60)`,[cid(),codeHash])
    await assert.rejects(beginEnrollment(),/Please wait/)
    await db.exec("update private.messaging_identity_challenges set created_at=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 day'")
    assert.ok(await beginEnrollment())
  })

  it('does not allocate mail budget for an already enrolled member',async()=>{
    await enroll(a)
    await assert.rejects(beginEnrollment(),(error:any)=>error.code==='23505')
    assert.equal((await db.query('select * from private.messaging_identity_challenges')).rows.length,0)
    assert.ok(await beginEnrollment(bid(),randomUUID(),codeHash,'Fatou@example.test'))
  })

  it('bounds one member across hours and UTC midnight while admitting another member',async()=>{
    await db.query(`insert into private.messaging_identity_challenges(id,user_id,email,code_hash,created_at)
      select gen_random_uuid(),$1,'Awa@example.test',$2,
        date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'-interval '1 second'
      from generate_series(1,3)`,[aid(),codeHash])
    await assert.rejects(beginEnrollment(),(error:any)=>error.code==='54000')
    assert.ok(await beginEnrollment(bid(),randomUUID(),codeHash,'Fatou@example.test'))
    await db.query("update private.messaging_identity_challenges set created_at=clock_timestamp()-interval '24 hours 1 second' where user_id=$1",[aid()])
    assert.ok(await beginEnrollment())
  })

  it('allows three spaced attempts but a fourth cannot consume another member slot',async()=>{
    for(let i=0;i<3;i++) {
      await beginEnrollment()
      await db.query("update private.messaging_identity_challenges set created_at=clock_timestamp()-interval '2 hours' where user_id=$1",[aid()])
    }
    await assert.rejects(beginEnrollment(),(error:any)=>error.code==='54000')
    assert.equal((await db.query('select * from private.messaging_identity_challenges')).rows.length,3)
    assert.ok(await beginEnrollment(bid(),randomUUID(),codeHash,'Fatou@example.test'))
  })

  it('does not recreate retired email enrollment on a device-bound deployment',async()=>{
    const modern=new PGlite()
    try {
      await modern.exec(`create schema private;
        create table private.messaging_devices(id uuid);
        create table private.messaging_members(id uuid);
        create function public.messaging_register_device() returns jsonb language sql as 'select ''{}''::jsonb';`)
      const migration=await readFile(new URL(migrationName,migrationsUrl),'utf8')
      await modern.exec(migration)
      await modern.exec(migration)
      const state=(await modern.query<{legacy:string|null;devices:string|null}>(`select
        to_regprocedure('public.messaging_begin_identity_enrollment(uuid,uuid,text,text)')::text as legacy,
        to_regprocedure('public.messaging_register_device()')::text as devices`)).rows[0]!
      assert.equal(state.legacy,null)
      assert.ok(state.devices)
    } finally {await modern.close()}
  })
})
