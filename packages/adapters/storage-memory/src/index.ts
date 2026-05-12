import type { Event, RoomId, StoragePort } from '@fairhandle/domain'

export class MemoryStorageAdapter implements StoragePort {
  private events = new Map<RoomId, Event[]>()

  async appendEvent(room: RoomId, event: Event): Promise<void> {
    const list = this.events.get(room) ?? []
    list.push(event)
    this.events.set(room, list)
  }

  async getEvents(room: RoomId): Promise<Event[]> {
    return [...(this.events.get(room) ?? [])]
  }

  async getHeadHash(room: RoomId): Promise<string | null> {
    const list = this.events.get(room)
    if (!list || list.length === 0) return null
    return list[list.length - 1]!.hash
  }
}
