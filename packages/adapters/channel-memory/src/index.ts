import type { ChannelPort, Envelope } from '@fairhandle/domain'

type Handler = (env: Envelope) => void

class InMemoryChannel implements ChannelPort {
  private handlers = new Set<Handler>()
  private peer: InMemoryChannel | null = null
  private closed = false

  bind(peer: InMemoryChannel): void {
    this.peer = peer
  }

  async send(env: Envelope): Promise<void> {
    if (this.closed) throw new Error('channel closed')
    if (!this.peer) throw new Error('channel not paired')
    const peer = this.peer
    // Deliver asynchronously to mimic real network ordering semantics.
    queueMicrotask(() => {
      for (const h of peer.handlers) h(env)
    })
  }

  onReceive(handler: Handler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    this.handlers.clear()
  }
}

export function createPairedChannels(): [ChannelPort, ChannelPort] {
  const a = new InMemoryChannel()
  const b = new InMemoryChannel()
  a.bind(b)
  b.bind(a)
  return [a, b]
}
