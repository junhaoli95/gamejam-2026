// PR #16 §4.1:WebAudio 程序化合成,零音频素材文件。
// 懒初始化 AudioContext(首次用户点击 overlay 后 resume,满足浏览器 autoplay policy)。
// BGM:4 拍循环,C minor,fm synth pad + walking bass(setInterval 调度)。
export interface AudioApi {
  playWin: () => void;
  playLose: () => void;
  playLowBattery: () => void;
  playAppToggle: (app: string) => void;
  startBGM: () => void;
  stopBGM: () => void;
}

// C minor walking bass:C2-Eb2-G2-F2 循环(每音 0.5s,2s 一个 bar)
const BASS_NOTES = [65.41, 77.78, 98.0, 87.31];
// win 上升音阶 C5-E5-G5-C6(每音 80ms)
const WIN_NOTES = [523.25, 659.26, 783.99, 1046.5];
const BASS_STEP_SEC = 0.5;

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
  let bassTimer: number | null = null;
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

  // --- BGM:fm synth pad(C3 sawtooth 被 C2 mod osc 调制 + Eb3 定和弦)+ walking bass ---
  function startBGM(): void {
    const c = ensureCtx();
    if (bgmOn) return;
    bgmOn = true;

    // pad:载波 C3 sawtooth
    const carrier = c.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.value = 130.81;
    const mod = c.createOscillator();
    mod.frequency.value = 65.41; // C2 调制
    const modGain = c.createGain();
    modGain.gain.value = 24; // fm depth
    mod.connect(modGain).connect(carrier.frequency);
    // 叠 Eb3 sine 定 C minor 和弦
    const fifth = c.createOscillator();
    fifth.type = 'sine';
    fifth.frequency.value = 155.56;
    const mix = c.createGain();
    mix.gain.value = 0.4;
    carrier.connect(mix);
    fifth.connect(mix);
    // GainNode 主控 + LFO(2s 周期)调音量
    padGain = c.createGain();
    padGain.gain.value = 0.07;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.5;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0.045;
    lfo.connect(lfoDepth).connect(padGain.gain);
    mix.connect(padGain).connect(master ?? c.destination);
    padOscs = [carrier, mod, fifth, lfo];
    carrier.start();
    mod.start();
    fifth.start();
    lfo.start();

    // walking bass:每 0.5s 一个 8 分音符,setInterval 调度(currentTime 精确落音)
    bassTimer = window.setInterval(() => {
      if (!bgmOn || !ctx) return;
      const now = ctx.currentTime;
      BASS_NOTES.forEach((f, i) => {
        tone({ freq: f, type: 'triangle', start: now + i * BASS_STEP_SEC, dur: 0.35, gain: 0.14 });
      });
    }, BASS_STEP_SEC * BASS_NOTES.length);
  }

  function stopBGM(): void {
    bgmOn = false;
    if (bassTimer !== null) {
      clearInterval(bassTimer);
      bassTimer = null;
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
