// Interactive figure for the DS savegame carving post.
// Everything here is illustrative: a 12 MB "image" with three intact saves and
// one hit too close to the end. Pattern and sizes are the real ones.
(function () {
  var root = document.getElementById('carve');
  if (!root) return;

  var COLS = 64, ROWS = 12, N = COLS * ROWS;
  var CELL = 0x4000;                       // one square = 16 KB
  var IMG = N * CELL;                      // 12 MB
  var SAVE = 0x80000;                      // 524,288 bytes
  var PAT = [0xB0, 0x29, 0x4D, 0x61, 0x72, 0x69, 0x6F, 0x32];
  var TAIL = SAVE - PAT.length;            // 524,280
  var HITS = [0x0011A3C5, 0x004B2E11, 0x0080D6A3, 0x00BC1F08];

  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var seed = 0x5eed;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function hex(n, w) { var s = n.toString(16).toUpperCase(); while (s.length < w) s = '0' + s; return s; }
  function fmt(n) { return n.toLocaleString('en-US'); }

  // ---- hits -> cell ranges
  var hits = HITS.map(function (off) {
    var end = off + SAVE;
    return {
      off: off, ok: end <= IMG,
      c0: Math.floor(off / CELL),
      c1: Math.min(N, Math.ceil(end / CELL)),   // exclusive
      left: IMG - off - PAT.length
    };
  });
  function inSave(c) {
    for (var i = 0; i < hits.length; i++) if (c >= hits[i].c0 && c < hits[i].c1) return true;
    return false;
  }

  // ---- overview map: runs of "noise", erased 0xFF and 0x00
  var map = document.getElementById('carveMap');
  var cells = [], c = 0;
  while (c < N) {
    var r = rnd(), type = r < 0.58 ? 'noise' : r < 0.88 ? 'ff' : 'zero';
    var len = 3 + Math.floor(rnd() * 38);
    for (var j = 0; j < len && c < N; j++, c++) {
      var t = inSave(c) ? 'noise' : type;
      var k = t === 'ff' ? 6 : t === 'zero' ? 40 : 13 + Math.floor(rnd() * 17);
      var el = document.createElement('i');
      el.style.setProperty('--k', k + '%');
      map.appendChild(el); cells.push(el);
    }
  }
  document.getElementById('carveScale').textContent =
    '1 square = 16 KB, ' + fmt(IMG) + ' bytes in total';

  // ---- hex zoom around hit 1
  var h1 = HITS[0], h1end = h1 + SAVE;     // exclusive
  function kind(addr) {
    if (addr >= h1 && addr < h1 + PAT.length) return 'p';
    if (addr >= h1 + PAT.length && addr < h1end) return 's';
    return 'n';
  }
  function byteAt(addr) {
    var k = kind(addr);
    if (k === 'p') return PAT[addr - h1];
    var x = rnd();
    if (k === 'n') return x < 0.3 ? 0xFF : Math.floor(rnd() * 256);
    return x < 0.35 ? 0x00 : Math.floor(rnd() * 256);
  }
  var hexBox = document.getElementById('carveHex');
  var rowsTop = [], base = h1 - (h1 % 16);
  for (var a = base - 48; a <= base + 32; a += 16) rowsTop.push(a);
  var endBase = (h1end - 1) - ((h1end - 1) % 16);
  var rowsBot = [endBase - 16, endBase, endBase + 16];
  var shown = 0;
  function row(addr) {
    var r = document.createElement('div'); r.className = 'r';
    var o = document.createElement('span'); o.className = 'o'; o.textContent = hex(addr, 8);
    var b = document.createElement('span'); b.className = 'bytes';
    var t = document.createElement('span'); t.className = 'asc';
    for (var i = 0; i < 16; i++) {
      var ad = addr + i, v = byteAt(ad), k = kind(ad);
      if (k !== 'n') shown++;
      var sb = document.createElement('span'); sb.className = k; sb.textContent = hex(v, 2);
      var st = document.createElement('span'); st.className = k;
      st.textContent = v >= 32 && v < 127 ? String.fromCharCode(v) : '.';
      b.appendChild(sb); t.appendChild(st);
    }
    r.appendChild(o); r.appendChild(b); r.appendChild(t);
    hexBox.appendChild(r);
  }
  rowsTop.forEach(row);
  var gap = document.createElement('div'); gap.className = 'gap';
  hexBox.appendChild(gap);
  rowsBot.forEach(row);
  gap.textContent = '... ' + fmt(SAVE - shown) + ' more bytes of the save ...';

  // ---- carved file list
  var files = document.getElementById('carveFiles');
  hits.forEach(function (h, i) {
    var li = document.createElement('li');
    var name = 'savegame_' + ('00' + (i + 1)).slice(-3) + '_offset_0x' + hex(h.off, 8) + '.sav';
    if (h.ok) {
      li.innerHTML = '<span></span><em></em>';
      li.firstChild.textContent = name;
      li.lastChild.textContent = fmt(SAVE) + ' bytes';
    } else {
      li.className = 'skip';
      li.innerHTML = '<span></span><em></em>';
      li.firstChild.textContent = 'hit ' + (i + 1) + ' at 0x' + hex(h.off, 8) + ': skipped';
      li.lastChild.textContent = 'needs ' + fmt(TAIL) + ' bytes after the pattern, only ' + fmt(h.left) + ' left';
    }
    li.style.animationDelay = (i * 90) + 'ms';
    files.appendChild(li);
  });

  // ---- steps
  var say = [
    'This is the dump of the card: ' + fmt(IMG) + ' bytes and no file table. Somewhere in here are savegames, ' +
      'but to the eye they look exactly like everything else.',
    'Search every byte offset for B0 29 4D 61 72 69 6F 32 (".)Mario2"). ' + hits.length +
      ' hits. Each one is where a save could start, and none of them sits on a nice round address.',
    'From each hit, take the 8 pattern bytes plus the next ' + fmt(TAIL) + ', so every save is exactly ' +
      fmt(SAVE) + ' bytes. The last hit is too close to the end of the image for that.',
    'Write every complete span to its own file, named after its offset. The truncated hit is reported and skipped.'
  ];
  var buttons = [].slice.call(root.querySelectorAll('.carve-steps button'));
  var sayEl = document.getElementById('carveSay');
  var token = 0;

  function paint(matchUpTo, fill) {
    // matchUpTo: cells < this index can show their match; fill: 0..1 of each save span
    cells.forEach(function (el) { el.className = ''; });
    hits.forEach(function (h) {
      if (h.c0 >= matchUpTo) return;
      var stop = h.c0 + Math.round((h.c1 - h.c0) * fill);
      for (var i = h.c0 + 1; i < stop; i++) cells[i].className = h.ok ? 'save' : 'trunc';
      cells[h.c0].className = 'match';
    });
  }
  function animate(ms, fn, done) {
    var my = ++token, t0 = null;
    if (reduced) { fn(1); if (done) done(); return; }
    function tick(t) {
      if (my !== token) return;
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / ms);
      fn(p);
      if (p < 1) requestAnimationFrame(tick); else if (done) done();
    }
    requestAnimationFrame(tick);
  }
  function go(step) {
    token++;
    buttons.forEach(function (b, i) { b.setAttribute('aria-pressed', i === step ? 'true' : 'false'); });
    root.classList.toggle('s1', step >= 1);
    root.classList.toggle('s2', step >= 2);
    root.classList.toggle('s3', step >= 3);
    sayEl.textContent = say[step];
    if (step === 0) { paint(0, 0); return; }
    if (step === 1) {
      animate(1600, function (p) {
        var cur = Math.floor(p * N);
        paint(cur + 1, 0);
        if (p < 1 && cells[cur]) cells[cur].className = 'cur';
      });
      return;
    }
    if (step === 2) { animate(900, function (p) { paint(N, p); }); return; }
    paint(N, 1);
  }
  buttons.forEach(function (b, i) { b.addEventListener('click', function () { go(i); }); });
  go(0);
})();
