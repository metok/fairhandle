export interface ClockPort {
  now(): Date
  nowIso(): string
  nowMs(): number
}
