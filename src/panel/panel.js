'use strict';

/* global api, Dust */

const api = window.bridge.panel;

const $ = (id) => document.getElementById(id);

const app = $('app');
const summary = $('summary');
const addForm = $('addForm');
const taskInput = $('taskInput');
const prios = $('prios');
const dueToggle = $('dueToggle');
const dueRow = $('dueRow');
const dueInput = $('dueInput');
const dueClear = $('dueClear');
const list = $('list');
const listWrap = $('listWrap');
const empty = $('empty');
const historyWrap = $('historyWrap');
const historyList = $('historyList');
const historyEmpty = $('historyEmpty');
const historyCount = $('historyCount');
const snapped = $('snapped');
const settingsSheet = $('settings');
const settingsBtn = $('settingsBtn');
const settingsBack = $('settingsBack');
const closeBtn = $('closeBtn');
const historyBtn = $('historyBtn');
const remindBtn = $('remindBtn');
const toast = $('toast');

const sizeSlider = $('sizeSlider');
const sizeValue = $('sizeValue');
const soundToggle = $('soundToggle');
const remindersToggle = $('remindersToggle');
const topToggle = $('topToggle');
const loginToggle = $('loginToggle');
const quitBtn = $('quitBtn');
const skins = $('skins');

const PRIORITY_WEIGHT = { high: 3, med: 2, low: 1 };

let state = null;
let priority = 'med';
let dueAt = null;
let view = 'tasks';
let newId = null;
let snapping = 0;
let queuedState = null;
let toastTimer = null;
let sizeDebounce = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function relTime(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function dueLabel(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return 'overdue';
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `in ${d} d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function showToast(text, ms = 1800) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function render(next) {
  if (next) state = next;
  if (!state) return;
  if (snapping > 0) {
    queuedState = state;
    return;
  }

  const pending = state.todos.length;
  summary.textContent =
    pending === 0 ? 'Nothing on the list' : pending === 1 ? '1 thing to do' : `${pending} things to do`;
  snapped.textContent =
    state.snappedToday === 0 ? 'No dust today' : `${state.snappedToday} snapped today`;

  list.replaceChildren(...state.todos.map(taskRow));
  empty.classList.toggle('show', pending === 0);

  const totalHistory = state.history.length;
  historyCount.textContent = String(state.snappedToday);
  historyList.replaceChildren(...state.history.map(historyRow));
  historyEmpty.classList.toggle('show', totalHistory === 0);

  syncSettings();

  if (newId) {
    const id = newId;
    newId = null;
    setTimeout(() => {
      const row = list.querySelector(`[data-id="${id}"]`);
      if (row) row.classList.remove('new');
    }, 700);
  }
}

function taskRow(task) {
  const li = document.createElement('li');
  li.className = 'task';
  if (task.id === newId) li.classList.add('new');
  li.dataset.id = task.id;
  li.dataset.priority = task.priority;

  const check = document.createElement('button');
  check.className = 'check';
  check.type = 'button';
  check.title = 'Done — turn it to dust';
  check.setAttribute('aria-label', `Complete ${task.text}`);
  check.addEventListener('click', (event) => {
    event.stopPropagation();
    completeTask(li, task.id);
  });

  const body = document.createElement('div');
  body.className = 'task-body';

  const text = document.createElement('p');
  text.className = 'task-text';
  text.textContent = task.text;

  const meta = document.createElement('div');
  meta.className = 'task-meta';

  const prioPill = document.createElement('span');
  prioPill.className = `pill prio-${task.priority}`;
  prioPill.textContent = task.priority === 'med' ? 'medium' : task.priority;
  meta.appendChild(prioPill);

  if (task.dueAt) {
    const duePill = document.createElement('span');
    duePill.className = 'pill due';
    duePill.dataset.due = String(task.dueAt);
    duePill.textContent = dueLabel(task.dueAt);
    if (task.dueAt <= Date.now()) duePill.classList.add('overdue');
    meta.appendChild(duePill);
  }

  body.append(text, meta);

  const del = document.createElement('button');
  del.className = 'del';
  del.type = 'button';
  del.title = 'Delete';
  del.setAttribute('aria-label', 'Delete task');
  del.textContent = '×';
  del.addEventListener('click', async (event) => {
    event.stopPropagation();
    const next = await api.remove(task.id);
    render(next);
  });

  li.append(check, body, del);
  return li;
}

function historyRow(item) {
  const li = document.createElement('li');
  li.className = 'history-row';

  const dot = document.createElement('span');
  dot.className = 'ash-dot';

  const text = document.createElement('span');
  text.className = 'history-text';
  text.textContent = item.text;

  const when = document.createElement('span');
  when.className = 'history-time';
  when.dataset.ts = String(item.completedAt);
  when.textContent = relTime(item.completedAt);

  li.append(dot, text, when);
  return li;
}

function syncSettings() {
  const s = state.settings;
  if (document.activeElement !== sizeSlider) sizeSlider.value = String(s.avatarSize);
  sizeValue.textContent = `${s.avatarSize} px`;
  soundToggle.checked = !!s.sound;
  remindersToggle.checked = !!s.reminders;
  topToggle.checked = !!s.alwaysOnTop;
  loginToggle.checked = !!s.autoLaunch;
  for (const btn of skins.querySelectorAll('.prio')) {
    btn.classList.toggle('on', btn.dataset.skin === s.skin);
  }
}

skins.addEventListener('click', async (event) => {
  const btn = event.target.closest('.prio');
  if (!btn) return;
  const next = await api.settings({ skin: btn.dataset.skin });
  if (next) {
    state = next;
    syncSettings();
  }
});

// ---------------------------------------------------------------------------
// Complete → dust
// ---------------------------------------------------------------------------
async function completeTask(row, id) {
  if (row.classList.contains('completing')) return;
  row.classList.add('completing');
  playSnap();
  snapping += 1;

  try {
    await Dust.snap(row, {
      onCapture: () => row.classList.add('snapping'),
    });
  } catch (err) {
    console.warn('[panel] dust failed:', err);
  }

  const next = await api.complete(id);
  snapping = Math.max(0, snapping - 1);

  // Drop "new" highlight bookkeeping.
  if (next) {
    render(next);
  } else if (queuedState) {
    const pending = queuedState;
    queuedState = null;
    render(pending);
  }
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------
function setPriority(next) {
  priority = next;
  for (const btn of prios.querySelectorAll('.prio')) {
    btn.classList.toggle('on', btn.dataset.priority === priority);
  }
}

prios.addEventListener('click', (event) => {
  const btn = event.target.closest('.prio');
  if (btn) setPriority(btn.dataset.priority);
});

dueToggle.addEventListener('click', () => {
  const open = !dueRow.classList.contains('open');
  dueRow.classList.toggle('open', open);
  dueToggle.classList.toggle('on', open);
  if (open) {
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    soon.setSeconds(0, 0);
    const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    if (!dueInput.value) dueInput.value = local;
    dueInput.focus();
  }
});

dueInput.addEventListener('change', () => {
  dueAt = dueInput.value ? new Date(dueInput.value).getTime() : null;
});

dueClear.addEventListener('click', () => {
  dueInput.value = '';
  dueAt = null;
  dueRow.classList.remove('open');
  dueToggle.classList.remove('on');
});

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = taskInput.value.trim();
  if (!text) {
    taskInput.classList.remove('shake');
    void taskInput.offsetWidth;
    taskInput.classList.add('shake');
    taskInput.focus();
    return;
  }

  const due = dueAt || (dueInput.value ? new Date(dueInput.value).getTime() : null);
  const next = await api.add({ text, priority, dueAt: due });

  taskInput.value = '';
  dueInput.value = '';
  dueAt = null;
  dueRow.classList.remove('open');
  dueToggle.classList.remove('on');

  if (next && next.todos.length > 0) {
    newId = next.todos[next.todos.length - 1].id;
  }
  playPop();
  render(next);
  taskInput.focus();

  if (view === 'history') setView('tasks');
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function setView(next) {
  view = next;
  const history = view === 'history';
  listWrap.style.display = history ? 'none' : 'block';
  historyWrap.classList.toggle('show', history);
  historyBtn.classList.toggle('on', history);
  historyBtn.textContent = history ? 'Tasks' : 'Dust';
}

historyBtn.addEventListener('click', () => setView(view === 'history' ? 'tasks' : 'history'));

// Keep "in 25 min" labels fresh without rebuilding the list.
setInterval(() => {
  for (const pill of document.querySelectorAll('[data-due]')) {
    const ts = Number(pill.dataset.due);
    pill.textContent = dueLabel(ts);
    pill.classList.toggle('overdue', ts <= Date.now());
  }
  for (const el of document.querySelectorAll('.history-time')) {
    const ts = Number(el.dataset.ts);
    if (ts) el.textContent = relTime(ts);
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function openSettings(open) {
  settingsSheet.classList.toggle('open', open);
  settingsSheet.setAttribute('aria-hidden', String(!open));
  if (open) syncSettings();
}

settingsBtn.addEventListener('click', () => openSettings(true));
settingsBack.addEventListener('click', () => openSettings(false));

sizeSlider.addEventListener('input', () => {
  const value = Number(sizeSlider.value);
  sizeValue.textContent = `${value} px`;
  clearTimeout(sizeDebounce);
  sizeDebounce = setTimeout(async () => {
    const next = await api.settings({ avatarSize: value });
    if (next) {
      state = next;
      syncSettings();
    }
  }, 110);
});

soundToggle.addEventListener('change', async () => {
  const next = await api.settings({ sound: soundToggle.checked });
  if (next) {
    state = next;
    syncSettings();
  }
  if (soundToggle.checked) playPop();
});

remindersToggle.addEventListener('change', async () => {
  const next = await api.settings({ reminders: remindersToggle.checked });
  if (next) {
    state = next;
    syncSettings();
  }
});

topToggle.addEventListener('change', async () => {
  const next = await api.settings({ alwaysOnTop: topToggle.checked });
  if (next) {
    state = next;
    syncSettings();
  }
});

loginToggle.addEventListener('change', async () => {
  const next = await api.settings({ autoLaunch: loginToggle.checked });
  if (next) {
    state = next;
    syncSettings();
  }
});

quitBtn.addEventListener('click', () => api.kill());

remindBtn.addEventListener('click', async () => {
  await api.remindNow();
  showToast(pick(['On my way.', 'Consider yourself nagged.', 'Poke sent.']));
});

closeBtn.addEventListener('click', () => api.close());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (settingsSheet.classList.contains('open')) {
      openSettings(false);
    } else {
      api.close();
    }
  }
});

// ---------------------------------------------------------------------------
// Sound kit
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

function tone({ freq, to, dur = 0.16, type = 'sine', gain = 0.05, delay = 0 }) {
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function playSnap() {
  if (state && state.settings && state.settings.sound === false) return;
  const ctx = audio();
  if (!ctx) return;
  const dur = 0.5;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.2);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.1;
  const t0 = ctx.currentTime;
  band.frequency.setValueAtTime(2200, t0);
  band.frequency.exponentialRampToValueAtTime(420, t0 + dur);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.22, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(band).connect(gain).connect(ctx.destination);
  src.start(t0);

  // low body of the "snap"
  tone({ freq: 140, to: 45, dur: 0.32, type: 'sine', gain: 0.11 });
}

function playPop() {
  tone({ freq: 560, to: 1040, dur: 0.1, type: 'sine', gain: 0.045 });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
api.onAny((channel, payload) => {
  if (channel === 'panel:state') {
    if (snapping > 0) {
      queuedState = payload;
    } else {
      render(payload);
    }
  } else if (channel === 'panel:focus-input') {
    app.classList.remove('in');
    void app.offsetWidth;
    app.classList.add('in');
    setTimeout(() => {
      taskInput.focus();
      taskInput.select();
    }, 120);
  }
});

(async function boot() {
  try {
    const initial = await api.get();
    render(initial);
    setView('tasks');
    setPriority('med');
    requestAnimationFrame(() => app.classList.add('in'));
  } catch (err) {
    console.error('[panel] boot failed:', err);
  }
})();
