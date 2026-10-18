/** The TV's sound: a soft pad under the round and a chime per caught star. All Web Audio, no files. */
export function createAudio() {
  let ctx: AudioContext | null = null;
  let pad: GainNode | null = null;
  const start = () => {
    if (ctx) return ctx;
    ctx = new AudioContext();
    pad = ctx.createGain();
    pad.gain.value = 0.035;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.connect(pad).connect(ctx.destination);
    for (const f of [110, 164.8, 220.5]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.connect(filter);
      osc.start();
    }
    return ctx;
  };
  return {
    start,
    ctx: () => ctx,
    chime(pitch = 0) {
      if (ctx?.state !== "running") return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(880 * 2 ** (pitch / 12), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.55);
    },
  };
}
