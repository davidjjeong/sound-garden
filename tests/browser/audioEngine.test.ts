import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAudioEngine } from '../../src/lib/audioEngine'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state = 'suspended'
  currentTime = 42
  sampleRate = 48000
  destination = {}
  source = { connect: vi.fn(), disconnect: vi.fn() }
  gain = { connect: vi.fn(), disconnect: vi.fn(), gain: {
    cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn(),
  } }
  analyser = { fftSize: 0, frequencyBinCount: 1024,
    getFloatFrequencyData: vi.fn((bins: Float32Array) => { bins.fill(-20) }), connect: vi.fn(), disconnect: vi.fn(),
    getFloatTimeDomainData: vi.fn((samples: Float32Array) => { samples.fill(.25) }),
  }
  constructor() { FakeAudioContext.instances.push(this) }
  createMediaElementSource = vi.fn<(element: HTMLAudioElement) => FakeAudioContext['source']>(() => this.source)
  createGain = vi.fn(() => this.gain)
  createAnalyser = vi.fn(() => this.analyser)
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
}
beforeEach(() => {
  FakeAudioContext.instances = []
  vi.stubGlobal('AudioContext', FakeAudioContext)
})
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const element = document.createElement('audio')
  const engine = createAudioEngine(element)
  return { element, engine, context: FakeAudioContext.instances[0] }
}
it('routes element → gain → analyser → destination with one context', () => {
  const { element, context } = setup()
  expect(FakeAudioContext.instances).toHaveLength(1)
  expect(context.createMediaElementSource).toHaveBeenCalledWith(element)
  expect(context.source.connect).toHaveBeenCalledExactlyOnceWith(context.gain)
  expect(context.gain.connect).toHaveBeenCalledExactlyOnceWith(context.analyser)
  expect(context.analyser.connect).toHaveBeenCalledExactlyOnceWith(context.destination)
  expect(context.analyser.fftSize).toBe(2048)
})
it('resumes a suspended context but does not resume an already-running context again', async () => {
  const { engine, context } = setup()
  await engine.resume()
  await engine.resume()
  expect(context.resume).toHaveBeenCalledOnce()
})
it('propagates context-resume failures for the playback hook to handle', async () => {
  const { engine, context } = setup()
  context.resume.mockRejectedValueOnce(new Error('Unavailable'))
  await expect(engine.resume()).rejects.toThrow('Unavailable')
})
it.each([[.4, .4], [-1, 0], [4, 1], [0, 0]])('clamps volume %s to %s and schedules a smooth gain change', (input, expected) => {
  const { engine, context } = setup()
  engine.setVolume(input)
  expect(context.gain.gain.cancelScheduledValues).toHaveBeenCalledWith(42)
  expect(context.gain.gain.setTargetAtTime).toHaveBeenCalledWith(expected, 42, .02)
  expect(context.gain.gain.cancelScheduledValues.mock.invocationCallOrder[0]).toBeLessThan(context.gain.gain.setTargetAtTime.mock.invocationCallOrder[0])
})
it.each([NaN, Infinity, -Infinity])('ignores nonfinite volume %s without changing gain', (volume) => {
  const { engine, context } = setup()
  engine.setVolume(volume)
  expect(context.gain.gain.setTargetAtTime).not.toHaveBeenCalled()
  expect(context.gain.gain.cancelScheduledValues).not.toHaveBeenCalled()
})
it('reads analyser values into one reusable Float32Array on every call', () => {
  const { engine, context } = setup()
  const first = engine.readWaveForm()
  expect(first).toBeInstanceOf(Float32Array)
  expect(first.length).toBe(2048)
  expect(first[0]).toBe(.25)
  context.analyser.getFloatTimeDomainData.mockImplementationOnce((samples) => { samples.fill(-.5) })
  const second = engine.readWaveForm()
  expect(second).toBe(first)
  expect(second[0]).toBe(-.5)
  expect(context.analyser.getFloatTimeDomainData).toHaveBeenCalledTimes(2)
})
it('disconnects each node before closing the context', async () => {
  const { engine, context } = setup()
  await engine.dispose()
  for (const node of [context.source, context.gain, context.analyser]) {
    expect(node.disconnect).toHaveBeenCalledOnce()
    expect(node.disconnect.mock.invocationCallOrder[0]).toBeLessThan(context.close.mock.invocationCallOrder[0])
  }
  expect(context.close).toHaveBeenCalledOnce()
})

it('returns reusable logarithmic bands in linear amplitude and maps silence to zero', () => {
  const { engine, context } = setup()
  const first = engine.readFrequencyBands()
  expect(first).toHaveLength(96)
  for (const value of first) expect(value).toBeCloseTo(.1)
  context.analyser.getFloatFrequencyData.mockImplementationOnce(bins => bins.fill(-Infinity))
  expect(engine.readFrequencyBands()).toBe(first)
  for (const value of first) expect(value).toBe(0)
})
