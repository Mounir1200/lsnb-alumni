import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { PGlite } from '@electric-sql/pglite'
import { answerRequest, asMember, createMigratedDatabase, seedMember, sendRequest } from './testDatabase.ts'

let db: PGlite
const BLOCKED = /blocked/

const block = (blocker: string, blocked: string) => asMember(db, blocker, () => db.query('select public.block_member($1)', [blocked]))
const unblock = (blocker: string, blocked: string) => asMember(db, blocker, async () =>
  (await db.query('delete from public.member_blocks where blocker_id = $1 and blocked_id = $2 returning blocked_id', [blocker, blocked])).rows.length)
const blocksSeenBy = (member: string) => asMember(db, member, async () =>
  (await db.query<{ blocker_id: string; blocked_id: string }>('select blocker_id, blocked_id from public.member_blocks')).rows)

/** "sender status" for every request between two members, oldest first, as the database holds them. */
const requestsBetween = async (first: string, second: string) => (await db.query<{ requester_id: string; status: string }>(
  `select requester_id, status from public.connection_requests
   where (requester_id = $1 and recipient_id = $2) or (requester_id = $2 and recipient_id = $1) order by created_at`, [first, second]))
  .rows.map((row) => `${row.requester_id === first ? 'first' : 'second'} ${row.status}`)
const areConnected = async (first: string, second: string) => (await db.query(
  'select 1 from public.member_connections where member_a = least($1::uuid, $2::uuid) and member_b = greatest($1::uuid, $2::uuid)',
  [first, second])).rows.length === 1
const mentorship = async (mentor: string, mentee: string) => (await db.query<{ ended_at: string | null; ended_by: string | null }>(
  'select ended_at, ended_by from public.mentorships where mentor_id = $1 and mentee_id = $2', [mentor, mentee])).rows[0]

// The signed messaging RPC inserts exactly this row; the guard applies to every insert.
const deliver = (conversation: string, sender: string, recipient: string) => db.query(
  `insert into public.conversation_messages(conversation_id, sender_id, recipient_id, ciphertext, client_nonce)
   values ($1, $2, $3, '\\x00'::bytea, $4)`, [conversation, sender, recipient, randomUUID()])

describe('Blocking a member', { concurrency: false }, () => {
  before(async () => { db = await createMigratedDatabase() })
  beforeEach(async () => { await db.exec('truncate public.weekly_highlights, auth.users cascade') })
  after(async () => { await db?.close() })

  it('stops requests both ways, whatever their kind', async () => {
    const member = await seedMember(db, { mentor: true }); const other = await seedMember(db, { mentor: true })
    await block(member, other)
    for (const kind of ['connection', 'contact', 'mentoring']) {
      await assert.rejects(sendRequest(db, other, member, kind), BLOCKED, `${kind} towards the blocker`)
      await assert.rejects(sendRequest(db, member, other, kind), BLOCKED, `${kind} from the blocker`)
    }
    assert.deepEqual(await requestsBetween(member, other), [])
  })

  it('declines what the blocked member asked and withdraws what the blocker asked', async () => {
    const member = await seedMember(db); const other = await seedMember(db)
    await sendRequest(db, other, member, 'contact')
    await sendRequest(db, member, other, 'contact')
    await block(member, other)
    assert.deepEqual(await requestsBetween(member, other), ['second declined'])
  })

  it('ends their connection and any mentorship between them, recorded as ended by the blocker', async () => {
    const mentee = await seedMember(db, { student: true }); const mentor = await seedMember(db, { mentor: true })
    const request = await sendRequest(db, mentee, mentor, 'mentoring')
    await answerRequest(db, mentor, request.id)
    assert.equal(await areConnected(mentee, mentor), true)
    assert.equal((await mentorship(mentor, mentee))?.ended_at, null)

    await block(mentor, mentee)
    assert.equal(await areConnected(mentee, mentor), false)
    const ended = await mentorship(mentor, mentee)
    assert.notEqual(ended?.ended_at, null)
    assert.equal(ended?.ended_by, mentor)
  })

  it('closes their conversation to new messages while other conversations go on', async () => {
    const member = await seedMember(db); const other = await seedMember(db); const friend = await seedMember(db)
    const conversation = (await sendRequest(db, other, member, 'contact')).id
    await answerRequest(db, member, conversation)
    const friendship = (await sendRequest(db, friend, member, 'contact')).id
    await answerRequest(db, member, friendship)
    await deliver(conversation, other, member)

    await block(member, other)
    await assert.rejects(deliver(conversation, other, member), BLOCKED)
    await assert.rejects(deliver(conversation, member, other), BLOCKED)
    await deliver(friendship, friend, member)
  })

  it('keeps each block private to the member who made it', async () => {
    const member = await seedMember(db); const other = await seedMember(db); const observer = await seedMember(db)
    await block(member, other)
    assert.deepEqual(await blocksSeenBy(member), [{ blocker_id: member, blocked_id: other }])
    assert.deepEqual(await blocksSeenBy(other), [])
    assert.deepEqual(await blocksSeenBy(observer), [])
    await asMember(db, null, () => assert.rejects(db.query('select * from public.member_blocks'), /permission denied/), 'anon')
  })

  it('lets only its author lift a block; ended links stay ended and the pair may ask again', async () => {
    const member = await seedMember(db); const other = await seedMember(db)
    await answerRequest(db, other, (await sendRequest(db, member, other)).id)
    await block(member, other)
    assert.equal(await unblock(other, member), 0)
    assert.equal(await asMember(db, other, async () => (await db.query(
      'delete from public.member_blocks where blocker_id = $1 returning blocked_id', [member])).rows.length), 0)
    assert.equal(await unblock(member, other), 1)
    assert.equal(await areConnected(member, other), false)
    await answerRequest(db, member, (await sendRequest(db, other, member)).id)
    assert.equal(await areConnected(member, other), true)
  })

  it('refuses self-blocks, direct writes and visitors, and accepts a repeated block', async () => {
    const member = await seedMember(db); const other = await seedMember(db)
    await assert.rejects(block(member, member), /yourself/)
    await asMember(db, member, () => assert.rejects(db.query(
      'insert into public.member_blocks (blocker_id, blocked_id) values ($1, $2)', [member, other]), /permission denied/))
    await asMember(db, other, () => assert.rejects(db.query(
      'update public.member_blocks set created_at = now()'), /permission denied/))
    await asMember(db, null, () => assert.rejects(db.query('select public.block_member($1)', [other]), /permission denied/), 'anon')
    await block(member, other)
    await block(member, other)
    assert.equal((await blocksSeenBy(member)).length, 1)
  })

  it('refuses an acceptance racing with a block, but still lets the recipient decline', async () => {
    const member = await seedMember(db); const other = await seedMember(db); const third = await seedMember(db)
    const raced = await sendRequest(db, other, member, 'contact')
    const declined = await sendRequest(db, third, member, 'contact')
    // As if the block committed between the request and its answer, before block_member() could tidy up.
    await db.query('insert into public.member_blocks (blocker_id, blocked_id) values ($1, $2), ($1, $3)', [member, other, third])
    await assert.rejects(answerRequest(db, member, raced.id), BLOCKED)
    await answerRequest(db, member, declined.id, 'declined')
    assert.deepEqual(await requestsBetween(member, third), ['second declined'])
  })

  it('refuses to block an unknown member', async () => {
    const member = await seedMember(db)
    await assert.rejects(block(member, randomUUID()), /not found/)
  })
})
