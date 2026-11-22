import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { completionExtras } from '../../../src/lib/profileCompletion.ts'
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
