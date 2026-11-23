import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { createMigratedDatabase } from './testDatabase.ts'

const EVERY_PRIVILEGE = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']

describe('What the API roles may do to the tables themselves', { concurrency: false }, () => {
  let db: PGlite

  /** Every privilege `role` holds on a table of the public schema, as "table: PRIVILEGE". */
  const held = async (role: string, privileges: string[]) => (await db.query<{ grant: string }>(
    `select c.relname || ': ' || p.privilege as grant
     from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     cross join unnest($2::text[]) as p(privilege)
     where c.relkind = 'r' and has_table_privilege($1, c.oid, p.privilege)
     order by 1`, [role, privileges])).rows.map((row) => row.grant)

  before(async () => { db = await createMigratedDatabase() })
  after(async () => { await db?.close() })

  it('gives visitors no table at all: what they see comes through public functions', async () => {
    assert.deepEqual(await held('anon', EVERY_PRIVILEGE), [])
  })

  it('never lets a member empty, watch or lock a table, nor delete a profile or a contact row', async () => {
    assert.deepEqual(await held('authenticated', ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']), [])
    const profileRows = (await held('authenticated', EVERY_PRIVILEGE)).filter((grant) => /^profile(s|_contacts):/.test(grant))
    assert.deepEqual(profileRows, [
      'profile_contacts: INSERT', 'profile_contacts: SELECT', 'profile_contacts: UPDATE',
      'profiles: INSERT', 'profiles: SELECT', 'profiles: UPDATE',
    ])
  })

  it('keeps trigger functions out of the API: only the database fires them', async () => {
    const callable = (await db.query<{ name: string }>(
      `select p.proname || ' by ' || r.role as name
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
       cross join unnest(array['anon', 'authenticated']) as r(role)
       where p.prorettype = 'trigger'::regtype and has_function_privilege(r.role, p.oid, 'execute')
       order by 1`)).rows.map((row) => row.name)
    assert.deepEqual(callable, [])
  })
})
