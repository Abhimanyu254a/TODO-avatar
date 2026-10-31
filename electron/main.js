'use strict';

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Menu,
  Tray,
  nativeImage,
  Notification,
} = require('electron');
const path = require('node:path');

const { Store } = require('./store');
const { PetBody } = require('./physics');
const { SurfaceWatcher } = require('./surfaces');

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
const WINDOW_W = 262; // wide enough for the speech bubble
const BUBBLE_ZONE = 132; // fixed space above the character's head
const FEET_PAD = 14; // gap between the feet and the window bottom

const PANEL_W = 404;
const PANEL_H = 604;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const clampSize = (v) => Math.round(clamp(Number(v) || 96, 32, 128));
const SKINS = ['blob', 'cat', 'dog'];

const windowHeight = (size) => BUBBLE_ZONE + size + FEET_PAD;
const bodyWidth = (size) => Math.round(size * 1.02);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let store = null;
let petWin = null;
let panelWin = null;
let tray = null;
let repaintTray = () => {};
let body = null;
let watcher = null;

let dragging = false;
let ignoring = true;
let foreground = null;
let passiveNextAt = 0;
let petAsleep = false;
let chaseUntil = 0;
let shutdown = false;

let loopTimer = null;
let lastFrame = 0;
let lastSentPos = { x: Number.NaN, y: Number.NaN };
let lastSavedPos = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function workAreaAt(cx, cy) {
  const display = screen.getDisplayNearestPoint({ x: Math.round(cx), y: Math.round(cy) });
  return display.workArea;
}

function toDipRect(rect) {
  const a = screen.screenToDipPoint({ x: rect.left, y: rect.top });
  const b = screen.screenToDipPoint({ x: rect.right, y: rect.bottom });
  return {
    left: Math.round(a.x),
    top: Math.round(a.y),
    right: Math.round(b.x),
    bottom: Math.round(b.y),
    width: Math.round(b.x - a.x),
    height: Math.round(b.y - a.y),
  };
}

function getForegroundForBody() {
  return foreground && foreground.rect ? foreground : null;
}

/** Ignore our own windows so the pet never tries to sit on itself. */
function isOwnWindow(rect) {
  for (const win of [petWin, panelWin]) {
    if (!win || win.isDestroyed() || !win.isVisible()) continue;
    const b = win.getBounds();
    const ix = Math.max(0, Math.min(rect.right, b.x + b.width) - Math.max(rect.left, b.x));
    const iy = Math.max(0, Math.min(rect.bottom, b.y + b.height) - Math.max(rect.top, b.y));
    if (ix * iy > 0.55 * (b.width * b.height)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pet window
// ---------------------------------------------------------------------------
function createPetWindow() {
  const size = clampSize(store.settings.avatarSize);
  const h = windowHeight(size);
  const wa = screen.getPrimaryDisplay().workArea;

  let x = Math.round(wa.x + wa.width / 2 - WINDOW_W / 2);
  let y = Math.round(wa.y + wa.height - (h - FEET_PAD));
  if (store.settings.petPos) {
    const saved = store.settings.petPos;
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const disp = screen.getDisplayNearestPoint({ x: saved.x, y: saved.y });
      const swa = disp.workArea;
      if (
        saved.x > swa.x - WINDOW_W &&
        saved.x < swa.x + swa.width &&
        saved.y > swa.y - 100 &&
        saved.y < swa.y + swa.height
      ) {
        x = saved.x;
        y = saved.y;
      }
    }
  }

  petWin = new BrowserWindow({
    width: WINDOW_W,
    height: h,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  petWin.setAlwaysOnTop(!!store.settings.alwaysOnTop, 'floating');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.setMenu(null);

  petWin.loadFile(path.join(__dirname, '..', 'src', 'pet', 'index.html'), {
    query: { size: String(size), skin: store.settings.skin },
  });

  petWin.once('ready-to-show', () => {
    petWin.showInactive();
    petWin.setIgnoreMouseEvents(true, { forward: true });
    ignoring = true;
    sendToPet('pet:size', size);
    sendToPet('pet:count', pendingPayload());
    setTimeout(() => greet(), 1400);
  });

  petWin.on('closed', () => {
    petWin = null;
  });

  if (process.argv.includes('--dev')) {
    petWin.webContents.openDevTools({ mode: 'detach' });
  }
}

function sendToPet(channel, payload) {
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send(channel, payload);
  }
}

function pendingPayload() {
  return { pending: store.todos.length, snapped: store.snappedToday() };
}

function applyWindowPosition() {
  if (!petWin || petWin.isDestroyed()) return;
  const x = Math.round(body.pos.x);
  const y = Math.round(body.pos.y);
  if (x !== lastSentPos.x || y !== lastSentPos.y) {
    lastSentPos = { x, y };
    // setBounds, not setPosition: on Windows at 125%/150% scaling setPosition
    // slowly grows the window, which pushes the pet below the screen edge.
    petWin.setBounds({ x, y, width: WINDOW_W, height: body.h });
  }
}

function createBody() {
  const size = clampSize(store.settings.avatarSize);
  body = new PetBody({
    width: WINDOW_W,
    height: windowHeight(size),
    feetPad: FEET_PAD,
    bodyWidth: bodyWidth(size),
    getWorkArea: workAreaAt,
    getForeground: getForegroundForBody,
  });

  const b = petWin.getBounds();
  body.setPosition(b.x, b.y);

  body.on('state', (state) => {
    sendToPet('pet:state', state);
  });
  body.on('surface', (surface) => {
    sendToPet('pet:surface', surface);
  });
  body.on('facing', (dir) => {
    sendToPet('pet:facing', dir);
  });
  body.on('land', () => {
    sendToPet('pet:land');
    if (panelWin && panelWin.isVisible()) positionPanel();
  });
  body.on('bounce', () => sendToPet('pet:bounce'));
  body.on('snap', () => sendToPet('pet:snap'));
  body.on('caught', () => sendToPet('pet:do', 'caught'));
}

// ---------------------------------------------------------------------------
// Panel window
// ---------------------------------------------------------------------------
function createPanelWindow() {
  panelWin = new BrowserWindow({
    width: PANEL_W,
    height: PANEL_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  panelWin.setAlwaysOnTop(!!store.settings.alwaysOnTop, 'floating');
  panelWin.setMenu(null);
  panelWin.loadFile(path.join(__dirname, '..', 'src', 'panel', 'index.html'));

  panelWin.on('closed', () => {
    panelWin = null;
  });

  if (process.argv.includes('--dev')) {
    panelWin.webContents.openDevTools({ mode: 'detach' });
  }
}

function positionPanel() {
  if (!panelWin || panelWin.isDestroyed() || !petWin) return;
  const pet = petWin.getBounds();
  const wa = workAreaAt(pet.x + pet.width / 2, pet.y + pet.height / 2);

  let x = pet.x + pet.width + 10;
  if (x + PANEL_W > wa.x + wa.width - 6) {
    x = pet.x - PANEL_W - 10;
  }
  if (x < wa.x + 6) x = wa.x + wa.width - PANEL_W - 6;
  x = clamp(x, wa.x + 6, wa.x + wa.width - PANEL_W - 6);

  let y = pet.y + pet.height - PANEL_H;
  y = clamp(y, wa.y + 6, wa.y + wa.height - PANEL_H - 6);

  panelWin.setBounds({ x: Math.round(x), y: Math.round(y), width: PANEL_W, height: PANEL_H });
}

function togglePanel(force) {
  if (!panelWin || panelWin.isDestroyed()) return;
  const shouldShow = typeof force === 'boolean' ? force : !panelWin.isVisible();
  if (!shouldShow) {
    panelWin.hide();
    return;
  }
  positionPanel();
  panelWin.show();
  panelWin.focus();
  panelWin.webContents.send('panel:focus-input');
  panelWin.webContents.send('panel:state', store.snapshot());
}

function nudgeRefresh() {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('panel:state', store.snapshot());
  }
  sendToPet('pet:count', pendingPayload());
  repaintTray();
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
const PASSIVE_LINES = [
  (t) => `Psst… “${t}” is still on the list.`,
  (t) => `Hey! You promised. “${t}”.`,
  (t) => `Don't make me come over there. “${t}”!`,
  (t) => `“${t}” won't do itself. Believe me, I tried.`,
  (t) => `Knock knock. “${t}” is waiting.`,
  (t) => `I've been staring at “${t}” for a while now.`,
  (t) => `Quick reminder: “${t}”. Then snacks.`,
  (t) => `You + “${t}”. Right now. Let's go.`,
];

const ACTIVE_LINES = [
  (t) => `TIME'S UP! “${t}” — go, go, go!`,
  (t) => `Deadline! “${t}”. I'm not mad, just disappointed.`,
  (t) => `That's the bell. “${t}” is due now!`,
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function schedulePassive() {
  const min = Math.max(1, Number(store.settings.passiveMinMinutes) || 25);
  const max = Math.max(min + 1, Number(store.settings.passiveMaxMinutes) || 45);
  passiveNextAt = Date.now() + (min + Math.random() * (max - min)) * 60_000;
}

function say(text, mood = 'happy', ms = 7000) {
  sendToPet('pet:say', { text, mood, ms });
}

function remind(task, { active = false } = {}) {
  if (!task) return;
  const line = pick(active ? ACTIVE_LINES : PASSIVE_LINES)(task.text);
  say(line, active ? 'alert' : 'pester', active ? 10_000 : 8000);
  sendToPet('pet:react', active ? 'alert' : 'pester');
  if (store.settings.sound) {
    sendToPet('pet:sound', active ? 'alert' : 'chime');
  }
  if (active && Notification.isSupported()) {
    const notification = new Notification({
      title: 'Todo Avatar — deadline',
      body: task.text,
      silent: true,
    });
    notification.on('click', () => togglePanel(true));
    notification.show();
  }
}

function startReminders() {
  schedulePassive();

  setInterval(() => {
    if (!store.settings.reminders) return;
    const now = Date.now();

    // Deadlines
    for (const todo of [...store.todos]) {
      if (todo.dueAt && !todo.remindedAt && now >= todo.dueAt) {
        todo.remindedAt = now;
        store.save();
        remind(todo, { active: true });
      }
    }

    // Passive pestering
    if (now >= passiveNextAt) {
      schedulePassive();
      if (store.todos.length > 0) {
        remind(store.topTask(), { active: false });
      }
    }
  }, 12_000);
}

function greet() {
  const count = store.todos.length;
  if (count === 0) {
    say('All clear. Add something when you are ready. 🌱', 'happy', 6000);
    return;
  }
  if (count === 1) {
    say('One thing on the list. You could finish it right now.', 'happy', 6000);
  } else {
    say(`${count} things to do. I'll be watching. 👀`, 'happy', 6000);
  }
}

function onTaskCompleted(todo) {
  const left = store.todos.length;
  sendToPet('pet:celebrate', { left });
  if (left === 0) {
    say('Snapped. The list is empty. Look at you. ✨', 'happy', 7000);
  } else if (left === 1) {
    say('One down. One left. So close.', 'happy', 6000);
  } else {
    say(`One down. ${left} to go.`, 'happy', 5000);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function resizePet(nextSize) {
  const size = clampSize(nextSize);
  const b = petWin.getBounds();
  const feetY = b.y + b.height - FEET_PAD;
  const centerX = b.x + b.width / 2;
  const h = windowHeight(size);

  petWin.setBounds({
    x: Math.round(centerX - WINDOW_W / 2),
    y: Math.round(feetY - (h - FEET_PAD)),
    width: WINDOW_W,
    height: h,
  });

  body.resize({ width: WINDOW_W, height: h, feetPad: FEET_PAD, bodyWidth: bodyWidth(size) });
  if (body.attached) {
    const rect = watcher.rectOf(body.attached.hwnd);
    if (rect) body.followAttached(toDipRect(rect));
  } else if (body.surface.type === 'floor') {
    body.pos.y = body.floorY;
  }

  sendToPet('pet:size', size);
  lastSentPos = { x: Number.NaN, y: Number.NaN };
}

function applySetting(key, value) {
  switch (key) {
    case 'avatarSize': {
      const size = clampSize(value);
      store.setSetting('avatarSize', size);
      if (petWin) resizePet(size);
      break;
    }
    case 'skin': {
      if (!SKINS.includes(value)) break;
      store.setSetting('skin', value);
      sendToPet('pet:skin', value);
      break;
    }
    case 'sound': {
      const on = !!value;
      store.setSetting('sound', on);
      sendToPet('pet:sound-enabled', on);
      break;
    }
    case 'reminders': {
      const on = !!value;
      store.setSetting('reminders', on);
      if (on) schedulePassive();
      break;
    }
    case 'alwaysOnTop': {
      const on = !!value;
      store.setSetting('alwaysOnTop', on);
      if (petWin) petWin.setAlwaysOnTop(on, 'floating');
      if (panelWin) panelWin.setAlwaysOnTop(on, 'floating');
      break;
    }
    case 'autoLaunch': {
      const on = !!value;
      store.setSetting('autoLaunch', on);
      try {
        app.setLoginItemSettings({ openAtLogin: on });
      } catch (err) {
        console.warn('[settings] auto launch failed:', err.message);
      }
      break;
    }
    default:
      store.setSetting(key, value);
  }
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------
function buildContextMenu() {
  const size = clampSize(store.settings.avatarSize);
  return Menu.buildFromTemplate([
    { label: 'Open to-do list', click: () => togglePanel(true) },
    {
      label: 'Remind me now',
      enabled: store.todos.length > 0,
      click: () => remind(store.topTask(), { active: false }),
    },
    { type: 'separator' },
    {
      label: 'Character',
      submenu: SKINS.map((s) => ({
        label: s[0].toUpperCase() + s.slice(1),
        type: 'radio',
        checked: s === store.settings.skin,
        click: () => {
          applySetting('skin', s);
          nudgeRefresh();
        },
      })),
    },
    {
      label: 'Size',
      submenu: [32, 48, 64, 80, 96, 112, 128].map((s) => ({
        label: `${s} px`,
        type: 'radio',
        checked: s === size,
        click: () => applySetting('avatarSize', s),
      })),
    },
    {
      label: 'Always on top',
      type: 'checkbox',
      checked: !!store.settings.alwaysOnTop,
      click: (item) => applySetting('alwaysOnTop', item.checked),
    },
    {
      label: 'Sound',
      type: 'checkbox',
      checked: !!store.settings.sound,
      click: (item) => applySetting('sound', item.checked),
    },
    {
      label: 'Reminders',
      type: 'checkbox',
      checked: !!store.settings.reminders,
      click: (item) => applySetting('reminders', item.checked),
    },
    { type: 'separator' },
    { label: 'Put my feet on the taskbar', click: () => body.spawnOnFloor() },
    { label: 'Quit', click: () => quitApp() },
  ]);
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------
/** Purple blob with two eyes, drawn in code so there is no asset to lose. */
function trayIcon() {
  const S = 32;
  const buf = Buffer.alloc(S * S * 4); // premultiplied BGRA
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const a = clamp(14.5 - Math.hypot(x - 15.5, y - 16.5), 0, 1);
      if (!a) continue;
      const eye = Math.hypot(Math.abs(x - 15.5) - 5, y - 14) < 3;
      const [r, g, b] = eye ? [255, 255, 255] : [122, 91, 255];
      const i = (y * S + x) * 4;
      buf[i] = b * a;
      buf[i + 1] = g * a;
      buf[i + 2] = r * a;
      buf[i + 3] = 255 * a;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S, scaleFactor: 2 });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Todo Avatar');
  const paint = () => {
    if (!tray || tray.isDestroyed()) return;
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `${store.todos.length} things to do`, enabled: false },
        { type: 'separator' },
        { label: 'Open to-do list', click: () => togglePanel(true) },
        {
          label: 'Remind me now',
          enabled: store.todos.length > 0,
          click: () => remind(store.topTask()),
        },
        { type: 'separator' },
        {
          label: 'Always on top',
          type: 'checkbox',
          checked: !!store.settings.alwaysOnTop,
          click: (item) => applySetting('alwaysOnTop', item.checked),
        },
        { label: 'Sound', type: 'checkbox', checked: !!store.settings.sound, click: (item) => applySetting('sound', item.checked) },
        { type: 'separator' },
        { label: 'Quit', click: () => quitApp() },
      ])
    );
  };
  paint();
  tray.on('double-click', () => togglePanel(true));
  tray.on('click', () => togglePanel());
  return paint;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
function quitApp() {
  shutdown = true;
  savePosition(true);
  if (petWin) petWin.destroy();
  if (panelWin) panelWin.destroy();
  if (tray) tray.destroy();
  app.quit();
}

function savePosition(force = false) {
  if (!body) return;
  const x = Math.round(body.pos.x);
  const y = Math.round(body.pos.y);
  if (!force && Math.abs(x - lastSavedPos.x) < 2 && Math.abs(y - lastSavedPos.y) < 2) return;
  lastSavedPos = { x, y };
  store.setSetting('petPos', { x, y });
}

function startLoop() {
  lastFrame = performance.now();
  loopTimer = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    if (body.state === 'run') {
      if (Date.now() > chaseUntil) body.walkTarget = null; // gave up
      else body.retarget(screen.getCursorScreenPoint().x);
    }
    // Ride the attached window every frame (GetWindowRect is cheap) so it never lags.
    if (body.attached) {
      const rect = watcher && watcher.rectOf(body.attached.hwnd);
      if (rect) body.followAttached(toDipRect(rect));
      else body.detach();
    }
    body.tick(dt);
    applyWindowPosition();
  }, 16);

  // Cursor tracking for the eyes (15 Hz is plenty).
  setInterval(() => {
    if (!petWin || petWin.isDestroyed() || !petWin.isVisible()) return;
    const c = screen.getCursorScreenPoint();
    const b = petWin.getBounds();
    sendToPet('pet:cursor', { cx: c.x, cy: c.y, wx: b.x, wy: b.y });
  }, 66);

  // Save position every few seconds.
  setInterval(() => savePosition(), 5000);

  // The pet's own little brain: every so often pick something to do.
  // "rest" is the most likely pick, so it is not busy all the time.
  const BEHAVIORS = [['rest', 35], ['walk', 22], ['chase', 15], ['sit', 16], ['nap', 12]];
  const pickBehavior = () => {
    let r = Math.random() * 100;
    for (const [name, weight] of BEHAVIORS) if ((r -= weight) < 0) return name;
    return 'rest';
  };
  const plan = () => {
    setTimeout(() => {
      if (body && !shutdown && !petAsleep && body.state === 'idle') {
        const action = pickBehavior();
        const onFloor = body.surface.type === 'floor';
        if (action === 'walk' && onFloor) body.startWalk();
        else if (action === 'chase' && onFloor) {
          if (body.startChase(screen.getCursorScreenPoint().x)) chaseUntil = Date.now() + 6000;
        } else if (action === 'sit' || action === 'nap') sendToPet('pet:do', action);
      }
      plan();
    }, 12_000 + Math.random() * 23_000);
  };
  plan();
}

function startSurfaceTracking() {
  watcher = new SurfaceWatcher({ interval: 450 });
  if (!watcher.available) {
    console.warn('[surfaces] Window tracking is unavailable; floor/wall only.');
    return;
  }
  watcher.start();

  setInterval(() => {
    const fg = watcher.foreground;
    if (fg) {
      const dip = toDipRect(fg.rect);
      foreground = isOwnWindow(dip) ? null : { hwnd: fg.hwnd, rect: dip };
    } else {
      foreground = null;
    }
  }, 450);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  ipcMain.on('pet:ready', () => {
    sendToPet('pet:size', clampSize(store.settings.avatarSize));
    sendToPet('pet:count', pendingPayload());
    sendToPet('pet:state', body.state);
    sendToPet('pet:surface', body.surface);
    sendToPet('pet:sound-enabled', !!store.settings.sound);
    sendToPet('pet:skin', store.settings.skin);
  });

  ipcMain.on('pet:asleep', (_e, on) => {
    petAsleep = !!on;
  });

  let lastPointer = null;
  ipcMain.on('pet:pointer', (_e, over) => {
    if (dragging) return;
    if (lastPointer === over) return;
    lastPointer = over;
    ignoring = !over;
    if (petWin) petWin.setIgnoreMouseEvents(ignoring, { forward: true });
  });

  ipcMain.on('pet:drag-start', (_e, point) => {
    if (!point) return;
    dragging = true;
    ignoring = false;
    if (petWin) petWin.setIgnoreMouseEvents(false);
    body.beginGrab({ x: point.x, y: point.y });
  });

  ipcMain.on('pet:drag-move', (_e, point) => {
    if (!point || !dragging) return;
    body.moveGrab({ x: point.x, y: point.y });
  });

  ipcMain.on('pet:drag-end', () => {
    if (!dragging) return;
    dragging = false;
    body.endGrab();
    savePosition(true);
  });

  ipcMain.on('pet:click', () => {
    togglePanel();
  });

  ipcMain.on('pet:context', () => {
    const menu = buildContextMenu();
    menu.popup({ window: petWin });
  });

  // ---- panel ----
  ipcMain.handle('panel:get', () => store.snapshot());

  ipcMain.handle('panel:add', (_e, payload) => {
    const todo = store.add({
      text: payload?.text || '',
      priority: payload?.priority || 'med',
      dueAt: payload?.dueAt || null,
    });
    if (todo) {
      nudgeRefresh();
      sendToPet('pet:pop');
      if (todo.dueAt && todo.dueAt - Date.now() < 60_000) {
        setTimeout(() => remind(todo, { active: true }), 800);
      } else {
        say(`“${todo.text}” — got it.`, 'happy', 4000);
      }
    }
    return store.snapshot();
  });

  ipcMain.handle('panel:complete', (_e, id) => {
    const todo = store.complete(id);
    if (todo) {
      nudgeRefresh();
      onTaskCompleted(todo);
    }
    return store.snapshot();
  });

  ipcMain.handle('panel:remove', (_e, id) => {
    store.remove(id);
    nudgeRefresh();
    return store.snapshot();
  });

  ipcMain.handle('panel:update', (_e, { id, patch }) => {
    store.update(id, patch || {});
    nudgeRefresh();
    return store.snapshot();
  });

  ipcMain.handle('panel:settings', (_e, patch) => {
    for (const [key, value] of Object.entries(patch || {})) {
      applySetting(key, value);
    }
    nudgeRefresh();
    return store.snapshot();
  });

  ipcMain.handle('panel:remind-now', () => {
    remind(store.topTask(), { active: false });
    return store.snapshot();
  });

  ipcMain.handle('panel:kill', () => {
    quitApp();
    return true;
  });

  ipcMain.on('panel:close', () => {
    if (panelWin) panelWin.hide();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => togglePanel(true));

  app.whenReady().then(() => {
    app.setAppUserModelId('com.todoavatar.app');
    Menu.setApplicationMenu(null);

    store = new Store(app.getPath('userData'));
    store.setSetting('autoLaunch', app.getLoginItemSettings().openAtLogin);

    createPetWindow();
    createBody();
    createPanelWindow();
    registerIpc();
    repaintTray = createTray();
    startSurfaceTracking();
    startLoop();
    startReminders();

    // Start on the floor if there is no saved position.
    if (!store.settings.petPos) {
      body.spawnOnFloor();
    }
    applyWindowPosition();
  });

  app.on('window-all-closed', (event) => {
    // Tray app: keep running.
    event.preventDefault?.();
  });

  app.on('before-quit', () => {
    shutdown = true;
    savePosition(true);
  });

  app.on('activate', () => {
    if (!petWin) {
      createPetWindow();
      createBody();
    }
  });
}

// Keep the panel's dust/fx cheap when hidden.
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('render-process-gone', (_evt, details) => {
    console.error('[renderer] gone:', details.reason);
  });
});
