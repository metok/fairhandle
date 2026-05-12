import type { Event } from '../types/event.js'
import type { RoomId } from '../types/ids.js'

export interface StoragePort {
  appendEvent(room: RoomId, event: Event): Promise<void>
  getEvents(room: RoomId): Promise<Event[]>
  getHeadHash(room: RoomId): Promise<string | null>
}
