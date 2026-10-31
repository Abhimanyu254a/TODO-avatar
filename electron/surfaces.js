'use strict';

const win32 = require('./win32');

/**
 * Polls the foreground window so the pet knows what it could sit on.
 * Rectangles are returned in *physical* pixels; the main process converts
 * them to DIP before handing them to the physics body.
 */
class SurfaceWatcher {
  constructor({ interval = 450 } = {}) {
    this.interval = interval;
    this.timer = null;
    this.foreground = null;
    this.tick = this.tick.bind(this);
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(this.tick, this.interval);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (!win32.available) return;
    const hwnd = win32.foreground();
    if (!hwnd) {
      this.foreground = null;
      return;
    }
    const rect = win32.rect(hwnd);
    if (!rect || win32.isMinimized(hwnd) || !win32.isVisible(hwnd)) {
      this.foreground = null;
      return;
    }
    // Ignore tiny utility windows / tooltips.
    if (rect.width < 200 || rect.height < 100) {
      this.foreground = null;
      return;
    }
    this.foreground = { hwnd, rect, seenAt: Date.now() };
  }

  /** Fresh rect for a specific window (used to ride a window around). */
  rectOf(hwnd) {
    if (!win32.available || !hwnd) return null;
    if (win32.isMinimized(hwnd) || !win32.isVisible(hwnd) || !win32.isWindow(hwnd)) return null;
    const rect = win32.rect(hwnd);
    if (!rect || rect.width < 200 || rect.height < 100) return null;
    return rect;
  }

  get available() {
    return win32.available;
  }
}

module.exports = { SurfaceWatcher };
