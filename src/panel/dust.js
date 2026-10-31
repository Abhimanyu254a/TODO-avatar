'use strict';

/**
 * Thanos-snap dust engine.
 *
 * The element is rasterised with html2canvas, sliced into tiny blocks
 * (2x2 px where affordable, a little larger for tall rows), and every opaque
 * block becomes a particle that is blown away with velocity + noise drift.
 * Grains are released in a ragged left-to-right sweep, then each fades
 * linearly over LIFE ms.
 */
(function () {
  const canvas = document.getElementById('dust');
  const ctx = canvas.getContext('2d', { alpha: true });

  let dpr = 1;
  let viewW = 0;
  let viewH = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // Cheap value noise, enough to make ash wander.
  function hash(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return ((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v) * 2 - 1;
  }

  const bursts = [];
  let raf = null;
  let lastTs = 0;

  const STAGGER = 420; // ms for the crumble to sweep left -> right across the row
  const JITTER = 140; // ms of random release delay so the edge is ragged
  const LIFE = 850; // ms each grain fades over: alpha = 1 - t / LIFE
  const DURATION = STAGGER + JITTER + LIFE;
  const GRAVITY = 320; // px / s^2

  function frame(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;

    ctx.clearRect(0, 0, viewW, viewH);

    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const burst = bursts[i];
      const age = ts - burst.start;
      const p = age / DURATION;

      if (p >= 1) {
        bursts.splice(i, 1);
        continue;
      }

      // Opening flash
      if (age < 240) {
        const f = 1 - age / 240;
        const g = ctx.createRadialGradient(
          burst.cx,
          burst.cy,
          0,
          burst.cx,
          burst.cy,
          Math.max(burst.w, burst.h) * 0.85
        );
        g.addColorStop(0, `rgba(214, 196, 255, ${0.55 * f})`);
        g.addColorStop(0.5, `rgba(168, 140, 255, ${0.22 * f})`);
        g.addColorStop(1, 'rgba(120, 90, 220, 0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(burst.cx - burst.w, burst.cy - burst.h, burst.w * 2, burst.h * 2);
      }

      for (const pt of burst.particles) {
        const t = age - pt.delay;
        if (t >= LIFE) continue;
        ctx.fillStyle = pt.color;
        if (t < 0) {
          // not released yet: hold the grain where the row used to be
          ctx.globalAlpha = 1;
          ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
          continue;
        }
        pt.vx += noise(pt.seed + pt.x * 0.01, ts * 0.0011) * 300 * dt;
        pt.vx *= 1 - 1.4 * dt;
        pt.vy += GRAVITY * dt;

        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;

        ctx.globalAlpha = 1 - t / LIFE;
        ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
      }
    }

    ctx.globalAlpha = 1;

    if (bursts.length > 0) {
      raf = requestAnimationFrame(frame);
    } else {
      raf = null;
      ctx.clearRect(0, 0, viewW, viewH);
    }
  }

  function startLoop() {
    if (raf) return;
    lastTs = performance.now();
    raf = requestAnimationFrame(frame);
  }

  async function snap(element, { onCapture } = {}) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      onCapture?.();
      return;
    }

    let shot = null;
    try {
      shot = await window.html2canvas(element, {
        backgroundColor: null,
        scale: 1,
        logging: false,
        useCORS: true,
      });
    } catch (err) {
      console.warn('[dust] raster failed, using a plain burst:', err);
    }

    onCapture?.();

    // If rasterisation failed, fall back to a small burst from the centre.
    let particles = [];
    let srcW = rect.width;
    let srcH = rect.height;

    if (shot && shot.width > 0 && shot.height > 0) {
      srcW = shot.width;
      srcH = shot.height;
      const off = document.createElement('canvas');
      off.width = shot.width;
      off.height = shot.height;
      const octx = off.getContext('2d');
      octx.drawImage(shot, 0, 0);
      const data = octx.getImageData(0, 0, shot.width, shot.height).data;

      // 2x2 blocks when it stays affordable, otherwise step up.
      let block = 2;
      while ((srcW / block) * (srcH / block) > 2600) block += 1;

      const sx = rect.width / shot.width;
      const sy = rect.height / shot.height;
      const mid = rect.width / 2;

      for (let by = 0; by < shot.height; by += block) {
        for (let bx = 0; bx < shot.width; bx += block) {
          const cy = Math.min(shot.height - 1, by + (block >> 1));
          const cx = Math.min(shot.width - 1, bx + (block >> 1));
          const idx = (cy * shot.width + cx) * 4;
          const a = data[idx + 3];
          if (a < 22) continue;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          const px = rect.left + bx * sx;
          const py = rect.top + by * sy;

          // Warm ash tint so purple UI dust still reads as "Thanos".
          const tr = Math.round(r * 0.72 + 196 * 0.28);
          const tg = Math.round(g * 0.72 + 178 * 0.28);
          const tb = Math.round(b * 0.72 + 168 * 0.28);

          particles.push({
            x: px,
            y: py,
            vx: ((px - rect.left - mid) / Math.max(1, rect.width)) * 320 + (Math.random() * 180 - 90),
            vy: -50 - Math.random() * 210,
            color: `rgba(${tr}, ${tg}, ${tb}, ${(a / 255) * 0.95})`,
            size: block * Math.max(sx, sy),
            seed: Math.random() * 1000,
            delay: ((px - rect.left) / rect.width) * STAGGER + Math.random() * JITTER,
          });
        }
      }
    }

    if (particles.length === 0) {
      for (let i = 0; i < 260; i += 1) {
        const px = rect.left + Math.random() * rect.width;
        const py = rect.top + Math.random() * rect.height;
        particles.push({
          x: px,
          y: py,
          vx: (Math.random() - 0.5) * 320,
          vy: -60 - Math.random() * 200,
          color: `rgba(190, 178, 205, ${0.35 + Math.random() * 0.5})`,
          size: 2 + Math.random() * 2,
          seed: Math.random() * 1000,
          delay: ((px - rect.left) / rect.width) * STAGGER + Math.random() * JITTER,
        });
      }
    }

    bursts.push({
      start: performance.now(),
      particles,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      w: rect.width,
      h: rect.height,
    });

    startLoop();

    return new Promise((resolve) => {
      setTimeout(resolve, DURATION + 60);
    });
  }

  window.Dust = { snap };
})();
