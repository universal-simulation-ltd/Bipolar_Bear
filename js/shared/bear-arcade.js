/**
 * @file js/shared/bear-arcade.js — the 🕹️ Bear Arcade.
 *
 * Loaded on the first tap of the dock's game button (`openArcade()` in
 * fab.js), so pages that never open it don't download it. Each open picks a
 * random retro game, never the one played last, drawn with the mood bears
 * (images/moods/sm/*) and the mood colours the journal uses:
 *
 *   snake  — Bear Snake: eat mood bears; each one adds a segment in its colour.
 *   flappy — Flappy Bear: fly through the gaps between the highs (red/orange
 *            pillars from the top) and the lows (purple/blue from the bottom).
 *   bricks — Bear Bricks: breakout with one row of bricks per mood.
 *   balance — Stay Stable: hold to lift, let go to sink, while a growing mood
 *            swing and life events (☕ 🎉 ⚡ up, 🌧️ 🥀 📉 down, 💊 😴 calm) push
 *            the bear around a manic-to-depressed scale. Points for time in the
 *            green; too long at either extreme ends it. The bear's path draws a
 *            mood chart behind it.
 *   catch  — Self-care Catch: catch what keeps you steady (💊 😴 💧 🥗 🚶 📔 🎧),
 *            dodge the triggers (⏰ all-nighter, 📱 3 am scrolling, ☕, ⚡ stress).
 *            Missing a good thing costs nothing; catching a trigger costs a life.
 *   sleep  — Sleep Guard: tap the things that would wake the sleeping bear
 *            (⏰ 📱 ☕ 🔔 💡 📺) before they reach it; 8 hours finishes a night.
 *   says   — Bear Says: Simon with four mood bears; one more each round.
 *   pairs  — Mood Pairs: card-flip memory. A bear is lost only for a mismatch
 *            when the first card's partner had already been seen.
 *   week   — Mood Week: a week of moods shows for a moment; fill it back in,
 *            in order. Weeks grow from 3 days to 7, then show for less time.
 *
 * To add a game, write a factory like `_snake(W, H)` that returns
 * `{ score, over, update(dt), draw(ctx, state) }` plus any of `idle(dt)`,
 * `start()`, `down(x, y)`, `move(x, y)`, `up()`, `key(k)`, `keyUp(k)`, and
 * list it in `GAMES`.
 *
 * Exposes `BB.arcade.open({ onHide })` and `BB.arcade.close()`. `onHide`
 * (fab.js) adds the "Hide this button" link, as on every other dock button.
 *
 * localStorage: `bbArcade` = `{"last":"snake","best":{"snake":12,…}}` —
 * device-only, never synced; cleared on the full reset lists.
 */
(function () {
  'use strict';

  window.BB = window.BB || {};

  const MOODS = ['manic', 'elevated', 'stable', 'low', 'depressed'];
  const COLORS = { manic: '#ff4444', elevated: '#ff9500', stable: '#51cf66', low: '#845ef7', depressed: '#5c7cfa' };
  const BG = '#14121f';
  const FONT = '700 {px}px ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  const _img = {};
  MOODS.forEach(m => { const i = new Image(); i.src = 'images/moods/sm/' + m + '.png'; _img[m] = i; });

  /** Translate `arcade.<key>`, falling back to the English text. */
  function _t(key, fallback, vars) {
    const k = 'arcade.' + key;
    const v = (window.BB && BB.t) ? BB.t(k, vars) : null;
    if (v && v !== k) return v;
    return vars ? fallback.replace(/\{(\w+)\}/g, (_, n) => vars[n]) : fallback;
  }

  function _load() {
    try { return JSON.parse(localStorage.getItem('bbArcade')) || {}; } catch (_) { return {}; }
  }
  function _save(d) {
    try { localStorage.setItem('bbArcade', JSON.stringify(d)); } catch (_) { /* private mode */ }
  }

  // ── Drawing helpers ───────────────────────────────────────────────────────

  function _rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Draw a mood bear centred on (x, y), `size` across; a coloured disc until the image loads. */
  function _bear(ctx, mood, x, y, size, rot) {
    const i = _img[mood];
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    if (i && i.complete && i.naturalWidth) {
      ctx.drawImage(i, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = COLORS[mood];
      ctx.beginPath(); ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function _text(ctx, str, x, y, px, color, align) {
    ctx.font = FONT.replace('{px}', Math.round(px));
    ctx.fillStyle = color;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  function _emoji(ctx, ch, x, y, size) {
    // Colour emoji take the fill's alpha, so draw them with an opaque fill.
    ctx.fillStyle = '#fff';
    ctx.font = Math.round(size) + 'px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y);
  }

  const _clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const _rand = (a, b) => a + Math.random() * (b - a);

  // ── Bear Snake ────────────────────────────────────────────────────────────

  function _snake(W, H) {
    const cols = 15;
    const cell = Math.floor(Math.min(W / cols, H / 10));
    const rows = Math.max(8, Math.floor(H / cell));
    const ox = Math.floor((W - cols * cell) / 2), oy = Math.floor((H - rows * cell) / 2);
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const cy = Math.floor(rows / 2);
    // Positions, head first. `tint[i]` colours body segment i + 1, so a
    // colour stays with its place in the snake as it moves.
    const body = [[6, cy], [5, cy], [4, cy]];
    const tint = ['stable', 'stable'];
    let dir = DIRS.right, queue = [], acc = 0, interval = 0.16, head = 'stable', t = 0;
    let food = null, swipe = null;

    function place() {
      let x, y;
      do { x = Math.floor(Math.random() * cols); y = Math.floor(Math.random() * rows); }
      while (body.some(b => b[0] === x && b[1] === y));
      food = { x: x, y: y, mood: MOODS[Math.floor(Math.random() * MOODS.length)] };
    }
    place();

    function turn(d) {
      const last = queue.length ? queue[queue.length - 1] : dir;
      if (queue.length >= 3 || (d[0] === -last[0] && d[1] === -last[1]) || d === last) return;
      queue.push(d);
    }

    function step() {
      if (queue.length) dir = queue.shift();
      const nx = body[0][0] + dir[0], ny = body[0][1] + dir[1];
      const eats = food.x === nx && food.y === ny;
      const solid = eats ? body : body.slice(0, -1);
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || solid.some(b => b[0] === nx && b[1] === ny)) {
        g.over = true;
        return;
      }
      body.unshift([nx, ny]);
      if (eats) {
        tint.unshift(food.mood);
        head = food.mood;
        g.score++;
        interval = Math.max(0.075, interval - 0.004);
        place();
      } else {
        body.pop();
      }
    }

    const keys = { ArrowUp: 'up', w: 'up', ArrowDown: 'down', s: 'down', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
    const g = {
      score: 0, over: false,
      idle(dt) { t += dt; },
      update(dt) {
        t += dt; acc += dt;
        while (acc >= interval && !g.over) { acc -= interval; step(); }
      },
      down(x, y) { swipe = [x, y]; },
      move(x, y) {
        if (!swipe) return;
        const dx = x - swipe[0], dy = y - swipe[1];
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
        turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? DIRS.right : DIRS.left) : (dy > 0 ? DIRS.down : DIRS.up));
        swipe = [x, y];
      },
      up() { swipe = null; },
      key(k) { const d = keys[k.length === 1 ? k.toLowerCase() : k]; if (d) turn(DIRS[d]); return !!d; },
      draw(ctx) {
        ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            ctx.fillStyle = (x + y) % 2 ? '#1c1930' : '#211d38';
            ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
          }
        }
        _bear(ctx, food.mood, ox + (food.x + 0.5) * cell, oy + (food.y + 0.5) * cell, cell * (1.1 + Math.sin(t * 6) * 0.07));
        for (let i = body.length - 1; i >= 1; i--) {
          ctx.fillStyle = COLORS[tint[i - 1]];
          _rrect(ctx, ox + body[i][0] * cell + 2, oy + body[i][1] * cell + 2, cell - 4, cell - 4, cell * 0.3);
          ctx.fill();
        }
        _bear(ctx, head, ox + (body[0][0] + 0.5) * cell, oy + (body[0][1] + 0.5) * cell, cell * 1.35);
      },
    };
    return g;
  }

  // ── Flappy Bear ───────────────────────────────────────────────────────────

  function _flappy(W, H) {
    const s = H / 600;
    const GRAV = 1700 * s, FLAP = -480 * s, R = 20 * s, X = W * 0.3;
    const PW = Math.max(46, 62 * s), SPACING = Math.max(200 * s, PW * 3.4), GROUND = H - 26 * s;
    const stars = Array.from({ length: 36 }, () => [Math.random() * W, Math.random() * GROUND, Math.random() * 1.6 + 0.4]);
    let y = H * 0.45, vy = 0, t = 0, speed = 150 * s, scroll = 0;
    const pipes = [];

    function gap() { return Math.max(132 * s, 190 * s - g.score * 2.5 * s); }
    function addPipe(x) {
      const gp = gap(), margin = 46 * s;
      pipes.push({ x: x, top: margin + Math.random() * (GROUND - gp - margin * 2), gap: gp, scored: false });
    }
    function flap() { vy = FLAP; }

    function pillar(ctx, x, y0, y1, c0, c1, capY, mood) {
      const grad = ctx.createLinearGradient(0, y0, 0, y1);
      grad.addColorStop(0, c0); grad.addColorStop(1, c1);
      ctx.fillStyle = grad;
      ctx.fillRect(x, y0, PW, y1 - y0);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + PW * 0.14, y0, PW * 0.12, y1 - y0);
      ctx.fillStyle = mood === 'manic' ? c1 : c0;
      _rrect(ctx, x - 5 * s, capY - 11 * s, PW + 10 * s, 22 * s, 7 * s);
      ctx.fill();
      _bear(ctx, mood, x + PW / 2, capY, PW * 0.62);
    }

    const g = {
      score: 0, over: false,
      idle(dt) { t += dt; y = H * 0.45 + Math.sin(t * 3) * 8 * s; scroll += 30 * s * dt; },
      start() { addPipe(W + 60 * s); flap(); },
      update(dt) {
        t += dt; scroll += speed * dt;
        vy += GRAV * dt; y += vy * dt;
        if (y < R) { y = R; vy = 0; }
        if (y + R * 0.8 > GROUND) { y = GROUND - R * 0.8; g.over = true; return; }
        pipes.forEach(p => { p.x -= speed * dt; });
        if (pipes.length && pipes[0].x + PW < -10 * s) pipes.shift();
        if (!pipes.length || pipes[pipes.length - 1].x < W - SPACING) addPipe((pipes.length ? pipes[pipes.length - 1].x : W) + SPACING);
        const hit = R * 0.78;
        for (const p of pipes) {
          if (!p.scored && p.x + PW < X - hit) { p.scored = true; g.score++; speed += 2 * s; }
          if (X + hit > p.x && X - hit < p.x + PW && (y - hit < p.top || y + hit > p.top + p.gap)) { g.over = true; return; }
        }
      },
      down() { flap(); },
      key(k) { if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') { flap(); return true; } return false; },
      draw(ctx) {
        const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
        sky.addColorStop(0, '#2a1f3d'); sky.addColorStop(1, BG);
        ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        stars.forEach(st => {
          const sx = ((st[0] - scroll * 0.08 * st[2]) % W + W) % W;
          ctx.fillRect(sx, st[1], st[2], st[2]);
        });
        for (const p of pipes) {
          ctx.fillStyle = 'rgba(81,207,102,0.07)';
          ctx.fillRect(p.x, p.top, PW, p.gap);
          pillar(ctx, p.x, 0, p.top, COLORS.manic, COLORS.elevated, p.top, 'manic');
          pillar(ctx, p.x, p.top + p.gap, GROUND, COLORS.low, COLORS.depressed, p.top + p.gap, 'depressed');
        }
        ctx.fillStyle = '#231e36'; ctx.fillRect(0, GROUND, W, H - GROUND);
        ctx.fillStyle = COLORS.stable; ctx.fillRect(0, GROUND, W, 3 * s);
        const mood = y < H * 0.3 ? 'elevated' : y > H * 0.62 ? 'low' : 'stable';
        _bear(ctx, mood, X, y, R * 2.5, _clamp(vy / (900 * s), -0.45, 0.9));
      },
    };
    return g;
  }

  // ── Bear Bricks ───────────────────────────────────────────────────────────

  function _bricks(W, H) {
    const s = Math.min(W / 360, H / 560);
    const COLS = 7, PAD = 12 * s, GAP = 6 * s;
    const BW = (W - PAD * 2 - GAP * (COLS - 1)) / COLS, BH = Math.max(14, 21 * s), TOP = 58 * s;
    const PADW = 86 * s, PADH = 12 * s, PADY = H - 48 * s, R = 11 * s;
    let px = W / 2, lives = 3, level = 1, speed = 330 * s, stuck = true, mood = 'stable', spin = 0;
    let bricks = [], ball = { x: 0, y: 0, vx: 0, vy: 0 };
    const held = { left: false, right: false };

    function build() {
      bricks = [];
      MOODS.forEach((m, r) => {
        for (let c = 0; c < COLS; c++) bricks.push({ x: PAD + c * (BW + GAP), y: TOP + r * (BH + GAP), mood: m, alive: true });
      });
    }
    function serve() { stuck = true; ball = { x: px, y: PADY - R - 1, vx: 0, vy: 0 }; }
    function launch() {
      if (!stuck) return;
      stuck = false;
      const a = _rand(-0.35, 0.35);
      ball.vx = speed * Math.sin(a); ball.vy = -speed * Math.cos(a);
    }
    function aim(x) { px = _clamp(x, PADW / 2, W - PADW / 2); }
    build(); serve();

    function sub(h) {
      ball.x += ball.vx * h; ball.y += ball.vy * h;
      if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); }
      if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); }
      if (ball.y < R) { ball.y = R; ball.vy = Math.abs(ball.vy); }
      if (ball.vy > 0 && ball.y + R >= PADY && ball.y - R <= PADY + PADH &&
          ball.x >= px - PADW / 2 - R && ball.x <= px + PADW / 2 + R) {
        // A little random spin, so a dead-centre hit can't bounce straight up
        // and down an emptied column for ever.
        const a = _clamp((ball.x - px) / (PADW / 2), -1, 1) * 1.05 + _rand(-0.08, 0.08);
        ball.vx = speed * Math.sin(a); ball.vy = -speed * Math.cos(a);
        ball.y = PADY - R;
      }
      if (ball.y - R > H) {
        lives--;
        if (lives <= 0) g.over = true; else serve();
        return;
      }
      for (const b of bricks) {
        if (!b.alive) continue;
        const cx = _clamp(ball.x, b.x, b.x + BW), cy = _clamp(ball.y, b.y, b.y + BH);
        const dx = ball.x - cx, dy = ball.y - cy;
        if (dx * dx + dy * dy > R * R) continue;
        b.alive = false; mood = b.mood; g.score++;
        // Bounce off whichever face the ball is least far into.
        const ox = Math.min(ball.x + R - b.x, b.x + BW - (ball.x - R));
        const oy = Math.min(ball.y + R - b.y, b.y + BH - (ball.y - R));
        if (ox < oy) ball.vx = -ball.vx; else ball.vy = -ball.vy;
        break;
      }
      if (bricks.every(b => !b.alive)) {
        level++; speed *= 1.1;
        build(); serve();
      }
    }

    const g = {
      score: 0, over: false,
      idle() { if (stuck) ball.x = px; },
      update(dt) {
        if (held.left) aim(px - 430 * s * dt);
        if (held.right) aim(px + 430 * s * dt);
        if (stuck) { ball.x = px; return; }
        spin += dt * (ball.vx > 0 ? 4 : -4);
        const n = Math.ceil(speed * dt / (R * 0.5));
        for (let i = 0; i < n && !g.over && !stuck; i++) sub(dt / n);
      },
      down(x) { aim(x); launch(); },
      move(x) { aim(x); },
      key(k) {
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') { held.left = true; return true; }
        if (k === 'ArrowRight' || k === 'd' || k === 'D') { held.right = true; return true; }
        if (k === ' ' || k === 'ArrowUp') { launch(); return true; }
        return false;
      },
      keyUp(k) {
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') held.left = false;
        if (k === 'ArrowRight' || k === 'd' || k === 'D') held.right = false;
      },
      draw(ctx) {
        ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
        for (const b of bricks) {
          if (!b.alive) continue;
          ctx.fillStyle = COLORS[b.mood];
          _rrect(ctx, b.x, b.y, BW, BH, 5 * s); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          _rrect(ctx, b.x + 2, b.y + 2, BW - 4, BH * 0.35, 3 * s); ctx.fill();
          _bear(ctx, b.mood, b.x + BW / 2, b.y + BH / 2, BH * 0.95);
        }
        for (let i = 0; i < lives; i++) _bear(ctx, 'stable', PAD + 11 * s + i * 24 * s, 26 * s, 20 * s);
        _text(ctx, _t('level', 'Level {n}', { n: level }), W - PAD, 26 * s, 13 * s, '#bdb6d6', 'right');
        const pg = ctx.createLinearGradient(0, PADY, 0, PADY + PADH);
        pg.addColorStop(0, '#ffb340'); pg.addColorStop(1, '#e07b00');
        ctx.fillStyle = pg;
        _rrect(ctx, px - PADW / 2, PADY, PADW, PADH, PADH / 2); ctx.fill();
        _bear(ctx, mood, ball.x, ball.y, R * 2.4, spin);
      },
    };
    return g;
  }

  // ── Stay Stable ───────────────────────────────────────────────────────────

  function _balance(W, H) {
    const s = H / 600;
    // The mood scale, top to bottom, as fractions of the height.
    const BANDS = [['manic', 0.14], ['elevated', 0.18], ['stable', 0.36], ['low', 0.18], ['depressed', 0.14]];
    let edge = 0;
    const bands = BANDS.map(b => { const top = edge * H; edge += b[1]; return { mood: b[0], top: top, bottom: edge * H }; });
    const X = W * 0.32, R = 20 * s;
    const LIFT = 820 * s, SINK = 620 * s, MAXV = 520 * s;
    const PUSH = { up: ['☕', '🎉', '⚡'], down: ['🌧️', '🥀', '📉'], calm: ['💊', '😴'] };
    let y = H / 2, vy = 0, t = 0, phase = 0, holding = false, calm = 0, steady = 1, inStable = 0, spawn = 1.2;
    const events = [], trail = [];

    function bandAt(py) { return bands.find(b => py < b.bottom) || bands[bands.length - 1]; }
    function speed() { return (140 + Math.min(t, 120) * 1.5) * s; }
    function addEvent() {
      const r = Math.random();
      const kind = r < 0.2 ? 'calm' : r < 0.6 ? 'up' : 'down';
      const list = PUSH[kind];
      events.push({ x: W + 24 * s, y: _rand(0.08, 0.92) * H, kind: kind, ch: list[Math.floor(Math.random() * list.length)] });
    }

    const g = {
      score: 0, over: false,
      idle(dt) { t += dt * 0.25; y = H / 2 + Math.sin(t * 6) * 10 * s; },
      start() { t = 0; phase = 0; },
      update(dt) {
        t += dt;
        // A slow mood swing with a faster ripple on top. Both grow stronger and
        // quicker the longer you play, until no one can hold it for ever.
        const amp = Math.min(950, 140 + t * 9) * s * (calm > 0 ? 0.2 : 1);
        phase += dt * (1 + Math.min(t, 150) / 120);
        const swing = amp * Math.sin(phase * 0.85) + amp * 0.45 * Math.sin(phase * 2.2 + 1);
        vy += ((holding ? -LIFT : SINK) * (calm > 0 ? 0.6 : 1) + swing) * dt;
        vy *= 1 - Math.min(1, 1.6 * dt);
        vy = _clamp(vy, -MAXV, MAXV);
        y += vy * dt;
        if (y < R) { y = R; vy = 0; }
        if (y > H - R) { y = H - R; vy = 0; }
        calm = Math.max(0, calm - dt);

        const v = speed();
        spawn -= dt;
        if (spawn <= 0) { addEvent(); spawn = Math.max(0.55, 1.5 - t * 0.012) * _rand(0.7, 1.3); }
        for (let i = events.length - 1; i >= 0; i--) {
          const e = events[i];
          e.x -= v * dt;
          const dx = e.x - X, dy = e.y - y;
          if (dx * dx + dy * dy < (R + 16 * s) * (R + 16 * s)) {
            if (e.kind === 'calm') { calm = 3.5; vy *= 0.3; }
            else vy += (e.kind === 'up' ? -1 : 1) * (380 + Math.min(t, 120) * 2) * s;
            events.splice(i, 1);
          } else if (e.x < -30 * s) {
            events.splice(i, 1);
          }
        }
        trail.forEach(p => { p[0] -= v * dt; });
        trail.push([X, y]);
        while (trail.length && trail[0][0] < 0) trail.shift();

        const m = bandAt(y).mood;
        if (m === 'stable') { inStable += dt; steady = Math.min(1, steady + dt / 6); }
        else if (m === 'manic' || m === 'depressed') steady -= dt / 2.5;
        g.score = Math.floor(inStable);
        if (steady <= 0) { steady = 0; g.over = true; }
      },
      down() { holding = true; },
      up() { holding = false; },
      key(k) { if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') { holding = true; return true; } return false; },
      keyUp(k) { if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') holding = false; },
      draw(ctx) {
        ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
        bands.forEach(b => {
          ctx.globalAlpha = b.mood === 'stable' ? 0.2 : 0.14;
          ctx.fillStyle = COLORS[b.mood];
          ctx.fillRect(0, b.top, W, b.bottom - b.top);
          ctx.globalAlpha = 1;
          _bear(ctx, b.mood, 16 * s, (b.top + b.bottom) / 2, 22 * s);
        });
        const st = bands[2];
        ctx.strokeStyle = 'rgba(81,207,102,0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6 * s, 6 * s]);
        ctx.beginPath(); ctx.moveTo(0, st.top); ctx.lineTo(W, st.top); ctx.moveTo(0, st.bottom); ctx.lineTo(W, st.bottom); ctx.stroke();
        ctx.setLineDash([]);
        if (trail.length > 1) {
          ctx.strokeStyle = 'rgba(255,255,255,0.55)';
          ctx.lineWidth = 3 * s;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          trail.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
          ctx.stroke();
        }
        events.forEach(e => _emoji(ctx, e.ch, e.x, e.y, 30 * s));
        if (calm > 0) {
          ctx.strokeStyle = 'rgba(81,207,102,' + (0.4 + 0.4 * Math.sin(t * 10)) + ')';
          ctx.lineWidth = 3 * s;
          ctx.beginPath(); ctx.arc(X, y, R * 1.45, 0, Math.PI * 2); ctx.stroke();
        }
        _bear(ctx, bandAt(y).mood, X, y, R * 2.5);
        // Steadiness: drains at the extremes, refills in the green.
        const bw = W * 0.34, bx = W - bw - 12 * s, by = 12 * s;
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        _rrect(ctx, bx, by, bw, 8 * s, 4 * s); ctx.fill();
        ctx.fillStyle = steady > 0.35 ? COLORS.stable : COLORS.manic;
        _rrect(ctx, bx, by, bw * steady, 8 * s, 4 * s); ctx.fill();
      },
    };
    return g;
  }

  // ── Self-care Catch ───────────────────────────────────────────────────────

  function _catch(W, H) {
    const s = Math.min(W / 360, H / 600);
    const GOOD = ['💊', '😴', '💧', '🥗', '🚶', '📔', '🎧'], BAD = ['⏰', '📱', '☕', '⚡'];
    const BY = H - 64 * s, BR = 30 * s, ITEM = 30 * s;
    let bx = W / 2, lives = 3, t = 0, fall = 150 * s, spawn = 0.5, hurt = 0, joy = 0;
    const held = { left: false, right: false }, items = [], pops = [];

    function aim(x) { bx = _clamp(x, BR, W - BR); }
    function addItem() {
      const good = Math.random() < Math.max(0.6, 0.75 - t * 0.002);
      const list = good ? GOOD : BAD;
      items.push({ x: _rand(ITEM, W - ITEM), y: -ITEM, good: good, ch: list[Math.floor(Math.random() * list.length)],
        vy: fall * _rand(0.85, 1.2), phase: Math.random() * 6 });
    }

    const g = {
      score: 0, over: false,
      idle(dt) { t += dt; },
      start() { t = 0; },
      update(dt) {
        t += dt;
        if (held.left) aim(bx - 430 * s * dt);
        if (held.right) aim(bx + 430 * s * dt);
        fall += 3.5 * s * dt;
        spawn -= dt;
        if (spawn <= 0) { addItem(); spawn = Math.max(0.32, 0.85 - t * 0.008); }
        hurt = Math.max(0, hurt - dt);
        joy = Math.max(0, joy - dt);
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          it.y += it.vy * dt;
          if (Math.abs(it.x - bx) < BR + ITEM * 0.4 && Math.abs(it.y - BY) < ITEM * 0.8) {
            if (it.good) { g.score++; joy = 0.35; pops.push({ x: it.x, y: BY - BR, txt: '+1', c: COLORS.stable, t: 0.8 }); }
            else { lives--; hurt = 0.7; pops.push({ x: it.x, y: BY - BR, txt: '−1', c: COLORS.manic, t: 0.8 }); }
            items.splice(i, 1);
          } else if (it.y > H + ITEM) {
            items.splice(i, 1);
          }
        }
        pops.forEach(p => { p.t -= dt; p.y -= 50 * s * dt; });
        while (pops.length && pops[0].t <= 0) pops.shift();
        if (lives <= 0) g.over = true;
      },
      down(x) { aim(x); },
      move(x) { aim(x); },
      key(k) {
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') { held.left = true; return true; }
        if (k === 'ArrowRight' || k === 'd' || k === 'D') { held.right = true; return true; }
        return false;
      },
      keyUp(k) {
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') held.left = false;
        if (k === 'ArrowRight' || k === 'd' || k === 'D') held.right = false;
      },
      draw(ctx) {
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#1c2140'); sky.addColorStop(1, BG);
        ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#231e36'; ctx.fillRect(0, BY + BR * 0.9, W, H - BY);
        ctx.fillStyle = COLORS.stable; ctx.fillRect(0, BY + BR * 0.9, W, 3 * s);
        items.forEach(it => {
          if (!it.good) {
            ctx.fillStyle = 'rgba(255,68,68,0.22)';
            ctx.beginPath(); ctx.arc(it.x + Math.sin(t * 3 + it.phase) * 3 * s, it.y, ITEM * 0.62, 0, Math.PI * 2); ctx.fill();
          }
          _emoji(ctx, it.ch, it.x + Math.sin(t * 3 + it.phase) * 3 * s, it.y, ITEM);
        });
        for (let i = 0; i < lives; i++) _bear(ctx, 'stable', 18 * s + i * 24 * s, 20 * s, 20 * s);
        const mood = hurt > 0 ? 'low' : 'stable';
        const bounce = joy > 0 ? Math.sin(joy / 0.35 * Math.PI) * 6 * s : 0;
        ctx.fillStyle = COLORS.elevated;
        _rrect(ctx, bx - BR * 1.15, BY + BR * 0.25, BR * 2.3, BR * 0.5, BR * 0.25); ctx.fill();
        _bear(ctx, mood, bx, BY - bounce, BR * 2.1, hurt > 0 ? Math.sin(hurt * 30) * 0.15 : 0);
        pops.forEach(p => {
          ctx.globalAlpha = Math.max(0, p.t / 0.8);
          _text(ctx, p.txt, p.x, p.y, 18 * s, p.c);
          ctx.globalAlpha = 1;
        });
      },
    };
    return g;
  }

  // ── Sleep Guard ───────────────────────────────────────────────────────────

  function _sleep(W, H) {
    const s = Math.min(W / 360, H / 600);
    const WAKERS = ['⏰', '📱', '☕', '🔔', '💡', '📺'];
    const cx = W / 2, cy = H * 0.56, BR = 36 * s, HOUR = 3.2, HIT = 34 * s;
    const stars = Array.from({ length: 40 }, () => [Math.random() * W, Math.random() * H * 0.8, Math.random() * 6]);
    let night = 1, hours = 0, lives = 3, speed = 55 * s, spawn = 1.2, t = 0, wake = 0, banner = 0;
    const items = [], pops = [];

    function addItem() {
      if (Math.random() < 0.12) {
        items.push({ sheep: true, ch: '🐑', x: -30 * s, y: _rand(0.12, 0.36) * H, vx: 70 * s, vy: 0 });
        return;
      }
      const a = Math.random() * Math.PI * 2, d = Math.hypot(W, H) * 0.55;
      const v = speed * _rand(0.8, 1.25);
      items.push({ ch: WAKERS[Math.floor(Math.random() * WAKERS.length)], x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
        vx: -Math.cos(a) * v, vy: -Math.sin(a) * v });
    }

    const g = {
      score: 0, over: false,
      idle(dt) { t += dt; },
      update(dt) {
        t += dt;
        wake = Math.max(0, wake - dt);
        pops.forEach(p => { p.t -= dt; p.y -= 40 * s * dt; });
        while (pops.length && pops[0].t <= 0) pops.shift();
        if (banner > 0) { banner -= dt; return; }
        hours += dt / HOUR;
        if (hours >= 8) {
          banner = 1.8; items.length = 0; night++; hours = 0; speed *= 1.15;
          g.score = (night - 1) * 8;
          return;
        }
        g.score = Math.floor((night - 1) * 8 + hours);
        spawn -= dt;
        if (spawn <= 0) { addItem(); spawn = Math.max(0.4, 1.3 - night * 0.12 - hours * 0.03) * _rand(0.7, 1.3); }
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i];
          it.x += it.vx * dt; it.y += it.vy * dt;
          if (it.sheep) { if (it.x > W + 30 * s) items.splice(i, 1); continue; }
          if (Math.hypot(it.x - cx, it.y - cy) < BR + 8 * s) {
            items.splice(i, 1);
            lives--; wake = 1;
            pops.push({ x: cx, y: cy - BR * 1.6, txt: '!', c: COLORS.manic, t: 0.8 });
            if (lives <= 0) g.over = true;
          }
        }
      },
      down(x, y) {
        let best = -1, bd = HIT;
        items.forEach((it, i) => { const d = Math.hypot(it.x - x, it.y - y); if (d < bd) { bd = d; best = i; } });
        if (best < 0) return;
        const it = items.splice(best, 1)[0];
        if (it.sheep) { hours = Math.min(7.99, hours + 0.5); pops.push({ x: it.x, y: it.y, txt: '+½', c: '#ffd43b', t: 0.8 }); }
        else pops.push({ x: it.x, y: it.y, txt: '✓', c: COLORS.stable, t: 0.6 });
      },
      draw(ctx) {
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#0d1030'); sky.addColorStop(1, BG);
        ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
        stars.forEach(st => {
          ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.35 * Math.sin(t * 1.5 + st[2])) + ')';
          ctx.fillRect(st[0], st[1], 2, 2);
        });
        // The moon fills its ring as the night's 8 hours go by.
        const mx = W - 44 * s, my = 46 * s;
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath(); ctx.arc(mx, my, 18 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0d1030';
        ctx.beginPath(); ctx.arc(mx + 8 * s, my - 5 * s, 15 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 4 * s;
        ctx.beginPath(); ctx.arc(mx, my, 26 * s, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffd43b';
        ctx.beginPath(); ctx.arc(mx, my, 26 * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, hours / 8)); ctx.stroke();
        for (let i = 0; i < lives; i++) _bear(ctx, 'stable', 18 * s + i * 24 * s, 20 * s, 20 * s);
        _text(ctx, _t('night', 'Night {n}', { n: night }), 12 * s, 46 * s, 13 * s, '#bdb6d6', 'left');
        ctx.fillStyle = 'rgba(132,94,247,0.18)';
        ctx.beginPath(); ctx.arc(cx, cy, BR * 1.9, 0, Math.PI * 2); ctx.fill();
        _bear(ctx, wake > 0 ? 'elevated' : 'stable', cx + (wake > 0 ? Math.sin(t * 50) * 3 * s : 0), cy, BR * 2.2);
        if (wake <= 0) _emoji(ctx, '💤', cx + BR * 1.1, cy - BR * 1.1 - Math.sin(t * 2) * 5 * s, 24 * s);
        items.forEach(it => {
          if (!it.sheep) {
            ctx.fillStyle = 'rgba(255,68,68,0.2)';
            ctx.beginPath(); ctx.arc(it.x, it.y, 20 * s, 0, Math.PI * 2); ctx.fill();
          }
          _emoji(ctx, it.ch, it.x, it.y, 30 * s);
        });
        pops.forEach(p => { ctx.globalAlpha = Math.max(0, p.t / 0.8); _text(ctx, p.txt, p.x, p.y, 20 * s, p.c); ctx.globalAlpha = 1; });
        if (banner > 0) _text(ctx, _t('nightDone', 'Night {n} slept 🌙', { n: night - 1 }), W / 2, H * 0.28, 20 * s, '#ffd43b');
      },
    };
    return g;
  }

  // ── Bear Says ─────────────────────────────────────────────────────────────

  function _says(W, H) {
    const s = Math.min(W / 360, H / 600);
    const PADS = ['manic', 'elevated', 'low', 'depressed'];
    const size = Math.min(W * 0.9, H * 0.7) * 0.46, gap = 14 * s, cx = W / 2, cy = H * 0.46;
    const rects = PADS.map((m, i) => ({ mood: m, x: cx - gap / 2 - size + (i % 2) * (size + gap), y: cy - gap / 2 - size + Math.floor(i / 2) * (size + gap) }));
    const seq = [];
    let mode = 'idle', idx = 0, timer = 0, lit = -1, litT = 0, wrong = -1, t = 0;

    function next() { seq.push(Math.floor(Math.random() * 4)); mode = 'watch'; idx = 0; timer = 0.7; }
    function press(i) {
      if (mode !== 'input') return;
      lit = i; litT = 0.22;
      if (i === seq[idx]) {
        idx++;
        if (idx === seq.length) { g.score = seq.length; mode = 'pause'; timer = 0.8; }
      } else {
        wrong = seq[idx]; mode = 'wrong'; timer = 0.9;
      }
    }

    const g = {
      score: 0, over: false,
      idle(dt) { t += dt; },
      start() { next(); },
      update(dt) {
        t += dt;
        litT -= dt;
        if (litT <= 0 && mode !== 'watch') lit = -1;
        timer -= dt;
        if (mode === 'watch') {
          const on = Math.max(0.28, 0.6 - seq.length * 0.025), off = 0.2;
          if (litT <= 0) lit = -1;
          if (timer <= 0) {
            if (idx < seq.length) { lit = seq[idx]; litT = on; timer = on + off; idx++; }
            else { mode = 'input'; idx = 0; lit = -1; }
          }
        } else if (mode === 'pause' && timer <= 0) next();
        else if (mode === 'wrong' && timer <= 0) g.over = true;
      },
      down(x, y) {
        const i = rects.findIndex(r => x >= r.x && x <= r.x + size && y >= r.y && y <= r.y + size);
        if (i >= 0) press(i);
      },
      key(k) { const i = '1234'.indexOf(k); if (i >= 0) { press(i); return true; } return false; },
      draw(ctx) {
        ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
        rects.forEach((r, i) => {
          const on = lit === i, bad = mode === 'wrong' && wrong === i && Math.sin(t * 20) > 0;
          ctx.globalAlpha = on || bad ? 1 : 0.32;
          if (on) { ctx.shadowColor = COLORS[r.mood]; ctx.shadowBlur = 30 * s; }
          ctx.fillStyle = COLORS[r.mood];
          _rrect(ctx, r.x, r.y, size, size, 22 * s); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.globalAlpha = on || bad ? 1 : 0.6;
          _bear(ctx, r.mood, r.x + size / 2, r.y + size / 2, size * (on ? 0.62 : 0.54));
          ctx.globalAlpha = 1;
        });
        ctx.fillStyle = BG;
        ctx.beginPath(); ctx.arc(cx, cy, 30 * s, 0, Math.PI * 2); ctx.fill();
        _text(ctx, String(seq.length), cx, cy, 22 * s, '#fff');
        const msg = mode === 'watch' ? _t('watch', 'Watch…') : mode === 'input' ? _t('yourTurn', 'Your turn') : '';
        if (msg) _text(ctx, msg, cx, cy + size + gap + 34 * s, 18 * s, mode === 'input' ? COLORS.stable : '#bdb6d6');
      },
    };
    return g;
  }

  // ── Mood Pairs ────────────────────────────────────────────────────────────

  function _pairs(W, H) {
    const s = Math.min(W / 360, H / 600);
    const FACES = MOODS.concat(['💊', '😴', '🎧']);
    const LEVELS = [[2, 3], [2, 4], [3, 4], [4, 4]];
    let level = 0, lives = 3, wait = 0, rebuild = 0, banner = 0, t = 0;
    let cards = [], open = [];
    const seen = new Set();

    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function build() {
      const [c, r] = LEVELS[Math.min(level, LEVELS.length - 1)];
      const faces = shuffle(FACES.slice()).slice(0, (c * r) / 2);
      const deck = shuffle(faces.concat(faces));
      const gap = 10 * s, top = 52 * s, availH = H - top - 16 * s;
      const cw = Math.min((W - 24 * s - gap * (c - 1)) / c, (availH - gap * (r - 1)) / r / 1.25);
      const ch = cw * 1.25, ox = (W - (cw * c + gap * (c - 1))) / 2, oy = top + (availH - (ch * r + gap * (r - 1))) / 2;
      cards = deck.map((f, i) => ({ face: f, x: ox + (i % c) * (cw + gap), y: oy + Math.floor(i / c) * (ch + gap), w: cw, h: ch, state: 'down', anim: 0 }));
      open = []; seen.clear();
    }
    build();

    function flip(card) {
      if (wait > 0 || rebuild > 0 || card.state !== 'down') return;
      card.state = 'up';
      open.push(card);
      if (open.length < 2) return;
      const [a, b] = open;
      if (a.face === b.face) {
        a.state = b.state = 'done'; open = []; g.score++;
        if (cards.every(c => c.state === 'done')) { level++; banner = 1.4; rebuild = 1.4; }
      } else {
        // Only a real slip costs a bear: the first card's match had been seen.
        const partner = cards.find(c => c !== a && c.face === a.face);
        if (seen.has(partner)) lives--;
        wait = 0.9;
      }
      seen.add(a); seen.add(b);
    }

    const g = {
      score: 0, over: false,
      idle(dt) { t += dt; },
      update(dt) {
        t += dt;
        cards.forEach(c => { const target = c.state === 'down' ? 0 : 1; c.anim += _clamp(target - c.anim, -dt * 6, dt * 6); });
        if (banner > 0) banner -= dt;
        if (rebuild > 0) { rebuild -= dt; if (rebuild <= 0) build(); return; }
        if (wait > 0) {
          wait -= dt;
          if (wait <= 0) {
            open.forEach(c => { c.state = 'down'; });
            open = [];
            if (lives <= 0) g.over = true;
          }
        }
      },
      down(x, y) { const c = cards.find(k => x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h); if (c) flip(c); },
      draw(ctx) {
        ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < lives; i++) _bear(ctx, 'stable', 18 * s + i * 24 * s, 22 * s, 20 * s);
        _text(ctx, _t('level', 'Level {n}', { n: level + 1 }), W - 12 * s, 22 * s, 13 * s, '#bdb6d6', 'right');
        cards.forEach(c => {
          const sx = Math.abs(Math.cos(c.anim * Math.PI));
          const w = Math.max(2, c.w * sx), x = c.x + (c.w - w) / 2, front = c.anim > 0.5;
          ctx.globalAlpha = c.state === 'done' ? 0.55 : 1;
          ctx.fillStyle = front ? '#f1edff' : '#2a2540';
          _rrect(ctx, x, c.y, w, c.h, 10 * s); ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = c.state === 'done' ? COLORS.stable : front ? '#d0c8ee' : COLORS.elevated;
          ctx.stroke();
          if (sx > 0.2) {
            ctx.save();
            ctx.translate(c.x + c.w / 2, c.y + c.h / 2); ctx.scale(sx, 1);
            if (!front) _text(ctx, '?', 0, 0, c.w * 0.4, COLORS.elevated);
            else if (COLORS[c.face]) _bear(ctx, c.face, 0, 0, c.w * 0.7);
            else _emoji(ctx, c.face, 0, 0, c.w * 0.5);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
        });
        if (banner > 0) _text(ctx, _t('level', 'Level {n}', { n: level + 1 }), W / 2, H / 2, 26 * s, COLORS.elevated);
      },
    };
    return g;
  }

  // ── Mood Week ─────────────────────────────────────────────────────────────

  function _week(W, H) {
    const s = Math.min(W / 360, H / 600);
    const lang = (window.BB && BB.i18n && BB.i18n.getLang) ? BB.i18n.getLang() : 'en';
    const DAYS = Array.from({ length: 7 }, (_, i) => {
      try { return new Date(2024, 0, 1 + i).toLocaleDateString(lang === 'zh' ? 'zh-Hans' : lang, { weekday: 'narrow' }); }
      catch (_) { return 'MTWTFSS'[i]; }
    });
    const slotW = Math.min(46 * s, (W - 24 * s) / 7 - 6 * s), slotGap = 6 * s, slotY = H * 0.36;
    const palY = H * 0.74, palSize = Math.min(58 * s, (W - 24 * s) / 5 - 8 * s);
    const palX = i => W / 2 + (i - 2) * (palSize + 10 * s);
    let round = 0, lives = 3, mode = 'idle', timer = 0, showFor = 1, idx = 0, t = 0;
    let seq = [], got = [];

    function slotX(i) { return W / 2 - (seq.length * slotW + (seq.length - 1) * slotGap) / 2 + i * (slotW + slotGap); }
    function next() {
      const n = Math.min(7, 3 + round);
      seq = Array.from({ length: n }, () => Math.floor(Math.random() * 5));
      got = [];
      idx = 0;
      showFor = Math.max(1.2 + n * 0.25, (1.2 + n * 0.45) * Math.pow(0.9, Math.max(0, round - 4)));
      timer = showFor;
      mode = 'show';
      round++;
    }
    function pick(m) {
      if (mode !== 'fill') return;
      const ok = m === seq[idx];
      got.push({ m: m, ok: ok });
      if (ok) g.score++; else lives--;
      idx++;
      if (lives <= 0) { mode = 'end'; timer = 1.2; }
      else if (idx === seq.length) { mode = 'pause'; timer = 1.1; }
    }

    const g = {
      score: 0, over: false,
      idle(dt) { t += dt; },
      start() { next(); },
      update(dt) {
        t += dt;
        timer -= dt;
        if (mode === 'show' && timer <= 0) mode = 'fill';
        else if (mode === 'pause' && timer <= 0) next();
        else if (mode === 'end' && timer <= 0) g.over = true;
      },
      down(x, y) {
        if (Math.abs(y - palY) > palSize * 0.7) return;
        for (let i = 0; i < 5; i++) if (Math.abs(x - palX(i)) < palSize / 2 + 5 * s) { pick(i); return; }
      },
      key(k) { const i = '12345'.indexOf(k); if (i >= 0) { pick(i); return true; } return false; },
      draw(ctx) {
        ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
        for (let i = 0; i < lives; i++) _bear(ctx, 'stable', 18 * s + i * 24 * s, 22 * s, 20 * s);
        const title = mode === 'show' ? _t('remember', 'Remember the week…') : mode === 'fill' ? _t('fillIn', 'Now fill it in') : '';
        if (title) _text(ctx, title, W / 2, H * 0.2, 18 * s, mode === 'fill' ? COLORS.stable : '#f1edff');
        if (mode === 'show') {
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          _rrect(ctx, W * 0.25, H * 0.25, W * 0.5, 6 * s, 3 * s); ctx.fill();
          ctx.fillStyle = COLORS.elevated;
          _rrect(ctx, W * 0.25, H * 0.25, W * 0.5 * Math.max(0, timer / showFor), 6 * s, 3 * s); ctx.fill();
        }
        seq.forEach((m, i) => {
          const x = slotX(i);
          _text(ctx, DAYS[i], x + slotW / 2, slotY - 16 * s, 13 * s, '#9d95bb');
          const r = got[i];
          ctx.lineWidth = 2;
          ctx.strokeStyle = r ? (r.ok ? COLORS.stable : COLORS.manic) : 'rgba(255,255,255,0.25)';
          ctx.fillStyle = '#1c1930';
          _rrect(ctx, x, slotY, slotW, slotW, 10 * s); ctx.fill();
          if (!r && mode === 'fill') ctx.setLineDash([4 * s, 4 * s]);
          ctx.stroke(); ctx.setLineDash([]);
          const show = mode === 'show' ? m : r ? (r.ok ? r.m : seq[i]) : (mode === 'end' || mode === 'pause') ? seq[i] : -1;
          if (show >= 0) _bear(ctx, MOODS[show], x + slotW / 2, slotY + slotW / 2, slotW * 0.85);
          if (r && !r.ok) _bear(ctx, MOODS[r.m], x + slotW * 0.85, slotY + slotW * 0.85, slotW * 0.42);
        });
        MOODS.forEach((m, i) => {
          ctx.globalAlpha = mode === 'fill' ? 1 : 0.35;
          ctx.fillStyle = COLORS[m];
          ctx.beginPath(); ctx.arc(palX(i), palY, palSize / 2, 0, Math.PI * 2); ctx.fill();
          _bear(ctx, m, palX(i), palY, palSize * 0.86);
          ctx.globalAlpha = 1;
        });
      },
    };
    return g;
  }

  const GAMES = [
    { id: 'snake',  mood: 'stable',   make: _snake,  name: () => _t('snake', 'Bear Snake'),   how: () => _t('snakeHow', 'Swipe or use the arrow keys to steer. Eat the bears, miss the walls and your tail.') },
    { id: 'flappy', mood: 'elevated', make: _flappy, name: () => _t('flappy', 'Flappy Bear'), how: () => _t('flappyHow', 'Tap to flap. Stay in the gap between the highs and the lows.') },
    { id: 'bricks', mood: 'manic',    make: _bricks, name: () => _t('bricks', 'Bear Bricks'), how: () => _t('bricksHow', 'Drag to move the paddle, tap to launch. Clear every mood.') },
    { id: 'balance', mood: 'stable',  make: _balance, name: () => _t('balance', 'Stay Stable'), how: () => _t('balanceHow', 'Hold to lift, let go to sink. Life pushes you up and down: keep the bear in the green as long as you can. 💊 and 😴 calm things down.') },
    { id: 'catch',  mood: 'low',      make: _catch,  name: () => _t('catch', 'Self-care Catch'), how: () => _t('catchHow', "Drag to move. Catch what keeps you steady (💊 😴 💧 🥗 🚶), dodge what doesn't (⏰ 📱 ☕ ⚡).") },
    { id: 'sleep',  mood: 'stable',   make: _sleep,  name: () => _t('sleep', 'Sleep Guard'), how: () => _t('sleepHow', 'Tap the things that keep the bear awake before they reach it. Sleep 8 hours to finish the night. Tap 🐑 for a bonus.') },
    { id: 'says',   mood: 'elevated', make: _says,   name: () => _t('says', 'Bear Says'), how: () => _t('saysHow', 'Watch the bears light up, then tap them in the same order. One more each round.') },
    { id: 'pairs',  mood: 'stable',   make: _pairs,  name: () => _t('pairs', 'Mood Pairs'), how: () => _t('pairsHow', "Turn the cards two at a time to find the pairs. You only lose a bear if you'd already seen the match.") },
    { id: 'week',   mood: 'low',      make: _week,   name: () => _t('week', 'Mood Week'), how: () => _t('weekHow', "Watch the week's moods, then fill them back in, in order. The weeks get longer.") },
  ];

  // ── Overlay + runner ──────────────────────────────────────────────────────

  const CSS = `
    .bba { position: fixed; inset: 0; z-index: 9998; display: none; flex-direction: column;
      background: ${BG}; color: #f1edff; overscroll-behavior: contain;
      padding: max(env(safe-area-inset-top, 0px), var(--safe-area-inset-top, 0px), 10px) 0
               max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px), 8px);
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
    .bba-top { display: flex; align-items: center; gap: 10px; padding: 6px 16px 10px; }
    .bba-title { flex: 1; font-weight: 800; font-size: 1.05em; color: #ff9500; letter-spacing: 0.04em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bba-score { font-weight: 800; font-size: 1.25em; font-variant-numeric: tabular-nums; }
    .bba-best { font-size: 0.72em; color: #9d95bb; font-weight: 600; margin-left: 8px; }
    .bba-btn { border: none; border-radius: 12px; font: inherit; font-weight: 800; cursor: pointer;
      -webkit-tap-highlight-color: transparent; }
    .bba-x { width: 40px; height: 40px; background: #2a2540; color: #f1edff; font-size: 1.05em; }
    .bba-stage { position: relative; flex: 1; min-height: 0; margin: 0 16px; border-radius: 16px; overflow: hidden;
      touch-action: none; user-select: none; -webkit-user-select: none; box-shadow: inset 0 0 0 2px #2a2540; }
    .bba-stage canvas { display: block; width: 100%; height: 100%; }
    .bba-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      width: min(300px, calc(100% - 32px)); box-sizing: border-box; padding: 20px 18px 18px; text-align: center;
      background: rgba(20,18,31,0.92); border: 2px solid #ff9500; border-radius: 18px;
      box-shadow: 0 0 0 4px rgba(255,149,0,0.15), 0 12px 40px rgba(0,0,0,0.5); }
    .bba-card img { width: 64px; height: 64px; object-fit: contain; }
    .bba-card h2 { margin: 6px 0 6px; font-size: 1.25em; color: #ff9500; letter-spacing: 0.05em; }
    .bba-card p { margin: 0 0 14px; font-size: 0.85em; line-height: 1.45; color: #cfc8ea; }
    .bba-card .bba-big { font-size: 2.2em; font-weight: 800; color: #fff; margin: 2px 0 2px; }
    .bba-card .bba-new { color: #51cf66; font-weight: 800; margin-bottom: 12px; }
    .bba-go { display: block; width: 100%; padding: 13px; background: #ff9500; color: #1a1300; font-size: 1em; }
    .bba-go + .bba-go { margin-top: 8px; background: #2a2540; color: #f1edff; }
    .bba-bottom { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 16px 4px; }
    .bba-another { padding: 11px 20px; background: #2a2540; color: #f1edff; font-size: 0.95em; }
    .bba-hide { padding: 6px 10px; background: none; color: #6f678f; font-size: 0.8em; font-weight: 600; }
    @media (hover: hover) and (pointer: fine) {
      .bba-btn:hover { filter: brightness(1.12); }
    }
  `;

  let root, stage, canvas, ctx, card, titleEl, scoreEl, bestEl, hideBtn;
  let def = null, game = null, state = 'ready', raf = 0, lastT = 0, W = 0, H = 0, shown = -1;
  let opts = {}, returnFocus = null, pointerId = null;

  function _build() {
    if (root) return;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    root = document.createElement('div');
    root.className = 'bba';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'bbaTitle');
    root.innerHTML = `
      <div class="bba-top">
        <div class="bba-title" id="bbaTitle"></div>
        <div class="bba-score"><span id="bbaScore">0</span><span class="bba-best" id="bbaBest"></span></div>
        <button type="button" class="bba-btn bba-x" id="bbaClose">✕</button>
      </div>
      <div class="bba-stage" id="bbaStage"><canvas aria-hidden="true"></canvas><div class="bba-card" id="bbaCard"></div></div>
      <div class="bba-bottom">
        <button type="button" class="bba-btn bba-another" id="bbaAnother"></button>
        <button type="button" class="bba-btn bba-hide" id="bbaHide"></button>
      </div>`;
    (document.getElementById('app-shell') || document.body).appendChild(root);
    stage = root.querySelector('#bbaStage');
    canvas = stage.querySelector('canvas');
    ctx = canvas.getContext('2d');
    card = root.querySelector('#bbaCard');
    titleEl = root.querySelector('#bbaTitle');
    scoreEl = root.querySelector('#bbaScore');
    bestEl = root.querySelector('#bbaBest');
    hideBtn = root.querySelector('#bbaHide');
    root.querySelector('#bbaClose').addEventListener('click', close);
    root.querySelector('#bbaAnother').addEventListener('click', _pick);
    hideBtn.addEventListener('click', () => { const h = opts.onHide; close(); if (h) h(); });

    stage.addEventListener('pointerdown', e => {
      if (card.contains(e.target)) return;
      if (state === 'ready' || state === 'paused') _play();
      if (state !== 'playing') return;
      pointerId = e.pointerId;
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* not supported */ }
      const p = _pos(e);
      if (game.down) game.down(p[0], p[1]);
      e.preventDefault();
    });
    stage.addEventListener('pointermove', e => {
      if (state !== 'playing' || !game.move) return;
      if (pointerId !== null && e.pointerId !== pointerId) return;
      const p = _pos(e);
      game.move(p[0], p[1]);
    });
    const up = e => {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      pointerId = null;
      if (game && game.up) game.up();
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  }

  function _pos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function _size() {
    const r = stage.getBoundingClientRect();
    W = Math.max(200, Math.floor(r.width));
    H = Math.max(200, Math.floor(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Pick a game other than the last one played, and show its start card. */
  function _pick() {
    const d = _load();
    const pool = GAMES.filter(gm => gm.id !== d.last);
    def = pool[Math.floor(Math.random() * pool.length)];
    d.last = def.id;
    _save(d);
    _setup();
  }

  function _best() { return ((_load().best || {})[def.id]) || 0; }

  function _setup() {
    _size();
    game = def.make(W, H);
    state = 'ready';
    shown = -1;
    titleEl.textContent = '🕹️ ' + def.name();
    _score();
    _card('ready');
  }

  function _score() {
    if (game.score === shown) return;
    shown = game.score;
    scoreEl.textContent = String(game.score);
    bestEl.textContent = _t('best', 'Best {n}', { n: Math.max(_best(), game.score) });
  }

  function _card(kind, newBest) {
    if (!kind) { card.style.display = 'none'; return; }
    card.style.display = '';
    let html;
    if (kind === 'ready') {
      html = `<img src="images/moods/sm/${def.mood}.png" alt=""><h2>${def.name()}</h2><p>${def.how()}</p>
        <button type="button" class="bba-btn bba-go" data-act="play">${_t('start', '▶ Play')}</button>`;
    } else if (kind === 'paused') {
      html = `<h2>${_t('paused', 'Paused')}</h2>
        <button type="button" class="bba-btn bba-go" data-act="play">${_t('resume', '▶ Carry on')}</button>`;
    } else {
      html = `<img src="images/moods/sm/${newBest ? 'elevated' : 'low'}.png" alt=""><h2>${_t('gameOver', 'Game over')}</h2>
        <div class="bba-big">${game.score}</div>
        ${newBest ? `<div class="bba-new">${_t('newBest', '🏆 New best!')}</div>` : `<p>${_t('best', 'Best {n}', { n: _best() })}</p>`}
        <button type="button" class="bba-btn bba-go" data-act="again">${_t('again', '↻ Play again')}</button>
        <button type="button" class="bba-btn bba-go" data-act="another">${_t('another', '🎲 Another game')}</button>`;
    }
    card.innerHTML = html;
    card.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'play') _play();
      else if (a === 'again') { _setup(); _play(); }
      else _pick();
    }));
    const first = card.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }

  function _play() {
    if (state === 'ready' && game.start) game.start();
    state = 'playing';
    _card(null);
  }

  function _finish() {
    state = 'over';
    const d = _load();
    d.best = d.best || {};
    const newBest = game.score > (d.best[def.id] || 0);
    if (newBest) { d.best[def.id] = game.score; _save(d); }
    _card('over', newBest && game.score > 0);
  }

  function _frame(t) {
    raf = requestAnimationFrame(_frame);
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
    lastT = t;
    if (state === 'playing') {
      game.update(dt);
      _score();
      if (game.over) _finish();
    } else if (state === 'ready' && game.idle) {
      game.idle(dt);
    }
    game.draw(ctx, state);
  }

  function _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    const onButton = e.target && e.target.tagName === 'BUTTON';
    if ((e.key === ' ' || e.key === 'Enter') && onButton) return;
    if (state === 'ready' || state === 'paused') {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); _play(); }
      return;
    }
    if (state === 'playing' && game.key && game.key(e.key)) e.preventDefault();
  }
  function _onKeyUp(e) { if (game && game.keyUp) game.keyUp(e.key); }

  function _onVis() {
    if (document.hidden && state === 'playing') { state = 'paused'; _card('paused'); }
    lastT = 0;
  }

  function _onResize() {
    if (!root || root.style.display === 'none') return;
    // A rotation or window resize changes the board, so the game starts over.
    _setup();
  }

  /**
   * Open the arcade on a random game.
   * @param {{onHide?: function}} [o] `onHide` adds "Hide this button".
   */
  function open(o) {
    opts = o || {};
    _build();
    returnFocus = document.activeElement;
    root.style.display = 'flex';
    root.querySelector('#bbaClose').setAttribute('aria-label', (window.BB && BB.t) ? BB.t('common.close') : 'Close');
    root.querySelector('#bbaAnother').textContent = _t('another', '🎲 Another game');
    hideBtn.textContent = (window.BB && BB.t) ? BB.t('common.hideButton') : '🙈 Hide this button';
    hideBtn.style.display = opts.onHide ? '' : 'none';
    document.addEventListener('keydown', _onKey, true);
    document.addEventListener('keyup', _onKeyUp, true);
    document.addEventListener('visibilitychange', _onVis);
    window.addEventListener('resize', _onResize);
    _pick();
    lastT = 0;
    if (!raf) raf = requestAnimationFrame(_frame);
  }

  /** Close the arcade and stop the game loop. */
  function close() {
    if (!root || root.style.display === 'none') return;
    root.style.display = 'none';
    cancelAnimationFrame(raf);
    raf = 0;
    document.removeEventListener('keydown', _onKey, true);
    document.removeEventListener('keyup', _onKeyUp, true);
    document.removeEventListener('visibilitychange', _onVis);
    window.removeEventListener('resize', _onResize);
    if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
  }

  BB.arcade = { open: open, close: close };
})();
