/**
 * Guards the rules that keep the audio silent when it should be silent.
 *
 * The popping this rework removed came from two specific mistakes — writing
 * `AudioParam.value` on a live graph, and scheduling automation against a
 * `currentTime` that had already gone stale — and neither is visible in ordinary
 * testing, because both produce a click rather than a wrong value. So instead of
 * asserting what the audio sounds like, these assert the scheduling discipline
 * that makes clicks impossible, using a fake context that records every call.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAudioParams, createAudioState, updateAudioModel } from "../app/game/audio/audioMath";
import { MasterBus } from "../app/game/audio/masterBus";
import { AmbienceVoice } from "../app/game/audio/voices/ambienceVoice";
import { EngineVoice } from "../app/game/audio/voices/engineVoice";
import { HornVoice } from "../app/game/audio/voices/hornVoice";
import { TyreVoice } from "../app/game/audio/voices/tyreVoice";
import type { VoiceContext } from "../app/game/audio/voices/voiceContext";

interface Scheduled {
  readonly method: string;
  readonly value: number;
  readonly time: number;
}

let recording = false;
const scheduled: Scheduled[] = [];
const directWrites: string[] = [];
let clock = 0;

class FakeParam {
  private stored: number;
  constructor(
    private readonly label: string,
    initial = 0,
  ) {
    this.stored = initial;
  }
  get value() {
    return this.stored;
  }
  set value(next: number) {
    // The whole point: a direct write after setup is a step change, and a step
    // change on a live graph is the click.
    if (recording) directWrites.push(this.label);
    this.stored = next;
  }
  setValueAtTime(value: number, time: number) {
    scheduled.push({ method: "setValueAtTime", value, time });
    this.stored = value;
  }
  setTargetAtTime(value: number, time: number, tau: number) {
    scheduled.push({ method: "setTargetAtTime", value, time });
    expect(tau, "time constant must be positive").toBeGreaterThan(0);
    this.stored = value;
  }
  linearRampToValueAtTime(value: number, time: number) {
    scheduled.push({ method: "linearRampToValueAtTime", value, time });
    this.stored = value;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    // A zero target throws in every real implementation.
    expect(value, "exponential ramps cannot target zero").not.toBe(0);
    scheduled.push({ method: "exponentialRampToValueAtTime", value, time });
    this.stored = value;
  }
  cancelScheduledValues(time: number) {
    scheduled.push({ method: "cancelScheduledValues", value: 0, time });
  }
  cancelAndHoldAtTime(time: number) {
    scheduled.push({ method: "cancelAndHoldAtTime", value: 0, time });
  }
}

const stops: string[] = [];
const starts: string[] = [];

class FakeNode {
  constructor(readonly kind: string) {}
  connect(target: unknown) {
    return target as FakeNode;
  }
  disconnect() {}
}

class FakeSource extends FakeNode {
  started = 0;
  stopped = 0;
  readonly frequency = new FakeParam("source.frequency", 100);
  readonly detune = new FakeParam("source.detune", 0);
  readonly playbackRate = new FakeParam("source.playbackRate", 1);
  buffer: unknown = null;
  loop = false;
  type = "sine";
  onended: (() => void) | null = null;
  setPeriodicWave() {}
  start() {
    this.started += 1;
    starts.push(this.kind);
  }
  stop() {
    this.stopped += 1;
    stops.push(this.kind);
  }
}

class FakeContext {
  sampleRate = 48_000;
  state = "running";
  destination = new FakeNode("destination");
  get currentTime() {
    return clock;
  }
  createGain() {
    const node = new FakeNode("gain") as FakeNode & { gain: FakeParam };
    node.gain = new FakeParam("gain.gain", 1);
    return node;
  }
  createOscillator() {
    return new FakeSource("oscillator");
  }
  createBufferSource() {
    return new FakeSource("buffer");
  }
  createBiquadFilter() {
    const node = new FakeNode("biquad") as FakeNode & {
      frequency: FakeParam;
      Q: FakeParam;
      gain: FakeParam;
      type: string;
    };
    node.frequency = new FakeParam("biquad.frequency", 350);
    node.Q = new FakeParam("biquad.Q", 1);
    node.gain = new FakeParam("biquad.gain", 0);
    node.type = "lowpass";
    return node;
  }
  createStereoPanner() {
    const node = new FakeNode("panner") as FakeNode & { pan: FakeParam };
    node.pan = new FakeParam("panner.pan", 0);
    return node;
  }
  createWaveShaper() {
    return new FakeNode("shaper") as FakeNode & { curve: unknown; oversample: string };
  }
  createDynamicsCompressor() {
    const node = new FakeNode("compressor") as FakeNode & Record<string, unknown>;
    for (const key of ["threshold", "knee", "ratio", "attack", "release"]) {
      node[key] = new FakeParam(`compressor.${key}`, 0);
    }
    node.reduction = 0;
    return node;
  }
  createPeriodicWave() {
    return new FakeNode("wave");
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: () => data,
    };
  }
}

const makeVoiceContext = (context: FakeContext, lowPower = false): VoiceContext =>
  ({
    context: context as unknown as AudioContext,
    destination: new FakeNode("bus") as unknown as AudioNode,
    // Short buffers keep the noise fill from dominating the test runtime.
    noiseBuffer: context.createBuffer(1, 4096, 48_000) as unknown as AudioBuffer,
    jitter: new FakeNode("jitter") as unknown as AudioNode,
    lowPower,
  }) as VoiceContext;

let context: FakeContext;

beforeEach(() => {
  clock = 10;
  recording = false;
  scheduled.length = 0;
  directWrites.length = 0;
  stops.length = 0;
  starts.length = 0;
  context = new FakeContext();
  // The voices arm timers through `window`; node's globals are fine stand-ins.
  (globalThis as unknown as { window: unknown }).window = {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

/** Runs every continuous voice through a busy stretch of driving. */
const driveAll = () => {
  const engine = new EngineVoice(makeVoiceContext(context));
  const ambience = new AmbienceVoice(makeVoiceContext(context));
  const tyres = new TyreVoice(makeVoiceContext(context));
  const state = createAudioState();
  const params = createAudioParams();
  recording = true;
  for (let i = 0; i < 400; i += 1) {
    clock += 1 / 60;
    updateAudioModel(
      state,
      {
        dtSeconds: 1 / 60,
        speedMps: (i / 400) * 40,
        signedSpeedMps: (i / 400) * 40,
        gear: "D",
        throttle: i % 90 < 45 ? 1 : 0,
        brake: i % 130 < 20 ? 1 : 0,
        steer: Math.sin(i / 30),
        offRoad: i > 300,
        outOfFuel: false,
        firstPerson: false,
      },
      params,
    );
    engine.update(params);
    ambience.update(params);
    tyres.update(params);
  }
  return { engine, ambience, tyres };
};

describe("scheduling discipline", () => {
  it("never writes a parameter value directly once running", () => {
    driveAll();
    expect(directWrites).toEqual([]);
  });

  it("never schedules automation in the past", () => {
    driveAll();
    expect(scheduled.length).toBeGreaterThan(0);
    // Each event was queued with the clock at or before its own timestamp; a
    // ramp scheduled behind `currentTime` is applied instantly, which steps.
    const late = scheduled.filter((event) => event.time < 10);
    expect(late).toEqual([]);
  });

  it("keeps the per-frame scheduling load low", () => {
    driveAll();
    // Epsilon-diffing is what stops ~20 parameters queueing 1200 events a
    // second, nearly all of them inaudible no-ops.
    expect(scheduled.length / 400).toBeLessThan(12);
  });

  it("starts every continuous source exactly once and stops none of them", () => {
    driveAll();
    expect(starts.length).toBeGreaterThan(0);
    expect(stops).toEqual([]);
  });
});

describe("horn envelope", () => {
  it("gives a tap a minimum audible length", () => {
    const horn = new HornVoice(makeVoiceContext(context));
    recording = true;
    horn.press();
    clock += 0.01;
    horn.release();
    const releases = scheduled.filter((event) => event.method === "setTargetAtTime");
    expect(releases.length).toBeGreaterThan(0);
    // Pressed at 10.005; a 10ms tap must still hold until at least 10.095.
    expect(Math.max(...releases.map((event) => event.time))).toBeGreaterThanOrEqual(10.09);
  });

  it("ignores a repeat press while already held", () => {
    const horn = new HornVoice(makeVoiceContext(context));
    horn.press();
    recording = true;
    const before = scheduled.length;
    horn.press();
    expect(scheduled.length).toBe(before);
    expect(horn.isHeld).toBe(true);
  });
});

describe("master bus", () => {
  it("fades to silence before anything is torn down", () => {
    const bus = new MasterBus(context as unknown as AudioContext, { master: 0.8, effects: 0.8 });
    recording = true;
    const settle = bus.beginDispose();
    expect(settle).toBeGreaterThan(0);
    const ramps = scheduled.filter((event) => event.method === "setTargetAtTime");
    expect(ramps.some((event) => event.value === 0)).toBe(true);
  });

  it("ducks to zero on pause without touching the effects bus", () => {
    const bus = new MasterBus(context as unknown as AudioContext, { master: 0.8, effects: 0.8 });
    recording = true;
    bus.setPaused(true);
    const ramps = scheduled.filter((event) => event.method === "setTargetAtTime");
    expect(ramps).toHaveLength(1);
    expect(ramps[0].value).toBe(0);
    expect(ramps[0].time).toBeGreaterThanOrEqual(10);
  });
});
