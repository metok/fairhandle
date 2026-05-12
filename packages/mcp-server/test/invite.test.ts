import { describe, it, expect } from 'vitest'
import { encodeInvite, decodeInvite } from '../src/invite.js'

describe('invite code', () => {
  it('round-trips', () => {
    const code = {
      room_id: '11111111-1111-4111-8111-111111111111',
      initiator_pubkey: ('aa'.repeat(32)) as never,
      config_hash: 'bb'.repeat(32),
      host: '127.0.0.1',
      port: 17234,
    }
    expect(decodeInvite(encodeInvite(code))).toEqual(code)
  })
  it('rejects malformed codes', () => {
    expect(() => decodeInvite('not-an-invite')).toThrow(/fairhandle invite code/)
    expect(() => decodeInvite('fh1:incomplete')).toThrow(/structure/)
  })
})
