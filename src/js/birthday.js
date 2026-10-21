/* ═══════════════════════════════════════════════════════════════════════
   16-bit birthday card · The Way Agency
   A looping pixel-art show on one canvas plus a WebAudio chiptune.
   The birthday person's name comes from the URL fragment
   (/happy-birthday#first-last). A fragment never reaches the server, the
   analytics tags or the git history.
   Drawing kit ported from SAGE's pipeline celebrations
   (sage-server public/js/win-celebration.js). Every scene is a pure
   function of its local time t, so any frame can be drawn on its own.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── tiny math ──
  function clamp(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function easeOut(p) { p = clamp(p); return 1 - (1 - p) * (1 - p); }
  function bounceOut(p) {
    p = clamp(p);
    if (p < 0.3636) return 7.5625 * p * p;
    if (p < 0.7272) { p -= 0.5454; return 7.5625 * p * p + 0.75; }
    if (p < 0.9090) { p -= 0.8181; return 7.5625 * p * p + 0.9375; }
    p -= 0.9545; return 7.5625 * p * p + 0.984375;
  }
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function mod(a, n) { return ((a % n) + n) % n; }

  // ── pixel primitives ──
  function R(ctx, c, x, y, w, h) {
    if (w <= 0 || h <= 0) return;
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }
  function bands(ctx, W, y0, y1, cols) {
    var n = cols.length, hgt = (y1 - y0) / n;
    for (var i = 0; i < n; i++) R(ctx, cols[i], 0, y0 + Math.floor(i * hgt), W, Math.ceil(hgt) + 1);
  }
  function disc(ctx, c, cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
    if (r < 0) return;
    ctx.fillStyle = c;
    for (var dy = -r; dy <= r; dy++) {
      var w = Math.floor(Math.sqrt(r * r - dy * dy));
      ctx.fillRect(cx - w, cy + dy, 2 * w + 1, 1);
    }
  }
  // Upper half of a disc (arched window tops).
  function arch(ctx, c, cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy);
    ctx.fillStyle = c;
    for (var dy = -r; dy <= 0; dy++) {
      var w = Math.floor(Math.sqrt(r * r - dy * dy));
      ctx.fillRect(cx - w, cy + dy, 2 * w + 1, 1);
    }
  }
  // Isosceles triangle pointing up: apex (cx, top), base y = bot, half-width hw at the base.
  function tri(ctx, c, cx, top, bot, hw) {
    ctx.fillStyle = c;
    var h = bot - top;
    for (var y = 0; y <= h; y++) {
      var w = Math.round(hw * y / h);
      ctx.fillRect(Math.round(cx - w), Math.round(top + y), 2 * w + 1, 1);
    }
  }

  // ── 5x7 bitmap font ──
  var FONT = (function () {
    var src = {
      A: '.###./#...#/#...#/#####/#...#/#...#/#...#', B: '####./#...#/#...#/####./#...#/#...#/####.',
      C: '.###./#...#/#..../#..../#..../#...#/.###.', D: '####./#...#/#...#/#...#/#...#/#...#/####.',
      E: '#####/#..../#..../####./#..../#..../#####', F: '#####/#..../#..../####./#..../#..../#....',
      G: '.###./#...#/#..../#.###/#...#/#...#/.###.', H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
      I: '#####/..#../..#../..#../..#../..#../#####', J: '..###/...#./...#./...#./...#./#..#./.##..',
      K: '#...#/#..#./#.#../##.../#.#../#..#./#...#', L: '#..../#..../#..../#..../#..../#..../#####',
      M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
      O: '.###./#...#/#...#/#...#/#...#/#...#/.###.', P: '####./#...#/#...#/####./#..../#..../#....',
      Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', R: '####./#...#/#...#/####./#.#../#..#./#...#',
      S: '.####/#..../#..../.###./....#/....#/####.', T: '#####/..#../..#../..#../..#../..#../..#..',
      U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.', V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
      W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#', X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
      Y: '#...#/#...#/.#.#./..#../..#../..#../..#..', Z: '#####/....#/...#./..#../.#.../#..../#####',
      0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.', 1: '..#../.##../..#../..#../..#../..#../.###.',
      2: '.###./#...#/....#/...#./..#../.#.../#####', 3: '####./....#/....#/.###./....#/....#/####.',
      4: '...#./..##./.#.#./#..#./#####/...#./...#.', 5: '#####/#..../####./....#/....#/#...#/.###.',
      6: '.###./#..../#..../####./#...#/#...#/.###.', 7: '#####/....#/...#./..#../.#.../.#.../.#...',
      8: '.###./#...#/#...#/.###./#...#/#...#/.###.', 9: '.###./#...#/#...#/.####/....#/....#/.###.',
      '!': '..#../..#../..#../..#../..#../...../..#..', '?': '.###./#...#/....#/...#./..#../...../..#..',
      '+': '...../..#../..#../#####/..#../..#../.....', '-': '...../...../...../#####/...../...../.....',
      '.': '...../...../...../...../...../.##../.##..', ':': '...../.##../.##../...../.##../.##../.....',
      '*': '...../#.#.#/.###./#####/.###./#.#.#/.....',
    };
    var out = {};
    Object.keys(src).forEach(function (k) { out[k] = src[k].split('/'); });
    return out;
  })();
  var MISSING = {};
  function textW(str, s) { return (str.length * 6 - 1) * s; }
  function text(ctx, str, x, y, s, col) {
    x = Math.round(x); y = Math.round(y);
    var fn = typeof col === 'function' ? col : null;
    if (!fn) ctx.fillStyle = col;
    for (var n = 0; n < str.length; n++) {
      var ch = str.charAt(n), g = FONT[ch];
      if (!g && ch !== ' ') MISSING[ch] = 1;
      if (g) {
        for (var j = 0; j < 7; j++) {
          var row = g[j];
          if (fn) ctx.fillStyle = fn(j);
          for (var i = 0; i < 5; i++) {
            if (row.charCodeAt(i) !== 35) continue;
            var k = i + 1;
            while (k < 5 && row.charCodeAt(k) === 35) k++;
            ctx.fillRect(x + i * s, y + j * s, (k - i) * s, s);
            i = k - 1;
          }
        }
      }
      x += 6 * s;
    }
  }
  function textC(ctx, str, cx, y, s, col) { text(ctx, str, cx - textW(str, s) / 2, y, s, col); }
  // Outlined text, for HUD lines over busy backgrounds.
  function textO(ctx, str, x, y, s, col, outline) {
    for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
      if (ox || oy) text(ctx, str, x + ox, y + oy, s, outline);
    }
    text(ctx, str, x, y, s, col);
  }

  function fitTitle(str, W, maxS) {
    var s;
    for (s = maxS || 4; s >= 2; s--) if (textW(str, s) <= W - 16) return { lines: [str], s: s };
    var words = str.split(' ');
    var longest = words.reduce(function (m, w) { return Math.max(m, w.length); }, 0);
    for (s = maxS || 4; s > 1; s--) if ((longest * 6 - 1) * s <= W - 16) break;
    return { lines: words, s: s };
  }
  // Bouncing drop-in title with outline, shadow and a cycling row gradient.
  // Returns the y just below it.
  function banner(ctx, t, t0, W, y, str, cols, outline, maxS) {
    var f = fitTitle(str, W, maxS), s = f.s, lineH = 9 * s;
    var bottom = y + f.lines.length * lineH;
    var dt = t - t0;
    if (dt < 0) return bottom;
    var drop = (1 - bounceOut(dt / 0.7)) * -(y + f.lines.length * lineH + 8);
    var shift = Math.floor(t * 9);
    var grad = function (j) { return cols[mod(j + shift, cols.length)]; };
    for (var l = 0; l < f.lines.length; l++) {
      var ln = f.lines[l];
      var x = Math.round(W / 2 - textW(ln, s) / 2), yy = Math.round(y + l * lineH + drop);
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
        if (ox || oy) text(ctx, ln, x + ox * s, yy + oy * s, s, outline);
      }
      text(ctx, ln, x + s, yy + 2 * s, s, outline);
      text(ctx, ln, x, yy, s, grad);
    }
    return bottom;
  }
  // Small line that blinks at 1Hz-ish (well under the 3Hz flash limit).
  function subtitle(ctx, t, t0, W, y, str, col, shadow) {
    if (t < t0 || Math.floor((t - t0) * 4) % 4 === 3) return;
    var s = (textW(str, 2) <= W - 16) ? 2 : 1;
    textC(ctx, str, W / 2 + s, y + s, s, shadow);
    textC(ctx, str, W / 2, y, s, col);
  }

  // ── effects ──
  function firework(ctx, t, t0, cx, cy, cols, seed, n, pow) {
    var dt = t - t0;
    if (dt < -0.35 || dt > 1.3) return;
    if (dt < 0) {
      var p = (dt + 0.35) / 0.35;
      R(ctx, '#fff', cx, lerp(cy + 60, cy, p), 1, 4);
      return;
    }
    var spread = 1 - Math.exp(-3.4 * dt);
    for (var i = 0; i < n; i++) {
      if (dt > 0.85 && (Math.floor(t * 14) + i) % 2) continue;
      var a = (i / n) * 6.2832 + rnd(seed + i) * 0.5;
      var sp = pow * (0.5 + 0.5 * rnd(seed * 3 + i));
      var sz = dt < 0.7 ? 2 : 1;
      R(ctx, dt < 0.1 ? '#fff' : cols[i % cols.length],
        cx + Math.cos(a) * sp * spread, cy + Math.sin(a) * sp * spread + 16 * dt * dt, sz, sz);
    }
  }
  // k bursts starting at t0, one every gap seconds.
  function fireworkShow(ctx, t, t0, W, H, sets, k, gap) {
    for (var i = 0; i < k; i++) {
      firework(ctx, t, t0 + i * gap, W * (0.1 + 0.8 * rnd(i + 61)), H * (0.14 + 0.32 * rnd(i + 83)),
        sets[i % sets.length], i * 17 + 5, 34, 34 + 20 * rnd(i + 9));
    }
  }
  function confetti(ctx, t, t0, W, H, cols, n) {
    var dt = t - t0;
    if (dt < 0) return;
    for (var i = 0; i < n; i++) {
      var y = -8 - rnd(i + 3) * H * 1.6 + dt * (34 + rnd(i + 7) * 46);
      if (y < -4 || y > H) continue;
      var x = rnd(i + 1) * W + Math.sin(dt * 3 + i) * 6;
      var wide = (Math.floor(dt * 8) + i) % 2;
      R(ctx, cols[i % cols.length], x, y, wide ? 3 : 2, wide ? 2 : 3);
    }
  }
  function sparkle(ctx, c, x, y, r) {
    R(ctx, c, x - r, y, 2 * r + 1, 1);
    R(ctx, c, x, y - r, 1, 2 * r + 1);
  }
  function stars(ctx, t, W, H, n, seed) {
    for (var i = 0; i < n; i++) {
      var tw = (Math.floor(t * 3 + rnd(i + seed) * 9)) % 5 === 0;
      R(ctx, tw ? '#7f9cc9' : '#e8f1ff', rnd(i * 3 + seed) * W, rnd(i * 7 + seed) * H, 1, 1);
    }
  }

  // ── brand ──
  var NAVY = '#173358', NAVY_D = '#0F2240', BLUE = '#3097D3', CYAN = '#20BCEE', CYAN_L = '#5FD0F3', GREEN = '#65C5B3';
  var GOLD = ['#fff6b0', '#ffe066', '#ffcc33', '#ff9f1c', '#ffcc33', '#ffe066'];
  var RAINBOW = ['#ff4d6d', '#ff9f1c', '#ffe066', '#7ee36a', '#20BCEE', '#9b7bff', '#ff6fd8'];
  var BRANDCYC = ['#ffffff', CYAN_L, CYAN, BLUE, CYAN, CYAN_L];
  var FW = [['#ffe066', '#ff9f1c'], [CYAN, '#ffffff'], ['#ff6fd8', '#9b7bff'], ['#7ee36a', GREEN], ['#ff4d6d', '#ffe066']];

  // Little pixel shield with a W: The Way Agency's badge in the scenes.
  function shield(ctx, cx, y, s) {
    var rows = ['..#########..', '.#ooooooooo#.', '#ooooooooooo#', '#owooowooowo#', '#owooowooowo#', '#oowowowowoo#', '#oowowowowoo#',
      '#ooowooowooo#', '#ooooooooooo#', '.#ooooooooo#.', '..#ooooooo#..', '...#ooooo#...', '....#ooo#....', '.....###.....'];
    var pal = { '#': NAVY_D, o: CYAN, w: '#ffffff' };
    var x0 = Math.round(cx - 6.5 * s);
    for (var j = 0; j < rows.length; j++) for (var i = 0; i < 13; i++) {
      var c = pal[rows[j].charAt(i)];
      if (c) R(ctx, c, x0 + i * s, y + j * s, s, s);
    }
  }

  // ── the birthday hero ──
  // Sun-tanned, tousled salt-and-pepper hair, a little goatee, big grin, shirtless with a
  // six-pack and black shades: a runner in The Way Agency navy shorts.
  var SKIN = '#dfa274', SKIN_D = '#b47549', SKIN_L = '#f3c398', SHADE = '#0b0b0f', SHORTS = NAVY;
  var HAIR = '#8d8883', HAIR_D = '#57534f', HAIR_L = '#c9c5bf', GOATEE = '#4a4440';
  // pose: 'run0' | 'run1' | 'stand' | 'flex' | 'blow' | 'wave'. (x, y) = feet centre, s = pixel size.
  // Facing right; 14 x 26 grid.
  function hero(ctx, x, y, s, pose, t, opts) {
    opts = opts || {};
    var ox = Math.round(x - 7 * s), oy = Math.round(y - 26 * s);
    function P(c, gx, gy, w, h) { R(ctx, c, ox + gx * s, oy + gy * s, w * s, h * s); }
    var run = pose === 'run0' || pose === 'run1';
    var a = pose === 'run0';
    // back arm (behind the body)
    if (run) {
      if (a) { P(SKIN_D, 2, 9, 2, 3); P(SKIN_D, 0, 11, 3, 2); }
      else { P(SKIN_D, 10, 9, 2, 3); P(SKIN_D, 11, 11, 3, 2); }
    }
    // legs
    if (run) {
      if (a) {
        P(SKIN_D, 3, 20, 2, 3); P(SKIN_D, 1, 22, 3, 2); P('#e9eef2', 0, 23, 3, 2); P(BLUE, 0, 24, 3, 1);
        P(SKIN, 8, 20, 2, 3); P(SKIN, 9, 22, 2, 3); P('#ffffff', 9, 25, 4, 1); P(CYAN, 12, 25, 1, 1);
      } else {
        P(SKIN_D, 8, 20, 2, 3); P(SKIN_D, 10, 21, 3, 2); P('#e9eef2', 12, 20, 2, 3); P(BLUE, 13, 22, 1, 1);
        P(SKIN, 4, 20, 2, 5); P('#ffffff', 3, 25, 4, 1); P(CYAN, 6, 25, 1, 1);
      }
    } else {
      P(SKIN_D, 4, 20, 2, 5); P(SKIN, 8, 20, 2, 5);
      P('#ffffff', 3, 25, 3, 1); P('#ffffff', 8, 25, 3, 1); P(CYAN, 5, 25, 1, 1); P(CYAN, 10, 25, 1, 1);
    }
    // shorts (navy, cyan waistband + side stripe)
    P(SHORTS, 3, 16, 8, 4); P(CYAN, 3, 16, 8, 1); P(CYAN, 10, 17, 1, 3);
    if (run) P(SHORTS, a ? 7 : 3, 19, 3, 2);
    // torso + six-pack
    P(SKIN, 3, 8, 8, 8); P(SKIN_D, 3, 8, 1, 8);
    P(SKIN_D, 4, 10, 3, 1); P(SKIN_D, 8, 10, 3, 1);          // pecs
    P(SKIN_D, 7, 11, 1, 5);                                  // linea alba
    P(SKIN_D, 5, 12, 5, 1); P(SKIN_D, 5, 14, 5, 1);          // ab rows
    P(SKIN_L, 5, 11, 1, 1); P(SKIN_L, 8, 11, 1, 1); P(SKIN_L, 5, 13, 1, 1); P(SKIN_L, 8, 13, 1, 1);
    if (opts.shine != null) {                                // sweep of light across the abs
      var sx = Math.floor(opts.shine * 14) - 2;
      for (var k = 0; k < 8; k++) { var gx = sx + k - 2; if (gx >= 4 && gx <= 10) P('#fff3d6', gx, 15 - k, 1, 1); }
    }
    // front arm
    if (run) {
      if (a) { P(SKIN, 10, 9, 2, 3); P(SKIN, 11, 11, 3, 2); }
      else { P(SKIN, 2, 9, 2, 3); P(SKIN, 0, 11, 3, 2); }
    } else if (pose === 'flex') {
      P(SKIN, 0, 8, 3, 2); P(SKIN, 11, 8, 3, 2);             // upper arms out
      P(SKIN, 0, 4, 2, 4); P(SKIN, 12, 4, 2, 4);             // forearms up
      P(SKIN_L, 1, 7, 2, 1); P(SKIN_L, 11, 7, 2, 1);         // biceps peak
      P(SKIN_D, 0, 3, 2, 1); P(SKIN_D, 12, 3, 2, 1);         // fists
    } else if (pose === 'wave') {
      P(SKIN_D, 2, 9, 1, 6); P(SKIN, 11, 8, 2, 2);
      var up = Math.floor(t * 6) % 2;
      P(SKIN, 12 + up, 3, 2, 5); P(SKIN_D, 12 + up, 2, 2, 1);
    } else {
      P(SKIN_D, 2, 9, 1, 6); P(SKIN, 11, 9, 1, 6);
    }
    // head
    // tousled salt-and-pepper, fuller on top (one row above the grid)
    P(HAIR_D, 5, -1, 1, 1); P(HAIR, 6, -1, 2, 1); P(HAIR_L, 9, -1, 1, 1);
    P(HAIR, 4, 0, 7, 1); P(HAIR_L, 6, 0, 2, 1); P(HAIR_D, 10, 0, 1, 1);
    P(HAIR, 4, 1, 7, 1); P(HAIR_D, 5, 1, 1, 1); P(HAIR_L, 8, 1, 2, 1);
    P(HAIR_D, 4, 2, 1, 2); P(HAIR, 5, 2, 1, 1);
    P(SKIN, 5, 2, 6, 5); P(SKIN_D, 5, 5, 1, 1);
    P(SHADE, 4, 3, 8, 2);                                     // wrap-around black shades
    if (opts.glint || Math.floor(t * 2.2) % 5 === 0) P('#ffffff', 9, 3, 1, 1);
    P(SKIN, 6, 7, 3, 1);                                      // neck
    if (pose === 'blow') { P(SKIN_L, 10, 5, 2, 2); P('#6b2a1a', 11, 5, 1, 1); }
    else { P('#6b2a1a', 8, 5, 3, 1); P('#ffffff', 8, 5, 2, 1); }  // big grin
    P(GOATEE, 9, 6, 1, 1);                                    // goatee
  }

  // ── vehicles (side view, facing right). (x, y) = left end of the body, y = ground. ──
  function wheel(ctx, cx, cy, t, spin) {
    disc(ctx, '#111317', cx, cy, 4); disc(ctx, '#9aa3ad', cx, cy, 2);
    var a = spin ? t * 14 : 0;
    R(ctx, '#e8edf2', cx + Math.round(Math.cos(a) * 1.5), cy + Math.round(Math.sin(a) * 1.5), 1, 1);
  }
  function car(ctx, kind, x, y, t, opts) {
    opts = opts || {};
    var body = kind === 'van' ? '#f2f3f5' : (kind === 'suv' ? '#1d2027' : '#aeb5bf');
    var dark = kind === 'van' ? '#c9ced6' : (kind === 'suv' ? '#0d0f13' : '#7d858f');
    var glass = '#7fb6d9', L = kind === 'van' ? 44 : (kind === 'suv' ? 42 : 40);
    var hop = opts.hop || 0;
    var by = y - 5 - hop;
    // lower body
    R(ctx, body, x, by - 9, L, 9); R(ctx, dark, x, by - 2, L, 2);
    // cabin
    if (kind === 'sedan') {
      for (var i = 0; i < 7; i++) R(ctx, body, x + 9 + Math.max(0, 6 - i), by - 9 - 7 + i, 20 - Math.max(0, 6 - i) + Math.min(i, 5), 1);
      R(ctx, glass, x + 14, by - 15, 6, 5); R(ctx, glass, x + 21, by - 15, 6, 5);
    } else if (kind === 'suv') {
      R(ctx, body, x + 4, by - 18, 31, 9); R(ctx, body, x + 35, by - 16, 3, 7);
      R(ctx, glass, x + 7, by - 16, 8, 5); R(ctx, glass, x + 17, by - 16, 8, 5); R(ctx, glass, x + 27, by - 16, 7, 5);
      R(ctx, '#3a3f48', x + 6, by - 20, 26, 1);              // roof rails
    } else {
      R(ctx, body, x + 3, by - 19, 31, 10);
      for (var j = 0; j < 8; j++) R(ctx, body, x + 34, by - 17 + j, Math.min(j + 1, 7), 1);
      R(ctx, glass, x + 5, by - 17, 7, 5); R(ctx, glass, x + 14, by - 17, 10, 5); R(ctx, glass, x + 26, by - 17, 8, 5);
      R(ctx, dark, x + 13, by - 18, 1, 15); R(ctx, dark, x + 25, by - 11, 1, 8);  // sliding-door seams
    }
    // badge, lights
    if (kind !== 'van') { disc(ctx, '#e8edf2', x + L - 9, by - 6, 2); R(ctx, '#1d4f91', x + L - 10, by - 6, 3, 1); }
    else R(ctx, '#c40f2f', x + L - 9, by - 7, 3, 2);
    var on = opts.flash && Math.floor(t * 4) % 2 === 0;
    R(ctx, on ? '#ffffff' : '#ffe9a0', x + L - 2, by - 8, 2, 3);
    if (on) { for (var k = 0; k < 4; k++) R(ctx, 'rgba(255,248,200,0.5)', x + L + k * 3, by - 9 - k, 3, 5 + 2 * k); }
    R(ctx, '#d62a2a', x, by - 8, 2, 3);
    // wheels stay on the ground while the body hops
    wheel(ctx, x + 9, y - 4, t, opts.spin); wheel(ctx, x + L - 10, y - 4, t, opts.spin);
  }

  // ── the house: white painted-brick ranch, charcoal roof with stacked front gables,
  // black arched windows, black two-car garage, crape myrtle, yellow shrubs. ──
  var WHITE = '#f1f2ef', WHITE_D = '#d8dad5', ROOF = '#3b3f46', ROOF_D = '#2a2d33', TRIM = '#ffffff', BLACK = '#121417';
  function brick(ctx, x, y, w, h, seed) {
    for (var j = 2; j < h; j += 3) {
      var off = (j / 3) % 2 ? 0 : 3;
      for (var i = off; i < w; i += 6) if (rnd(seed + i * 7 + j) > 0.45) R(ctx, WHITE_D, x + i, y + j, 3, 1);
    }
  }
  function gable(ctx, cx, top, bot, hw) {
    tri(ctx, ROOF_D, cx, top - 2, bot, hw + 3);
    tri(ctx, TRIM, cx, top, bot, hw + 1);
    tri(ctx, WHITE, cx, top + 2, bot, hw - 1);
  }
  function archWindow(ctx, cx, top, bot, hw) {
    arch(ctx, BLACK, cx, top + hw, hw);
    R(ctx, BLACK, cx - hw, top + hw, 2 * hw + 1, bot - top - hw);
    arch(ctx, '#2c3540', cx, top + hw, hw - 2);
    R(ctx, '#c9d4d9', cx - hw + 2, top + hw + 1, 2 * hw - 3, bot - top - hw - 3);
    for (var i = -hw + 2; i < hw - 1; i += 4) R(ctx, BLACK, cx + i + 3, top + hw + 1, 1, bot - top - hw - 3);
  }
  function house(ctx, x, gy, t) {
    // big trees behind
    disc(ctx, '#2f6b2a', x + 52, gy - 70, 22); disc(ctx, '#3f8a36', x + 40, gy - 76, 16); disc(ctx, '#2f6b2a', x + 168, gy - 58, 20);
    disc(ctx, '#4f9a3e', x + 178, gy - 66, 13);
    // main hip roof + walls
    var top = gy - 58;
    for (var j = 0; j <= 26; j++) R(ctx, j % 5 === 0 ? ROOF_D : ROOF, x + 30 - j * 1.2, top + j, 108 + j * 2.4, 1);
    R(ctx, WHITE, x + 4, gy - 32, 126, 32); brick(ctx, x + 4, gy - 32, 126, 32, 3);
    // garage wing
    for (var g = 0; g <= 10; g++) R(ctx, ROOF, x + 136 - g, gy - 46 + g, 34 + 2 * g, 1);
    R(ctx, WHITE, x + 128, gy - 36, 52, 36); brick(ctx, x + 128, gy - 36, 52, 36, 9);
    gable(ctx, x + 154, gy - 54, gy - 38, 10);
    R(ctx, BLACK, x + 134, gy - 26, 38, 26);                  // the black two-car garage door
    for (var p = 1; p < 4; p++) R(ctx, '#23262b', x + 134, gy - 26 + p * 6, 38, 1);
    R(ctx, '#3a3f48', x + 152, gy - 26, 1, 26);
    R(ctx, '#2a2a2a', x + 130, gy - 24, 2, 4); R(ctx, '#ffd36b', x + 130, gy - 23, 2, 2);   // lanterns
    R(ctx, '#2a2a2a', x + 174, gy - 24, 2, 4); R(ctx, '#ffd36b', x + 174, gy - 23, 2, 2);
    // tall rear gable with the round vent
    gable(ctx, x + 96, gy - 78, gy - 32, 26);
    disc(ctx, TRIM, x + 96, gy - 58, 4); disc(ctx, WHITE_D, x + 96, gy - 58, 3); R(ctx, '#b9bcb6', x + 94, gy - 58, 5, 1);
    // left wing gable
    gable(ctx, x + 28, gy - 56, gy - 30, 24);
    disc(ctx, TRIM, x + 28, gy - 46, 2);
    // front centre gable
    gable(ctx, x + 70, gy - 58, gy - 30, 24);
    brick(ctx, x + 50, gy - 32, 40, 32, 21);
    // arched black windows + entry
    archWindow(ctx, x + 26, gy - 28, gy - 6, 9);
    archWindow(ctx, x + 72, gy - 28, gy - 6, 11);
    arch(ctx, BLACK, x + 47, gy - 16, 4); R(ctx, BLACK, x + 43, gy - 16, 9, 16); R(ctx, '#d9b56b', x + 49, gy - 9, 1, 1);
    // crape myrtle (pink) by the garage corner
    R(ctx, '#7a5a3a', x + 118, gy - 18, 2, 18);
    var pinks = ['#e86fa0', '#f29bbf', '#c94f80', '#ffb8d2'];
    for (var c = 0; c < 26; c++) {
      var a = rnd(c + 40) * 6.28, r = rnd(c + 90) * 14;
      disc(ctx, pinks[c % 4], x + 118 + Math.cos(a) * r * 1.2, gy - 30 + Math.sin(a) * r * 0.8 + Math.sin(t * 2 + c) * 0.6, 2 + (c % 2));
    }
    // shrubs: yellow and green
    var shrubs = [[8, '#e8d34a'], [16, '#3d8a3a'], [38, '#e8d34a'], [58, '#3d8a3a'], [66, '#e8d34a'], [86, '#e8d34a'], [96, '#3d8a3a'], [104, '#f0b6c8'], [126, '#3d8a3a']];
    for (var s = 0; s < shrubs.length; s++) { disc(ctx, shrubs[s][1], x + shrubs[s][0], gy - 2, 4); disc(ctx, '#2c6a2a', x + shrubs[s][0] - 2, gy, 2); }
    // cedar fence + basketball hoop
    for (var f = 0; f < 6; f++) R(ctx, f % 2 ? '#c69a62' : '#d4aa70', x + 182 + f * 3, gy - 16, 3, 16);
    R(ctx, '#202020', x + 180, gy - 34, 1, 34); R(ctx, '#f4f4f4', x + 175, gy - 40, 10, 7); R(ctx, '#e06a2a', x + 177, gy - 34, 5, 1);
  }

  // ── backdrops ──
  function skyline(ctx, W, gy, t, speed, col, lit, seed) {
    var sc = (t * speed) % 400;
    for (var i = -1; i < Math.ceil(W / 16) + 30; i++) {
      var bx = i * 16 - sc % 16, idx = i + Math.floor(sc / 16);
      var h = 18 + Math.floor(rnd(idx + seed) * 34);
      R(ctx, col, bx, gy - h, 14, h);
      for (var wy = gy - h + 4; wy < gy - 4; wy += 5) for (var wx = 2; wx < 12; wx += 4) {
        if (rnd(idx * 13 + wy + wx) > 0.55) R(ctx, lit, bx + wx, wy, 2, 2);
      }
    }
  }
  function hills(ctx, W, gy, t, speed, col, amp, seed) {
    var sc = t * speed;
    for (var x = 0; x < W; x++) {
      var wx = x + sc;
      var h = amp * (0.6 + 0.4 * Math.sin(wx * 0.021 + seed) * Math.sin(wx * 0.007 + seed * 2));
      R(ctx, col, x, gy - h, 1, h);
    }
  }
  function cloud(ctx, x, y, c) {
    disc(ctx, c, x, y, 6); disc(ctx, c, x + 8, y - 3, 8); disc(ctx, c, x + 17, y, 6); R(ctx, c, x, y, 18, 6);
  }
  function track(ctx, W, gy, H, t, speed) {
    R(ctx, '#4f9a3e', 0, gy, W, 3);
    R(ctx, '#c8553d', 0, gy + 3, W, H - gy);
    var sc = (t * speed) % 24;
    for (var k = 0; k < 3; k++) R(ctx, '#f6efe6', 0, gy + 8 + k * 7, W, 1);
    for (var x = -24; x < W + 24; x += 24) R(ctx, '#b1452f', x - sc, gy + 4, 10, 1);
  }

  // ═══ SCENES ═══
  // Each: { id, dur, top, bottom, draw(ctx, t, W, H, N), sfx: [[t, name]] }. H is the 180 stage;
  // the frame loop fills the area above with `top` and below with `bottom` on tall screens.
  var STAGE_H = 180;

  var sceneTitle = {
    id: 'title', dur: 5.2, top: '#060b1c', bottom: '#060b1c',
    sfx: [[0.3, 'coin'], [1.4, 'power'], [3.0, 'select']],
    draw: function (ctx, t, W, H, N) {
      bands(ctx, W, 0, H, ['#060b1c', '#0a1430', '#0F2240', '#132a52']);
      stars(ctx, t, W, H, 70, 1);
      // warp streaks
      for (var i = 0; i < 24; i++) {
        var y = rnd(i + 5) * H, sp = 60 + rnd(i + 11) * 160;
        var x = mod(W - (t * sp + rnd(i) * W * 2), W * 1.4) - 20;
        R(ctx, i % 3 ? '#2b4f86' : CYAN_L, x, y, 8 + rnd(i + 2) * 14, 1);
      }
      // shield logo zooms in, then the wordmark
      var sp2 = Math.min(1, t / 0.9), sz = Math.max(1, Math.round(lerp(1, 4, easeOut(sp2))));
      shield(ctx, W / 2, 16 + (4 - sz) * 6, sz);
      banner(ctx, t, 0.9, W, 74, 'THE WAY AGENCY', BRANDCYC, NAVY_D, 3);
      subtitle(ctx, t, 1.8, W, 104, 'PRESENTS', '#ffffff', NAVY_D);
      // player-select card
      if (t > 2.8) {
        var p = easeOut((t - 2.8) / 0.5), cw = 150, cx = W / 2 - cw / 2, cy = lerp(H + 10, 120, p);
        R(ctx, '#ffffff', cx - 2, cy - 2, cw + 4, 52); R(ctx, NAVY, cx, cy, cw, 48);
        R(ctx, BLUE, cx, cy, cw, 2);
        R(ctx, '#0a1430', cx + 6, cy + 6, 36, 36);
        ctx.save(); ctx.beginPath(); ctx.rect(cx + 6, cy + 6, 36, 36); ctx.clip();
        hero(ctx, cx + 24, cy + 60, 2, 'stand', t, { glint: Math.floor(t * 3) % 3 === 0 });
        ctx.restore();
        text(ctx, 'PLAYER 1', cx + 48, cy + 8, 1, CYAN_L);
        var nm = N.first.length > 8 ? 1 : 2;
        text(ctx, N.first, cx + 48, cy + 19, nm, '#ffe066');
        text(ctx, 'SPD 99  ABS 99', cx + 48, cy + 36, 1, '#ffffff');
      }
    }
  };

  // The run: parallax skyline, red running track, hurdles he clears and coins he grabs.
  var RUN_V = 96, RUN_X = 70;
  var HURDLES = [260, 470, 640];
  var COINS = (function () {
    var out = [], i, k;
    for (i = 0; i < 6; i++) out.push({ x: 140 + i * 16, y: 22 });
    for (k = 0; k < HURDLES.length; k++) for (i = 0; i < 4; i++) out.push({ x: HURDLES[k] - 18 + i * 12, y: 40 + Math.round(Math.sin((i + 0.5) / 4 * Math.PI) * 10) });
    for (i = 0; i < 5; i++) out.push({ x: 540 + i * 16, y: 22 });
    return out;
  })();
  var GIFTS = [{ x: 380, c: '#ff6fd8' }, { x: 560, c: CYAN }, { x: 720, c: '#ffe066' }];
  function runJump(t) {
    for (var k = 0; k < HURDLES.length; k++) {
      var d = HURDLES[k] - t * RUN_V - RUN_X;    // hurdle's distance ahead of the runner
      if (d < 26 && d > -26) return Math.sin((26 - d) / 52 * Math.PI) * 30;
    }
    return 0;
  }
  var sceneRun = {
    id: 'run', dur: 7.6, top: '#3b6fd4', bottom: '#c8553d',
    sfx: (function () {
      var s = [], i;
      COINS.forEach(function (c) { s.push([(c.x - RUN_X) / RUN_V, 'coin']); });
      GIFTS.forEach(function (g) { s.push([(g.x - RUN_X) / RUN_V, 'gift']); });
      HURDLES.forEach(function (h) { s.push([(h - RUN_X - 26) / RUN_V, 'jump']); });
      for (i = 0; i < s.length; i++) if (s[i][0] > 7.4) s.splice(i--, 1);
      return s;
    })(),
    draw: function (ctx, t, W, H, N) {
      var gy = H - 40;
      bands(ctx, W, 0, gy, ['#3b6fd4', '#4f86e0', '#6aa0ec', '#8fbdf5', '#b9d9fb']);
      disc(ctx, '#fff3a0', W - 40, 30, 13); disc(ctx, '#ffd84a', W - 40, 30, 10);
      for (var c = 0; c < 4; c++) cloud(ctx, mod(c * 97 - t * 8, W + 60) - 30, 22 + c * 9, '#ffffff');
      hills(ctx, W, gy, t, 10, '#7fa9d9', 40, 1);
      skyline(ctx, W, gy, t, 26, '#5b7fb8', '#ffe9a0', 7);
      hills(ctx, W, gy, t, 50, '#3f8a36', 14, 4);
      track(ctx, W, gy, H, t, RUN_V);
      // hurdles
      HURDLES.forEach(function (hx) {
        var sx = hx - t * RUN_V;
        if (sx < -20 || sx > W + 20) return;
        R(ctx, '#f6efe6', sx, gy - 16, 2, 16); R(ctx, '#f6efe6', sx + 10, gy - 16, 2, 16);
        R(ctx, '#ffffff', sx - 1, gy - 18, 14, 3); R(ctx, '#d62a2a', sx + 2, gy - 18, 3, 3); R(ctx, '#d62a2a', sx + 8, gy - 18, 3, 3);
      });
      // coins + gifts (vanish as he passes them, with a sparkle and a +100)
      var got = 0;
      COINS.forEach(function (cn, i) {
        var sx = cn.x - t * RUN_V, dt = t - (cn.x - RUN_X) / RUN_V;
        if (dt >= 0) {
          got++;
          if (dt < 0.35) { sparkle(ctx, '#fff6b0', RUN_X + 4, gy - cn.y - dt * 30, 3); }
          return;
        }
        if (sx > W + 8) return;
        var spin = Math.floor(t * 8 + i) % 4, w = [6, 4, 2, 4][spin];
        R(ctx, '#b8860b', sx - w / 2, gy - cn.y - 4, w, 8); R(ctx, '#ffd84a', sx - w / 2 + (w > 2 ? 1 : 0), gy - cn.y - 3, Math.max(1, w - 2), 6);
      });
      GIFTS.forEach(function (g, i) {
        var sx = g.x - t * RUN_V, dt = t - (g.x - RUN_X) / RUN_V;
        if (dt >= 0) {
          if (dt < 0.8) textO(ctx, '+500', RUN_X - 6, gy - 60 - dt * 26, 1, '#ffffff', '#3a1c05');
          return;
        }
        if (sx > W + 10) return;
        var by = gy - 52 + Math.sin(t * 4 + i) * 2;
        R(ctx, g.c, sx - 6, by, 12, 10); R(ctx, '#ffffff', sx - 1, by, 2, 10); R(ctx, '#ffffff', sx - 6, by + 4, 12, 2);
        R(ctx, '#ffffff', sx - 4, by - 3, 3, 3); R(ctx, '#ffffff', sx + 1, by - 3, 3, 3);
      });
      // the hero
      var jy = runJump(t), gifts = 0;
      GIFTS.forEach(function (g) { if (t >= (g.x - RUN_X) / RUN_V) gifts++; });
      if (jy > 4) { for (var d = 1; d < 4; d++) R(ctx, 'rgba(255,255,255,0.35)', RUN_X - 14 - d * 6, gy - jy - 30 + d * 6, 5, 1); }
      hero(ctx, RUN_X, gy - jy, 2, jy > 0 ? 'run0' : (Math.floor(t * 10) % 2 ? 'run0' : 'run1'), t);
      // dust
      if (jy === 0) for (var q = 0; q < 3; q++) { var ph = mod(t * 6 + q / 3, 1); R(ctx, '#e8b7a6', RUN_X - 10 - ph * 18, gy + 2 - ph * 4, 2, 2); }
      // HUD
      textO(ctx, 'COINS*' + (got < 10 ? '0' : '') + got, 6, N.hud, 1, '#ffe066', '#1b2a4a');
      textO(ctx, 'GIFTS*' + gifts, 6, N.hud + 10, 1, '#ff9fe0', '#1b2a4a');
      var wl = 'WORLD 1-BDAY';
      textO(ctx, wl, W - textW(wl, 1) - 6, N.hud + 10, 1, '#ffffff', '#1b2a4a');
      banner(ctx, t, 0.5, W, Math.max(44, N.hud + 22), 'RUN ' + N.first + ' RUN!', ['#ffffff', '#fff6b0', '#ffe066', '#ffcc33', '#ffe066', '#fff6b0'], '#3a1c05', 3);
    }
  };

  // Home base: his house, the three cars hopping in the driveway, a storm, and The Way's shield.
  var sceneHome = {
    id: 'home', dur: 8.4, top: '#3b6fd4', bottom: '#4f9a3e',
    sfx: [[0.9, 'honk'], [1.5, 'honk'], [2.1, 'honk'], [3.4, 'thunder'], [4.6, 'power'], [5.0, 'shield']],
    draw: function (ctx, t, W, H, N) {
      var gy = H - 26;
      var storm = clamp((t - 2.8) / 0.8) * (1 - clamp((t - 6.2) / 1.2));
      var sky = storm > 0.5 ? ['#2b3550', '#36425f', '#465373', '#566488', '#67759a'] : ['#3b6fd4', '#4f86e0', '#6aa0ec', '#8fbdf5', '#b9d9fb'];
      bands(ctx, W, 0, gy, sky);
      if (storm <= 0.5) { disc(ctx, '#fff3a0', 26, 24, 10); disc(ctx, '#ffd84a', 26, 24, 8); }
      // lawn + driveway
      R(ctx, '#57a845', 0, gy, W, H - gy); R(ctx, '#4f9a3e', 0, gy, W, 2);
      var hx = Math.round(W / 2 - 104);
      for (var j = 0; j < H - gy; j++) R(ctx, '#cfd3d0', hx + 134 + j * 0.6, gy + j, 38 + j * 1.6, 1);
      R(ctx, '#b8908a', hx + 4, gy + 6, 126, 2);               // front walk
      house(ctx, hx, gy, t);
      // the fleet: two VWs and the white Odyssey, lined up on the drive
      var fleet = [['suv', hx + 112], ['sedan', hx + 160], ['van', hx + 206]];
      var labels = ['VW', 'VW', 'HONDA'];
      for (var k = 0; k < 3; k++) {
        var tk = t - (0.9 + k * 0.6);
        var hop = tk > 0 && t < 2.8 ? Math.abs(Math.sin(tk * 9)) * 6 * Math.max(0, 1 - tk / 1.6) : 0;
        var fx = fleet[k][1], fy = gy + 22;
        if (fx > W - 20) fx = W - 46 - (2 - k) * 2;
        car(ctx, fleet[k][0], fx - 22, fy, t, { hop: hop, flash: tk > 0 && tk < 1.2 });
        if (tk > 0 && t < 2.8) textO(ctx, labels[k], fx - textW(labels[k], 1) / 2, fy - 34 - hop, 1, '#ffffff', NAVY_D);
      }
      // he runs in from the left and waves
      var rx = lerp(-20, hx - 10 > 30 ? hx - 6 : 30, easeOut(t / 1.4));
      hero(ctx, rx, gy + 24, 2, t < 1.4 ? (Math.floor(t * 10) % 2 ? 'run0' : 'run1') : (t > 5.4 ? 'flex' : 'wave'), t);
      if (t < 2.8) banner(ctx, t, 0.3, W, N.hud + 2, 'HOME BASE', ['#ffffff', CYAN_L, '#ffffff', '#fff6b0'], NAVY_D, 3);
      // storm: cloud, rain, one lightning bolt (no full-screen flash)
      if (storm > 0) {
        var cx = lerp(W + 40, W / 2 - 40, clamp((t - 2.8) / 1.2));
        for (var c = 0; c < 5; c++) cloud(ctx, cx - 70 + c * 30, 14 + (c % 2) * 6, storm > 0.5 ? '#4a4f5c' : '#6b7180');
        var shieldUp = clamp((t - 4.6) / 0.5);
        var domeR = 120, dcx = W / 2, dcy = gy + 10;
        for (var r = 0; r < Math.round(70 * storm); r++) {
          var rxp = mod(rnd(r) * W * 1.3 - t * 40, W), ry = mod(rnd(r + 50) * H + t * 180, gy + 10);
          var dd = Math.hypot(rxp - dcx, ry - dcy);
          if (shieldUp > 0 && dd < domeR * shieldUp + 2) {
            if (dd > domeR * shieldUp - 6) R(ctx, '#e8f7ff', rxp + 2, ry - 3, 1, 1);   // splash off the dome
            continue;
          }
          R(ctx, '#9fc6ff', rxp, ry, 1, 4);
        }
        if (t > 3.4 && t < 3.6) {
          var bx = W / 2 + 30, by = 24;
          for (var b = 0; b < 6; b++) { R(ctx, '#fffbd0', bx, by, 2, 8); bx += (b % 2 ? 4 : -3); by += 8; }
        }
        if (shieldUp > 0) {
          // The Way Agency dome: cyan arc with a shimmer band
          for (var a = 0; a < 180; a++) {
            var ang = Math.PI + a / 180 * Math.PI;
            var px = dcx + Math.cos(ang) * domeR * shieldUp, py = dcy + Math.sin(ang) * domeR * 0.9 * shieldUp;
            R(ctx, (a + Math.floor(t * 30)) % 12 < 3 ? '#ffffff' : CYAN, px, py, 2, 2);
          }
        }
      }
      if (t > 5.0) {
        var by2 = banner(ctx, t, 5.0, W, 36, 'COVERED!', ['#ffffff', CYAN_L, CYAN, BLUE, CYAN, CYAN_L], NAVY_D, 4);
        subtitle(ctx, t, 5.6, W, by2 + 2, 'STORM SEASON? GET COVERED.', '#ffffff', NAVY_D);
      }
    }
  };

  // Finish line: he breaks the tape; the big HAPPY BIRTHDAY drops in under fireworks.
  var sceneFinish = {
    id: 'finish', dur: 7.4, top: '#0b1530', bottom: '#c8553d',
    sfx: [[1.5, 'tape'], [1.9, 'boom'], [2.32, 'boom'], [2.74, 'boom'], [3.16, 'boom'], [3.58, 'boom'], [4.0, 'boom'], [4.42, 'boom'], [4.84, 'boom'], [5.26, 'boom']],
    draw: function (ctx, t, W, H, N) {
      var gy = H - 40;
      var shake = t > 1.5 && t < 1.85 ? Math.round((rnd(Math.floor(t * 40)) - 0.5) * 6) : 0;
      ctx.save(); ctx.translate(shake, Math.round(shake / 2));
      bands(ctx, W, -4, gy, ['#0b1530', '#13224a', '#1d3366', '#2b4682']);
      stars(ctx, t, W, gy - 40, 50, 3);
      skyline(ctx, W, gy, t > 1.6 ? 1.6 : t, 20, '#0e1a36', '#ffd36b', 7);
      // crowd
      for (var i = 0; i < W; i += 6) {
        var bob = Math.floor(t * 6 + i) % 2 && t > 1.6 ? 2 : 0;
        R(ctx, ['#ff6fd8', CYAN, '#ffe066', '#7ee36a', '#ff9f1c'][i % 5], i, gy - 10 - bob, 5, 6);
        disc(ctx, ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'][i % 4], i + 2, gy - 13 - bob, 2);
      }
      track(ctx, W, gy, H + 4, Math.min(t, 1.6), RUN_V);
      // finish arch
      var fx = Math.round(W * 0.62);
      R(ctx, '#ffffff', fx - 46, gy - 70, 3, 70); R(ctx, '#ffffff', fx + 44, gy - 70, 3, 70);
      for (var cx = 0; cx < 90; cx += 4) for (var cy = 0; cy < 12; cy += 4) R(ctx, ((cx + cy) / 4) % 2 ? '#111' : '#fff', fx - 44 + cx, gy - 70 + cy, 4, 4);
      R(ctx, NAVY, fx - 30, gy - 66, 61, 9); text(ctx, 'FINISH', fx - 17, gy - 65, 1, '#ffe066');
      // tape: whole until he hits it, then two halves flutter down
      if (t < 1.5) R(ctx, '#ff4d6d', fx - 44, gy - 30, 90, 2);
      else {
        var dt = t - 1.5;
        for (var k = 0; k < 20; k++) {
          R(ctx, '#ff4d6d', fx - 44 + k * 2 - dt * 4, gy - 30 + k * k * 0.04 * Math.min(1, dt * 3) + dt * 6 * (k / 20), 2, 2);
          R(ctx, '#ff4d6d', fx + 44 - k * 2 + dt * 4, gy - 30 + k * k * 0.04 * Math.min(1, dt * 3) + dt * 6 * (k / 20), 2, 2);
        }
      }
      var hx = t < 1.6 ? lerp(-20, fx + 6, t / 1.6) : fx + 6 + easeOut((t - 1.6) / 0.6) * 18;
      hero(ctx, hx, gy + 4, 2, t < 2.2 ? (Math.floor(t * 10) % 2 ? 'run0' : 'run1') : (t > 4.2 ? 'flex' : 'wave'), t);
      if (t > 1.5 && t < 1.9) { var p = (t - 1.5) / 0.4; for (var s = 0; s < 8; s++) sparkle(ctx, '#ffffff', fx + Math.cos(s * 0.78) * p * 30, gy - 30 + Math.sin(s * 0.78) * p * 20, 2); }
      fireworkShow(ctx, t, 1.9, W, H, FW, 9, 0.42);
      confetti(ctx, t, 2.0, W, H, RAINBOW, 110);
      ctx.restore();
      var y1 = banner(ctx, t, 2.2, W, 14, 'HAPPY BIRTHDAY', GOLD, '#3a1c05', 4);
      if (N.full) banner(ctx, t, 2.9, W, y1 + 4, N.full + '!', RAINBOW, '#2a0a3a', 3);
      else subtitle(ctx, t, 2.9, W, y1 + 6, 'YOU WIN AT LIFE!', '#ffffff', '#2a0a3a');
    }
  };

  // Boss fight: a giant birthday cake. He flexes, blows out every candle, levels up.
  var CANDLES = 9;
  var sceneBoss = {
    id: 'boss', dur: 9.0, top: '#1a0b2e', bottom: '#2a1240',
    sfx: (function () {
      var s = [[0.2, 'boss'], [1.0, 'flex'], [1.6, 'flex'], [2.4, 'blow']];
      for (var i = 0; i < CANDLES; i++) s.push([2.9 + i * 0.16, 'puff']);
      s.push([4.5, 'ko'], [5.0, 'levelup'], [5.4, 'boom'], [5.8, 'boom'], [6.2, 'boom'], [6.6, 'boom'], [7.0, 'boom']);
      return s;
    })(),
    draw: function (ctx, t, W, H, N) {
      var gy = H - 28;
      bands(ctx, W, 0, gy, ['#1a0b2e', '#241040', '#2f1452', '#3b1a66', '#4a2280']);
      stars(ctx, t, W, gy - 30, 40, 9);
      // spotlight beams
      for (var b = 0; b < 4; b++) {
        var bx = W * (0.15 + b * 0.24) + Math.sin(t * 1.3 + b) * 20;
        for (var y = 0; y < gy; y += 2) R(ctx, 'rgba(255,255,255,0.05)', bx - y * 0.25, y, 4 + y * 0.5, 2);
      }
      R(ctx, '#2a1240', 0, gy, W, H - gy);
      for (var x = 0; x < W; x += 16) R(ctx, (x / 16) % 2 ? '#3b1a66' : '#2f1452', x, gy, 16, 4);
      // the cake boss
      var ko = t > 4.5, cx = Math.round(W * 0.7), wob = ko ? 0 : Math.round(Math.sin(t * 5) * 1);
      var tiers = [[80, 28, '#f7d6e0', '#ff6fd8'], [60, 22, '#fff1d6', CYAN], [40, 20, '#f7d6e0', '#ffe066']];
      var ty = gy;
      for (var k = 0; k < 3; k++) {
        var tw = tiers[k][0], th = tiers[k][1];
        R(ctx, tiers[k][2], cx - tw / 2 + wob * k, ty - th, tw, th);
        for (var d = 0; d < tw; d += 6) R(ctx, tiers[k][3], cx - tw / 2 + d + wob * k, ty - th, 4, 3 + ((d / 6) % 2) * 2);
        ty -= th;
      }
      // boss face
      var fy = gy - 44;
      if (!ko) {
        R(ctx, '#111', cx - 14, fy, 6, 6); R(ctx, '#111', cx + 8, fy, 6, 6); R(ctx, '#ffffff', cx - 12, fy + 1, 2, 2); R(ctx, '#ffffff', cx + 10, fy + 1, 2, 2);
        R(ctx, '#111', cx - 16, fy - 4, 8, 2); R(ctx, '#111', cx + 8, fy - 4, 8, 2);
        R(ctx, '#7a1030', cx - 8, fy + 10, 16, 3);
      } else {
        text(ctx, 'X', cx - 15, fy - 1, 1, '#111'); text(ctx, 'X', cx + 9, fy - 1, 1, '#111');
        R(ctx, '#111', cx - 6, fy + 11, 12, 1);
      }
      // candles: each goes out in turn once he blows
      var top = gy - 70;
      for (var c = 0; c < CANDLES; c++) {
        var ccx = cx - 17 + c * 4 + wob * 2;
        R(ctx, c % 2 ? '#20BCEE' : '#ff6fd8', ccx, top - 8, 2, 8);
        var out = t > 2.9 + c * 0.16;
        if (!out) {
          var fl = Math.floor(t * 12 + c) % 2;
          R(ctx, '#ffcc33', ccx, top - 12 - fl, 2, 3 + fl); R(ctx, '#ffffff', ccx, top - 11, 1, 1);
        } else {
          var st = t - (2.9 + c * 0.16);
          if (st < 1.2) for (var sm = 0; sm < 3; sm++) R(ctx, 'rgba(220,220,230,' + (0.7 - st * 0.5) + ')', ccx + Math.sin(st * 6 + sm) * 2, top - 12 - st * 16 - sm * 4, 2, 2);
        }
      }
      // HP bar
      var hp = t < 2.9 ? 1 : Math.max(0, 1 - (t - 2.9) / (CANDLES * 0.16));
      var hy = N.hud;
      textO(ctx, 'BOSS: THE CAKE', W - textW('BOSS: THE CAKE', 1) - 8, hy, 1, '#ffffff', '#1a0b2e');
      R(ctx, '#ffffff', W - 88, hy + 10, 80, 6); R(ctx, '#1a0b2e', W - 87, hy + 11, 78, 4);
      R(ctx, hp > 0.3 ? '#7ee36a' : '#ff4d6d', W - 87, hy + 11, Math.round(78 * hp), 4);
      textO(ctx, N.first, 8, hy, 1, '#ffe066', '#1a0b2e');
      R(ctx, '#ffffff', 8, hy + 10, 60, 6); R(ctx, '#7ee36a', 9, hy + 11, 58, 4);
      // the hero: walks in, double-bicep flexes (abs shine), then blows
      var hx = lerp(-20, Math.round(W * 0.28), easeOut(t / 0.9));
      var pose = t < 0.9 ? (Math.floor(t * 10) % 2 ? 'run0' : 'run1') : (t < 2.4 ? 'flex' : (t < 4.5 ? 'blow' : 'flex'));
      var shine = t > 1.0 && t < 2.3 ? mod((t - 1.0) / 0.65, 1) : (t > 5 ? mod(t - 5, 1.2) / 1.2 : null);
      hero(ctx, hx, gy + 2, 3, pose, t, { shine: shine });
      if (t > 1.0 && t < 2.4) {
        var pp = (t - 1.0) % 0.6;
        textO(ctx, '+100 SWOLE', hx - 26, gy - 92 - pp * 20, 1, '#ffe066', '#1a0b2e');
        sparkle(ctx, '#ffffff', hx - 18 + Math.sin(t * 8) * 3, gy - 70, 2); sparkle(ctx, '#ffffff', hx + 20, gy - 66 + Math.cos(t * 8) * 3, 2);
      }
      if (t > 2.4 && t < 4.5) {
        for (var w = 0; w < 14; w++) {
          var wp = mod(t * 2.2 + w / 14, 1);
          R(ctx, 'rgba(255,255,255,0.75)', lerp(hx + 18, cx - 14, wp), gy - 64 + Math.sin(w * 1.7 + t * 9) * 6 - wp * 6, 4, 1);
        }
      }
      if (t > 4.5 && t < 5.2) banner(ctx, t, 4.5, W, 50, 'K.O.!', ['#ffd0d8', '#ff9fb0', '#ff4d6d', '#ff9fb0'], '#2a0a3a', 5);
      if (t > 5.0) {
        fireworkShow(ctx, t, 5.4, W, H, FW, 7, 0.4);
        confetti(ctx, t, 5.0, W, H, RAINBOW, 120);
        var y2 = banner(ctx, t, 5.2, W, 30, 'LEVEL UP!', RAINBOW, '#2a0a3a', 4);
        subtitle(ctx, t, 5.8, W, y2 + 4, 'ANOTHER YEAR UNLOCKED', '#ffffff', '#2a0a3a');
      }
    }
  };

  var SCENES = [sceneTitle, sceneRun, sceneHome, sceneFinish, sceneBoss];
  var TOTAL = SCENES.reduce(function (m, s) { return m + s.dur; }, 0);
  function sceneAt(T) {
    var tt = mod(T, TOTAL);
    for (var i = 0; i < SCENES.length; i++) { if (tt < SCENES[i].dur) return { i: i, s: SCENES[i], t: tt }; tt -= SCENES[i].dur; }
    return { i: 0, s: SCENES[0], t: 0 };
  }

  // ═══ CHIPTUNE (oscillators + a noise buffer only; no media files) ═══
  var AC = null, master = null, noiseBuf = null, muted = false;
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function tone(type, f, t0, dur, vol, f2) {
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(t0, dur, vol, hp) {
    var s = AC.createBufferSource(), g = AC.createGain(), f = AC.createBiquadFilter();
    s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = hp || 800;
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0 + dur + 0.02);
  }
  var SFX = {
    coin: function (t) { tone('square', 988, t, 0.06, 0.09); tone('square', 1319, t + 0.06, 0.18, 0.09); },
    gift: function (t) { [72, 76, 79, 84].forEach(function (m, i) { tone('square', mtof(m), t + i * 0.05, 0.1, 0.08); }); },
    jump: function (t) { tone('square', 300, t, 0.22, 0.08, 900); },
    select: function (t) { tone('square', 660, t, 0.08, 0.08); tone('square', 880, t + 0.09, 0.12, 0.08); },
    power: function (t) { for (var i = 0; i < 8; i++) tone('square', mtof(60 + i * 2), t + i * 0.04, 0.06, 0.06); },
    honk: function (t) { tone('square', 392, t, 0.16, 0.07); tone('square', 494, t, 0.16, 0.05); },
    thunder: function (t) { noise(t, 1.1, 0.35, 60); },
    shield: function (t) { tone('triangle', 523, t, 0.5, 0.12, 1568); tone('square', 1047, t + 0.1, 0.4, 0.04, 2093); },
    tape: function (t) { noise(t, 0.25, 0.3, 2000); tone('square', 784, t, 0.3, 0.07, 1568); },
    boom: function (t) { noise(t, 0.6, 0.28, 200); },
    boss: function (t) { tone('sawtooth', 110, t, 0.5, 0.08, 55); },
    flex: function (t) { tone('square', 523, t, 0.07, 0.07); tone('square', 784, t + 0.07, 0.12, 0.07); },
    blow: function (t) { noise(t, 2.0, 0.12, 400); },
    puff: function (t) { noise(t, 0.12, 0.12, 3000); },
    ko: function (t) { tone('square', 880, t, 0.4, 0.09, 110); },
    levelup: function (t) { [60, 64, 67, 72, 76, 79, 84].forEach(function (m, i) { tone('square', mtof(m), t + i * 0.07, 0.14, 0.08); }); }
  };
  // Happy Birthday in C, 3/4, then an octave-up pass with harmony, then a fanfare bridge.
  var BPM = 152, BEAT = 60 / BPM;
  var MEL = [[null, 2], [67, 0.75], [67, 0.25],
    [69, 1], [67, 1], [72, 1], [71, 2], [67, 0.75], [67, 0.25],
    [69, 1], [67, 1], [74, 1], [72, 2], [67, 0.75], [67, 0.25],
    [79, 1], [76, 1], [72, 1], [71, 1], [69, 1], [77, 0.75], [77, 0.25],
    [76, 1], [72, 1], [74, 1], [72, 3]];
  var CHORDS = [null, 48, 43, 43, 48, 48, 53, 48, 48];       // bar roots (C2 = 36 + 12)
  var SONG = (function () {
    var ev = [], beat = 0, pass, i;
    for (pass = 0; pass < 2; pass++) {
      var b = beat;
      MEL.forEach(function (n) {
        if (n[0] != null) {
          ev.push({ b: b, fn: (function (m, d, p) { return function (t) {
            tone('square', mtof(m + (p ? 12 : 0)), t, d * BEAT * 0.9, p ? 0.05 : 0.07);
            if (p) tone('triangle', mtof(m + 4), t, d * BEAT * 0.9, 0.05);
          }; })(n[0], n[1], pass) });
        }
        b += n[1];
      });
      for (i = 1; i < CHORDS.length; i++) {
        (function (root, bar) {
          for (var k = 0; k < 3; k++) {
            ev.push({ b: beat + bar * 3 + k, fn: function (t) { tone('triangle', mtof(root + (k ? 7 : 0) - 12), t, BEAT * 0.8, 0.14); } });
            ev.push({ b: beat + bar * 3 + k + 0.5, fn: function (t) { noise(t, 0.04, 0.05, 6000); } });
          }
          ev.push({ b: beat + bar * 3, fn: function (t) { tone('sine', 150, t, 0.18, 0.3, 40); } });
          ev.push({ b: beat + bar * 3 + 2, fn: function (t) { noise(t, 0.12, 0.12, 1500); } });
        })(CHORDS[i], i);
      }
      beat += 27;
    }
    // fanfare: rising arpeggios C F G C, four bars
    [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79]].forEach(function (ch, bar) {
      for (var k = 0; k < 6; k++) {
        (function (m, at) { ev.push({ b: at, fn: function (t) { tone('square', mtof(m), t, BEAT * 0.45, 0.06); } }); })(ch[k % 3] + (k > 2 ? 12 : 0), beat + bar * 3 + k * 0.5);
      }
      ev.push({ b: beat + bar * 3, fn: function (t) { tone('sine', 150, t, 0.18, 0.3, 40); } });
      ev.push({ b: beat + bar * 3, fn: (function (r) { return function (t) { tone('triangle', mtof(r - 12), t, BEAT * 2.6, 0.14); }; })(ch[0] - 12) });
    });
    beat += 12;
    ev.sort(function (a, b2) { return a.b - b2.b; });
    return { ev: ev, beats: beat };
  })();
  var songStart = 0, songIdx = 0, songLoop = 0, schedTimer = null;
  function schedule() {
    if (!AC) return;
    var horizon = AC.currentTime + 0.15;
    for (;;) {
      var e = SONG.ev[songIdx];
      var at = songStart + (songLoop * SONG.beats + e.b) * BEAT;
      if (at > horizon) break;
      if (at > AC.currentTime - 0.05) e.fn(Math.max(at, AC.currentTime));
      songIdx++;
      if (songIdx >= SONG.ev.length) { songIdx = 0; songLoop++; }
    }
  }
  function startAudio() {
    if (AC) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx();
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    songStart = AC.currentTime + 0.1; songIdx = 0; songLoop = 0;
    schedTimer = setInterval(schedule, 40);
    // Created outside a tap (PRESS START came before this script): iOS Safari keeps the
    // context suspended until a gesture resumes it, so resume on the next one.
    // A finger's pointerdown is not a gesture (its pointerup/touchend is), so listen for
    // all of them and only stop once the context is actually running.
    if (AC.state === 'suspended') {
      var GESTURES = ['pointerup', 'touchend', 'click', 'keydown'];
      var wake = function () {
        AC.resume().then(function () {
          if (AC.state !== 'running') return;
          GESTURES.forEach(function (g) { window.removeEventListener(g, wake, true); });
        }, function () {});
      };
      GESTURES.forEach(function (g) { window.addEventListener(g, wake, true); });
    }
  }
  function setMuted(m) {
    muted = m;
    if (AC && AC.state === 'suspended' && !document.hidden) AC.resume();
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.5, AC.currentTime, 0.02);
  }
  function sfx(name) { if (AC && !muted && SFX[name]) SFX[name](AC.currentTime + 0.01); }

  // ═══ NAME (from the fragment) ═══
  function readName() {
    var h = '';
    try { h = decodeURIComponent((location.hash || '').slice(1)); } catch (e) { h = ''; }
    h = h.replace(/[-_+.]+/g, ' ').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24).trim();
    var first = h.split(' ')[0] || '';
    return { full: h, first: first || 'CHAMP', given: first };
  }

  // ═══ FRAME LOOP ═══
  function init() {
    var cv = document.getElementById('bdayCanvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var N = readName();
    var W = 256, H = STAGE_H, oy = 0, hud = 4, lastDrawn = null;
    // Fit the 180-row stage into the wrapper (which stops above the docked quote box).
    // Wide screens get up to 480 columns, then side bars; tall ones get extra sky and ground.
    function resize() {
      var wrap = cv.parentNode;
      var cw = wrap.clientWidth || window.innerWidth, ch = wrap.clientHeight || window.innerHeight;
      var s = Math.min(cw / 256, ch / STAGE_H);
      W = Math.min(480, Math.max(256, Math.floor(cw / s))); H = Math.max(STAGE_H, Math.floor(ch / s));
      oy = Math.floor((H - STAGE_H) * 0.42);
      hud = Math.max(4, Math.ceil(52 / s) - oy);          // clear of the logo bar
      cv.width = W; cv.height = H;
      cv.style.width = Math.round(W * s) + 'px'; cv.style.height = Math.round(H * s) + 'px';
      ctx.imageSmoothingEnabled = false;
      if (lastDrawn != null) frame(lastDrawn);             // a canvas resize wipes it: redraw (reduced motion has no loop)
    }
    resize();
    window.addEventListener('resize', resize);

    function frame(T) {
      var cur = sceneAt(T);
      lastDrawn = T;
      N.hud = hud;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      R(ctx, cur.s.top, 0, 0, W, oy + 1);
      R(ctx, cur.s.bottom, 0, oy + STAGE_H - 1, W, H - oy - STAGE_H + 1);
      ctx.translate(0, oy);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, STAGE_H); ctx.clip();
      try { cur.s.draw(ctx, cur.t, W, STAGE_H, N); } catch (e) { if (window.__bdayDebug) throw e; }
      ctx.restore();
      // iris wipe between scenes (classic 16-bit), no white flash
      var edge = Math.min(cur.t / 0.45, (cur.s.dur - cur.t) / 0.35);
      if (edge < 1) {
        var r = Math.max(0, edge) * Math.hypot(W, H);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(W / 2, oy + STAGE_H / 2, r, 0, Math.PI * 2, true); ctx.fill();
      }
      return cur;
    }

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var api = { seek: function (T) { return frame(T); }, total: TOTAL, scenes: SCENES.map(function (s) { return s.id + ':' + s.dur; }) };
    window.__bdayCard = api;
    document.dispatchEvent(new CustomEvent('bday:ready', { detail: { name: N } }));
    window.addEventListener('hashchange', function () {
      N = readName(); document.dispatchEvent(new CustomEvent('bday:ready', { detail: { name: N } }));
      if (lastDrawn != null) frame(lastDrawn);
    });
    if (reduce) {
      frame(sceneTitle.dur + sceneRun.dur + sceneHome.dur + 5.4);
      document.dispatchEvent(new CustomEvent('bday:cta'));
      return;
    }

    var T = 0, last = null, raf = 0, ctaShown = false, lastScene = -1, lastT = 0;
    var ctaAt = sceneTitle.dur + sceneRun.dur + 5.4;
    function tick(now) {
      if (last == null) last = now;
      T += Math.min(0.1, (now - last) / 1000); last = now;
      var cur = frame(T);
      // fire this scene's sound effects as their moments pass
      if (cur.i !== lastScene) { lastScene = cur.i; lastT = -1; }
      var list = cur.s.sfx || [];
      for (var i = 0; i < list.length; i++) if (list[i][0] > lastT && list[i][0] <= cur.t) sfx(list[i][1]);
      lastT = cur.t;
      if (!ctaShown && T >= ctaAt) { ctaShown = true; document.dispatchEvent(new CustomEvent('bday:cta')); }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { cancelAnimationFrame(raf); last = null; if (AC) AC.suspend(); }
      else { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); if (AC) AC.resume(); }
    });
    api.startAudio = startAudio; api.setMuted = setMuted;
  }

  window.BdayCard = { startAudio: startAudio, setMuted: setMuted, isMuted: function () { return muted; }, readName: readName, FONT: FONT };
  if (window.__bdayWantsAudio) startAudio();               // PRESS START came before this script
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
