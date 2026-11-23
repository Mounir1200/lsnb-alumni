import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PROFILE_LIMITS, profileListsError } from '../../../src/lib/profileLimits.ts'

describe('Profile lists the editor lets a member save', () => {
  const twenty = Array.from({ length: PROFILE_LIMITS.listItems }, () => 'x'.repeat(PROFILE_LIMITS.listItemLength))

  it('saves up to twenty items of up to 120 characters in each list', () => {
    assert.equal(profileListsError(twenty, twenty), null)
    assert.equal(profileListsError([], []), null)
  })

  it('says which list is too long or holds too long an item', () => {
    assert.match(profileListsError([...twenty, 'one more'], [])!, /20 spécialités au plus/)
    assert.match(profileListsError(['x'.repeat(121)], [])!, /de 120 caractères chacune/)
    assert.match(profileListsError([], [...twenty, 'one more'])!, /20 sujets de mentorat au plus/)
    assert.match(profileListsError([], ['x'.repeat(121)])!, /de 120 caractères chacun\./)
  })
})
