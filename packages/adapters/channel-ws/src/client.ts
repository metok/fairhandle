import WebSocket from 'ws'
import type { ChannelPort, Envelope } from '@fairhandle/domain'

export class WebSocketClientChannel implements ChannelPort {
  private ws: WebSocket
  private handlers = new Set<(env: Envelope) => void>()
  private ready: Promise<void>

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ready = new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve())
      this.ws.on('error', reject)
    })
    this.ws.on('message', (data) => {
      try {
        const env: Envelope = JSON.parse(data.toString())
        for (const h of this.handlers) h(env)
      } catch {
        // bad frame; ignore
      }
    })
  }

  async connect(): Promise<void> { await this.ready }

  async send(env: Envelope): Promise<void> {
    await this.ready
    this.ws.send(JSON.stringify(env))
  }

  onReceive(handler: (env: Envelope) => void): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  async close(): Promise<void> {
    this.ws.close()
  }
}
