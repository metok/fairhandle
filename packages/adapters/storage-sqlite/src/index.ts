import Database from 'better-sqlite3'
import type { Event, RoomId, StoragePort } from '@fairhandle/domain'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  room_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  appended_at TEXT NOT NULL,
  PRIMARY KEY (room_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_events_room ON events(room_id);
`

export class SqliteStorageAdapter implements StoragePort {
  private db: InstanceType<typeof Database>
  constructor(filename: string) {
    this.db = new Database(filename)
    this.db.exec(SCHEMA)
  }

  async appendEvent(room: RoomId, event: Event): Promise<void> {
    this.db.prepare(
      `INSERT INTO events (room_id, idx, prev_hash, payload_json, payload_hash, hash, appended_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(room, event.index, event.prev_hash, JSON.stringify(event.payload), event.payload_hash, event.hash, event.appended_at)
  }

  async getEvents(room: RoomId): Promise<Event[]> {
    const rows = this.db.prepare(
      `SELECT idx, prev_hash, payload_json, payload_hash, hash, appended_at FROM events WHERE room_id = ? ORDER BY idx ASC`,
    ).all(room) as Array<{ idx: number; prev_hash: string; payload_json: string; payload_hash: string; hash: string; appended_at: string }>
    return rows.map((r) => ({
      index: r.idx,
      prev_hash: r.prev_hash as Event['prev_hash'],
      payload: JSON.parse(r.payload_json),
      payload_hash: r.payload_hash as Event['payload_hash'],
      hash: r.hash as Event['hash'],
      appended_at: r.appended_at,
    }))
  }

  async getHeadHash(room: RoomId): Promise<string | null> {
    const row = this.db.prepare(`SELECT hash FROM events WHERE room_id = ? ORDER BY idx DESC LIMIT 1`).get(room) as { hash: string } | undefined
    return row?.hash ?? null
  }

  close(): void {
    this.db.close()
  }
}
