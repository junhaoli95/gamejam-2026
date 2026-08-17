// PR #16 §4.1:WebAudio 程序化合成,零音频素材文件。
// 懒初始化 AudioContext(首次用户点击 overlay 后 resume,满足浏览器 autoplay policy)。
// BGM:低音量、慢速和弦渐变的温和 library pad,不使用刺耳的 FM/walking bass。
export interface AudioApi {
  playWin: () => void;
  playLose: () => void;
  playLowBattery: () => void;
  playAppToggle: (app: string) => void;
  startBGM: () => void;
  stopBGM: () => void;
}

// 温和的 C major7 → Am7 → F major7 → G6 和弦,每 4 秒平滑换一次。
const PAD_CHORDS = [
  [261.63, 329.63, 392.00, 493.88],
  [220.00, 261.63, 329.63, 392.00],
  [174.61, 220.00, 261.63, 329.63],
  [196.00, 246.94, 293.66, 392.00],
];
const PAD_CHORD_SEC = 4;
// win 上升音阶 C5-E5-G5-C6(每音 80ms)
const WIN_NOTES = [523.25, 659.26, 783.99, 1046.5];

interface ToneOpts {
  freq: number;
  type: OscillatorType;
  start: number;
  dur: number;
  gain?: number;
  glideTo?: number;
}

export function mountAudio(): AudioApi {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let padOscs: OscillatorNode[] = [];
  let padGain: GainNode | null = null;
  let chordTimer: number | null = null;
  let lowTimer: number | null = null;
  let bgmOn = false;

  function ensureCtx(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    }
    // resume 必须在用户手势内调用;startBGM 由 overlay click 触发,满足 autoplay policy
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  // 单音合成:Oscillator + 指数包络(attack 到 peak,decay 到 0)
  function tone(o: ToneOpts): void {
    const c = ensureCtx();
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(o.freq, o.start);
    if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(o.glideTo, o.start + o.dur);
    const peak = o.gain ?? 0.15;
    const attack = Math.min(0.01, o.dur / 4);
    g.gain.setValueAtTime(0.0001, o.start);
    g.gain.exponentialRampToValueAtTime(peak, o.start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, o.start + o.dur);
    osc.connect(g).connect(master ?? c.destination);
    osc.start(o.start);
    osc.stop(o.start + o.dur + 0.05);
  }

  // --- BGM:温和的低通和弦 Pad,适合图书馆环境 ---
  function startBGM(): void {
    const c = ensureCtx();
    if (bgmOn) return;
    bgmOn = true;

    // 纯净 sine/triangle 叠层 + 低通，避免 sawtooth/FM 带来的高频尖锐感。
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    filter.Q.value = 0.25;
    padGain = c.createGain();
    padGain.gain.value = 0.045;
    padGain.connect(filter).connect(master ?? c.destination);

    const firstChord = PAD_CHORDS[0];
    padOscs = firstChord.map((freq, i) => {
      const osc = c.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      osc.detune.value = i === 3 ? 2 : 0;
      osc.connect(padGain!);
      osc.start();
      return osc;
    });

    let chordIndex = 0;
    chordTimer = window.setInterval(() => {
      if (!bgmOn || !ctx) return;
      chordIndex = (chordIndex + 1) % PAD_CHORDS.length;
      const now = ctx.currentTime;
      PAD_CHORDS[chordIndex].forEach((freq, i) => {
        const osc = padOscs[i];
        if (!osc) return;
        osc.frequency.cancelScheduledValues(now);
        osc.frequency.setTargetAtTime(freq, now, 1.35);
      });
    }, PAD_CHORD_SEC * 1000);
  }

  function stopBGM(): void {
    bgmOn = false;
    if (chordTimer !== null) {
      clearInterval(chordTimer);
      chordTimer = null;
    }
    if (lowTimer !== null) {
      clearInterval(lowTimer);
      lowTimer = null;
    }
    if (ctx && padOscs.length > 0 && padGain) {
      const t = ctx.currentTime;
      padGain.gain.cancelScheduledValues(t);
      padGain.gain.setValueAtTime(Math.max(padGain.gain.value, 0.0001), t);
      padGain.gain.linearRampToValueAtTime(0.0001, t + 0.4);
      padOscs.forEach(osc => osc.stop(t + 0.45));
      padOscs = [];
      padGain = null;
    }
  }

  // --- SFX ---
  function playWin(): void {
    const c = ensureCtx();
    const t0 = c.currentTime + 0.02;
    WIN_NOTES.forEach((f, i) => {
      tone({ freq: f, type: 'square', start: t0 + i * 0.08, dur: 0.08, gain: 0.12 });
    });
  }

  function playLose(): void {
    const c = ensureCtx();
    tone({ freq: 200, type: 'sawtooth', start: c.currentTime + 0.02, dur: 0.5, gain: 0.2, glideTo: 50 });
  }

  // 低电警报:启动 2s 间歇短哔循环(800hz);stopBGM 时停止
  function playLowBattery(): void {
    ensureCtx();
    if (lowTimer !== null) return;
    lowTimer = window.setInterval(() => {
      if (!ctx) return;
      const t = ctx.currentTime;
      tone({ freq: 800, type: 'sine', start: t, dur: 0.08, gain: 0.1 });
    }, 2000);
  }

  function playAppToggle(app: string): void {
    const c = ensureCtx();
    // 不同 app 音高微调:map=1000hz 基准,radar/query 各高 2/5 个半音
    const base = 1000 * Math.pow(2, (app === 'map' ? 0 : app === 'radar' ? 2 : 5) / 12);
    tone({ freq: base, type: 'sine', start: c.currentTime, dur: 0.05, gain: 0.09 });
  }

  return { playWin, playLose, playLowBattery, playAppToggle, startBGM, stopBGM };
}
