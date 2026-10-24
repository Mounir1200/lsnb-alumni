import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, beforeEach, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migrationsUrl = new URL('../../../supabase/migrations/', import.meta.url)
let db: PGlite
let admin: string, moderator: string, samePromo: string, otherPromo: string

async function value<T = any>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<{ value: T }>(sql, params)).rows[0]!.value
}
async function seed(name: string, year = 2020, provider = 'email', metadata = {}) {
  return (await db.query<{ id: string }>(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
    values(gen_random_uuid(),$1,$2,$3) returning id`, [`${name}@example.test`, JSON.stringify({
    first_name: name, last_name: 'Test', graduation_year: year, member_role: 'alumni', offers_mentoring: true, ...metadata,
  }), JSON.stringify({ provider })])).rows[0]!.id
}
async function asUser<T>(id: string, run: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id])
  await db.exec('set role authenticated')
  try { return await run() }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', '', false)") }
}
const rpc = <T = any>(id: string, name: string, args: unknown[] = []) => asUser(id, () =>
  value<T>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args))
const moderate = (actor: string, target: string, active = false) => rpc(actor, 'hub_moderate_member', [target, active, 'Promotion non vérifiée'])
const maintenance = (enabled = true, ends: string | null = null) => rpc(admin, 'hub_set_maintenance', [enabled, 'Une amélioration est en cours.', ends])
const complete = (id: string) => rpc(id, 'complete_member_profile', [
  'Awa', 'Test', 'alumni', 2020, 'Sciences', 'Paris', 'France', 'Développement logiciel', null, true, false, true,
])

describe('Administration hub PostgreSQL authorization and maintenance', { concurrency: false }, () => {
  before(async () => {
    db = new PGlite({ extensions: { pgcrypto } })
    await db.exec(`
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
    const files = (await readdir(migrationsUrl)).filter(file => file.endsWith('.sql')).sort()
    for (const file of files) await db.exec(await readFile(new URL(file, migrationsUrl), 'utf8'))
    await db.exec(`grant select,insert,update on public.profiles,public.profile_contacts to authenticated;
      grant select,insert,update,delete on storage.objects to authenticated;`)
  })
  beforeEach(async () => {
    await db.exec(`truncate public.weekly_highlights,auth.users,private.hub_audit cascade;
      insert into private.hub_maintenance(singleton) values(true) on conflict(singleton) do update
        set enabled=false,ends_at=null,started_at=null,updated_by=null;`)
    admin = await seed('Admin', 2019)
    moderator = await seed('Modérateur', 2020)
    samePromo = await seed('Membre', 2020)
    otherPromo = await seed('Autre', 2021)
    await db.query("insert into private.hub_staff(user_id,role,graduation_year) values($1,'admin',null),($2,'moderator',2020)", [admin, moderator])
  })
  after(async () => { await db?.close() })

  it('only trusts private staff assignments, ignoring forged user metadata', async () => {
    const fake = await seed('Fake', 2020, 'email', { role: 'admin', is_admin: true, staff_role: 'admin' })
    await assert.rejects(rpc(fake, 'hub_context'), /staff access required/)
    await assert.rejects(rpc(fake, 'hub_dashboard'), /staff access required/)
    await assert.rejects(rpc(fake, 'hub_members'), /staff access required/)
    await assert.rejects(rpc(fake, 'hub_set_staff', [fake, 'admin', null]), /staff access required/)
    await assert.rejects(asUser(fake, () => db.query("insert into private.hub_staff(user_id,role) values($1,'admin')", [fake])), /permission denied/)
    await assert.rejects(asUser(fake, () => db.exec('select * from private.hub_audit')), /permission denied/)
    assert.equal((await rpc(admin, 'hub_context')).role, 'admin')
    assert.equal((await rpc(moderator, 'hub_context')).graduation_year, 2020)
  })

  it('blocks anonymous hub RPCs but publishes the maintenance status', async () => {
    await db.exec('set role anon')
    try {
      assert.equal((await value('select public.public_site_status() as value')).active, false)
      await assert.rejects(db.exec('select public.hub_context()'), /permission denied/)
      await assert.rejects(db.exec('select public.member_access_status()'), /permission denied/)
      await assert.rejects(db.exec('select public.hub_dashboard()'), /permission denied/)
    } finally { await db.exec('reset role') }
  })

  it('scopes member search, staff list, dashboard and audit to the moderator promotion', async () => {
    const list = await rpc(moderator, 'hub_members')
    assert.equal(list.total, 2)
    assert.ok(list.items.every((p: any) => p.graduation_year === 2020))
    await assert.rejects(rpc(moderator, 'hub_members', ['', 2021, 'all', 1]), /outside your scope/)
    assert.equal((await rpc(admin, 'hub_members')).total, 4)
    assert.equal((await rpc(admin, 'hub_members', ['autre', null, 'all', 1])).items[0].id, otherPromo)
    assert.equal((await rpc(moderator, 'hub_staff')).length, 1)
    assert.equal((await rpc(moderator, 'hub_dashboard')).members, 2)
    await moderate(admin, otherPromo)
    await moderate(moderator, samePromo)
    assert.equal((await rpc(moderator, 'hub_audit')).total, 1)
    assert.equal((await rpc(admin, 'hub_audit')).total, 2)
  })

  it('requires reasons and rejects cross-promotion, self, staff and moderator restoration actions', async () => {
    await assert.rejects(rpc(moderator, 'hub_moderate_member', [samePromo, false, '']), /reason/)
    await assert.rejects(moderate(moderator, otherPromo), /own promotion/)
    await assert.rejects(moderate(moderator, moderator), /yourself/)
    await assert.rejects(moderate(admin, moderator), /staff role/)
    await assert.rejects(moderate(moderator, admin), /staff role/)
    await moderate(moderator, samePromo)
    await assert.rejects(moderate(moderator, samePromo, true), /own promotion/)
    await moderate(admin, samePromo, true)
    assert.deepEqual(await rpc(samePromo, 'member_access_status'), { active: true })
    const log = await rpc(admin, 'hub_audit')
    assert.deepEqual(log.items.map((x: any) => x.action), ['member_restored', 'member_suspended'])
    assert.equal(log.items[1].actor_name, 'Modérateur Test')
    assert.equal(log.items[1].reason, 'Promotion non vérifiée')
  })

  it('cannot reactivate a suspended account or change promotion through profile REST writes', async () => {
    await assert.rejects(asUser(samePromo, () => db.query('update public.profiles set graduation_year=2021 where id=$1', [samePromo])), /correct your promotion/)
    await assert.rejects(asUser(samePromo, () => db.query('update public.profiles set profile_completed=false where id=$1', [samePromo])), /complete_member_profile/)
    await assert.rejects(asUser(samePromo, () => db.query("update public.profiles set created_at='2020-01-01' where id=$1", [samePromo])), /Registration time is server-managed/)
    await assert.rejects(asUser(samePromo, () => db.query('update public.profiles set is_active=false where id=$1', [samePromo])), /server-managed/)
    await moderate(moderator, samePromo)
    assert.deepEqual(await rpc(samePromo, 'member_access_status'), { active: false })
    assert.equal((await asUser(samePromo, () => db.query('update public.profiles set is_active=true where id=$1 returning id', [samePromo]))).rows.length, 0)
    await assert.rejects(complete(samePromo), /account suspended/)
    assert.equal(await value('select is_active as value from public.profiles where id=$1', [samePromo]), false)
    assert.equal((await asUser(otherPromo, () => db.query('select id from public.profiles where id=$1', [samePromo]))).rows.length, 0)
  })

  it('hides suspended contacts and authored offers; suspension blocks new activity and uploads', async () => {
    await asUser(samePromo, () => db.query(`insert into public.offers(author_id,kind,title,organization,description)
      values($1,'internship','Stage logiciel','Entreprise','Une opportunité pour apprendre le développement logiciel.')`, [samePromo]))
    await asUser(samePromo, () => db.query('update public.profile_contacts set is_visible=true where profile_id=$1', [samePromo]))
    assert.equal((await asUser(otherPromo, () => db.query('select id from public.offers'))).rows.length, 1)
    await moderate(moderator, samePromo)
    assert.equal((await asUser(otherPromo, () => db.query('select id from public.offers'))).rows.length, 0)
    assert.equal((await asUser(otherPromo, () => db.query('select profile_id from public.profile_contacts where profile_id=$1', [samePromo]))).rows.length, 0)
    await assert.rejects(rpc(samePromo, 'record_member_activity', ['directory']), /account suspended/)
    await assert.rejects(asUser(samePromo, () => db.query("insert into storage.objects(bucket_id,name) values('avatars',$1)", [`${samePromo}/avatar.png`])), /row-level security/)
  })

  it('enforces maintenance in all direct member tables while preserving hub administration', async () => {
    await asUser(samePromo, () => db.query("insert into storage.objects(bucket_id,name) values('avatars',$1)", [`${samePromo}/avatar.png`]))
    await maintenance()
    assert.equal((await value('select public.public_site_status() as value')).active, true)
    for (const table of ['profiles','profile_contacts','connection_requests','mentorships','offers']) {
      assert.equal((await asUser(admin, () => db.query(`select * from public.${table}`))).rows.length, 0, table)
    }
    assert.equal((await asUser(samePromo, () => db.query('update public.profiles set city=\'Lille\' where id=$1 returning id', [samePromo]))).rows.length, 0)
    await assert.rejects(asUser(samePromo, () => db.query(`insert into public.connection_requests(requester_id,recipient_id,request_kind,message)
      values($1,$2,'contact','Bonjour, une demande de contact pour vous.')`, [samePromo, otherPromo])), /row-level security|active completed profiles/)
    await assert.rejects(asUser(samePromo, () => db.query("insert into storage.objects(bucket_id,name) values('avatars',$1)", [`${samePromo}/second.png`])), /row-level security/)
    assert.equal((await asUser(samePromo, () => db.query('delete from storage.objects returning id'))).rows.length, 0)
    await assert.rejects(rpc(samePromo, 'record_member_activity', ['home']), /Site unavailable/)
    assert.equal((await rpc(admin, 'hub_context')).role, 'admin')
    assert.equal((await rpc(admin, 'hub_members')).total, 4)
    await moderate(moderator, samePromo)
    await maintenance(false)
    assert.equal((await asUser(otherPromo, () => db.query('select id from public.profiles'))).rows.length, 3)
  })

  it('allows onboarding when open but blocks the elevated completion RPC during maintenance or suspension', async () => {
    const google = await seed('Google', 2020, 'google')
    assert.deepEqual(await rpc(google, 'member_access_status'), { active: true })
    await maintenance()
    await assert.rejects(complete(google), /Site unavailable/)
    await assert.rejects(seed('MaintenanceSignup'), /Registration temporarily unavailable/)
    await maintenance(false)
    assert.equal(await complete(google), true)
    assert.equal(await value('select graduation_year as value from public.profiles where id=$1', [google]), 2020)
    assert.deepEqual(await rpc(google, 'member_access_status'), { active: true })
    const suspendedGoogle = await seed('Google2', 2020, 'google')
    await moderate(admin, suspendedGoogle)
    await assert.rejects(complete(suspendedGoogle), /account suspended/)
    await assert.rejects(asUser(suspendedGoogle, () => db.exec(`select private.complete_member_profile('Awa','Test','alumni',2020,'Sciences','Paris','France','Parcours',null,true,false,true)`)), /permission denied/)
    assert.equal((await rpc(admin, 'hub_dashboard')).suspended_members, 1)
    await moderate(admin, suspendedGoogle, true)
    assert.deepEqual(await rpc(suspendedGoogle, 'member_access_status'), { active: true })
    assert.equal(await value('select is_active as value from public.profiles where id=$1', [suspendedGoogle]), false)
    assert.equal((await rpc(admin, 'hub_members', ['',null,'suspended',1])).total, 0)
    assert.equal(await complete(suspendedGoogle), true)
  })

  it('automatically reopens expired maintenance using database time, and rejects past schedules', async () => {
    await assert.rejects(maintenance(true, '2020-01-01T00:00:00Z'), /must be in the future/)
    await maintenance(true, '2099-01-01T00:00:00Z')
    assert.equal((await value('select public.public_site_status() as value')).active, true)
    await db.exec("update private.hub_maintenance set ends_at=clock_timestamp()-interval '1 second'")
    const status = await value('select public.public_site_status() as value')
    assert.equal(status.enabled, true)
    assert.equal(status.active, false)
    assert.ok(status.server_time)
    assert.equal((await asUser(samePromo, () => db.query('select id from public.profiles'))).rows.length, 4)
    await assert.rejects(rpc(moderator, 'hub_set_maintenance', [true, 'Un arrêt non autorisé.', null]), /staff access required/)
  })

  it('protects staff assignment scope and the last administrator; revocation takes effect immediately', async () => {
    await assert.rejects(rpc(admin, 'hub_set_staff', [admin, null, null]), /own staff role/)
    await assert.rejects(rpc(moderator, 'hub_set_staff', [samePromo, 'admin', null]), /staff access required/)
    await assert.rejects(rpc(admin, 'hub_set_staff', [otherPromo, 'moderator', 2020]), /assigned promotion/)
    await assert.rejects(rpc(admin, 'hub_set_staff', [otherPromo, 'admin', 2021]), /global scope/)
    await rpc(admin, 'hub_set_staff', [samePromo, 'moderator', 2020])
    assert.equal((await rpc(samePromo, 'hub_context')).role, 'moderator')
    await rpc(admin, 'hub_set_staff', [samePromo, null, null])
    await assert.rejects(rpc(samePromo, 'hub_context'), /staff access required/)
    await moderate(admin, otherPromo)
    await assert.rejects(rpc(admin, 'hub_set_staff', [otherPromo, 'admin', null]), /active completed profile/)
    assert.equal((await rpc(admin, 'hub_staff')).filter((s: any) => s.role === 'admin').length, 1)
  })

  it('allows only administrators to correct promotions, with an audit trail and moderator reassignment protection', async () => {
    await assert.rejects(rpc(moderator, 'hub_change_promotion', [samePromo, 2021, 'Correction vérifiée du dossier']), /staff access required/)
    await assert.rejects(rpc(admin, 'hub_change_promotion', [moderator, 2021, 'Correction vérifiée du dossier']), /Remove the moderator role/)
    await assert.rejects(rpc(admin, 'hub_change_promotion', [samePromo, 1900, 'Correction vérifiée du dossier']), /valid promotion/)
    await rpc(admin, 'hub_change_promotion', [samePromo, 2021, 'Correction vérifiée du dossier'])
    assert.equal((await rpc(moderator, 'hub_members')).total, 1)
    await assert.rejects(moderate(moderator, samePromo), /own promotion/)
    const log = await rpc(admin, 'hub_audit')
    assert.equal(log.items[0].action, 'promotion_corrected')
    assert.equal(log.items[0].graduation_year, 2020)
    assert.match(log.items[0].reason, /2020 → 2021/)
  })

  it('makes audit entries immutable to clients, even administrators', async () => {
    await moderate(admin, samePromo)
    for (const statement of ['delete from private.hub_audit', "update private.hub_audit set reason='falsified'", 'truncate private.hub_audit']) {
      await assert.rejects(asUser(admin, () => db.exec(statement)), /permission denied/)
    }
    await assert.rejects(asUser(admin, () => db.exec("select private.audit_action('fake',null,null,'forged')")), /permission denied/)
    assert.equal((await rpc(admin, 'hub_audit')).total, 1)
  })

  it('counts real UTC activity once per user/route/minute and zero-fills 30 days within scope', async () => {
    await rpc(samePromo, 'record_member_activity', ['directory'])
    await rpc(samePromo, 'record_member_activity', ['directory'])
    await rpc(samePromo, 'record_member_activity', ['offers'])
    await rpc(otherPromo, 'record_member_activity', ['home'])
    await assert.rejects(rpc(samePromo, 'record_member_activity', ['/profile/private?token=secret']), /Invalid activity route/)
    const dash = await rpc(moderator, 'hub_dashboard')
    assert.equal(dash.activity.length, 30)
    assert.equal(dash.active_30d, 1)
    assert.equal(dash.activity.at(-1).views, 2)
    assert.equal(dash.activity.at(-1).active_members, 1)
    assert.equal(dash.activity.at(-1).registrations, 2)
    assert.equal(dash.activity[0].views, 0)
    assert.deepEqual(dash.promotions, [{ year: 2020, members: 2, active: 2 }])
    assert.equal((await rpc(admin, 'hub_dashboard')).active_30d, 2)
    await db.query("update private.member_activity set last_seen=clock_timestamp()-interval '2 minutes' where user_id=$1 and route='directory'", [samePromo])
    await rpc(samePromo, 'record_member_activity', ['directory'])
    assert.equal((await rpc(moderator, 'hub_dashboard')).activity.at(-1).views, 3)
  })

  it('validates and caps pagination without exposing extra fields', async () => {
    await assert.rejects(rpc(admin, 'hub_members', ['', null, 'all', 0]), /Invalid member filters/)
    await assert.rejects(rpc(admin, 'hub_members', ['', null, 'unexpected', 1]), /Invalid member filters/)
    await assert.rejects(rpc(admin, 'hub_audit', [0]), /Invalid page/)
    const result = await rpc(admin, 'hub_members', ['', null, 'all', 2])
    assert.deepEqual(result, { items: [], total: 4, page: 2, page_size: 25 })
    assert.ok(!(await rpc(admin, 'hub_members')).items.some((row: any) => 'email' in row))
  })
})
