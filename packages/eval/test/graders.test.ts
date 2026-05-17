import { describe, it, expect } from 'vitest'
import { classifyOutcome, isTerminal, type RoomStateLike } from '../src/graders.js'

function state(p: Partial<RoomStateLike>): RoomStateLike {
  return {
    state: 'closed',
    current_round: 1,
    head_hash: 'h',
    hard_limit_hit: null,
    walk_away_by: null,
    artifact: null,
    ...p,
  }
}

describe('isTerminal', () => {
  it('treats closed and closing as terminal', () => {
    expect(isTerminal('closed')).toBe(true)
    expect(isTerminal('closing')).toBe(true)
    expect(isTerminal('active')).toBe(false)
    expect(isTerminal('consolidating')).toBe(false)
  })
})

describe('classifyOutcome', () => {
  it('classifies a closed room with >=1 round as a deal', () => {
    expect(classifyOutcome(state({ state: 'closed', current_round: 2 }))).toBe('deal')
    expect(classifyOutcome(state({ state: 'closing', current_round: 1 }))).toBe('deal')
  })
  it('classifies a walk-away by walk_away_by', () => {
    expect(classifyOutcome(state({ state: 'closing', walk_away_by: 'agent-x' }))).toBe('walk_away')
  })
  it('classifies a deadlock by hard_limit_hit', () => {
    expect(classifyOutcome(state({ state: 'closing', hard_limit_hit: 'deadlock' }))).toBe('deadlock')
  })
  it('classifies an unfinished room as incomplete', () => {
    expect(classifyOutcome(state({ state: 'active', current_round: 0 }))).toBe('incomplete')
    expect(classifyOutcome(state({ state: 'closed', current_round: 0 }))).toBe('incomplete')
  })
  it('walk_away takes precedence over a closed-with-rounds state', () => {
    expect(
      classifyOutcome(state({ state: 'closed', current_round: 3, walk_away_by: 'x' })),
    ).toBe('walk_away')
  })
})
