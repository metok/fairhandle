import { WebSocketServer, type WebSocket } from 'ws'
import type { ChannelPort, Envelope } from '@fairhandle/domain'

export interface ServerChannelInit {
  port?: number  // 0 for auto-assigned
}

export class WebSocketServerChannel implements ChannelPort {
  private wss: WebSocketServer
  private client: WebSocket | null = null
  private handlers = new Set<(env: Envelope) => void>()
  private queue: Envelope[] = []
  public actualPort = 0

  constructor(init: ServerChannelInit = {}) {
    this.wss = new WebSocketServer({ port: init.port ?? 0, host: '127.0.0.1' })
  }

  async listen(): Promise<number> {
    return new Promise((resolve) => {
      this.wss.on('listening', () => {
        const addr = this.wss.address()
        if (typeof addr === 'object' && addr) this.actualPort = addr.port
        this.wss.on('connection', (ws) => {
          if (this.client) {
            ws.close(1008, 'room already full')
            return
          }
          this.client = ws
          for (const env of this.queue) ws.send(JSON.stringify(env))
          this.queue = []
          ws.on('message', (data) => {
            try {
              const env: Envelope = JSON.parse(data.toString())
              for (const h of this.handlers) h(env)
            } catch {
              // bad frame; ignore
            }
          })
          ws.on('close', () => { this.client = null })
        })
        resolve(this.actualPort)
      })
    })
  }

  async send(env: Envelope): Promise<void> {
    if (!this.client) { this.queue.push(env); return }
    this.client.send(JSON.stringify(env))
  }

  onReceive(handler: (env: Envelope) => void): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  async close(): Promise<void> {
    this.wss.close()
  }
}
