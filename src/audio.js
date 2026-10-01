// Процедурный лоу-фай звук через Web Audio API: никаких файлов.
// sfx — короткие звуки, music — мрачный цикл (гул, хор, барабаны), громче в бою.
let ctx = null, out = null, musicBus = null, noiseBuf = null, crusher = null;
let beamNodes = null, settings = { music: true, volume: 1 };

export function audioSettings(s) {
  settings = s;
  if (musicBus) musicBus.gain.value = s.music ? 0.22 : 0;
}

// Создать/разбудить AudioContext (только из обработчика нажатия — требование iOS)
export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    // лёгкое "лоу-фай" искажение
    crusher = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.round(Math.tanh(x * 1.6) * 24) / 24; }
    crusher.curve = curve;
    out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(crusher).connect(comp).connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = settings.music ? 0.22 : 0;
    musicBus.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    music.start();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function env(g, t, a, dur, vol) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function noise({ dur, vol, type = 'lowpass', f0, f1, q = 1, delay = 0, attack = 0.003, dest = null }) {
  if (!ctx || vol < 0.003) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  env(g, t, attack, dur, vol);
  src.connect(f).connect(g).connect(dest || out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

function tone({ dur, vol, type = 'sine', f0, f1, delay = 0, attack = 0.005, dest = null, detune = 0 }) {
  if (!ctx || vol < 0.003) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.detune.value = detune;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  env(g, t, attack, dur, vol);
  o.connect(g).connect(dest || out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const V = (v) => v * (settings.volume ?? 1);

export const sfx = {
  shot(kind) {
    if (kind === 'rifle') {
      noise({ dur: 0.14, vol: V(0.9), f0: 4500, f1: 400 });
      tone({ dur: 0.2, vol: V(0.9), f0: 150, f1: 40 });
      noise({ dur: 0.35, vol: V(0.2), f0: 900, f1: 100, delay: 0.03 });
    } else if (kind === 'shotgun') {
      noise({ dur: 0.35, vol: V(1), f0: 3000, f1: 150 });
      tone({ dur: 0.3, vol: V(1), f0: 110, f1: 30 });
      noise({ dur: 0.08, vol: V(0.4), type: 'highpass', f0: 2500, delay: 0.5 });   // перелом стволов
      noise({ dur: 0.08, vol: V(0.4), type: 'highpass', f0: 1800, delay: 0.62 });
    } else if (kind === 'plasma') {
      tone({ dur: 0.3, vol: V(0.45), type: 'sawtooth', f0: 1600, f1: 120 });
      tone({ dur: 0.3, vol: V(0.35), type: 'square', f0: 800, f1: 90, detune: 20 });
      noise({ dur: 0.2, vol: V(0.3), type: 'bandpass', f0: 3000, f1: 600, q: 4 });
    }
  },
  // луч термокопья: непрерывный рёв, включается/выключается
  beam(on) {
    if (!ctx) return;
    if (on && !beamNodes) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.8;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 70;
      const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(V(0.5), ctx.currentTime + 0.05);
      const og = ctx.createGain(); og.gain.value = 0.25;
      src.connect(f).connect(g); o.connect(og).connect(g); g.connect(out);
      src.start(); o.start();
      beamNodes = { src, o, g };
    } else if (!on && beamNodes) {
      const b = beamNodes; beamNodes = null;
      b.g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
      b.src.stop(ctx.currentTime + 0.1); b.o.stop(ctx.currentTime + 0.1);
    }
  },
  chainSwing() {
    tone({ dur: 0.35, vol: V(0.3), type: 'sawtooth', f0: 90, f1: 140 });
    tone({ dur: 0.35, vol: V(0.2), type: 'square', f0: 180, f1: 260, detune: 30 });
    noise({ dur: 0.22, vol: V(0.35), type: 'bandpass', f0: 400, f1: 2400, q: 2 });
  },
  chainHit() {
    noise({ dur: 0.3, vol: V(0.7), type: 'bandpass', f0: 1200, f1: 300, q: 1.5 });
    tone({ dur: 0.25, vol: V(0.8), f0: 120, f1: 40 });
    tone({ dur: 0.3, vol: V(0.25), type: 'sawtooth', f0: 220, f1: 160 });
  },
  impact(v = 1) { noise({ dur: 0.18, vol: V(0.4 * v), type: 'bandpass', f0: 1500, f1: 250, q: 0.7 }); tone({ dur: 0.15, vol: V(0.3 * v), f0: 100, f1: 40 }); },
  flesh(v = 1) { noise({ dur: 0.12, vol: V(0.45 * v), type: 'bandpass', f0: 700, f1: 160, q: 1.6 }); },
  plasmaHit() { tone({ dur: 0.35, vol: V(0.5), type: 'sawtooth', f0: 300, f1: 40 }); noise({ dur: 0.4, vol: V(0.6), f0: 3000, f1: 200 }); },
  explosion(v = 1) { noise({ dur: 1.0, vol: V(0.95 * v), f0: 1800, f1: 40 }); tone({ dur: 0.9, vol: V(0.9 * v), f0: 85, f1: 25 }); },
  empty() { noise({ dur: 0.04, vol: V(0.35), type: 'highpass', f0: 3000 }); },
  reload(kind) {
    noise({ dur: 0.05, vol: V(0.4), type: 'highpass', f0: 2000, delay: 0.1 });
    tone({ dur: 0.05, vol: V(0.15), type: 'square', f0: 260, f1: 180, delay: 0.12 });
    noise({ dur: 0.07, vol: V(0.5), type: 'highpass', f0: 1500, delay: kind === 'shotgun' ? 0.7 : 0.9 });
    tone({ dur: 0.06, vol: V(0.2), type: 'square', f0: 200, f1: 320, delay: kind === 'shotgun' ? 0.8 : 1.05 });
  },
  swap() { noise({ dur: 0.06, vol: V(0.3), type: 'highpass', f0: 1800 }); tone({ dur: 0.08, vol: V(0.12), type: 'square', f0: 300, f1: 200, delay: 0.04 }); },
  throw() { noise({ dur: 0.2, vol: V(0.3), type: 'bandpass', f0: 600, f1: 1800, q: 2 }); },
  bounce() { tone({ dur: 0.08, vol: V(0.25), type: 'triangle', f0: 500, f1: 300 }); },
  step() { noise({ dur: 0.07, vol: V(0.12), type: 'bandpass', f0: 900 + Math.random() * 500, f1: 400, q: 1.2 }); },
  jump() { noise({ dur: 0.1, vol: V(0.15), type: 'bandpass', f0: 600, q: 1 }); },
  land() { tone({ dur: 0.12, vol: V(0.35), f0: 90, f1: 40 }); noise({ dur: 0.1, vol: V(0.25), f0: 1200, f1: 200 }); },
  dash() { noise({ dur: 0.25, vol: V(0.45), type: 'bandpass', f0: 300, f1: 2400, q: 1.5 }); tone({ dur: 0.2, vol: V(0.2), type: 'sawtooth', f0: 60, f1: 120 }); },
  hurt() { tone({ dur: 0.25, vol: V(0.35), type: 'sawtooth', f0: 150, f1: 60 }); noise({ dur: 0.2, vol: V(0.4), f0: 700, f1: 100 }); },
  pickup(big = false) {
    tone({ dur: 0.12, vol: V(0.25), type: 'triangle', f0: 660 });
    tone({ dur: 0.18, vol: V(0.25), type: 'triangle', f0: 990, delay: 0.07 });
    if (big) tone({ dur: 0.4, vol: V(0.25), type: 'triangle', f0: 1320, delay: 0.15 });
  },
  secret() { [523, 659, 784, 1047].forEach((f, i) => tone({ dur: 0.5, vol: V(0.2), type: 'triangle', f0: f, delay: i * 0.12 })); },
  gate() { tone({ dur: 1.4, vol: V(0.35), type: 'sawtooth', f0: 50, f1: 40, attack: 0.1 }); noise({ dur: 1.4, vol: V(0.35), f0: 300, f1: 120, attack: 0.1 }); },
  horn() {
    tone({ dur: 0.7, vol: V(0.22), type: 'sawtooth', f0: 98, attack: 0.06 });
    tone({ dur: 1.1, vol: V(0.22), type: 'sawtooth', f0: 73.4, attack: 0.06, delay: 0.6 });
  },
  spawn(v = 1) { noise({ dur: 0.6, vol: V(0.3 * v), f0: 150, f1: 1600, q: 3 }); tone({ dur: 0.5, vol: V(0.15 * v), type: 'sawtooth', f0: 40, f1: 90 }); },
  // враги
  enemyCry(type, v = 1) {
    if (type === 'fanatic') { tone({ dur: 0.4, vol: V(0.12 * v), type: 'sawtooth', f0: 520, f1: 300 }); tone({ dur: 0.4, vol: V(0.08 * v), type: 'square', f0: 780, f1: 420, detune: 15 }); }
    else if (type === 'gunner') { noise({ dur: 0.25, vol: V(0.15 * v), type: 'bandpass', f0: 500, q: 6 }); }
    else if (type === 'heavy') { tone({ dur: 0.7, vol: V(0.25 * v), type: 'sawtooth', f0: 70, f1: 50 }); }
  },
  enemyPain(type, v = 1) { tone({ dur: 0.2, vol: V(0.15 * v), type: 'sawtooth', f0: type === 'heavy' ? 120 : 380, f1: type === 'heavy' ? 70 : 220 }); },
  enemyDeath(type, v = 1) {
    tone({ dur: 0.5, vol: V(0.22 * v), type: 'sawtooth', f0: type === 'heavy' ? 140 : 340, f1: 50 });
    noise({ dur: 0.4, vol: V(0.45 * v), f0: 1200, f1: 80 });
  },
  enemySwing(v = 1) { noise({ dur: 0.15, vol: V(0.3 * v), type: 'bandpass', f0: 500, f1: 2000, q: 2 }); },
  enemyShot(v = 1) { noise({ dur: 0.1, vol: V(0.5 * v), f0: 3000, f1: 400 }); tone({ dur: 0.1, vol: V(0.3 * v), f0: 200, f1: 70 }); },
  heavyRoar(v = 1) { tone({ dur: 0.9, vol: V(0.4 * v), type: 'sawtooth', f0: 80, f1: 45, attack: 0.05 }); noise({ dur: 0.8, vol: V(0.3 * v), f0: 600, f1: 150, attack: 0.05 }); },
  bossShot() { noise({ dur: 0.5, vol: V(0.7), f0: 1500, f1: 100 }); tone({ dur: 0.5, vol: V(0.6), type: 'sawtooth', f0: 90, f1: 40 }); },
  bossRoar() { tone({ dur: 1.8, vol: V(0.45), type: 'sawtooth', f0: 65, f1: 35, attack: 0.1 }); tone({ dur: 1.8, vol: V(0.3), type: 'square', f0: 98, f1: 52, attack: 0.1, detune: 25 }); noise({ dur: 1.6, vol: V(0.4), f0: 400, f1: 60 }); },
  bossDeath() { this.bossRoar(); },
  victory() { [196, 247, 294, 392, 494].forEach((f, i) => tone({ dur: 1.4, vol: V(0.18), type: 'triangle', f0: f, delay: i * 0.18, attack: 0.03 })); },
  defeat() { [220, 185, 147, 110].forEach((f, i) => tone({ dur: 1.0, vol: V(0.2), type: 'sawtooth', f0: f, f1: f * 0.9, delay: i * 0.3, attack: 0.03 })); },
};

// ---------- Музыка: мрачный цикл. intensity 0 — гул и хор, 1 — + барабаны, 2 — быстрее и злее ----------
export const music = {
  intensity: 0,
  step: 0,
  next: 0,
  timer: null,
  setIntensity(v) { this.intensity = v; },
  start() {
    if (this.timer || !ctx) return;
    this.next = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 60);
  },
  schedule() {
    if (!ctx || !musicBus) return;
    const bpm = this.intensity >= 2 ? 112 : 92, s16 = 60 / bpm / 4;
    while (this.next < ctx.currentTime + 0.25) {
      const st = this.step % 64, t = this.next - ctx.currentTime;
      const chord = [[62, 65, 69], [58, 62, 65], [60, 63, 67], [57, 61, 64]][Math.floor(st / 16)]; // Dm Bb Cm A
      const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
      if (st % 16 === 0) {
        // хор: три расстроенные пилы через фильтр, медленная атака
        for (const m of chord) for (const d of [-8, 8]) tone({ dur: s16 * 16, vol: 0.05, type: 'sawtooth', f0: hz(m - 12), delay: t, attack: 0.6, dest: musicBus, detune: d });
        tone({ dur: s16 * 16, vol: 0.12, type: 'triangle', f0: hz(chord[0] - 36), delay: t, attack: 0.3, dest: musicBus }); // гул баса
      }
      if (this.intensity >= 1) {
        if (st % 8 === 0 || (this.intensity >= 2 && st % 8 === 6)) tone({ dur: 0.25, vol: 0.5, f0: 110, f1: 38, delay: t, dest: musicBus });   // бочка
        if (st % 8 === 4) noise({ dur: 0.18, vol: 0.28, type: 'bandpass', f0: 1800, q: 0.8, delay: t, dest: musicBus });                     // малый
        if (st % 2 === 1) noise({ dur: 0.03, vol: 0.06, type: 'highpass', f0: 6000, delay: t, dest: musicBus });                              // хэт
        if (st % 4 === 2) tone({ dur: s16 * 1.5, vol: 0.12, type: 'sawtooth', f0: hz(chord[0] - 24), delay: t, dest: musicBus });             // пульс баса
      }
      this.next += s16;
      this.step++;
    }
  },
};
