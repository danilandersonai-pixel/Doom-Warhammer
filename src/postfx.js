// Постобработка кадра: сцена рисуется в HDR-буфер, затем
//   1) яркие места вытягиваются и размываются цепочкой уменьшенных копий (bloom — «свечение»),
//   2) от светила тянутся лучи сквозь проёмы и зубцы стен (радиальное размытие маски неба),
//   3) всё сводится: тональная компрессия (ACES), цветокоррекция, виньетка, зерно, хроматическая аберрация,
//      красная пульсация при уроне, размытие при рывке, вспышки.
// Пиксельный слой (оружие в руках и кровь на экране) подмешивается здесь же — вспышка выстрела «светится»,
// а цветокоррекция и виньетка общие для 3D и спрайтов.
import * as THREE from 'three';

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = `
precision highp float;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

// Яркие места + маска неба (альфа) в половинном разрешении
const FRAG_BRIGHT = COMMON + `
uniform sampler2D tScene; uniform sampler2D tOverlay;
uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee; uniform float uOverlayOn; uniform float uOverlayBoost;
void main() {
  vec4 a = texture2D(tScene, vUv + uTexel * vec2(-0.5, -0.5));
  vec4 b = texture2D(tScene, vUv + uTexel * vec2( 0.5, -0.5));
  vec4 c = texture2D(tScene, vUv + uTexel * vec2(-0.5,  0.5));
  vec4 d = texture2D(tScene, vUv + uTexel * vec2( 0.5,  0.5));
  // усреднение с весами по яркости — одиночные «горячие» пиксели не мерцают
  float wa = 1.0 / (1.0 + luma(a.rgb)), wb = 1.0 / (1.0 + luma(b.rgb)), wc = 1.0 / (1.0 + luma(c.rgb)), wd = 1.0 / (1.0 + luma(d.rgb));
  vec3 col = (a.rgb * wa + b.rgb * wb + c.rgb * wc + d.rgb * wd) / (wa + wb + wc + wd);
  col = min(col, vec3(24.0));
  float sky = 1.0 - clamp((a.a + b.a + c.a + d.a) * 0.25, 0.0, 1.0);
  // оружие в руках: вспышка выстрела должна светиться
  vec4 ov = texture2D(tOverlay, vUv) * uOverlayOn;
  vec3 oc = ov.rgb * (1.0 + uOverlayBoost * smoothstep(0.5, 0.95, luma(ov.rgb)));
  col = mix(col, oc, ov.a);
  sky *= 1.0 - ov.a;
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float k = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(col * k, sky);
}`;

const FRAG_DOWN = COMMON + `
uniform sampler2D tSrc; uniform vec2 uTexel;
void main() {
  vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  s += texture2D(tSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const FRAG_UP = COMMON + `
uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uSpread;
void main() {
  vec3 s = texture2D(tSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(2.0, 0.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.0, 2.0)).rgb;
  s += (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
      + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 2.0;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + s / 12.0 * uSpread, 1.0);
}`;

// Лучи света: размытие маски неба от экранного положения светила
const FRAG_RAYS = COMMON + `
uniform sampler2D tBright; uniform vec2 uSun; uniform float uAspect; uniform float uTime; uniform float uDisc;
const int N = 26;
void main() {
  vec2 stepv = (uSun - vUv) / float(N) * 0.92;
  vec2 p = vUv + stepv * hash12(gl_FragCoord.xy + uTime);
  float acc = 0.0, w = 1.0;
  for (int i = 0; i < N; i++) {
    vec2 q = clamp(p, vec2(0.002), vec2(0.998));
    vec2 d = (q - uSun) * vec2(uAspect, 1.0);
    float dd = dot(d, d);
    float glow = exp(-dd * 7.0) * smoothstep(uDisc * uDisc * 0.8, uDisc * uDisc * 2.2, dd);
    acc += texture2D(tBright, q).a * glow * w;
    w *= 0.955;
    p += stepv;
  }
  gl_FragColor = vec4(vec3(acc / float(N)), 1.0);
}`;

const FRAG_FINAL = COMMON + `
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays; uniform sampler2D tOverlay;
uniform sampler2D tStreak; uniform sampler2D tMask; uniform vec2 uSun; uniform float uAspect, uStreak, uFlare;
uniform vec2 uRes; uniform float uTime;
uniform float uExposure, uBloom, uRays, uVignette, uGrain, uSaturation, uContrast, uCA;
uniform float uOverlayOn, uOverlayBoost, uDamage, uLowHp, uDash, uFlash, uDesat;
uniform vec3 uRayColor, uShadowTint, uHighTint, uFlashColor, uWeaponTint;

// ACES (как в three.js), вход — линейный HDR
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 color) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = IN * color; color = RRTAndODTFit(color); color = OUT * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  // рывок: радиальное смазывание к центру
  vec3 hdr;
  float ca = uCA + uDamage * 0.012;
  vec2 off = d * (ca * (0.6 + r2 * 3.0));
  if (uDash > 0.01) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 6; i++) { float t = float(i) / 5.0; acc += texture2D(tScene, vUv - d * (t * 0.11 * uDash * (0.2 + r2 * 3.2))).rgb; }
    hdr = acc / 6.0;
  } else if (ca > 0.0004) {
    hdr = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
  } else hdr = texture2D(tScene, vUv).rgb;

  vec3 bloom = texture2D(tBloom, vUv).rgb;
  float rays = texture2D(tRays, vUv).r * uRays;
  hdr += bloom * uBloom + uRayColor * rays;
  // анаморфные блики: яркие огни тянутся в горизонтальные холодные штрихи, как в киношной оптике
  if (uStreak > 0.001) {
    vec3 st = vec3(0.0);
    for (int i = -4; i <= 4; i++) st += texture2D(tStreak, vUv + vec2(float(i) * 0.034, 0.0)).rgb * (1.0 - abs(float(i)) * 0.2);
    hdr += st * 0.2 * uStreak * vec3(0.5, 0.7, 1.0);
  }
  // блики объектива от светила: цепочка «призраков» вдоль оси светило → центр кадра (если светило не за стеной)
  if (uFlare > 0.001) {
    float vis = texture2D(tMask, clamp(uSun, vec2(0.02), vec2(0.98))).a;
    vec2 axis = vec2(0.5) - uSun, asp = vec2(uAspect, 1.0);
    // два мягких пятна далеко за центром кадра — не мешают целиться
    float d1 = length((vUv - (uSun + axis * 1.55)) * asp), d2 = length((vUv - (uSun + axis * 2.2)) * asp);
    vec3 fl = vec3(0.55, 0.75, 1.0) * smoothstep(0.055, 0.0, d1) * 0.16 + vec3(1.0, 0.8, 0.55) * smoothstep(0.11, 0.0, d2) * 0.1;
    hdr += fl * uFlare * vis;
  }
  hdr += uFlashColor * uFlash;
  vec3 col = aces(hdr);

  // пиксельный слой поверх (после компрессии — цвета спрайтов не «вымываются»), с местным светом
  vec4 ov = texture2D(tOverlay, vUv) * uOverlayOn;
  float hot = smoothstep(0.5, 0.95, luma(ov.rgb));
  vec3 oc = ov.rgb * mix(uWeaponTint, vec3(1.0), hot);
  col = mix(col, oc, ov.a);
  col += aces(bloom * uBloom * 0.7) * ov.a * (0.35 + 0.65 * min(1.0, uOverlayBoost));

  // цветокоррекция: холодные тени, тёплые света
  float l = luma(col);
  col *= mix(uShadowTint, vec3(1.0), smoothstep(0.0, 0.45, l));
  col *= mix(vec3(1.0), uHighTint, smoothstep(0.45, 1.0, l));
  l = luma(col);
  col = mix(vec3(l), col, uSaturation * (1.0 - uDesat));
  col = (col - 0.5) * uContrast + 0.5;

  // виньетка; урон и низкое здоровье — красная кромка с пульсом
  float vig = smoothstep(0.12, 0.62, r2);
  col *= 1.0 - uVignette * vig;
  float hurt = max(uDamage, uLowHp * (0.55 + 0.45 * sin(uTime * 5.5)));
  col = mix(col, vec3(0.62, 0.02, 0.0) + col * vec3(0.7, 0.15, 0.1), clamp(hurt * smoothstep(0.05, 0.55, r2) * 1.25, 0.0, 0.9));

  // плёночное зерно (сильнее в тенях) и сглаживание полос градиента
  float n = hash12(gl_FragCoord.xy + fract(uTime) * 311.7) - 0.5;
  col += n * uGrain * (1.2 - l);
  col = toSRGB(clamp(col, 0.0, 1.0));
  col += (hash12(gl_FragCoord.xy * 1.37) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const BLOOM_LEVELS = { medium: 4, high: 6 };

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.quality = 'high';
    const gl = renderer.getContext();
    const isGL2 = renderer.capabilities.isWebGL2;
    // можно ли рисовать в буфер с плавающей точкой (HDR)? Иначе — обычный 8-битный sRGB-буфер
    this.hdr = isGL2 ? !!(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))
      : !!renderer.extensions.has('EXT_color_buffer_half_float');
    this.maxSamples = isGL2 ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0) : 0;

    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(tri, null);
    this.quad.frustumCulled = false;
    this.fsScene = new THREE.Scene();
    this.fsScene.add(this.quad);

    const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    const U = (v) => ({ value: v });
    this.mBright = mat(FRAG_BRIGHT, { tScene: U(null), tOverlay: U(null), uTexel: U(new THREE.Vector2()), uThreshold: U(0.95), uKnee: U(0.45), uOverlayOn: U(0), uOverlayBoost: U(0) });
    this.mDown = mat(FRAG_DOWN, { tSrc: U(null), uTexel: U(new THREE.Vector2()) });
    this.mUp = mat(FRAG_UP, { tSrc: U(null), tBase: U(null), uTexel: U(new THREE.Vector2()), uSpread: U(1) });
    this.mRays = mat(FRAG_RAYS, { tBright: U(null), uSun: U(new THREE.Vector2(0.5, 0.5)), uAspect: U(1), uTime: U(0), uDisc: U(0.06) });
    this.mFinal = mat(FRAG_FINAL, {
      tScene: U(null), tBloom: U(null), tRays: U(null), tOverlay: U(null), uRes: U(new THREE.Vector2()), uTime: U(0),
      tStreak: U(null), tMask: U(null), uSun: U(new THREE.Vector2(0.5, 0.5)), uAspect: U(1), uStreak: U(0), uFlare: U(0),
      uExposure: U(1), uBloom: U(0.9), uRays: U(0), uVignette: U(0.4), uGrain: U(0.016), uSaturation: U(1.08), uContrast: U(1.06), uCA: U(0.0012),
      uOverlayOn: U(0), uOverlayBoost: U(0), uDamage: U(0), uLowHp: U(0), uDash: U(0), uFlash: U(0), uDesat: U(0),
      uRayColor: U(new THREE.Color(1.0, 0.72, 0.42)), uShadowTint: U(new THREE.Color(0.93, 0.97, 1.06)), uHighTint: U(new THREE.Color(1.06, 1.0, 0.92)),
      uFlashColor: U(new THREE.Color(1, 1, 1)), uWeaponTint: U(new THREE.Color(1, 1, 1)),
    });

    // состояние, которым управляет игра
    this.fx = {
      exposure: 1.12, damage: 0, lowHp: 0, dash: 0, flash: 0, flashColor: new THREE.Color(1, 0.9, 0.7), desat: 0, ca: 0,
      weaponBoost: 0, weaponTint: new THREE.Color(1, 1, 1), sunScreen: new THREE.Vector2(0.5, 0.5), rays: 0, rayDisc: 1, flare: 0,
    };
    this.overlayTex = null;
    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.blank.needsUpdate = true;
    this.w = this.h = 0;
    this.rts = null;
  }

  // Пиксельный слой (2D-холст с оружием): каждый кадр загружается как текстура
  setOverlay(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    this.overlayTex = t;
    this.overlayCanvas = canvas;
  }

  setQuality(q) {
    this.quality = q;
    this.enabled = q !== 'low';
    this.dispose();
    if (this.w) this.setSize(this.w, this.h);
  }

  dispose() {
    if (!this.rts) return;
    this.rts.scene.dispose(); this.rts.bright.dispose(); this.rts.rays.dispose();
    for (const r of this.rts.down) r.dispose();
    for (const r of this.rts.up) r.dispose();
    this.rts = null;
  }

  // w, h — размер буфера в физических пикселях
  setSize(w, h) {
    this.w = w; this.h = h;
    if (!this.enabled) return;
    this.dispose();
    const type = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    const opts = { type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
    const mk = (ww, hh, extra = {}) => {
      const rt = new THREE.WebGLRenderTarget(Math.max(2, ww | 0), Math.max(2, hh | 0), { ...opts, ...extra });
      if (!this.hdr) rt.texture.colorSpace = THREE.SRGBColorSpace;
      return rt;
    };
    const samples = this.quality === 'high' ? this.maxSamples : 0;
    const scene = mk(w, h, { depthBuffer: true, samples });
    const bright = mk(w / 2, h / 2);
    const levels = BLOOM_LEVELS[this.quality] || 4;
    const down = [], up = [];
    let ww = w / 2, hh = h / 2;
    for (let i = 0; i < levels; i++) {
      ww /= 2; hh /= 2;
      if (ww < 8 || hh < 8) break;
      down.push(mk(ww, hh));
      up.push(mk(ww, hh));
    }
    const rays = mk(w / 4, h / 4, { type: THREE.UnsignedByteType });
    rays.texture.colorSpace = THREE.NoColorSpace;
    this.rts = { scene, bright, down, up, rays };
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.cam);
  }

  render(scene, camera, time) {
    const r = this.renderer;
    if (!this.enabled || !this.rts) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    const R = this.rts, fx = this.fx;
    const useOverlay = !!this.overlayTex;
    if (useOverlay) {
      // Память под текстуру выделяется один раз под размер холста. Холст меняет размер вместе с окном —
      // тогда текстуру нужно освободить, иначе видеокарта отклоняет каждую загрузку и оружие пропадает.
      const c = this.overlayCanvas;
      if (c.width !== this.ovW || c.height !== this.ovH) { this.overlayTex.dispose(); this.ovW = c.width; this.ovH = c.height; }
      this.overlayTex.needsUpdate = true;
    }
    const ovTex = useOverlay ? this.overlayTex : this.blank;

    // 1) сцена → HDR-буфер
    r.setRenderTarget(R.scene);
    r.render(scene, camera);

    // 2) яркие места + маска неба
    let u = this.mBright.uniforms;
    u.tScene.value = R.scene.texture; u.tOverlay.value = ovTex;
    u.uTexel.value.set(1 / R.scene.width, 1 / R.scene.height);
    u.uOverlayOn.value = useOverlay ? 1 : 0; u.uOverlayBoost.value = fx.weaponBoost;
    this.pass(this.mBright, R.bright);

    // 3) цепочка уменьшения и обратного увеличения
    let src = R.bright;
    for (let i = 0; i < R.down.length; i++) {
      u = this.mDown.uniforms;
      u.tSrc.value = src.texture; u.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.mDown, R.down[i]);
      src = R.down[i];
    }
    let acc = R.down[R.down.length - 1];
    for (let i = R.down.length - 2; i >= 0; i--) {
      u = this.mUp.uniforms;
      u.tSrc.value = acc.texture; u.tBase.value = R.down[i].texture; u.uTexel.value.set(1 / acc.width, 1 / acc.height); u.uSpread.value = 1.0;
      this.pass(this.mUp, R.up[i]);
      acc = R.up[i];
    }

    // 4) лучи света
    const raysOn = this.quality === 'high' && fx.rays > 0.01;
    if (raysOn) {
      u = this.mRays.uniforms;
      u.tBright.value = R.bright.texture; u.uSun.value.copy(fx.sunScreen); u.uAspect.value = this.w / this.h; u.uTime.value = time % 10; u.uDisc.value = (0.078 / (camera.fov * Math.PI / 180)) * fx.rayDisc;
      this.pass(this.mRays, R.rays);
    }

    // 5) сведение на экран
    u = this.mFinal.uniforms;
    u.tScene.value = R.scene.texture; u.tBloom.value = acc.texture; u.tRays.value = R.rays.texture; u.tOverlay.value = ovTex;
    const high = this.quality === 'high';
    u.tStreak.value = (R.up[Math.min(2, R.down.length - 2)] || acc).texture; u.tMask.value = R.bright.texture;
    u.uSun.value.copy(fx.sunScreen); u.uAspect.value = this.w / this.h;
    u.uStreak.value = high ? 1 : 0; u.uFlare.value = high ? fx.flare : 0;
    u.uRes.value.set(this.w, this.h); u.uTime.value = time % 1000;
    u.uExposure.value = fx.exposure; u.uBloom.value = 0.16 * (this.hdr ? 1 : 1.6); u.uRays.value = raysOn ? fx.rays : 0;
    u.uOverlayOn.value = useOverlay ? 1 : 0; u.uOverlayBoost.value = fx.weaponBoost;
    u.uDamage.value = fx.damage; u.uLowHp.value = fx.lowHp; u.uDash.value = fx.dash; u.uFlash.value = fx.flash; u.uDesat.value = fx.desat;
    u.uCA.value = 0.0012 + fx.ca; u.uFlashColor.value.copy(fx.flashColor); u.uWeaponTint.value.copy(fx.weaponTint);
    this.pass(this.mFinal, null);
  }
}
