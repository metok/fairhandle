import { describe, it, expect } from 'vitest'
import { SystemClock, FixedClock } from '../src/index.js'

describe('SystemClock', () => {
  it('returns ISO 8601 strings', () => {
    const c = new SystemClock()
    expect(c.nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  })
})

describe('FixedClock', () => {
  it('returns the fixed time and supports tick', () => {
    const c = new FixedClock(new Date('2026-05-12T00:00:00Z'))
    expect(c.nowIso()).toBe('2026-05-12T00:00:00.000Z')
    c.tick(1000)
    expect(c.nowIso()).toBe('2026-05-12T00:00:01.000Z')
  })
})
