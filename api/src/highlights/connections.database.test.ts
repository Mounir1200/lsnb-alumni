import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { answerRequest, asMember, createMigratedDatabase, seedMember, sendRequest } from './testDatabase.ts'

let db: PGlite
type Connection = { id: string; member_a: string; member_b: string; request_id: string }

const connectionsSeenBy = (member: string) =>
  asMember(db, member, async () => (await db.query<Connection>('select * from public.member_connections')).rows)

describe('Member connections between peers', { concurrency: false }, () => {
  before(async () => { db = await createMigratedDatabase() })
  beforeEach(async () => { await db.exec('truncate public.weekly_highlights, auth.users cascade') })
  after(async () => { await db?.close() })

  it('lets two mentors, or two students, connect once the recipient accepts', async () => {
    for (const options of [{ mentor: true }, { student: true }]) {
      const first = await seedMember(db, options); const second = await seedMember(db, options)
      const request = await sendRequest(db, first, second)
      assert.equal(request.status, 'pending')
      assert.deepEqual(await connectionsSeenBy(first), [])
      await answerRequest(db, second, request.id)
      const [connection] = await connectionsSeenBy(first)
      assert.deepEqual([connection?.member_a, connection?.member_b], [first, second].sort())
      assert.equal(connection?.request_id, request.id)
      assert.deepEqual(await connectionsSeenBy(second), [connection])
    }
  })

  it('keeps connections private to the two members', async () => {
    const first = await seedMember(db); const second = await seedMember(db); const observer = await seedMember(db)
    await answerRequest(db, second, (await sendRequest(db, first, second)).id)
    assert.deepEqual(await connectionsSeenBy(observer), [])
    await asMember(db, null, () => assert.rejects(db.query('select * from public.member_connections'), /permission denied/), 'anon')
  })

  it('refuses a second request or a second connection for the same pair', async () => {
    const first = await seedMember(db); const second = await seedMember(db)
    const pending = await sendRequest(db, first, second)
    await assert.rejects(sendRequest(db, first, second), /duplicate key|already/)
    await assert.rejects(sendRequest(db, second, first), /waiting for your answer/)
    await answerRequest(db, second, pending.id)
    await assert.rejects(sendRequest(db, second, first), /already connected/)
    await assert.rejects(sendRequest(db, first, second), /already connected/)
  })

  it('lets either member remove the connection, and then ask again', async () => {
    const first = await seedMember(db); const second = await seedMember(db); const observer = await seedMember(db)
    await answerRequest(db, second, (await sendRequest(db, first, second)).id)
    const [connection] = await connectionsSeenBy(first)
    const removedByObserver = await asMember(db, observer, () => db.query('delete from public.member_connections where id = $1 returning id', [connection!.id]))
    assert.equal(removedByObserver.rows.length, 0)
    const removed = await asMember(db, second, () => db.query('delete from public.member_connections where id = $1 returning id', [connection!.id]))
    assert.equal(removed.rows.length, 1)
    assert.deepEqual(await connectionsSeenBy(first), [])
    const again = await sendRequest(db, second, first)
    await answerRequest(db, first, again.id)
    assert.equal((await connectionsSeenBy(second)).length, 1)
  })

  it('lets nobody create or rewrite a connection directly', async () => {
    const first = await seedMember(db); const second = await seedMember(db)
    const [low, high] = [first, second].sort()
    const request = await sendRequest(db, first, second)
    await asMember(db, first, () => assert.rejects(db.query(
      'insert into public.member_connections (member_a, member_b, request_id) values ($1, $2, $3)', [low, high, request.id]), /permission denied/))
    await answerRequest(db, second, request.id)
    await asMember(db, first, () => assert.rejects(db.query('update public.member_connections set created_at = now()'), /permission denied/))
  })

  it('needs active completed members on both sides', async () => {
    const member = await seedMember(db); const inactive = await seedMember(db, { inactive: true })
    await assert.rejects(sendRequest(db, member, inactive), /active completed profiles/)
  })
})
