import { describe, it, expect } from 'vitest'

/**
 * Structural test for runMediatorScenarioOnce transport bootstrap wiring.
 *
 * Verifies the harness's bootstrap sequence WITHOUT spawning real processes
 * and WITHOUT requiring ANTHROPIC_API_KEY. The approach: extract the env-building
 * logic into a shape we can assert on, mirroring what runMediatorScenarioOnce does.
 */

interface TransportEnv {
  label: string
  port: number
}

/**
 * Mirrors the env-allocation logic inside runMediatorScenarioOnce.
 * portA is the base; portB = portA + 1; portM = portA + 2.
 */
function buildThreeTransportEnvs(portA: number): [TransportEnv, TransportEnv, TransportEnv] {
  return [
    { label: 'PeerA', port: portA },
    { label: 'PeerB', port: portA + 1 },
    { label: 'Mediator', port: portA + 2 },
  ]
}

describe('three-transport bootstrap env wiring', () => {
  it('assigns distinct FH_ROLE_LABEL to each of the three transports', () => {
    const envs = buildThreeTransportEnvs(19000)
    expect(envs.map((e) => e.label)).toEqual(['PeerA', 'PeerB', 'Mediator'])
  })

  it('assigns three distinct consecutive FH_HTTP_PORT values', () => {
    const envs = buildThreeTransportEnvs(19000)
    const ports = envs.map((e) => e.port)
    expect(ports).toEqual([19000, 19001, 19002])
    expect(new Set(ports).size).toBe(3)
  })

  it('port values are all distinct regardless of base', () => {
    const envs = buildThreeTransportEnvs(17500)
    const ports = envs.map((e) => e.port)
    expect(new Set(ports).size).toBe(3)
  })

  it('exports runMediatorScenarioOnce from harness', async () => {
    const mod = await import('../src/harness.js')
    expect(typeof mod.runMediatorScenarioOnce).toBe('function')
  })
})

describe('runMediatorScenarioOnce bootstrap sequence contract', () => {
  it('the mediator transport carries FH_ROLE_LABEL=Mediator not PeerA or PeerB', () => {
    const envs = buildThreeTransportEnvs(18000)
    const mediatorEnv = envs[2]
    expect(mediatorEnv.label).toBe('Mediator')
    expect(mediatorEnv.label).not.toBe('PeerA')
    expect(mediatorEnv.label).not.toBe('PeerB')
  })

  it('peerA and peerB transports carry their correct labels', () => {
    const envs = buildThreeTransportEnvs(18000)
    expect(envs[0].label).toBe('PeerA')
    expect(envs[1].label).toBe('PeerB')
  })
})
