import type { Envelope } from '../types/envelope.js'

/** Bidirectional, ordered, peer-to-peer channel for envelopes. */
export interface ChannelPort {
  /** Send an envelope to the peer. */
  send(env: Envelope): Promise<void>
  /** Register a handler for incoming envelopes. Returns an unsubscribe fn. */
  onReceive(handler: (env: Envelope) => void): () => void
  /** Close the channel. */
  close(): Promise<void>
}
