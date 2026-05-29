import { WebSocketServer, type WebSocket } from 'ws'
import type { ChannelPort, Envelope } from '@fairhandle/domain'

export interface HubChannelInit {
  port?: number  // 0 for auto-assigned
}

export class WebSocketHubChannel implements ChannelPort {
  private wss: WebSocketServer
  private clients = new Set<WebSocket>()
  private handlers = new Set<(env: Envelope) => void>()
  private history: Envelope[] = []
  public actualPort = 0

  constructor(init: HubChannelInit = {}) {
    this.wss = new WebSocketServer({ port: init.port ?? 0, host: '127.0.0.1' })
  }

  async listen(): Promise<number> {
    return new Promise((resolve) => {
      this.wss.on('listening', () => {
        const addr = this.wss.address()
        if (typeof addr === 'object' && addr) this.actualPort = addr.port
        this.wss.on('connection', (ws) => {
          this.clients.add(ws)
          // Replay the full history to this newly connected client before
          // any live messages can reach it. This ensures late connectors
          // see every envelope that has ever flowed through the hub.
          for (const env of this.history) ws.send(JSON.stringify(env))
          ws.on('message', (data) => {
            try {
              const env: Envelope = JSON.parse(data.toString())
              // Deliver to local handlers first.
              for (const h of this.handlers) h(env)
              // Record in history so future connectors replay it.
              this.history.push(env)
              // Forward to every OTHER currently-connected client (not the sender).
              for (const peer of this.clients) {
                if (peer !== ws) peer.send(JSON.stringify(env))
              }
            } catch {
              // bad frame; ignore
            }
          })
          ws.on('close', () => { this.clients.delete(ws) })
        })
        resolve(this.actualPort)
      })
    })
  }

  async send(env: Envelope): Promise<void> {
    // Always record in history so future connectors replay it.
    this.history.push(env)
    // Broadcast to all currently-connected clients.
    const serialised = JSON.stringify(env)
    for (const ws of this.clients) ws.send(serialised)
  }

  onReceive(handler: (env: Envelope) => void): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  async close(): Promise<void> {
    this.wss.close()
  }
}
