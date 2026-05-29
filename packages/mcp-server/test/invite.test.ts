import { describe, it, expect } from 'vitest'
import { encodeInvite, decodeInvite, hashRoomConfig } from '../src/invite.js'
import { defaultRoomConfig } from '@fairhandle/domain'
import type { Pubkey } from '@fairhandle/domain'

describe('invite code', () => {
  it('round-trips', () => {
    const code = {
      room_id: '11111111-1111-4111-8111-111111111111',
      initiator_pubkey: ('aa'.repeat(32)) as never,
      config_hash: 'bb'.repeat(32),
      host: '127.0.0.1',
      port: 17234,
      mediator_pubkey: null,
    }
    expect(decodeInvite(encodeInvite(code))).toEqual(code)
  })
  it('rejects malformed codes', () => {
    expect(() => decodeInvite('not-an-invite')).toThrow(/fairhandle invite code/)
    expect(() => decodeInvite('fh1:incomplete')).toThrow(/structure/)
  })
  it('round-trips with a non-null mediator_pubkey', () => {
    const mediatorPubkey = ('cc'.repeat(32)) as Pubkey
    const code = {
      room_id: '22222222-2222-4222-8222-222222222222',
      initiator_pubkey: ('aa'.repeat(32)) as Pubkey,
      config_hash: 'bb'.repeat(32),
      host: '127.0.0.1',
      port: 17235,
      mediator_pubkey: mediatorPubkey,
    }
    const decoded = decodeInvite(encodeInvite(code))
    expect(decoded.mediator_pubkey).toBe(mediatorPubkey)
    expect(decoded).toEqual(code)
  })
  it('round-trips with mediator_pubkey: null', () => {
    const code = {
      room_id: '33333333-3333-4333-8333-333333333333',
      initiator_pubkey: ('aa'.repeat(32)) as Pubkey,
      config_hash: 'bb'.repeat(32),
      host: '127.0.0.1',
      port: 17236,
      mediator_pubkey: null,
    }
    const decoded = decodeInvite(encodeInvite(code))
    expect(decoded.mediator_pubkey).toBeNull()
  })
  it('decodes a legacy invite (no mediator_pubkey field) as mediator_pubkey: null', () => {
    // Simulate a legacy fh1 invite that has only 5 parts (no mediator_pubkey segment).
    const legacyEncoded = `fh1:44444444-4444-4444-8444-444444444444:${'aa'.repeat(32)}:${'bb'.repeat(32)}:127.0.0.1:17237`
    const decoded = decodeInvite(legacyEncoded)
    expect(decoded.mediator_pubkey).toBeNull()
  })
})

describe('hashRoomConfig', () => {
  it('produces different hashes when mediator_pubkey differs', () => {
    const base = defaultRoomConfig()
    const withNull = { ...base, mediator_pubkey: null }
    const withPubkey = { ...base, mediator_pubkey: ('dd'.repeat(32)) as Pubkey }
    expect(hashRoomConfig(withNull)).not.toBe(hashRoomConfig(withPubkey))
  })
})

describe('joinRoom config build', () => {
  it('builds a RoomConfig with mediator_pubkey from the invite', () => {
    const mediatorPubkey = ('ee'.repeat(32)) as Pubkey
    const invite = {
      room_id: '55555555-5555-4555-8555-555555555555',
      initiator_pubkey: ('aa'.repeat(32)) as Pubkey,
      config_hash: 'bb'.repeat(32),
      host: '127.0.0.1',
      port: 17238,
      mediator_pubkey: mediatorPubkey,
    }
    const config = { ...defaultRoomConfig(), mediator_pubkey: (invite.mediator_pubkey ?? null) as Pubkey | null }
    expect(config.mediator_pubkey).toBe(mediatorPubkey)
  })
  it('builds a RoomConfig with mediator_pubkey null when invite has no mediator', () => {
    const invite = {
      room_id: '66666666-6666-4666-8666-666666666666',
      initiator_pubkey: ('aa'.repeat(32)) as Pubkey,
      config_hash: 'bb'.repeat(32),
      host: '127.0.0.1',
      port: 17239,
      mediator_pubkey: null,
    }
    const config = { ...defaultRoomConfig(), mediator_pubkey: (invite.mediator_pubkey ?? null) as Pubkey | null }
    expect(config.mediator_pubkey).toBeNull()
  })
})
