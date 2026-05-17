import { useState } from 'react'

/**
 * Dual-pane observer. Each MCP server already serves its own full per-peer SPA
 * on its local HTTP port, so this app simply frames both of them side by side.
 * URLs are taken from the query string: ?a=http://localhost:5173&b=http://localhost:5174
 */

const params = new URLSearchParams(window.location.search)
const DEFAULT_A = 'http://localhost:5173'
const DEFAULT_B = 'http://localhost:5174'

const wrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  margin: 0,
  fontFamily: 'system-ui, sans-serif',
}
const bar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  background: '#111827',
  color: '#fff',
  fontSize: 13,
}
const panes: React.CSSProperties = { display: 'flex', flex: 1, minHeight: 0 }
const pane: React.CSSProperties = { flex: 1, minWidth: 0, border: 0 }
const input: React.CSSProperties = {
  background: '#1f2937',
  color: '#fff',
  border: '1px solid #374151',
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 12,
  width: 220,
}

export function Observer() {
  const [a, setA] = useState(params.get('a') ?? DEFAULT_A)
  const [b, setB] = useState(params.get('b') ?? DEFAULT_B)
  const [liveA, setLiveA] = useState(a)
  const [liveB, setLiveB] = useState(b)

  const apply = () => {
    setLiveA(a)
    setLiveB(b)
  }

  return (
    <div style={wrap}>
      <div style={bar}>
        <strong>fairhandle observer</strong>
        <label>
          Peer A{' '}
          <input style={input} value={a} onChange={(e) => setA(e.target.value)} />
        </label>
        <label>
          Peer B{' '}
          <input style={input} value={b} onChange={(e) => setB(e.target.value)} />
        </label>
        <button type="button" onClick={apply} style={{ fontSize: 12 }}>
          Load
        </button>
      </div>
      <div style={panes}>
        <iframe title="peer-a" src={liveA} style={pane} />
        <iframe title="peer-b" src={liveB} style={{ ...pane, borderLeft: '2px solid #111827' }} />
      </div>
    </div>
  )
}
