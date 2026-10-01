// Процедурный звук через Web Audio API: никаких файлов, всё из шума и осцилляторов.
let ctx = null, out = null, noiseBuf = null;

// Создаём/будим AudioContext. Вызывать только из обработчика нажатия (требование iOS).
export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    // Компрессор, чтобы громкие звуки не хрипели при наложении
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(comp);
    comp.connect(ctx.destination);
    // Буфер белого шума на 1 секунду — основа для выстрелов и взрывов
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// Огибающая громкости: быстрый подъём и плавный спад
function envelope(gain, t, attack, dur, vol) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

// Отфильтрованный шум
function noise({ dur, vol, type = 'lowpass', f0, f1, q = 1, delay = 0 }) {
  if (!ctx || vol < 0.003) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  envelope(g, t, 0.003, dur, vol);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 0.4);
  src.stop(t + dur + 0.05);
}

// Тон с изменением высоты
function tone({ dur, vol, type = 'sine', f0, f1, delay = 0, attack = 0.005 }) {
  if (!ctx || vol < 0.003) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  envelope(g, t, attack, dur, vol);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// Набор звуков игры. vol — множитель громкости (например, по расстоянию)
export const sfx = {
  shoot() {
    noise({ dur: 0.16, vol: 0.9, f0: 5000, f1: 300 });                // хлопок
    tone({ dur: 0.22, vol: 0.9, f0: 170, f1: 38 });                   // басовый удар
    noise({ dur: 0.4, vol: 0.22, f0: 900, f1: 90, delay: 0.03 });     // эхо
  },
  impact(vol = 1) {
    noise({ dur: 0.18, vol: 0.35 * vol, type: 'bandpass', f0: 1600, f1: 250, q: 0.7 });
    tone({ dur: 0.12, vol: 0.25 * vol, f0: 120, f1: 50 });
  },
  flesh() {
    noise({ dur: 0.12, vol: 0.5, type: 'bandpass', f0: 700, f1: 180, q: 1.5 });
  },
  empty() {
    noise({ dur: 0.04, vol: 0.35, type: 'highpass', f0: 3000 });
  },
  reload() {
    noise({ dur: 0.05, vol: 0.4, type: 'highpass', f0: 2000 });
    tone({ dur: 0.05, vol: 0.15, type: 'square', f0: 260, f1: 180, delay: 0.02 });
    noise({ dur: 0.06, vol: 0.5, type: 'highpass', f0: 1500, delay: 0.9 });
    tone({ dur: 0.06, vol: 0.2, type: 'square', f0: 200, f1: 320, delay: 1.1 });
  },
  melee() {
    noise({ dur: 0.2, vol: 0.35, type: 'bandpass', f0: 300, f1: 2400, q: 2 }); // свист замаха
  },
  meleeHit() {
    tone({ dur: 0.18, vol: 0.9, f0: 140, f1: 45 });
    noise({ dur: 0.14, vol: 0.6, f0: 1800, f1: 200 });
  },
  hurt() {
    tone({ dur: 0.25, vol: 0.35, type: 'sawtooth', f0: 150, f1: 60 });
    noise({ dur: 0.2, vol: 0.4, f0: 700, f1: 100 });
  },
  enemyShot(vol = 1) {
    tone({ dur: 0.2, vol: 0.22 * vol, type: 'square', f0: 620, f1: 160 });
    noise({ dur: 0.1, vol: 0.2 * vol, type: 'bandpass', f0: 1200, q: 2 });
  },
  enemyMelee(vol = 1) {
    tone({ dur: 0.3, vol: 0.25 * vol, type: 'sawtooth', f0: 95, f1: 70 }); // рык
  },
  enemyDeath(vol = 1) {
    tone({ dur: 0.45, vol: 0.25 * vol, type: 'sawtooth', f0: 260, f1: 50 });
    noise({ dur: 0.4, vol: 0.5 * vol, f0: 1200, f1: 80 });
  },
  explosion(vol = 1) {
    noise({ dur: 0.9, vol: 0.9 * vol, f0: 1500, f1: 50 });
    tone({ dur: 0.8, vol: 0.8 * vol, f0: 90, f1: 28 });
  },
  spawn(vol = 1) {
    noise({ dur: 0.5, vol: 0.2 * vol, f0: 150, f1: 1400, q: 3 });
  },
  wave() { // боевой горн
    tone({ dur: 0.6, vol: 0.22, type: 'sawtooth', f0: 110, attack: 0.05 });
    tone({ dur: 1.0, vol: 0.22, type: 'sawtooth', f0: 82.4, attack: 0.05, delay: 0.55 });
  },
  boss() {
    tone({ dur: 1.8, vol: 0.4, type: 'sawtooth', f0: 75, f1: 38, attack: 0.1 });
    noise({ dur: 1.6, vol: 0.4, f0: 400, f1: 60 });
  },
  victory() {
    [196, 247, 294, 392].forEach((f, i) => tone({ dur: 1.2, vol: 0.2, type: 'triangle', f0: f, delay: i * 0.18, attack: 0.03 }));
  },
  defeat() {
    [220, 185, 147, 110].forEach((f, i) => tone({ dur: 0.9, vol: 0.2, type: 'sawtooth', f0: f, f1: f * 0.9, delay: i * 0.3, attack: 0.03 }));
  },
};
