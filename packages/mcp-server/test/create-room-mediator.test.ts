import { describe, it, expect, afterEach } from 'vitest'
import { RoomRegistry } from '../src/room-registry.js'
import { WebSocketHubChannel, WebSocketServerChannel } from '@fairhandle/channel-ws'
import { decodeInvite } from '../src/invite.js'
import type { Pubkey } from '@fairhandle/domain'

const FAKE_MEDIATOR_PUBKEY = ('ab'.repeat(32)) as Pubkey

describe('create_room with mediator_pubkey', () => {
  let registry: RoomRegistry

  afterEach(async () => {
    await registry.closeAll()
  })

  it('sets mediator_pubkey on room.config when provided', async () => {
    registry = new RoomRegistry({ role_label: 'peer-a' })
    const result = await registry.createRoom({ mediator_pubkey: FAKE_MEDIATOR_PUBKEY }) as { room_id: string; invite_code: string }
    expect(registry.getRoomConfig(result.room_id).mediator_pubkey).toBe(FAKE_MEDIATOR_PUBKEY)
  })

  it('encodes mediator_pubkey in the invite when provided', async () => {
    registry = new RoomRegistry({ role_label: 'peer-a' })
    const result = await registry.createRoom({ mediator_pubkey: FAKE_MEDIATOR_PUBKEY }) as { room_id: string; invite_code: string }
    const decoded = decodeInvite(result.invite_code)
    expect(decoded.mediator_pubkey).toBe(FAKE_MEDIATOR_PUBKEY)
  })

  it('hosts a WebSocketHubChannel when mediator_pubkey is provided', async () => {
    registry = new RoomRegistry({ role_label: 'peer-a' })
    const result = await registry.createRoom({ mediator_pubkey: FAKE_MEDIATOR_PUBKEY }) as { room_id: string; invite_code: string }
    expect(registry.getRoomChannel(result.room_id)).toBeInstanceOf(WebSocketHubChannel)
  })

  it('binds a real port (actualPort > 0) for the hub', async () => {
    registry = new RoomRegistry({ role_label: 'peer-a' })
    const result = await registry.createRoom({ mediator_pubkey: FAKE_MEDIATOR_PUBKEY }) as { room_id: string; invite_code: string }
    const hub = registry.getRoomChannel(result.room_id) as WebSocketHubChannel
    expect(hub.actualPort).toBeGreaterThan(0)
  })
})

describe('create_room without mediator_pubkey', () => {
  let registry: RoomRegistry

  afterEach(async () => {
    await registry.closeAll()
  })

  it('sets mediator_pubkey to null on room.config when not provided', async () => {
    registry = new RoomRegistry({ role_label: 'peer-a' })
    const result = await registry.createRoom({}) as { room_id: string; invite_code: string }
    expect(registry.getRoomConfig(result.room_id).mediator_pubkey).toBeNull()
  })

  it('encodes null mediator_pubkey in the invite when not provided', async () => {
    registry = new RoomRegistry({ role_label: 'peer-a' })
    const result = await registry.createRoom({}) as { room_id: string; invite_code: string }
    const decoded = decodeInvite(result.invite_code)
    expect(decoded.mediator_pubkey).toBeNull()
  })

  it('hosts a WebSocketServerChannel (two-peer path unchanged) when no mediator_pubkey', async () => {
    registry = new RoomRegistry({ role_label: 'peer-a' })
    const result = await registry.createRoom({}) as { room_id: string; invite_code: string }
    expect(registry.getRoomChannel(result.room_id)).toBeInstanceOf(WebSocketServerChannel)
  })
})

describe('create_room with empty mediator_pubkey', () => {
  let registry: RoomRegistry

  afterEach(async () => {
    await registry.closeAll()
  })

  it('throws a clear error when mediator_pubkey is an empty string', async () => {
    registry = new RoomRegistry({ role_label: 'peer-a' })
    await expect(registry.createRoom({ mediator_pubkey: '' })).rejects.toThrow(/mediator_pubkey/)
  })
})
