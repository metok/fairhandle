import type { ClockPort } from '@fairhandle/domain'

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date()
  }
  nowIso(): string {
    return new Date().toISOString()
  }
  nowMs(): number {
    return Date.now()
  }
}

/** Deterministic clock for tests. */
export class FixedClock implements ClockPort {
  private current: Date
  constructor(start: Date) {
    this.current = new Date(start.getTime())
  }
  now(): Date {
    return new Date(this.current.getTime())
  }
  nowIso(): string {
    return this.current.toISOString()
  }
  nowMs(): number {
    return this.current.getTime()
  }
  tick(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}
