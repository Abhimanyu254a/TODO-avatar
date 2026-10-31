// node test/physics.check.js — fails loudly if wall-slide or window-riding breaks.
const assert = require('node:assert');
const { PetBody } = require('../electron/physics');

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const make = (fg = null) => {
  const b = new PetBody({ width: 262, height: 242, feetPad: 14, bodyWidth: 98, getWorkArea: () => WA, getForeground: () => fg });
  b.spawnOnFloor();
  return b;
};
const run = (b, secs) => { for (let i = 0; i < secs * 60; i++) b.tick(1 / 60); };

// Wall cling slowly slides down, lets go, lands on the floor.
let b = make();
b.pos.y = 300; b.snapToWall(-1);
run(b, 1);
assert.strictEqual(b.state, 'cling');
const y0 = b.pos.y; run(b, 20);
assert.ok(b.pos.y > y0, 'should drift down');
run(b, 200);
assert.strictEqual(b.surface.type, 'floor');
assert.strictEqual(b.pos.y, b.floorY);

// Riding a window; maximizing it drops the pet to the floor.
const rect = { left: 400, top: 300, right: 1400, bottom: 900, width: 1000, height: 600 };
b = make({ hwnd: 1n, rect });
b.pos = { x: 600, y: 300 - 228 - 20 }; b.beginFall();
run(b, 1);
assert.strictEqual(b.surface.type, 'window');
b.followAttached({ ...rect, left: 500, right: 1500 });
assert.strictEqual(b.pos.x, 700, 'rides along');
const maxed = { left: -8, top: -8, right: 1928, bottom: 1048, width: 1936, height: 1056 };
b.getForeground = () => ({ hwnd: 1n, rect: maxed });
b.followAttached(maxed);
run(b, 2);
assert.strictEqual(b.surface.type, 'floor');

// Chasing the cursor: runs there, faces it, reports 'caught', goes idle.
b = make();
let caught = false; b.on('caught', () => { caught = true; });
assert.ok(b.startChase(200));
assert.strictEqual(b.state, 'run');
run(b, 0.1);
assert.strictEqual(b.facing, -1, 'faces the cursor');
run(b, 5);
assert.ok(caught && b.state === 'idle');
assert.strictEqual(b.pos.x, 200 - 131);
console.log('physics ok');
