'use strict';

/**
 * Minimal Win32 bridge used to find the top edge (title bar) of the window
 * the user is currently working in, so the pet can sit on it.
 *
 * Everything degrades gracefully: if koffi or user32 cannot be loaded the
 * app still runs (the pet then only knows about the screen edges, floor and
 * taskbar).
 */

let api = null;

try {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');

  const RECT = koffi.struct('RECT', {
    left: 'long',
    top: 'long',
    right: 'long',
    bottom: 'long',
  });

  const GetForegroundWindow = user32.func('uint64 GetForegroundWindow()');
  const GetWindowRect = user32.func('bool GetWindowRect(uint64 hwnd, _Out_ RECT *rect)');
  const IsWindow = user32.func('bool IsWindow(uint64 hwnd)');
  const IsWindowVisible = user32.func('bool IsWindowVisible(uint64 hwnd)');
  const IsIconic = user32.func('bool IsIconic(uint64 hwnd)');

  api = {
    foreground() {
      const handle = GetForegroundWindow();
      return handle ? BigInt(handle) : 0n;
    },
    rect(hwnd) {
      const out = { left: 0, top: 0, right: 0, bottom: 0 };
      const ok = GetWindowRect(hwnd, out);
      if (!ok) return null;
      const width = out.right - out.left;
      const height = out.bottom - out.top;
      if (width <= 0 || height <= 0) return null;
      return { left: out.left, top: out.top, right: out.right, bottom: out.bottom, width, height };
    },
    isWindow(hwnd) {
      return !!IsWindow(hwnd);
    },
    isVisible(hwnd) {
      return !!IsWindowVisible(hwnd);
    },
    isMinimized(hwnd) {
      return !!IsIconic(hwnd);
    },
  };
} catch (err) {
  console.warn('[win32] native window tracking unavailable:', err.message);
}

module.exports = {
  available: !!api,
  foreground: () => (api ? api.foreground() : 0n),
  rect: (hwnd) => (api ? api.rect(hwnd) : null),
  isWindow: (hwnd) => (api ? api.isWindow(hwnd) : false),
  isVisible: (hwnd) => (api ? api.isVisible(hwnd) : false),
  isMinimized: (hwnd) => (api ? api.isMinimized(hwnd) : false),
};
