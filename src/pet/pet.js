'use strict';

/* global api */

const api = window.bridge.pet;

const stage = document.getElementById('stage');
const petEl = document.getElementById('pet');
const bodyEl = document.getElementById('avatarBody');
const bubble = document.getElementById('bubble');
const bubbleText = document.getElementById('bubbleText');
const badge = document.getElementById('badge');
const badgeCount = document.getElementById('badgeCount');
const spriteEl = document.getElementById('sprite');
const sctx = spriteEl.getContext('2d');

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

let charSize = 96;
let mainState = 'idle';
let tempState = null;
let tempStateTimer = null;
let surface = 'floor';
let sleepy = false;
let soundOn = true;
let lastInteraction = Date.now();
let bubbleTimer = null;
let moodTimer = null;
let badgeTimer = null;
let blinkTimer = null;
let skin = 'blob';
let sitting = false;
let sitTimer = null;
let drawnKey = '';

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------
function applySize(size) {
  charSize = clamp(Number(size) || 96, 32, 128);
  document.documentElement.style.setProperty('--k', String(charSize / 128));
  document.documentElement.style.setProperty('--char-h', `${charSize}px`);
  stage.classList.toggle('tiny', charSize < 64);
}

applySize(new URLSearchParams(location.search).get('size'));

// ---------------------------------------------------------------------------
// Skin: the CSS blob, or a pixel-art pet from sprites.js
// ---------------------------------------------------------------------------
function applySkin(next) {
  skin = SPRITES[next] ? next : 'blob';
  stage.dataset.skin = skin;
  drawnKey = '';
}

applySkin(new URLSearchParams(location.search).get('skin'));
api.on('pet:skin', applySkin);

function spriteAnim() {
  const st = tempState || mainState;
  if (st === 'run') return ['walk', 100];
  if (st === 'walk') return ['walk', 220];
  if (st === 'drag' || st === 'fall') return ['walk', 90]; // paddling paws
  if (sleepy && st === 'idle') return ['sleep', 1200];
  if (st === 'idle' && (sitting || surface === 'window')) return ['sit', 1000];
  return ['idle', 900];
}

function drawSprite(now) {
  const sp = SPRITES[skin];
  if (!sp) return;
  const [anim, ms] = spriteAnim();
  const frames = sp.frames[anim];
  const i = Math.floor(now / ms) % frames.length;
  const key = `${skin}:${anim}:${i}`;
  if (key === drawnKey) return;
  drawnKey = key;
  const frame = frames[i];
  sctx.clearRect(0, 0, spriteEl.width, spriteEl.height);
  for (let y = 0; y < frame.length; y += 1) {
    for (let x = 0; x < frame[y].length; x += 1) {
      const c = frame[y][x];
      if (c === '.') continue;
      sctx.fillStyle = sp.palette[c];
      sctx.fillRect(x, y, 1, 1);
    }
  }
}

function sit() {
  sitting = true;
  clearTimeout(sitTimer);
  sitTimer = setTimeout(() => {
    sitting = false;
  }, 8000 + Math.random() * 14000);
}

function playOnce(cls, ms) {
  petEl.classList.remove(cls);
  void petEl.offsetWidth;
  petEl.classList.add(cls);
  setTimeout(() => petEl.classList.remove(cls), ms);
}

// Things the main-process brain decides to do.
api.on('pet:do', (action) => {
  if (action === 'nap') goToSleep();
  else if (action === 'sit') sit();
  else if (action === 'caught') {
    wake();
    playOnce('hop-small', 1100);
  }
});

// ---------------------------------------------------------------------------
// Mood / state
// ---------------------------------------------------------------------------
function baseMood() {
  return sleepy ? 'sleepy' : 'happy';
}

function setMood(mood, ms = 0) {
  stage.dataset.mood = mood;
  clearTimeout(moodTimer);
  if (ms > 0) {
    moodTimer = setTimeout(() => {
      stage.dataset.mood = baseMood();
    }, ms);
  }
}

function applyState() {
  stage.dataset.state = tempState || mainState;
}

function setMainState(state) {
  mainState = state;
  applyState();
}

function playState(state, ms) {
  tempState = state;
  applyState();
  clearTimeout(tempStateTimer);
  tempStateTimer = setTimeout(() => {
    tempState = null;
    applyState();
  }, ms);
}

function wake() {
  lastInteraction = Date.now();
  if (sleepy) {
    sleepy = false;
    api.asleep(false);
    stage.dataset.sleepy = 'false';
    setMood(baseMood());
  }
}

function goToSleep() {
  sleepy = true;
  api.asleep(true);
  stage.dataset.sleepy = 'true';
  setMood('sleepy');
  hideBubble();
}

// ---------------------------------------------------------------------------
// Speech bubble
// ---------------------------------------------------------------------------
function hideBubble() {
  bubble.classList.remove('show');
}

function say(text, mood = 'happy', ms = 7000) {
  if (!text) return;
  wake();
  bubbleText.textContent = text;
  bubble.style.setProperty('--bubble-ms', `${ms}ms`);
  bubble.classList.remove('show');
  // force a reflow so the entrance + progress bar restart
  void bubble.offsetWidth;
  bubble.classList.add('show');
  setMood(mood, ms);
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, ms);
}

api.on('pet:say', (payload) => {
  if (!payload) return;
  say(payload.text, payload.mood || 'happy', payload.ms || 7000);
});

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
api.on('pet:count', (payload) => {
  if (!payload) return;
  const count = payload.pending || 0;
  badgeCount.textContent = String(count);
  badge.classList.toggle('show', count > 0);
  if (count > 0) {
    badge.classList.remove('pop');
    void badge.offsetWidth;
    badge.classList.add('pop');
    clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => badge.classList.remove('pop'), 520);
  }
});

// ---------------------------------------------------------------------------
// State / surface / reactions
// ---------------------------------------------------------------------------
api.on('pet:state', (state) => {
  setMainState(state || 'idle');
  if (state !== 'idle') sitting = false;
  if (state === 'drag' || state === 'fall') wake();
});

api.on('pet:size', (size) => {
  applySize(size);
});

api.on('pet:surface', (s) => {
  surface = (s && s.type) || 'floor';
  stage.dataset.surface = surface;
});

api.on('pet:facing', (dir) => {
  stage.dataset.facing = dir < 0 ? '-1' : '1';
});

api.on('pet:land', () => {
  petEl.classList.remove('landing');
  void petEl.offsetWidth;
  petEl.classList.add('landing');
  setTimeout(() => petEl.classList.remove('landing'), 460);
  if (soundOn) playThud();
  wake();
});

api.on('pet:bounce', () => {
  petEl.classList.remove('landing');
  void petEl.offsetWidth;
  petEl.classList.add('landing');
  setTimeout(() => petEl.classList.remove('landing'), 460);
  if (soundOn) playThud(0.6);
});

api.on('pet:celebrate', () => {
  wake();
  petEl.classList.remove('celebrate');
  void petEl.offsetWidth;
  petEl.classList.add('celebrate');
  setTimeout(() => petEl.classList.remove('celebrate'), 1300);
  setMood('excited', 1400);
  if (soundOn) playChime();
});

api.on('pet:pop', () => {
  wake();
  petEl.classList.remove('hop-small');
  void petEl.offsetWidth;
  petEl.classList.add('hop-small');
  setTimeout(() => petEl.classList.remove('hop-small'), 1100);
  if (soundOn) playPop();
});

api.on('pet:react', (kind) => {
  wake();
  if (kind === 'alert') {
    playState('alert', 4800);
    setMood('alert', 4800);
    if (soundOn) playAlert();
  } else {
    playState('pester', 5200);
    setMood('pester', 5200);
    if (soundOn) playChime();
  }
});

api.on('pet:sound', (kind) => {
  if (!soundOn) return;
  if (kind === 'alert') playAlert();
  else if (kind === 'chime') playChime();
  else if (kind === 'pop') playPop();
});

api.on('pet:sound-enabled', (on) => {
  soundOn = !!on;
});

api.on('pet:snap', () => {
  wake();
});

// ---------------------------------------------------------------------------
// Cursor tracking (eyes + head tilt)
// ---------------------------------------------------------------------------
const look = { x: 0, y: 0 };
const target = { x: 0, y: 0 };
let tilt = 0;
let tiltTarget = 0;

api.on('pet:cursor', (payload) => {
  if (!payload) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const headX = payload.wx + w / 2;
  const headY = payload.wy + h - 14 - charSize * 0.62;
  const dx = payload.cx - headX;
  const dy = payload.cy - headY;
  const dist = Math.hypot(dx, dy) || 1;

  const near = dist < 170;
  if (near) wake();

  const falloff = clamp(dist / 220, 0.35, 1);
  target.x = clamp(dx / dist, -1, 1) * 4.6 * falloff;
  target.y = clamp(dy / dist, -1, 1) * 3.6 * falloff;
  tiltTarget = clamp(dx / 200, -1, 1) * 6.5;
});

function animateLook(now) {
  drawSprite(now);
  look.x += (target.x - look.x) * 0.2;
  look.y += (target.y - look.y) * 0.2;
  tilt += (tiltTarget - tilt) * 0.12;
  petEl.style.setProperty('--ex', `${look.x.toFixed(2)}px`);
  petEl.style.setProperty('--ey', `${look.y.toFixed(2)}px`);
  petEl.style.setProperty('--tilt', `${tilt.toFixed(2)}deg`);
  requestAnimationFrame(animateLook);
}
requestAnimationFrame(animateLook);

// ---------------------------------------------------------------------------
// Blinking
// ---------------------------------------------------------------------------
function blinkOnce() {
  if (sleepy) return;
  petEl.classList.add('blink');
  setTimeout(() => petEl.classList.remove('blink'), 120);
}

function scheduleBlink() {
  blinkTimer = setTimeout(() => {
    blinkOnce();
    if (Math.random() < 0.22) setTimeout(blinkOnce, 220);
    scheduleBlink();
  }, 2400 + Math.random() * 4200);
}
scheduleBlink();

// ---------------------------------------------------------------------------
// Idle behaviour
// ---------------------------------------------------------------------------
const IDLE_ACTIONS = ['stretch', 'yawn', 'look-around', 'wave', 'hop-small', 'doodle'];
const PIXEL_IDLE_ACTIONS = ['stretch', 'hop-small', 'yawn'];

function randomIdleAction() {
  if (sleepy || mainState !== 'idle' || tempState) return;
  const action = pick(skin === 'blob' ? IDLE_ACTIONS : PIXEL_IDLE_ACTIONS);
  petEl.classList.add(action);
  const duration = action === 'look-around' ? 2000 : action === 'doodle' ? 2400 : 1900;
  if (action === 'yawn') setMood('sleepy', 1900);
  setTimeout(() => petEl.classList.remove(action), duration);
}

setTimeout(function idleLoop() {
  randomIdleAction();
  setTimeout(idleLoop, 15_000 + Math.random() * 30_000); // spec: every 15–45 s
}, 6000 + Math.random() * 6000);

// Fall asleep after a while without anyone bothering the pet.
setInterval(() => {
  if (sleepy || mainState === 'drag' || mainState === 'fall') return;
  if (Date.now() - lastInteraction > 75_000) goToSleep();
}, 5000);

// ---------------------------------------------------------------------------
// Pointer / dragging
// ---------------------------------------------------------------------------
let press = null;
let grabTimer = null;
let dragging = false;
let hoverSent = false;

function hitTest(x, y) {
  const r = (skin === 'blob' ? bodyEl : spriteEl).getBoundingClientRect();
  const pad = Math.max(5, charSize * 0.07);
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

function sendHover(over) {
  if (hoverSent === over) return;
  hoverSent = over;
  api.pointer(over);
}

document.addEventListener('pointermove', (event) => {
  // Forwarded moves (click-through mode) still land here, so we can notice
  // when the cursor touches the character and switch to interactive mode.
  if (!press) sendHover(hitTest(event.clientX, event.clientY));

  if (!press) return;

  if (!dragging) {
    const dx = event.screenX - press.sx;
    const dy = event.screenY - press.sy;
    if (Math.hypot(dx, dy) > 5) {
      clearTimeout(grabTimer);
      beginDrag();
    }
  }
  if (dragging) {
    api.dragMove({ x: event.screenX, y: event.screenY });
  }
});

document.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  if (!hitTest(event.clientX, event.clientY)) return;
  event.preventDefault();
  wake();

  press = { sx: event.screenX, sy: event.screenY, at: performance.now(), id: event.pointerId };
  sendHover(true);
  try {
    document.documentElement.setPointerCapture(event.pointerId);
  } catch {
    /* ignore */
  }

  clearTimeout(grabTimer);
  grabTimer = setTimeout(beginDrag, 150);
});

function beginDrag() {
  if (!press || dragging) return;
  dragging = true;
  stage.dataset.state = 'drag';
  api.dragStart({ x: press.sx, y: press.sy });
}

function endPress(event) {
  if (!press) return;
  clearTimeout(grabTimer);

  if (dragging) {
    api.dragEnd();
    dragging = false;
    applyState();
  } else if (event && performance.now() - press.at < 600) {
    api.click();
  }

  try {
    document.documentElement.releasePointerCapture(press.id);
  } catch {
    /* ignore */
  }
  press = null;
  if (event) sendHover(hitTest(event.clientX, event.clientY));
}

document.addEventListener('pointerup', (event) => endPress(event));
document.addEventListener('pointercancel', (event) => endPress(event));

document.addEventListener('mouseleave', () => {
  if (!press) sendHover(false);
});

window.addEventListener('blur', () => {
  if (press) endPress(null);
  sendHover(false);
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (hitTest(event.clientX, event.clientY)) {
    api.context();
  }
});

// Cursor left the pet while it was being carried? Nothing to do; the window
// follows the pointer so we keep receiving moves.

// ---------------------------------------------------------------------------
// Tiny WebAudio sound kit (no assets needed)
// ---------------------------------------------------------------------------
let audioCtx = null;

function audio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone({ freq, to, dur = 0.18, type = 'sine', gain = 0.06, delay = 0, curve = 'exp' }) {
  if (!soundOn) return;
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) {
    if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    else osc.frequency.linearRampToValueAtTime(Math.max(20, to), t0 + dur);
  }
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function playChime() {
  tone({ freq: 880, to: 1320, dur: 0.2, type: 'sine', gain: 0.05 });
  tone({ freq: 1320, dur: 0.26, type: 'sine', gain: 0.035, delay: 0.1 });
}

function playAlert() {
  tone({ freq: 720, to: 980, dur: 0.14, type: 'triangle', gain: 0.06 });
  tone({ freq: 980, to: 1320, dur: 0.14, type: 'triangle', gain: 0.06, delay: 0.16 });
  tone({ freq: 1320, to: 1600, dur: 0.18, type: 'triangle', gain: 0.06, delay: 0.32 });
}

function playPop() {
  tone({ freq: 520, to: 940, dur: 0.09, type: 'sine', gain: 0.045 });
}

function playThud(scale = 1) {
  tone({ freq: 150 * scale, to: 70, dur: 0.16, type: 'sine', gain: 0.05 * scale });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
setMood('happy');
stage.dataset.sleepy = 'false';
api.ready();

// Nudge the eyes every so often even when the cursor is parked.
setInterval(() => {
  if (sleepy) return;
  if (Math.random() < 0.35) {
    target.x = (Math.random() - 0.5) * 6;
    target.y = (Math.random() - 0.5) * 4;
  }
}, 7000);
