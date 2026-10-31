'use strict';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Motion tuning -------------------------------------------------------------
const GRAVITY = 2600; // px / s^2
const SPRING_K = 1500; // cursor follow stiffness
const SPRING_C = 58; // cursor follow damping
const MAX_SPEED = 8000;
const WALL_SNAP = 96; // how close to a screen edge before you stick to it
const WIN_SNAP = 150; // how close (vertically) before you land on a title bar
const RESTITUTION = 0.34;
const WALK_SPEED = 74;
const RUN_SPEED = 300; // chasing the cursor
const CLING_SLIDE = 6; // px / s downward drift while hanging on a wall

/**
 * The pet itself is just a little box of physics. `pos` is the top-left of the
 * browser window, and every surface is expressed in screen coordinates.
 *
 * Window layout (height H):
 *   [ speech bubble area ][ character ][ feetPad ]
 * so the "feet" of the pet are at pos.y + H - feetPad.
 */
class PetBody {
  /**
   * @param {object} opts
   * @param {number} opts.width            window width
   * @param {number} opts.height           window height
   * @param {number} opts.feetPad          distance from window bottom to feet
   * @param {number} opts.bodyWidth        visible avatar width (wall snapping)
   * @param {(x:number) => {x:number,y:number,width:number,height:number}} opts.getWorkArea
   * @param {() => ({hwnd: bigint, rect: object}|null)} opts.getForeground
   */
  constructor(opts) {
    this.w = opts.width;
    this.h = opts.height;
    this.feetPad = opts.feetPad;
    this.bodyWidth = opts.bodyWidth;
    this.getWorkArea = opts.getWorkArea;
    this.getForeground = opts.getForeground;

    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.state = 'idle';
    this.surface = { type: 'floor' };
    this.attached = null; // { hwnd, rect, offsetX }
    this.grab = null;
    this.snap = null;
    this.walkTarget = null;
    this.walkSpeed = WALK_SPEED;
    this.clingDir = -1;
    this.clingPhase = 0;
    this.facing = 1;
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
    return this;
  }

  emit(event, payload) {
    const fns = this.listeners.get(event);
    if (!fns) return;
    for (const fn of fns) {
      try {
        fn(payload);
      } catch (err) {
        console.warn(`[physics] listener for "${event}" failed:`, err);
      }
    }
  }

  get feet() {
    return { x: this.pos.x + this.w / 2, y: this.pos.y + this.h - this.feetPad };
  }

  get floorY() {
    const wa = this.workArea();
    return wa.y + wa.height - (this.h - this.feetPad);
  }

  workArea() {
    return this.getWorkArea(this.pos.x + this.w / 2, this.pos.y + this.h / 2);
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state', state);
  }

  setPosition(x, y) {
    this.pos.x = x;
    this.pos.y = y;
  }

  resize({ width, height, feetPad, bodyWidth }) {
    this.w = width;
    this.h = height;
    this.feetPad = feetPad;
    this.bodyWidth = bodyWidth;
  }

  /** Drop the pet onto the floor at the bottom-centre of the current screen. */
  spawnOnFloor() {
    const wa = this.workArea();
    this.pos.x = Math.round(wa.x + wa.width / 2 - this.w / 2);
    this.pos.y = Math.round(wa.y + wa.height - (this.h - this.feetPad));
    this.vel = { x: 0, y: 0 };
    this.surface = { type: 'floor' };
    this.attached = null;
    this.setState('idle');
    this.emit('surface', this.surface);
  }

  /** Let the pet drop from wherever it currently is. */
  beginFall() {
    this.attached = null;
    this.snap = null;
    this.walkTarget = null;
    this.vel = { x: 0, y: 0 };
    this.surface = { type: 'air' };
    this.emit('surface', this.surface);
    this.setState('fall');
  }

  // --- dragging -----------------------------------------------------------

  beginGrab(cursor) {
    this.attached = null;
    this.snap = null;
    this.grab = {
      dx: cursor.x - this.pos.x,
      dy: cursor.y - this.pos.y,
      target: { x: this.pos.x, y: this.pos.y },
    };
    this.vel = { x: 0, y: 0 };
    this.surface = { type: 'air' };
    this.setState('drag');
    this.emit('surface', this.surface);
  }

  moveGrab(cursor) {
    if (!this.grab) return;
    this.grab.target.x = cursor.x - this.grab.dx;
    this.grab.target.y = cursor.y - this.grab.dy;
  }

  endGrab() {
    if (!this.grab) return;
    this.grab = null;
    const feet = this.feet;
    const wa = this.workArea();
    const fg = this.getForeground();

    // 1. Title bar of the window you are hovering over.
    if (fg && feet.x >= fg.rect.left - 30 && feet.x <= fg.rect.right + 30) {
      const top = fg.rect.top;
      if (Math.abs(feet.y - top) < WIN_SNAP) {
        this.snapToWindow(fg.hwnd, fg.rect);
        return;
      }
    }

    // 2. Left / right screen edge.
    const aboveFloor = feet.y < wa.y + wa.height - 70;
    if (aboveFloor && feet.x - wa.x < WALL_SNAP) {
      this.snapToWall(-1);
      return;
    }
    if (aboveFloor && wa.x + wa.width - feet.x < WALL_SNAP) {
      this.snapToWall(1);
      return;
    }

    // 3. Free fall.
    this.setState('fall');
    this.emit('drop');
  }

  snapToWindow(hwnd, rect) {
    const x = clamp(this.pos.x, rect.left - 12, rect.right - this.w + 12);
    const y = rect.top - (this.h - this.feetPad);
    this.beginSnap(x, y, 'idle', { type: 'window', hwnd }, { hwnd, rect: { ...rect }, offsetX: x - rect.left });
  }

  snapToWall(dir) {
    const wa = this.workArea();
    const margin = (this.w - this.bodyWidth) / 2;
    const x = dir < 0 ? wa.x - margin : wa.x + wa.width - this.w + margin;
    const y = clamp(this.pos.y, wa.y, wa.y + wa.height - this.h);
    this.clingDir = dir;
    this.clingPhase = dir < 0 ? Math.PI * 0.5 : Math.PI * 1.5;
    this.beginSnap(x, y, 'cling', { type: dir < 0 ? 'wall-left' : 'wall-right' });
    this.emit('facing', dir < 0 ? 1 : -1);
  }

  beginSnap(x, y, nextState, surface, attachment) {
    this.snap = {
      fx: this.pos.x,
      fy: this.pos.y,
      tx: x,
      ty: y,
      t: 0,
      dur: 0.24,
      nextState,
      surface,
      attachment: attachment || null,
    };
    this.vel = { x: 0, y: 0 };
    this.setState('snap');
    this.emit('snap');
  }

  detach() {
    if (!this.attached) return;
    this.attached = null;
    this.surface = { type: 'air' };
    this.emit('surface', this.surface);
    this.emit('detach');
    this.setState('fall');
  }

  /** Called by the main process with fresh DIP bounds for the attached window. */
  followAttached(rect) {
    if (!this.attached || !rect) return;
    // Window got maximized / dragged to the top: nothing left to sit on.
    if (rect.top < this.getWorkArea(rect.left + rect.width / 2, rect.top + 40).y + 12) {
      this.detach();
      return;
    }
    this.attached.rect = rect;
    const targetX = rect.left + this.attached.offsetX;
    this.pos.x = clamp(targetX, rect.left - 10, rect.right - this.w + 10);
    this.pos.y = rect.top - (this.h - this.feetPad);
  }

  // --- walking ------------------------------------------------------------

  startWalk() {
    if (this.state !== 'idle' || this.surface.type !== 'floor') return false;
    const wa = this.workArea();
    const direction = Math.random() < 0.5 ? -1 : 1;
    const distance = 90 + Math.random() * 260;
    this.walkTarget = clamp(
      this.pos.x + direction * distance,
      wa.x + 12,
      wa.x + wa.width - this.w - 12
    );
    if (Math.abs(this.walkTarget - this.pos.x) < 40) return false;
    this.walkSpeed = WALK_SPEED;
    this.setState('walk');
    return true;
  }

  /** Run along the floor toward the cursor; main keeps calling retarget(). */
  startChase(cursorX) {
    if (this.state !== 'idle' || this.surface.type !== 'floor') return false;
    this.retarget(cursorX);
    if (Math.abs(this.walkTarget - this.pos.x) < 40) return false;
    this.walkSpeed = RUN_SPEED;
    this.setState('run');
    return true;
  }

  retarget(cursorX) {
    const wa = this.workArea();
    this.walkTarget = clamp(cursorX - this.w / 2, wa.x + 12, wa.x + wa.width - this.w - 12);
  }

  // --- main update --------------------------------------------------------

  tick(dt) {
    dt = Math.min(dt, 0.05);

    switch (this.state) {
      case 'drag':
        this.tickDrag(dt);
        break;
      case 'snap':
        this.tickSnap(dt);
        break;
      case 'fall':
        this.tickFall(dt);
        break;
      case 'walk':
      case 'run':
        this.tickWalk(dt);
        break;
      case 'cling':
        this.tickCling(dt);
        break;
      default:
        this.tickIdle(dt);
        break;
    }
  }

  tickDrag(dt) {
    if (!this.grab) return;
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const sdt = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      const ax = SPRING_K * (this.grab.target.x - this.pos.x) - SPRING_C * this.vel.x;
      const ay = SPRING_K * (this.grab.target.y - this.pos.y) - SPRING_C * this.vel.y;
      this.vel.x = clamp(this.vel.x + ax * sdt, -MAX_SPEED, MAX_SPEED);
      this.vel.y = clamp(this.vel.y + ay * sdt, -MAX_SPEED, MAX_SPEED);
      this.pos.x += this.vel.x * sdt;
      this.pos.y += this.vel.y * sdt;
    }
    // Let it dangle a little outside the screen but never get lost.
    const wa = this.workArea();
    this.pos.x = clamp(this.pos.x, wa.x - this.w * 0.6, wa.x + wa.width - this.w * 0.4);
    this.pos.y = clamp(this.pos.y, wa.y - this.h * 0.7, wa.y + wa.height - this.h * 0.35);
  }

  tickSnap(dt) {
    const s = this.snap;
    if (!s) return;
    s.t += dt;
    const p = Math.min(1, s.t / s.dur);
    const e = 1 - Math.pow(1 - p, 3);
    this.pos.x = lerp(s.fx, s.tx, e);
    this.pos.y = lerp(s.fy, s.ty, e);
    if (p >= 1) {
      this.surface = s.surface;
      this.attached = s.attachment || null;
      this.snap = null;
      this.emit('surface', this.surface);
      this.setState(s.nextState);
      this.emit('land', this.surface);
    }
  }

  tickFall(dt) {
    const prevFeetY = this.feet.y;
    this.vel.y += GRAVITY * dt;
    this.vel.x *= 1 - 0.6 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    const wa = this.workArea();
    const minX = wa.x - (this.w - this.bodyWidth) / 2;
    const maxX = wa.x + wa.width - this.w + (this.w - this.bodyWidth) / 2;
    if (this.pos.x < minX) {
      this.pos.x = minX;
      this.vel.x = 0;
    } else if (this.pos.x > maxX) {
      this.pos.x = maxX;
      this.vel.x = 0;
    }

    const feet = this.feet;

    // Catch a window title bar on the way down.
    if (this.vel.y > 0) {
      const fg = this.getForeground();
      if (
        fg &&
        feet.x >= fg.rect.left &&
        feet.x <= fg.rect.right &&
        fg.rect.top > wa.y + 12 &&
        prevFeetY <= fg.rect.top + 2 &&
        feet.y >= fg.rect.top
      ) {
        this.pos.y = fg.rect.top - (this.h - this.feetPad);
        this.vel = { x: 0, y: 0 };
        this.surface = { type: 'window', hwnd: fg.hwnd };
        this.attached = { hwnd: fg.hwnd, rect: { ...fg.rect }, offsetX: this.pos.x - fg.rect.left };
        this.emit('surface', this.surface);
        this.setState('idle');
        this.emit('land', this.surface);
        return;
      }
    }

    // Floor / taskbar.
    if (this.pos.y >= this.floorY) {
      this.pos.y = this.floorY;
      if (this.vel.y > 320) {
        this.vel.y = -this.vel.y * RESTITUTION;
        this.vel.x *= 0.55;
        this.emit('bounce');
        if (Math.abs(this.vel.y) < 120) {
          this.vel = { x: 0, y: 0 };
          this.surface = { type: 'floor' };
          this.emit('surface', this.surface);
          this.setState('idle');
          this.emit('land', this.surface);
        }
      } else {
        this.vel = { x: 0, y: 0 };
        this.surface = { type: 'floor' };
        this.emit('surface', this.surface);
        this.setState('idle');
        this.emit('land', this.surface);
      }
    }
  }

  tickWalk(dt) {
    if (this.walkTarget === null) {
      this.setState('idle');
      return;
    }
    const dx = this.walkTarget - this.pos.x;
    const dir = Math.sign(dx);
    if (dir && dir !== this.facing) {
      this.facing = dir;
      this.emit('facing', dir);
    }
    const step = this.walkSpeed * dt * dir;
    if (Math.abs(dx) <= Math.abs(step)) {
      this.pos.x = this.walkTarget;
      this.walkTarget = null;
      if (this.state === 'run') this.emit('caught');
      this.setState('idle');
    } else {
      this.pos.x += step;
    }
  }

  tickCling(dt) {
    const wa = this.workArea();
    this.clingPhase += dt * 0.5;
    // wobble + slow gravity drift; let go once the feet near the floor
    this.pos.y += (Math.sin(this.clingPhase) * 14 + CLING_SLIDE) * dt;
    this.pos.y = Math.max(this.pos.y, wa.y + 24);
    if (this.pos.y >= wa.y + wa.height - this.h + this.feetPad - 20) this.beginFall();
  }

  tickIdle(dt) {
    if (this.attached) {
      // keep glued to the window even between watcher ticks
      const rect = this.attached.rect;
      if (rect) {
        this.pos.y = rect.top - (this.h - this.feetPad);
      }
    } else if (this.surface.type === 'floor') {
      this.pos.y = this.floorY;
    }
  }
}

module.exports = { PetBody };
