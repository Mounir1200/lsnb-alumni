import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { after, before, beforeEach, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const migrationName = '20261021183651_mentorship_requests_and_network.sql'
const migrationsUrl = new URL('../../../supabase/migrations/', import.meta.url)
let db: PGlite

type Request = { id: string; requester_id: string; recipient_id: string; request_kind: string; message: string; status: string; created_at: Date; responded_at: Date | null }
type Mentorship = { id: string; mentor_id: string; mentee_id: string; request_id: string; created_at: Date; ended_at: Date | null; ended_by: string | null }

async function initialize(target: PGlite, includeMentorship = true) {
  await target.exec(`
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
    // The legacy database predates this migration and every later one.
    if (file >= migrationName && !includeMentorship) continue
    await target.exec(await readFile(new URL(file, migrationsUrl), 'utf8'))
  }
  await target.exec('grant select, insert, update on public.profiles, public.profile_contacts to authenticated')
}

async function seed(options: { student?: boolean; mentor?: boolean; incomplete?: boolean; inactive?: boolean } = {}, target = db) {
  const result = await target.query<{ id: string }>(`insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
    values (gen_random_uuid(), 'member@example.test', $1, $2) returning id`, [
    JSON.stringify({ first_name: 'Membre', last_name: 'Test', member_role: options.student ? 'student' : 'alumni', offers_mentoring: options.mentor ?? false }),
    JSON.stringify({ provider: options.incomplete ? 'google' : 'email' }),
  ])
  const id = result.rows[0]!.id
  if (options.inactive) await target.query('update public.profiles set is_active = false where id = $1', [id])
  return id
}

async function asUser<T>(id: string | null, run: () => Promise<T>, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ''])
  await db.exec(`set role ${role}`)
  try { return await run() }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', '', false)") }
}

const request = (requester: string, recipient: string, kind = 'mentoring', message = 'Bonjour, je souhaite être accompagné pour mon orientation.') => asUser(requester, async () => {
  const result = await db.query<Request>('insert into public.connection_requests (requester_id, recipient_id, request_kind, message) values ($1, $2, $3, $4) returning *', [requester, recipient, kind, message])
  return result.rows[0]!
})
const respond = (actor: string, id: string, status = 'accepted') => asUser(actor, () => db.query<Request>('update public.connection_requests set status = $2 where id = $1 returning *', [id, status]))
const relations = (actor: string | null, role = 'authenticated') => asUser(actor, async () => (await db.query<Mentorship>('select * from public.mentorships order by created_at')).rows, role)
const end = (actor: string, id: string) => asUser(actor, () => db.query<Mentorship>("update public.mentorships set ended_at = '2099-01-01' where id = $1 returning *", [id]))

describe('Mentoring requests, consent and member network', { concurrency: false }, () => {
  before(async () => { db = new PGlite({ extensions: { pgcrypto } }); await initialize(db) })
  beforeEach(async () => { await db.exec('truncate public.weekly_highlights, auth.users cascade') })
  after(async () => { await db?.close() })

  it('creates a private pending request with trimmed message and server-owned identity/timestamps', async () => {
    const junior = await seed({ student: true }); const mentor = await seed({ mentor: true }); const observer = await seed()
    const fakeId = '00000000-0000-0000-0000-000000000001'
    const sent = await asUser(junior, async () => (await db.query<Request>(`
      insert into public.connection_requests (id, requester_id, recipient_id, request_kind, message, created_at)
      values ($1, $2, $3, 'mentoring', '  Un message suffisamment long pour un mentor.  ', '1999-01-01') returning *`,
    [fakeId, junior, mentor])).rows[0]!)
    assert.notEqual(sent.id, fakeId)
    assert.equal(sent.status, 'pending'); assert.equal(sent.responded_at, null)
    assert.equal(sent.message, 'Un message suffisamment long pour un mentor.')
    assert.ok(new Date(sent.created_at).getFullYear() > 1999)
    for (const actor of [junior, mentor]) {
      const rows = await asUser(actor, () => db.query('select id from public.connection_requests'))
      assert.equal(rows.rows.length, 1)
    }
    assert.equal((await asUser(observer, () => db.query('select id from public.connection_requests'))).rows.length, 0)
    assert.equal((await relations(observer)).length, 0)
  })

  it('rejects spoofed consent, identity, guest requests, invalid messages and self-requests', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true }); const other = await seed()
    for (const status of ['accepted', 'declined']) {
      await asUser(junior, () => assert.rejects(db.query(`insert into public.connection_requests
        (requester_id, recipient_id, request_kind, message, status) values ($1, $2, 'mentoring', $3, $4)`,
      [junior, mentor, 'Un message suffisamment long pour un mentor.', status]), /must be pending/))
    }
    await asUser(junior, () => assert.rejects(db.query(`insert into public.connection_requests
      (requester_id, recipient_id, request_kind, message, responded_at) values ($1, $2, 'mentoring', $3, now())`,
    [junior, mentor, 'Un message suffisamment long pour un mentor.']), /without a response/))
    await asUser(other, () => assert.rejects(db.query(`insert into public.connection_requests
      (requester_id, recipient_id, request_kind, message) values ($1, $2, 'mentoring', $3)`,
    [junior, mentor, 'Un message suffisamment long pour un mentor.']), /Only the requester/))
    await asUser(null, () => assert.rejects(db.query('select * from public.connection_requests'), /permission denied/), 'anon')
    await asUser(null, () => assert.rejects(db.query(`insert into public.connection_requests
      (requester_id, recipient_id, request_kind, message) values ($1, $2, 'mentoring', $3)`,
    [junior, mentor, 'Un message suffisamment long pour un mentor.']), /Authentication required/))
    await assert.rejects(request(mentor, mentor), /yourself/)
    await assert.rejects(request(junior, mentor, 'mentoring', ' '.repeat(20)), /message_check/)
    await assert.rejects(request(junior, mentor, 'mentoring', 'x'.repeat(1201)), /message_check/)
    assert.equal((await db.query('select * from public.connection_requests')).rows.length, 0)
  })

  it('requires completed active members and an alumni mentor while allowing alumni juniors', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true })
    for (const options of [{ incomplete: true }, { inactive: true }]) {
      const ineligible = await seed(options)
      await assert.rejects(request(ineligible, mentor), /active completed/)
      await assert.rejects(request(junior, ineligible), /active completed/)
    }
    const unavailable = await seed(); const studentMentor = await seed({ student: true })
    await db.query('update public.profiles set offers_mentoring = true where id = $1', [studentMentor])
    await assert.rejects(request(junior, unavailable), /mentor must offer/)
    await assert.rejects(request(junior, studentMentor), /mentor must offer/)
    const sent = await request(junior, mentor)
    assert.equal((await respond(mentor, sent.id)).rows.length, 1)
    assert.equal((await relations(junior))[0]?.mentee_id, junior)
  })

  it('allows only the recipient to accept or refuse, protects immutable fields and creates one relationship atomically', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true }); const other = await seed()
    const sent = await request(junior, mentor)
    assert.equal((await respond(junior, sent.id)).rows.length, 0)
    assert.equal((await respond(other, sent.id)).rows.length, 0)
    await assert.rejects(respond(mentor, sent.id, 'pending'), /accepted or declined/)
    for (const [column, value] of [['id', '00000000-0000-0000-0000-000000000010'], ['requester_id', mentor], ['recipient_id', junior], ['message', 'Un autre message suffisamment long.'], ['created_at', '1999-01-01'], ['responded_at', '1999-01-01']]) {
      await asUser(mentor, () => assert.rejects(db.query(`update public.connection_requests set ${column} = $2 where id = $1`, [sent.id, value]), /permission denied/))
    }
    const accepted = (await respond(mentor, sent.id)).rows[0]!
    assert.equal(accepted.status, 'accepted'); assert.ok(accepted.responded_at)
    const relation = (await relations(other))[0]!
    assert.equal(relation.mentor_id, mentor); assert.equal(relation.mentee_id, junior); assert.equal(relation.request_id, sent.id)
    assert.equal(relation.ended_at, null); assert.equal(relation.ended_by, null)
    assert.equal((await respond(mentor, sent.id)).rows.length, 0)
    assert.equal((await relations(other)).length, 1)
  })

  it('blocks suspended participants while active partners can refuse or withdraw pending requests', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true })
    const refused = await request(junior, mentor)
    await db.query('update public.profiles set offers_mentoring = false, is_active = false where id = $1', [mentor])
    assert.equal((await respond(mentor, refused.id, 'declined')).rows.length, 0)
    assert.equal((await db.query<Request>('select * from public.connection_requests where id=$1', [refused.id])).rows[0]?.status, 'pending')
    assert.equal((await asUser(junior, () => db.query('delete from public.connection_requests where id = $1 returning id', [refused.id]))).rows.length, 1)
    assert.equal((await relations(junior)).length, 0)
    await db.query('update public.profiles set offers_mentoring = true, is_active = true where id = $1', [mentor])
    const withdrawn = await request(junior, mentor)
    await db.query('update public.profiles set is_active = false where id = $1', [junior])
    assert.equal((await asUser(mentor, () => db.query('delete from public.connection_requests where id = $1 returning id', [withdrawn.id]))).rows.length, 0)
    assert.equal((await asUser(junior, () => db.query('delete from public.connection_requests where id = $1 returning id', [withdrawn.id]))).rows.length, 0)
    assert.equal((await respond(mentor, withdrawn.id, 'declined')).rows[0]?.status, 'declined')
    assert.equal((await relations(mentor)).length, 0)
  })

  it('rechecks both participants and the mentoring offer at acceptance time', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true }); const sent = await request(junior, mentor)
    await db.query('update public.profiles set offers_mentoring = false where id = $1', [mentor])
    await assert.rejects(respond(mentor, sent.id), /mentor must offer/)
    await db.query('update public.profiles set offers_mentoring = true where id = $1', [mentor])
    for (const id of [junior, mentor]) {
      await db.query('update public.profiles set is_active = false where id = $1', [id])
      if (id === mentor) {
        // RLS removes all rows from the suspended actor before the transition
        // trigger can run; callers must treat a zero-row write as denied.
        assert.equal((await respond(mentor, sent.id)).rows.length, 0)
      } else {
        await assert.rejects(respond(mentor, sent.id), /active completed/)
      }
      const unchanged = (await db.query<Request>('select * from public.connection_requests where id=$1', [sent.id])).rows[0]!
      assert.equal(unchanged.status, 'pending'); assert.equal(unchanged.responded_at, null)
      await db.query('update public.profiles set is_active = true where id = $1', [id])
    }
    assert.equal((await relations(junior)).length, 0)
    assert.equal((await respond(mentor, sent.id)).rows[0]?.status, 'accepted')
  })

  it('exposes the active network to eligible members without exposing request messages or contact details', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true }); const observer = await seed()
    const sent = await request(junior, mentor); await respond(mentor, sent.id)
    assert.equal((await relations(observer)).length, 1)
    for (const viewer of [await seed({ incomplete: true }), await seed({ inactive: true })]) {
      assert.equal((await relations(viewer)).length, 0)
    }
    await assert.rejects(relations(null, 'anon'), /permission denied/)
    await asUser(observer, async () => {
      assert.equal((await db.query('select * from public.connection_requests where id = $1', [sent.id])).rows.length, 0)
      assert.equal((await db.query('select email from public.profile_contacts where profile_id in ($1, $2)', [junior, mentor])).rows.length, 0)
      const relationship = (await db.query('select * from public.mentorships')).rows[0]!
      assert.equal('message' in relationship, false); assert.equal('email' in relationship, false)
    })
  })

  it('forbids direct relationship insertion, deletion and nonparticipant ending', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true }); const other = await seed()
    const sent = await request(junior, mentor); await respond(mentor, sent.id)
    const relation = (await relations(junior))[0]!
    await asUser(junior, () => assert.rejects(db.query('insert into public.mentorships (mentor_id, mentee_id, request_id) values ($1, $2, $3)', [mentor, junior, sent.id]), /permission denied/))
    await asUser(junior, () => assert.rejects(db.query('delete from public.mentorships where id = $1', [relation.id]), /permission denied/))
    await asUser(junior, () => assert.rejects(db.query('update public.mentorships set ended_by = $2 where id = $1', [relation.id, mentor]), /permission denied/))
    await asUser(junior, () => assert.rejects(db.query('update public.mentorships set mentor_id = $2 where id = $1', [relation.id, other]), /permission denied/))
    assert.equal((await end(other, relation.id)).rows.length, 0)
    assert.equal((await relations(other))[0]?.ended_at, null)
    await asUser(junior, () => assert.rejects(db.exec('select private.create_accepted_mentorship()'), /permission denied/))
  })

  it('lets either participant end a relationship, preserves private history and requires fresh consent to restart', async () => {
    for (const participant of ['mentor', 'mentee']) {
      const junior = await seed(); const mentor = await seed({ mentor: true }); const other = await seed()
      const sent = await request(junior, mentor); await respond(mentor, sent.id)
      const relation = (await relations(junior)).find((item) => item.request_id === sent.id)!
      const actor = participant === 'mentor' ? mentor : junior
      const ended = (await end(actor, relation.id)).rows[0]!
      assert.equal(ended.ended_by, actor); assert.ok(ended.ended_at)
      assert.ok(new Date(ended.ended_at!).getFullYear() < 2099)
      assert.equal((await relations(other)).some((item) => item.id === relation.id), false)
      assert.equal((await relations(mentor)).some((item) => item.id === relation.id), true)
      assert.equal((await relations(junior)).some((item) => item.id === relation.id), true)
      assert.equal((await end(actor, relation.id)).rows.length, 0)
      assert.equal((await asUser(actor, () => db.query('update public.mentorships set ended_at = null where id = $1 returning id', [relation.id]))).rows.length, 0)
      assert.equal((await respond(mentor, sent.id)).rows.length, 0)
      const second = await request(junior, mentor); await respond(mentor, second.id)
      const own = (await relations(junior)).filter((item) => item.mentor_id === mentor && item.mentee_id === junior)
      assert.equal(own.length, 2); assert.equal(own.filter((item) => item.ended_at === null).length, 1)
    }
  })

  it('retains relationships after a mentoring pause but only active participants can end them after suspension', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true }); const other = await seed()
    const sent = await request(junior, mentor); await respond(mentor, sent.id)
    const relation = (await relations(junior))[0]!
    await db.query('update public.profiles set offers_mentoring = false where id = $1', [mentor])
    assert.equal((await relations(other)).length, 1)
    await db.query('update public.profiles set is_active = false where id = $1', [mentor])
    assert.equal((await relations(other)).length, 0)
    assert.equal((await relations(junior)).length, 1); assert.equal((await relations(mentor)).length, 0)
    assert.equal((await end(mentor, relation.id)).rows.length, 0)
    assert.equal((await db.query<Mentorship>('select * from public.mentorships where id=$1', [relation.id])).rows[0]?.ended_at, null)
    assert.equal((await end(junior, relation.id)).rows[0]?.ended_by, junior)
    assert.equal((await relations(junior)).length, 1)
    assert.equal((await relations(mentor)).length, 0)
  })

  it('enforces pending and active uniqueness and protects contacts without turning them into mentoring', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true })
    const outcomes = await asUser(junior, () => Promise.allSettled([1, 2].map(() => db.query<Request>(`
      insert into public.connection_requests (requester_id, recipient_id, request_kind, message)
      values ($1, $2, 'mentoring', 'Une demande de mentorat suffisamment longue.') returning *`, [junior, mentor]))))
    assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1)
    assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1)
    const pending = (await db.query<Request>('select * from public.connection_requests')).rows[0]!
    await respond(mentor, pending.id)
    await assert.rejects(request(junior, mentor), /active mentorship already exists/)
    const contact = await request(junior, mentor, 'contact')
    await assert.rejects(request(junior, mentor, 'contact'), /unique constraint/)
    await respond(mentor, contact.id)
    await assert.rejects(request(junior, mentor, 'contact'), /unique constraint/)
    assert.equal((await relations(junior)).length, 1)
  })

  it('rolls acceptance back if creating the relationship fails', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true }); const sent = await request(junior, mentor)
    await db.exec(`create function public.fail_test_mentorship() returns trigger language plpgsql as $$
      begin raise exception 'Simulated relationship failure'; end; $$;
      create trigger fail_test_mentorship before insert on public.mentorships for each row execute function public.fail_test_mentorship();`)
    try {
      await assert.rejects(respond(mentor, sent.id), /Simulated relationship failure/)
      const unchanged = (await db.query<Request>('select * from public.connection_requests where id = $1', [sent.id])).rows[0]!
      assert.equal(unchanged.status, 'pending'); assert.equal(unchanged.responded_at, null)
      assert.equal((await relations(junior)).length, 0)
    } finally { await db.exec('drop trigger fail_test_mentorship on public.mentorships; drop function public.fail_test_mentorship()') }
    assert.equal((await respond(mentor, sent.id)).rows[0]?.status, 'accepted')
  })

  it('allows reciprocal mentorship between two alumni with independent consent and directional counts', async () => {
    const first = await seed({ mentor: true }); const second = await seed({ mentor: true }); const observer = await seed()
    const firstRequest = await request(first, second)
    const secondRequest = await request(second, first)
    await respond(second, firstRequest.id)
    assert.equal((await relations(observer)).length, 1)
    await respond(first, secondRequest.id)
    const network = await relations(observer)
    assert.equal(network.length, 2)
    for (const member of [first, second]) {
      assert.equal(network.filter((item) => item.mentor_id === member).length, 1)
      assert.equal(network.filter((item) => item.mentee_id === member).length, 1)
    }
    await end(first, network.find((item) => item.mentee_id === first)!.id)
    const remaining = await relations(observer)
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0]?.mentor_id, first)
    assert.equal(remaining[0]?.mentee_id, second)
  })

  it('cascades account deletion without retaining a dangling relationship', async () => {
    const junior = await seed(); const mentor = await seed({ mentor: true }); const sent = await request(junior, mentor)
    await respond(mentor, sent.id); await end(junior, (await relations(junior))[0]!.id)
    await db.query('delete from auth.users where id = $1', [junior])
    assert.equal((await db.query('select * from public.mentorships')).rows.length, 0)
    assert.equal((await db.query('select * from public.connection_requests')).rows.length, 0)
  })

  it('does not silently convert historical accepted requests without verified consent', async () => {
    const legacy = new PGlite({ extensions: { pgcrypto } })
    try {
      await initialize(legacy, false)
      const junior = await seed({}, legacy); const mentor = await seed({ mentor: true }, legacy)
      await legacy.query(`insert into public.connection_requests (requester_id, recipient_id, request_kind, message, status)
        values ($1, $2, 'mentoring', 'Une ancienne demande dont le consentement doit être vérifié.', 'accepted')`, [junior, mentor])
      await assert.rejects(legacy.exec(await readFile(new URL(migrationName, migrationsUrl), 'utf8')), /Review existing accepted mentoring requests/)
      await legacy.exec('rollback')
      assert.equal((await legacy.query<{ name: string | null }>("select to_regclass('public.mentorships')::text as name")).rows[0]?.name, null)
      assert.equal((await legacy.query<Request>('select * from public.connection_requests')).rows[0]?.status, 'accepted')
    } finally { await legacy.close() }
  })
})
