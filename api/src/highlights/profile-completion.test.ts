import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { completeMemberProfile, completionExtras, type CompletionClient, type ProfileCompletion } from '../../../src/lib/profileCompletion.ts'
import { toCareerStepRows, type CareerStep } from '../../../src/lib/careerSteps.ts'

describe('What completing a profile saves after the completion RPC', () => {
  const step: CareerStep = { kind: 'work', title: 'Ingénieure', organization: 'Sonabel', location: 'Ouagadougou', startYear: 2021, endYear: null }

  it('saves nothing more when there are no steps and the alumnus stays out of the public directory', () => {
    assert.deepEqual(completionExtras({ memberRole: 'alumni', careerSteps: [], listedPublicly: false }), {})
  })

  it('lists an alumnus who ticked the public directory, never a student', () => {
    assert.deepEqual(completionExtras({ memberRole: 'alumni', careerSteps: [], listedPublicly: true }), { listed_publicly: true })
    assert.deepEqual(completionExtras({ memberRole: 'student', careerSteps: [], listedPublicly: true }), {})
  })

  it('saves the career steps as rows', () => {
    assert.deepEqual(completionExtras({ memberRole: 'student', careerSteps: [step], listedPublicly: false }),
      { career_steps: toCareerStepRows([step]) })
  })
})

describe('Completing a Google profile', () => {
  type Call = { name: string; values: Record<string, unknown>; id?: string }
  const fakeClient = (calls: Call[], failing: { rpc?: boolean; update?: boolean } = {}): CompletionClient => ({
    rpc: async (name, params) => { calls.push({ name, values: params }); return { error: failing.rpc ? { message: 'refused' } : null } },
    from: (table) => ({ update: (values) => ({ eq: async (_column, id) => {
      calls.push({ name: `update ${table}`, values, id }); return { error: failing.update ? { message: 'offline' } : null }
    } }) }),
  })
  const answers: ProfileCompletion = {
    firstName: ' Awa ', lastName: ' Ouédraogo ', memberRole: 'alumni', graduationYear: 2019, specialty: ' Génie civil ',
    city: ' Bobo ', country: ' Burkina Faso ', experience: ' Ingénieure. ', gender: 'female', offersMentoring: true,
    contactVisible: false, termsAccepted: true, listedPublicly: true, careerSteps: [],
  }

  it('sends the trimmed answers to the completion RPC, then saves the public directory choice on the member’s row', async () => {
    const calls: Call[] = []
    await completeMemberProfile(fakeClient(calls), 'member-1', answers)
    assert.deepEqual(calls.map((call) => call.name), ['complete_member_profile', 'update profiles'])
    assert.equal(calls[0]!.values.p_first_name, 'Awa')
    assert.equal(calls[0]!.values.p_offers_mentoring, true)
    assert.deepEqual(calls[1], { name: 'update profiles', values: { listed_publicly: true }, id: 'member-1' })
  })

  it('writes nothing more for a student, who can neither mentor nor be listed', async () => {
    const calls: Call[] = []
    await completeMemberProfile(fakeClient(calls), 'member-1', { ...answers, memberRole: 'student' })
    assert.deepEqual(calls.map((call) => call.name), ['complete_member_profile'])
    assert.equal(calls[0]!.values.p_offers_mentoring, false)
  })

  it('says what was not saved, and saves nothing more when the profile itself was refused', async () => {
    const refused: Call[] = []
    await assert.rejects(completeMemberProfile(fakeClient(refused, { rpc: true }), 'member-1', answers), /n’a pas pu être enregistré/)
    assert.equal(refused.length, 1)
    await assert.rejects(completeMemberProfile(fakeClient([], { update: true }), 'member-1', answers), /annuaire public/)
  })
})
