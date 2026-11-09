(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  /* ===== TINGKAT KUALITAS OTOMATIS (hemat RAM & GPU untuk Chromebook) =====
     low  = Chromebook RAM 4 GB atau kurang / CPU 4 core ke bawah (otomatis)
     Paksa manual dengan menambahkan ?q=low  atau  ?q=mid  atau  ?q=high  di alamat web. */
  var QL = (function () {
    var m = (location.search.match(/[?&]q=(low|mid|high)/) || [])[1];
    if (!m) { var mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4; m = (mem <= 4 || cores <= 4) ? 'low' : (mem <= 8 ? 'mid' : 'high'); }
    var T = {
      low:  { n: 'low',  res: .8,  dpr: 1,    aa: false, K: 3,   fogN: 45, fogF: 175, trees: 120, clouds: 5,  hills: 10, tex: .5,  aniso: 2, mip: false, mini: 9, cull: true },
      mid:  { n: 'mid',  res: .95, dpr: 1.25, aa: false, K: 4.5, fogN: 65, fogF: 250, trees: 210, clouds: 9,  hills: 20, tex: .75, aniso: 4, mip: true,  mini: 7, cull: true },
      high: { n: 'high', res: 1,   dpr: 2,    aa: true,  K: 6,   fogN: 90, fogF: 330, trees: 300, clouds: 14, hills: 30, tex: 1,   aniso: 8, mip: true,  mini: 6, cull: true }
    };
    return T[m];
  })();
  var CELL = 64, CH = [];   /* potongan peta (chunk): hanya yang dekat & menghadap kamera yang digambar */
  function chReg(im, pts) {
    var i, p, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, cx, cz, r = 0;
    for (i = 0; i < pts.length; i++) { p = pts[i]; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1]; }
    cx = (x0 + x1) / 2; cz = (z0 + z1) / 2;
    for (i = 0; i < pts.length; i++) { p = pts[i]; r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cz) + p[2]); }
    im.userData.cc = [cx, cz, r + 10]; CH.push(im);
  }
  var cullN = 0, _cf = [0, 0];
  function cullStep() {
    if (!QL.cull || !CH.length) return;
    var cx = camera.position.x, cz = camera.position.z, far = scene.fog ? scene.fog.far : 400, ry = camera.rotation.y;
    var ang = Math.abs(camera.rotation.x) < .75 && playerY < 6, fx = -Math.sin(ry), fz = -Math.cos(ry), i, im, c, dx, dz, d, vis, a;
    for (i = 0; i < CH.length; i++) {
      im = CH[i]; c = im.userData.cc; dx = c[0] - cx; dz = c[1] - cz; d = Math.sqrt(dx * dx + dz * dz);
      vis = d < far + c[2];
      if (vis && ang && d > c[2] + 4) {
        a = Math.acos(clamp((dx * fx + dz * fz) / d, -1, 1));
        if (a > 1.0 + Math.asin(Math.min(1, c[2] / d))) vis = false;
      }
      im.visible = vis;
    }
  }
  /* resolusi adaptif: kalau FPS turun, gambar otomatis diturunkan sedikit supaya tetap lancar */
  var RES = { base: 1, cur: 1, acc: 0, n: 0, cool: 0 };
  function resInit() { RES.base = Math.min(window.devicePixelRatio || 1, QL.dpr) * QL.res; RES.cur = RES.base; renderer.setPixelRatio(RES.cur); }
  function resStep(dt) {
    RES.acc += dt; RES.n++; RES.cool -= dt;
    if (RES.acc < 2) return;
    var avg = RES.acc / RES.n; RES.acc = 0; RES.n = 0;
    if (RES.cool > 0 || document.hidden) return;
    var minR = Math.max(.45, RES.base * .55), nr = RES.cur;
    if (avg > 1 / 38 && RES.cur > minR) nr = Math.max(minR, RES.cur - .1);
    else if (avg < 1 / 56 && RES.cur < RES.base) nr = Math.min(RES.base, RES.cur + .05);
    if (Math.abs(nr - RES.cur) > .001) { RES.cur = nr; RES.cool = 3; renderer.setPixelRatio(nr); renderer.setSize(window.innerWidth, window.innerHeight, false); }
  }
  var D = window.GAME_DATA, MP = window.MAP, NPC = D.npcs, QS = D.questions, N = NPC.length, NQ = QS.length, CFG = D.config;
  var P = MP.P, HALF = MP.HALF, WX = HALF.x * 2, WZ = HALF.z * 2;
  NPC.forEach(function (d, i) { var p = P(MP.NPCPOS[i].px[0], MP.NPCPOS[i].px[1]); d.x = p[0]; d.z = p[1]; d.clue = MP.NPCPOS[i].clue; d.ox = d.x; d.oz = d.z; d.oclue = d.clue; d.fl = null; });
  var GREET = ['Halo! Aku punya soal untukmu.', 'Hai! Bantu aku menjawab soal ini, ya.', 'Wah, kamu menemukanku! Ini soalnya.', 'Ayo berpikir bersama! Coba jawab ini.', 'Hore, ada teman! Aku punya soal dokumen rapi.'];
  var TYPE_NAME = { pg: 'Pilihan Ganda', pgk: 'Pilihan Ganda Kompleks', isian: 'Isian Singkat' };
  var TRY_F = [1, .6, .35], SK_F = [1, .85, .7, .55];
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var r2 = function (v) { return Math.round(v * 100) / 100; };
  var isTouch = ((('ontouchstart' in window) || navigator.maxTouchPoints > 0) && window.matchMedia && window.matchMedia('(pointer:coarse)').matches);
  if (isTouch) document.body.classList.add('touch');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- audio ---------- */
  var AC = null;
  function beep(f, d, type, delay) {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      var t0 = AC.currentTime + (delay || 0), o = AC.createOscillator(), g = AC.createGain();
      o.type = type || 'sine'; o.frequency.value = f; g.gain.setValueAtTime(.07, t0);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + d); o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0 + d);
    } catch (e) { }
  }

  /* ---------- state ---------- */
  var state = 'intro', playerName = '', kelas = '', absen = '', sid = '', sent = false, practiceOnly = false;
  var score = 0, done = 0, res = new Array(N).fill(null), att = new Array(N).fill(0), lastOk = false, cur = -1, qopts = [], skHTML = '';
  var qmap = [], mg = 0, stars = 0, finished = false, inGame = false, startX = 0, startZ = 0, startYaw = 0, SPAWN = { x: 0, z: 0, yaw: Math.PI };
  var W = { ready: false, fail: false, npc: [], dyn: [] };
  var ANIM = [];
  var renderer, scene, camera, clock, sky, clouds = [];
  var yaw = 0, pitch = 0, locked = false, dragging = false, keys = {}, joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 }, lookId = null, lookLast = null;
  var pos = { x: 0, y: 1.6, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z; } }, bobT = 0, moving = false, frameN = 0, started = false;
  var ride = null;
  var FLY_MAX = 90, VIEWK = 1;   /* tinggi terbang maksimum (aturan Firebase membatasi < 100) & pengali jarak pandang */
  var coins = 0, ownedCostumes = {}, activeCostume = '', jumpV = 0, playerY = 0, flying = false, fireCooldown = 0, motor = null, motorOn = false, nosActive = false, mpFire = null;
  var ANIM = [];
  var COSTUMES = [
    { id: 'tracker', name: '👁️ Penjelajah', price: 100, desc: 'Radar menampilkan lokasi seluruh NPC di peta dan minimap.' },
    { id: 'jumper', name: '🦘 Sky Jumper', price: 220, desc: 'Lompat tinggi dengan Space.' },
    { id: 'rider', name: '🏍️ Nitro Rider', price: 380, desc: 'Tekan R untuk menaiki motor, Shift untuk NOS.' },
    { id: 'fire', name: '🔥 Pyro Titan', price: 560, desc: 'Klik kiri atau F untuk menembakkan api. Semua benda terbakar dan hancur (rumah, ruko, angkot, pohon, gedung), kecuali orang.' },
    { id: 'flyer', name: '🪽 Sky Guardian', price: 800, desc: 'Tekan G untuk terbang tinggi (Space naik, Shift turun). Makin tinggi, pandangan makin luas.' }
  ];
  function activePower(id) { return activeCostume === id && !!ownedCostumes[id]; }
  function openShop() { if (state !== 'play') return; releaseLock(); setState('shop'); renderShop(); $('shop').hidden = false; $('shopCard').focus(); }
  function renderShop() {
    $('shopCoins').textContent = coins; $('hCoins').textContent = coins;
    $('shopItems').innerHTML = COSTUMES.map(function (c) {
      var own = !!ownedCostumes[c.id], active = activeCostume === c.id;
      return '<div class="shop-item ' + (active ? 'active' : '') + '"><h3>' + c.name + '</h3><p>' + c.desc + '</p><b>🪙 ' + c.price + ' koin</b><button class="btn ' + (active ? '' : 'alt') + ' small" data-costume="' + c.id + '">' + (active ? 'Sedang dipakai' : own ? 'Pakai kostum' : 'Beli kostum') + '</button></div>';
    }).join('');
    Array.prototype.forEach.call($('shopItems').querySelectorAll('[data-costume]'), function (b) {
      b.addEventListener('click', function () {
        var c = COSTUMES.filter(function (x) { return x.id === b.dataset.costume; })[0];
        if (!ownedCostumes[c.id]) { if (coins < c.price) { showToast('Koin belum cukup! Jawab soal guru untuk mendapat koin.'); return; } coins -= c.price; ownedCostumes[c.id] = true; }
        activeCostume = c.id; applyCostume(); renderShop(); save();
      });
    });
  }
  function closeShop() { $('shop').hidden = true; setState('play'); if (!isTouch) lockPointer(); }
  $('btnShop').addEventListener('click', openShop); $('shopClose').addEventListener('click', closeShop); $('shopDone').addEventListener('click', closeShop);
  /* Kostum aktif dikirim ke Firebase (field c, fl, mo, ns, py, fe, fx..fh) sehingga pemain lain melihat kostum & skill yang sama. */
  function applyCostume() {
    var chosen = COSTUMES.filter(function (c) { return c.id === activeCostume; })[0];
    showToast('Kostum aktif: ' + (chosen || { name: 'Tanpa kostum' }).name);
    if (activeCostume !== 'flyer' && flying) { flying = false; }
    if (activeCostume !== 'rider' && motorOn) toggleMotor();
    if (FB.on) fbSend(true);
  }
  function toggleMotor() {
    motorOn = !motorOn;
    if (motorOn) {
      if (!W.motor) W.motor = wsMakeMotor(); W.motor.userData.keep = true;
      W.motor.visible = true; showToast('Motor siap! Shift untuk NOS, R untuk turun.');
    } else { if (W.motor) W.motor.visible = false; showToast('Kamu turun dari motor.'); }
    if (FB.on) fbSend(true);
  }
  window.addEventListener('mousedown', function (e) { if (state === 'play' && activePower('fire') && e.button === 0) shootFire(); });
  var SRV = { off: 0, ok: false };
  function ST() { return Date.now() + SRV.off; }

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function newSid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function applyQmap() {
    NPC.forEach(function (d, i) {
      var q = QS[qmap[i]];
      d.q = q; d.t = q.t; d.pts = q.pts; d.bloom = q.bloom; d.qid = q.id; d.s = q.s; d.o = q.o; d.w = q.w;
    });
  }
  function resetData() {
    /* 20 soal diacak ke 20 tokoh. */
    var idx = [], i; for (i = 0; i < NQ; i++) idx.push(i);
    shuffle(idx); qmap = idx.slice(0, N);
    applyQmap();
    score = 0; done = 0; res = new Array(N).fill(null); att = new Array(N).fill(0); mg = 0; stars = 0; finished = false; cur = -1; lastOk = false; skHTML = '';
    NPC.forEach(function (d) { d.x = d.ox; d.z = d.oz; d.clue = d.oclue; d.fl = null; });
    startX = SPAWN.x; startZ = SPAWN.z; startYaw = SPAWN.yaw; sid = newSid(); sent = false;
  }

  /* ---------- simpan & lanjutkan (reset otomatis setelah lebih dari 24 jam) ---------- */
  var SKEY = 'petualangKomputerKranggan.v1', DAY_MS = 24 * 60 * 60 * 1000;
  function save() {
    try {
      localStorage.setItem(SKEY, JSON.stringify({
        v: 1, savedAt: Date.now(), name: playerName, kelas: kelas, absen: absen, sid: sid, sent: sent, practiceOnly: practiceOnly,
        qmap: qmap, res: res, att: att, score: score, done: done, mg: mg, stars: stars, finished: finished, sk: skHTML,
        coins: coins, own: ownedCostumes, cos: activeCostume,
        pos: { x: pos.x, z: pos.z, yaw: yaw }, npc: NPC.map(function (d) { return [d.x, d.z, d.clue]; }), fl: NPC.map(function (d) { return d.fl || null; })
      }));
    } catch (e) { }
  }
  function clearSave() { try { localStorage.removeItem(SKEY); } catch (e) { } }
  function loadSave() {
    try {
      var raw = localStorage.getItem(SKEY); if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || s.v !== 1) return null;
      if (Date.now() - s.savedAt > DAY_MS) { localStorage.removeItem(SKEY); return null; }
      if (!Array.isArray(s.qmap) || s.qmap.length !== N || !Array.isArray(s.res) || s.res.length !== N || !Array.isArray(s.att) || s.att.length !== N || !Array.isArray(s.npc) || s.npc.length !== N) return null;
      var seen = {}; for (var i = 0; i < N; i++) { var q = s.qmap[i]; if (typeof q !== 'number' || q < 0 || q >= NQ || seen[q]) return null; seen[q] = 1; }
      return s;
    } catch (e) { return null; }
  }
  function restore(s) {
    playerName = s.name || ''; kelas = s.kelas || ''; absen = s.absen || ''; sid = s.sid || newSid(); sent = !!s.sent; practiceOnly = !!s.practiceOnly;
    qmap = s.qmap; applyQmap(); skHTML = typeof s.sk === 'string' ? s.sk : '';
    /* koin & kostum ikut tersimpan (berlaku 24 jam sejak terakhir bermain) */
    coins = Math.max(0, Math.floor(+s.coins || 0)); ownedCostumes = {};
    COSTUMES.forEach(function (c) { if (s.own && s.own[c.id]) ownedCostumes[c.id] = true; });
    activeCostume = (s.cos && ownedCostumes[s.cos]) ? s.cos : '';
    res = s.res; att = s.att; score = +s.score || 0; done = s.done | 0; mg = s.mg | 0; stars = s.stars | 0; finished = !!s.finished;
    s.npc.forEach(function (a, i) { NPC[i].x = +a[0]; NPC[i].z = +a[1]; NPC[i].clue = String(a[2] || NPC[i].oclue); });
    if (Array.isArray(s.fl)) s.fl.forEach(function (f, i) { if (NPC[i]) NPC[i].fl = (f && typeof f.fa === 'number') ? f : null; });
    if (s.pos) { startX = clamp(+s.pos.x || 0, -HALF.x + 3, HALF.x - 3); startZ = clamp(+s.pos.z || 0, -HALF.z + 3, HALF.z - 3); startYaw = +s.pos.yaw || 0; }
  }
  function saveNow() { if (inGame) save(); }
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
  setInterval(function () { if (inGame && state === 'play') save(); }, 4000);

  function show(id) { ['intro', 'baca', 'hasil'].forEach(function (s) { $(s).hidden = (s !== id); }); }
  function setState(s) {
    state = s;
    document.body.classList.toggle('playing', s === 'play');
    updatePause();
  }
  function updatePause() { $('pause').hidden = !(state === 'play' && !locked && !isTouch); }

  /* ---------- intro -> membaca ---------- */
  $('nameForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = $('nama').value.trim(), k = $('kelas').value.trim(), a = $('absen').value.trim();
    if (!n || !k || !a) { $('introErr').textContent = 'Lengkapi nama, kelas, dan nomor absen dulu, ya!'; $('introErr').hidden = false; return; }
    $('introErr').hidden = true; playerName = n; kelas = k; absen = a; startRead();
  });
  var readEnd = 0, readTimer = null, skipArm = false, READ_MS = 180000;
  function fmt(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2); }
  function startRead() {
    show('baca'); setState('read'); $('baca').scrollTop = 0;
    readEnd = Date.now() + READ_MS; skipArm = false;
    $('btnSkip').textContent = '.'; $('btnSkip').hidden = false;
    $('btnSiap').disabled = true; $('btnSiap').textContent = 'Tunggu waktu membaca…'; $('clock').classList.remove('done');
    $('glErr').hidden = true;
    clearInterval(readTimer); tickRead(); readTimer = setInterval(tickRead, 250);
    setTimeout(ensureWorld, 400);
  }
  function tickRead() {
    var left = readEnd - Date.now();
    $('clock').textContent = fmt(left);
    $('rProg').style.width = clamp((1 - left / READ_MS) * 100, 0, 100) + '%';
    if (left <= 0) {
      clearInterval(readTimer); $('clock').classList.add('done');
      $('btnSiap').disabled = false; $('btnSiap').textContent = 'Aku siap, mulai misi!';
      $('siapNote').textContent = 'Waktu membaca selesai. Kamu boleh membaca lagi sebelum mulai.';
      $('btnSkip').hidden = true;
    }
  }
  $('btnSkip').addEventListener('click', function () {
    if (!skipArm) { skipArm = true; $('btnSkip').textContent = 'Klik sekali lagi untuk melewati'; return; }
    readEnd = Date.now(); tickRead();
  });
  $('btnSiap').addEventListener('click', function () { inGame = true; save(); startPlay(); });

  /* ---------- peta kota (koordinat dunia) ---------- */
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  var lam = function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  var hex = function (c) { return '#' + ('000000' + c.toString(16)).slice(-6); };
  var RD = MP.ROADS.map(function (r) { return { n: r.n, w: r.w, c: r.c, pts: r.p.map(function (q) { return P(q[0], q[1]); }) }; });
  var RIVER = MP.RIVER.map(function (q) { return P(q[0], q[1]); }), RIVER_W = 12;
  var SEGS = [];
  RD.forEach(function (r) { for (var i = 0; i < r.pts.length - 1; i++) SEGS.push({ a: r.pts[i], b: r.pts[i + 1], hw: r.w / 2, r: r }); });
  function segDist(x, z, a, b) {
    var dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = L ? clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L, 0, 1) : 0;
    return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
  }
  function roadAt(x, z) {
    var bd = 1e9, br = null;
    for (var i = 0; i < SEGS.length; i++) { var s = SEGS[i], d = segDist(x, z, s.a, s.b) - s.hw; if (d < bd) { bd = d; br = s.r; } }
    return { d: bd, r: br };
  }
  function riverDist(x, z) { var bd = 1e9; for (var i = 0; i < RIVER.length - 1; i++) bd = Math.min(bd, segDist(x, z, RIVER[i], RIVER[i + 1])); return bd; }
  function segInter(a, b, c, d) {
    var r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) return null;
    var t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: a[0] + r[0] * t, z: a[1] + r[1] * t, dx: r[0], dz: r[1] };
  }
  var BRIDGES = [];
  RD.forEach(function (r) {
    for (var i = 0; i < r.pts.length - 1; i++) for (var j = 0; j < RIVER.length - 1; j++) {
      var h = segInter(r.pts[i], r.pts[i + 1], RIVER[j], RIVER[j + 1]); if (!h) continue;
      if (BRIDGES.some(function (b) { return Math.hypot(b.x - h.x, b.z - h.z) < 12; })) continue;
      var l = Math.hypot(h.dx, h.dz); BRIDGES.push({ x: h.x, z: h.z, dx: h.dx / l, dz: h.dz / l, w: r.w });
    }
  });
  var POI = MP.POIS.map(function (p) { var c = P(p.px[0], p.px[1]); return { id: p.id, n: p.n, zn: p.z, x: c[0], z: c[1], w: p.w, d: p.d, h: p.h, c: p.c, roof: p.roof, f: p.f, kind: p.kind, nopin: !!p.nopin, m: p.id === 'pasar' ? 9 : 3.5 }; });
  var AREAS = MP.AREAS.map(function (p) { var c = P(p.px[0], p.px[1]); return { id: p.id, n: p.n, zn: p.z, x: c[0], z: c[1], w: p.w, d: p.d }; });
  var ROUTE = {};
  Object.keys(MP.ROUTES).forEach(function (k) {
    var pts = MP.ROUTES[k].map(function (q) { return P(q[0], q[1]); }), cum = [0];
    for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    ROUTE[k] = { pts: pts, cum: cum, len: cum[cum.length - 1] };
  });
  function routeAt(rt, s) {
    s = clamp(s, 0, rt.len); var i = 1; while (i < rt.pts.length - 1 && rt.cum[i] < s) i++;
    var a = rt.pts[i - 1], b = rt.pts[i], seg = rt.cum[i] - rt.cum[i - 1] || 1, t = (s - rt.cum[i - 1]) / seg, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l };
  }
  function routeProject(rt, x, z) {
    var best = 1e9, bs = 0;
    for (var i = 0; i < rt.pts.length - 1; i++) {
      var a = rt.pts[i], b = rt.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L, 0, 1), d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
      if (d < best) { best = d; bs = rt.cum[i] + Math.sqrt(L) * t; }
    }
    return bs;
  }
  var STOPS = MP.STOPS.map(function (s) {
    var c = P(s.px[0], s.px[1]), rt = ROUTE[s.line], sv = routeProject(rt, c[0], c[1]), p = routeAt(rt, sv), nx = p.dz, nz = -p.dx, ra = roadAt(p.x, p.z), hw = ra.r ? ra.r.w / 2 : 3.5;
    return { id: s.id, n: s.n, line: s.line, d: s.d, s: sv, cx: p.x, cz: p.z, dx: p.dx, dz: p.dz, nx: nx, nz: nz, hw: hw, sx: p.x + nx * (hw + 2.4), sz: p.z + nz * (hw + 2.4), ex: p.x + nx * (hw + 3) - p.dx * 5.5, ez: p.z + nz * (hw + 3) - p.dz * 5.5 };
  });
  var SPAWN_P = null;
  (function () { var sd = POI.filter(function (p) { return p.id === 'sdit'; })[0]; SPAWN = { x: sd.x, z: sd.z + sd.d / 2 + 4.5, yaw: Math.PI }; startX = SPAWN.x; startZ = SPAWN.z; startYaw = SPAWN.yaw; })();

  /* ---------- tabrakan (grid) ---------- */
  var CG = {}, CS = 16, CO = 40;
  function ck(ix, iz) { return (ix + CO) * 200 + (iz + CO); }
  function gridAdd(item, x0, x1, z0, z1) { for (var ix = Math.floor(x0 / CS); ix <= Math.floor(x1 / CS); ix++) for (var iz = Math.floor(z0 / CS); iz <= Math.floor(z1 / CS); iz++) { var k = ck(ix, iz); (CG[k] || (CG[k] = [])).push(item); } }
  function addBoxC(x0, x1, z0, z1) { var b = { box: 1, x0: x0, x1: x1, z0: z0, z1: z1 }; gridAdd(b, x0 - .6, x1 + .6, z0 - .6, z1 + .6); }
  function addCircC(x, z, r) { var c = { x: x, z: z, r: r }; gridAdd(c, x - r - .6, x + r + .6, z - r - .6, z + r + .6); }
  function collide(p, rad, skip, noDyn) {
    var r = rad || .45, i, ix, iz, arr, it, k;
    p.x = clamp(p.x, -HALF.x + 1.5, HALF.x - 1.5); p.z = clamp(p.z, -HALF.z + 1.5, HALF.z - 1.5);
    for (ix = Math.floor((p.x - r) / CS); ix <= Math.floor((p.x + r) / CS); ix++) for (iz = Math.floor((p.z - r) / CS); iz <= Math.floor((p.z + r) / CS); iz++) {
      arr = CG[ck(ix, iz)]; if (!arr) continue;
      for (k = 0; k < arr.length; k++) {
        it = arr[k]; if (it.dead) continue;
        if (it.box) {
          if (p.x > it.x0 - r && p.x < it.x1 + r && p.z > it.z0 - r && p.z < it.z1 + r) {
            var dl = p.x - (it.x0 - r), dr = (it.x1 + r) - p.x, dt = p.z - (it.z0 - r), db = (it.z1 + r) - p.z, m = Math.min(dl, dr, dt, db);
            if (m === dl) p.x = it.x0 - r; else if (m === dr) p.x = it.x1 + r; else if (m === dt) p.z = it.z0 - r; else p.z = it.z1 + r;
          }
        } else {
          var dx = p.x - it.x, dz = p.z - it.z, rr2 = r + it.r, d2 = dx * dx + dz * dz;
          if (d2 < rr2 * rr2) { var d = Math.sqrt(d2) || .001; p.x = it.x + dx / d * rr2; p.z = it.z + dz / d * rr2; }
        }
      }
    }
    for (i = 0; !noDyn && i < W.dyn.length; i++) {
      var c = W.dyn[i]; if (c === skip) continue;
      var ddx = p.x - c.x, ddz = p.z - c.z, rq = r + c.r, dd2 = ddx * ddx + ddz * ddz;
      if (dd2 < rq * rq) { var dq = Math.sqrt(dd2) || .001; p.x = c.x + ddx / dq * rq; p.z = c.z + ddz / dq * rq; }
    }
  }
  function spotFree(x, z) {
    for (var ix = Math.floor((x - 3) / CS); ix <= Math.floor((x + 3) / CS); ix++) for (var iz = Math.floor((z - 3) / CS); iz <= Math.floor((z + 3) / CS); iz++) {
      var arr = CG[ck(ix, iz)]; if (!arr) continue;
      for (var k = 0; k < arr.length; k++) {
        var it = arr[k]; if (it.dead) continue;
        if (it.box) { if (x > it.x0 - 2.5 && x < it.x1 + 2.5 && z > it.z0 - 2.5 && z < it.z1 + 2.5) return false; }
        else if (Math.hypot(x - it.x, z - it.z) < it.r + 1.8) return false;
      }
    }
    return Math.abs(x) < HALF.x - 6 && Math.abs(z) < HALF.z - 6;
  }

  /* =====================================================================
     PEMUAT ASET 3D  (membaca window.MANIFEST_3D di bagian atas file)
     Slot yang filenya tidak ada otomatis memakai model bawaan.
     ===================================================================== */
  var Assets = (function () {
    var MF = window.MANIFEST_3D || {}, MD = MF.models || {}, TX = MF.tekstur || {};
    var raw = {}, imgs = {}, state = {}, pending = 0, done = false, waiters = [], timer = null, total = 0, loaded = 0, pcb = null;
    function report() {
      var rows = [], k, n = 0;
      for (k in MD) rows.push({ slot: k, file: MD[k].file, status: state[k] || '-' });
      for (k in TX) rows.push({ slot: k, file: TX[k].file, status: state[k] || '-' });
      rows.forEach(function (r) { if (r.status === 'dipakai') n++; });
      window.__aset3d = rows;
      if (window.console && console.info) console.info('[Manifest 3D] ' + n + ' dari ' + rows.length + ' slot terpasang. Ketik __aset3d di Console untuk rinciannya.' + (location.protocol === 'file:' ? ' (Dibuka via file:// - model .glb tidak bisa dimuat, gunakan server.)' : ''));
    }
    function finish() { if (done) return; done = true; clearTimeout(timer); report(); waiters.splice(0).forEach(function (f) { try { f(); } catch (e) { if (window.console) console.error(e); } }); }
    function one() { loaded++; if (pcb) { try { pcb(Math.min(loaded, total), total); } catch (e) { } } if (--pending <= 0) finish(); }
    /* samakan tampilan dengan sisa dunia: bahan Lambert, tekstur tanpa konversi warna */
    function lambert(root) {
      root.traverse(function (o) {
        if (!o.isMesh) return;
        var arr = Array.isArray(o.material) ? o.material : [o.material], out = [];
        arr.forEach(function (m) {
          if (m.isMeshBasicMaterial || m.isMeshLambertMaterial) { if (m.map) m.map.encoding = THREE.LinearEncoding; out.push(m); return; }
          var n = new THREE.MeshLambertMaterial({ color: m.color ? m.color.clone() : new THREE.Color(0xffffff), map: m.map || null, transparent: !!m.transparent, opacity: m.opacity == null ? 1 : m.opacity, side: m.side, alphaTest: m.alphaTest || 0, vertexColors: !!m.vertexColors, emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000), emissiveMap: m.emissiveMap || null });
          if (n.map) n.map.encoding = THREE.LinearEncoding;
          if (n.emissiveMap) n.emissiveMap.encoding = THREE.LinearEncoding;
          out.push(n);
        });
        o.material = Array.isArray(o.material) ? out : out[0];
      });
    }
    function start() {
      var ids = Object.keys(MD), tids = Object.keys(TX), base = MF.folder || 'assets/3d/';
      if (MF.aktif === false || (!ids.length && !tids.length)) { done = true; return; }
      var loader = THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
      pending = total = ids.length + tids.length;
      timer = setTimeout(finish, MF.batasWaktu || 15000);
      ids.forEach(function (id) {
        var c = MD[id];
        if (!c || !c.file || !loader) { state[id] = 'dilewati'; one(); return; }
        try {
          loader.load(base + c.file, function (g) {
            try { lambert(g.scene); raw[id] = g.scene; state[id] = 'dipakai'; } catch (e) { state[id] = 'rusak'; }
            one();
          }, undefined, function () { state[id] = 'file tidak ada'; one(); });
        } catch (e) { state[id] = 'rusak'; one(); }
      });
      tids.forEach(function (id) {
        var c = TX[id]; if (!c || !c.file) { state[id] = 'dilewati'; one(); return; }
        var im = new Image();
        im.onload = function () { imgs[id] = im; state[id] = 'dipakai'; one(); };
        im.onerror = function () { state[id] = 'file tidak ada'; one(); };
        im.src = base + c.file;
      });
    }
    /* kembalikan salinan model yang sudah dipusatkan (tengah x/z, dasar y=0) & diskalakan agar muat di 'size' */
    function fit(id, size) {
      var g = raw[id]; if (!g) return null;
      var c = MD[id] || {}, obj = g.clone(true), root = new THREE.Group(), scl = new THREE.Group(), box = new THREE.Box3(), sz = new THREE.Vector3(), ct = new THREE.Vector3(), k = Infinity;
      root.add(scl); scl.add(obj); obj.position.set(0, 0, 0); obj.scale.set(1, 1, 1); obj.rotation.set(0, (c.putar || 0) * Math.PI / 180, 0); root.updateMatrixWorld(true);
      box.setFromObject(obj); box.getSize(sz);
      var t = size || c.ukuran || [0, 0, 0], fillMode = c.isi != null ? !!c.isi : /^(rumah_|ruko$|bangunan_)/.test(id);
      if (fillMode && t[0] > 0 && t[2] > 0 && sz.x > 1e-6 && sz.y > 1e-6 && sz.z > 1e-6) {
        /* ISI PENUH: lebar & panjang model mengikuti lebar & panjang bangunan di peta (model kecil diperbesar, model besar dikecilkan).
           Tinggi menyesuaikan secara wajar supaya bangunan tidak terlalu pendek / tinggi. */
        var kx = t[0] / sz.x, kz = t[2] / sz.z, ky = Math.sqrt(kx * kz), T = c.tinggi || t[1] || 0;
        if (T > 0) ky = Math.max(.75 * T / sz.y, Math.min(1.5 * T / sz.y, ky));
        scl.scale.set(kx, ky, kz);
      } else {
        [sz.x, sz.y, sz.z].forEach(function (v, i) { if (t[i] > 0 && v > 1e-6) k = Math.min(k, t[i] / v); });
        if (!isFinite(k)) k = 1;
        scl.scale.setScalar(k);
      }
      root.updateMatrixWorld(true);
      box.setFromObject(obj); box.getCenter(ct); box.getSize(sz);
      scl.position.set(-ct.x, -box.min.y + (c.naik || 0), -ct.z); root.updateMatrixWorld(true);
      root.userData.dim = [sz.x, sz.y, sz.z];
      return root;
    }
    /* pasang banyak salinan sekaligus (InstancedMesh). item: {x,z,ry,y,s,sx,sy,sz} */
    function instance(id, list, size) {
      if (!raw[id]) return false;
      if (!list.length) return true;
      var root = fit(id, size), metas = [];
      if (!root) return false;
      root.traverse(function (o) { if (o.isMesh && o.geometry) metas.push(o); });
      var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
      var cells = {}, dm0 = root.userData.dim || [2, 2, 2];
      list.forEach(function (it) { var ky = Math.floor(it.x / CELL) + ',' + Math.floor(it.z / CELL); (cells[ky] || (cells[ky] = [])).push(it); });
      metas.forEach(function (me) {
        Object.keys(cells).forEach(function (ky) {
          var arr = cells[ky], im = new THREE.InstancedMesh(me.geometry, me.material, arr.length), pts = [];
          arr.forEach(function (it, i) {
            e.set(0, it.ry || 0, 0); q.setFromEuler(e); p.set(it.x, it.y || 0, it.z);
            var k = it.s || 1; s.set((it.sx || 1) * k, (it.sy || 1) * k, (it.sz || 1) * k);
            m4.compose(p, q, s); m4.multiply(me.matrixWorld); im.setMatrixAt(i, m4);
            pts.push([it.x, it.z, Math.hypot(dm0[0] * (it.sx || 1) * k, dm0[2] * (it.sz || 1) * k) / 2 + Math.max(dm0[1], 4) * .3]);
          });
          im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.userData.glb = id; scene.add(im); chReg(im, pts);
        });
      });
      return true;
    }
    start();
    return {
      has: function (id) { return !!raw[id]; },
      tex: function (id) { return imgs[id] || null; },
      texCfg: function (id) { return TX[id] || {}; },
      cfg: function (id) { return MD[id] || {}; },
      make: fit,
      dim: function (id, size) { var r = fit(id, size); return r ? r.userData.dim : null; },
      instance: instance,
      loading: function () { return !done; },
      whenReady: function (f) { if (done) f(); else waiters.push(f); },
      onProgress: function (f) { pcb = f; },
      forceFinish: function () { finish(); }
    };
  })();
  /* pola tekstur untuk kanvas tanah (kalau gambar tersedia), kalau tidak pakai warna biasa */
  function gfill(g, id, fallback, K) {
    var im = Assets.tex(id); if (!im || !g.createPattern) return fallback;
    var pt = g.createPattern(im, 'repeat'), u = Assets.texCfg(id).ulang || 8;
    if (pt && pt.setTransform && window.DOMMatrix) { var sc = u * K / im.width; pt.setTransform(new DOMMatrix([sc, 0, 0, sc, 0, 0])); }
    return pt || fallback;
  }

  /* =====================================================================
     KOMPLEK PERUMAHAN: tata letak rapi (gerbang, jalan, trotoar, kavling, taman)
     ===================================================================== */
  var KP = { rw: 6.8, lane: 4.4, med: 2.4, sw: 1.8, ld: 14.5, lw: 12, hw: 8.4, hd: 8.6, rear: 2.8, edge: 1.2, pocket: 26 };
  KP.fy = KP.ld - KP.rear - KP.hd;
  var KOMPLEK = [
    { id: 'kr', n: 'KRANGGAN RESIDENCE', zn: 'Kranggan Residence', x0: -156, x1: -12, z0: 58, z1: 150, t: 'ring', pal: 0 },
    { id: 'ts', n: 'TAMAN SAWO ASRI', zn: 'Taman Sawo Asri', x0: 16, x1: 185, z0: 52, z1: 150, t: 'ring', pal: 1, lake: 1 },
    { id: 'kg', n: 'KENANGA GARDEN', zn: 'Kenanga Garden', x0: -242, x1: -186, z0: 62, z1: 150, t: 'bul', ax: 'z', gate: 'N', med: 1, pal: 2 },
    { id: 'ab', n: 'ABSOK GARDEN', zn: 'Absok Garden', x0: -135, x1: 12, z0: -94, z1: -42, t: 'bul', ax: 'x', gate: 'W', med: 1, pal: 3 },
    { id: 'pc', n: 'PURI CAMAT', zn: 'Puri Camat', x0: -200, x1: -158, z0: -108, z1: -36, t: 'bul', ax: 'z', gate: 'N', pk: 14, pal: 4 },
    { id: 'ch', n: 'CEMPAKA HILL', zn: 'Cempaka Hill', x0: 36, x1: 174, z0: -152, z1: -122, t: 'bul', ax: 'x', gate: 'W', one: 1, far: 1, pal: 5 }
  ];
  var PAL = [
    { w: [0xfbf3e0, 0xf2e3c6], r: 0xb5532d, acc: 0x8a5a36 },
    { w: [0xf4f4f1, 0xdfe6ea], r: 0x4f5d6e, acc: 0x2a68dc },
    { w: [0xf9e3d0, 0xf3d2b8], r: 0x7a4a2e, acc: 0xb8562c },
    { w: [0xeaf3dc, 0xf6f0d8], r: 0x5d7a63, acc: 0x14a06e },
    { w: [0xfdeceb, 0xf0e1ee], r: 0x9a3f35, acc: 0xe0434a },
    { w: [0xf6ecd2, 0xe6efe0], r: 0x2f7d73, acc: 0x14a06e }
  ];
  var TYP = ['a', 'b', 'a', 'c'], CARC = [0xe4e4e4, 0x1f2a44, 0xb73a3a, 0xf6f6f6, 0x3a6ea5, 0x555b63];
  var HOUSES = [], RUKO = [], KROADS = [], PARKS = [], MEDIANS = [], ROWS = [], COLL = [], HEDGE = [], KSL = {};
  function kslot(id) { return KSL[id] || (KSL[id] = []); }
  function ccirc(x, z, r) { COLL.push({ x: x, z: z, r: r }); }
  function cbox(x0, x1, z0, z1) { COLL.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) }); }
  function l2w(h, lx, lz) { return [h.cx + h.tx * lx + h.fx * lz, h.cz + h.tz * lx + h.fz * lz]; }
  function lrect(h, x0, x1, z0, z1) { var a = l2w(h, x0, z0), b = l2w(h, x1, z1); return [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])]; }
  function addKRoad(pts, w, kl, dash) {
    var rd = { pts: pts, w: w, kl: kl, dash: !!dash, r: { n: kl.zn, w: w, c: 'inner' } };
    KROADS.push(rd);
    for (var i = 0; i < pts.length - 1; i++) SEGS.push({ a: pts[i], b: pts[i + 1], hw: w / 2, r: rd.r });
  }
  function probe(x, z, dx, dz, max) { for (var t = 0; t <= max; t += 1) { if (roadAt(x + dx * t, z + dz * t).d < .8) return t; } return -1; }
  function gateAt(kl, x, z, dx, dz, span) {
    var px = dz, pz = -dx, off = span / 2 + 2.6, ry = Math.atan2(dx, dz);
    kl.gt = { x: x, z: z, dx: dx, dz: dz, span: span };
    kslot('gerbang_komplek').push({ x: x, z: z, ry: ry, span: span });
    ccirc(x + px * span / 2, z + pz * span / 2, .7); ccirc(x - px * span / 2, z - pz * span / 2, .7);
    [-1, 1].forEach(function (sd) {
      var qx = x + dx + px * off * sd, qz = z + dz + pz * off * sd;
      kslot('pos_satpam').push({ x: qx, z: qz, ry: Math.atan2(-px * sd, -pz * sd) });
      cbox(qx - 1.5, qx + 1.5, qz - 1.5, qz + 1.5);
    });
  }
  /* satu baris kavling: (sx,sz)=awal garis depan kavling di sisi jalan, (dx,dz)=arah baris, (nx,nz)=arah hadap rumah (ke jalan) */
  function lotRow(kl, sx, sz, dx, dz, nx, nz, len, i0) {
    var n = Math.floor(len / KP.lw); if (n < 1) return;
    var sp = len / n, tx = nz, tz = -nx, pal = PAL[kl.pal], i, u, h, ls = sp / 2 - 4.7, ry = Math.atan2(nx, nz);
    ROWS.push({ sx: sx, sz: sz, dx: dx, dz: dz, nx: nx, nz: nz, len: len });
    for (i = 0; i < n; i++) {
      u = sp * (i + .5);
      var fx0 = sx + dx * u, fz0 = sz + dz * u, typ = TYP[(i0 + i) % TYP.length], q = (i0 + i + kl.pal);
      h = { cx: fx0 - nx * (KP.fy + KP.hd / 2) - tx * ls, cz: fz0 - nz * (KP.fy + KP.hd / 2) - tz * ls, fx: nx, fz: nz, tx: tx, tz: tz, typ: typ, wc: pal.w[(i0 + i) % 2], rc: pal.r, acc: pal.acc, lw_: KP.hw, ld_: KP.hd, sp: sp, ls: ls, kl: kl };
      h.h = typ === 'b' ? 3.6 : (typ === 'c' ? 6.2 : 6.4);
      h.w = nx !== 0 ? KP.hd : KP.hw; h.d = nx !== 0 ? KP.hw : KP.hd;
      HOUSES.push(h);
      var p;
      if (q % 3 !== 2) { p = l2w(h, 5.9, KP.hd / 2 + 1.1); kslot('mobil').push({ x: p[0], z: p[1], ry: ry, c: CARC[q % CARC.length] }); }
      [[2.5, KP.hd / 2 + .8], [3.9, KP.hd / 2 + .8], [-4.0, KP.hd / 2 + .8]].forEach(function (b, bi) { var w = l2w(h, b[0], b[1]); kslot('semak').push({ x: w[0], z: w[1], s: .85 + ((q + bi) % 3) * .12 }); });
      p = l2w(h, .7, KP.hd / 2 + 2.3); kslot('bunga').push({ x: p[0], z: p[1], s: 1, k: q });
      p = l2w(h, 3.2, -KP.hd / 2 - 1.5); kslot('pohon_hias').push({ x: p[0], z: p[1], s: .85 + (q % 3) * .1, k: q }); ccirc(p[0], p[1], .4);
      [[-3.6, 2.2], [1.85, 5.1]].forEach(function (sg) {
        var w = l2w(h, sg[0], KP.hd / 2 + KP.fy - .35); HEDGE.push({ x: w[0], z: w[1], ry: Math.atan2(nx, nz), len: sg[1] });
        var half = sg[1] / 2; if (nz !== 0) cbox(w[0] - half, w[0] + half, w[1] - .3, w[1] + .3); else cbox(w[0] - .3, w[0] + .3, w[1] - half, w[1] + half);
      });
    }
    for (i = 1; i < n; i++) {
      u = sp * i; var bx0 = sx + dx * u, bz0 = sz + dz * u;
      if (i % 2) { kslot('lampu_jalan').push({ x: bx0 + nx * (KP.sw - .3), z: bz0 + nz * (KP.sw - .3), ry: ry }); ccirc(bx0 + nx * (KP.sw - .3), bz0 + nz * (KP.sw - .3), .25); }
      else { kslot('pohon_sedang').push({ x: bx0 + nx * .9, z: bz0 + nz * .9, s: .88 + ((i + i0) % 3) * .07 }); ccirc(bx0 + nx * .9, bz0 + nz * .9, .45); }
    }
  }
  function ringKomplek(kl) {
    var e = KP.edge, ld = KP.ld, sw = KP.sw, rw = KP.rw, xc = (kl.x0 + kl.x1) / 2, gap = rw + 2 * sw + 1;
    var zN = kl.z0 + e + ld + sw + rw / 2, zS = kl.z1 - e - ld - sw - rw / 2, xW = kl.x0 + e + ld + sw + rw / 2, xE = kl.x1 - e - ld - sw - rw / 2;
    var wz0 = zN + rw / 2 + sw, wz1 = zS - rw / 2 - sw;
    var len = probe(xc, kl.z0, 0, -1, 70); if (len < 0) len = 12;
    lotRow(kl, kl.x0 + e, kl.z0 + e + ld, 1, 0, 0, 1, (xc - gap / 2) - (kl.x0 + e), 0);
    lotRow(kl, xc + gap / 2, kl.z0 + e + ld, 1, 0, 0, 1, (kl.x1 - e) - (xc + gap / 2), 0);
    lotRow(kl, kl.x0 + e, kl.z1 - e - ld, 1, 0, 0, -1, kl.x1 - kl.x0 - 2 * e, 0);
    lotRow(kl, kl.x0 + e + ld, wz0, 0, 1, 1, 0, wz1 - wz0, 1);
    lotRow(kl, kl.x1 - e - ld, wz0, 0, 1, -1, 0, wz1 - wz0, 1);
    addKRoad([[xW, zN], [xE, zN], [xE, zS], [xW, zS], [xW, zN]], rw, kl, true);
    addKRoad([[xc, zN], [xc, kl.z0 - len]], rw, kl, true);
    gateAt(kl, xc, kl.z0 + 2.5, 0, 1, rw + 2 * sw + .8);
    var p = e + ld + 2 * sw + rw;
    PARKS.push({ kind: 'ring', x0: kl.x0 + p, x1: kl.x1 - p, z0: kl.z0 + p, z1: kl.z1 - p, kl: kl });
  }
  function bulevar(kl) {
    var ax = kl.ax, g = kl.gate, cx = (kl.x0 + kl.x1) / 2, cz = (kl.z0 + kl.z1) / 2;
    var L = ax === 'x' ? kl.x1 - kl.x0 : kl.z1 - kl.z0, D = ax === 'x' ? kl.z1 - kl.z0 : kl.x1 - kl.x0;
    var dir = (g === 'W' || g === 'N') ? 1 : -1, u0 = ax === 'x' ? (dir > 0 ? kl.x0 : kl.x1) : (dir > 0 ? kl.z0 : kl.z1);
    var lane = kl.med ? KP.lane : KP.rw, half = kl.med ? KP.med / 2 + lane + KP.sw : KP.rw / 2 + KP.sw;
    var vOff = kl.one ? D / 2 - KP.edge - KP.sw - KP.rw / 2 : 0;
    function T(s, v) { v += vOff; return ax === 'x' ? [u0 + dir * s, cz + v] : [cx + v, u0 + dir * s]; }
    function Td(ds, dv) { return ax === 'x' ? [dir * ds, dv] : [dv, dir * ds]; }
    var sEnd = kl.one ? L : L - (kl.pk || KP.pocket), ds = Td(1, 0), od = Td(-1, 0), s0, s1, s;
    var a = T(0, 0), len = probe(a[0], a[1], od[0], od[1], 70); if (len < 0) len = 12;
    var pe = T(-len, 0);
    if (kl.med) {
      var cs0 = lane / 2 + .5, cs1 = sEnd - lane / 2 - .5, vc = KP.med / 2 + lane / 2;
      addKRoad([pe, T(cs0, 0)], KP.rw, kl, true);
      addKRoad([T(cs0, -vc), T(cs0, vc)], lane, kl); addKRoad([T(cs1, -vc), T(cs1, vc)], lane, kl);
      addKRoad([T(cs0, -vc), T(cs1, -vc)], lane, kl); addKRoad([T(cs0, vc), T(cs1, vc)], lane, kl);
      MEDIANS.push({ a: T(cs0 + lane / 2, 0), b: T(cs1 - lane / 2, 0), w: KP.med });
      s0 = cs0 + lane / 2 + 1; s1 = cs1 - lane / 2 - 1;
      var k2 = 0;
      for (s = s0 + 3; s < s1 - 1; s += 7, k2++) {
        var pp = T(s, 0); kslot('pohon_palem').push({ x: pp[0], z: pp[1], s: .9 + (k2 % 3) * .06 }); ccirc(pp[0], pp[1], .4);
        var pf = T(s + 3.5, 0); if (s + 3.5 < s1 - 1) kslot('bunga').push({ x: pf[0], z: pf[1], s: 1.1, k: k2 });
      }
    } else {
      var sCul = kl.far ? sEnd : sEnd - 6;
      var b0 = T(sEnd, 0), len2 = kl.far ? probe(b0[0], b0[1], ds[0], ds[1], 70) : -1;
      if (kl.far && len2 >= 0) addKRoad([pe, T(sEnd + len2, 0)], KP.rw, kl, true);
      else { addKRoad([pe, T(sCul, 0)], KP.rw, kl, true); addKRoad([T(sCul, 0), T(sCul, 0)], 11, kl); }
      s0 = 7; s1 = (kl.far && len2 >= 0) ? sEnd - 7 : sCul - 5.5;
    }
    [-1, 1].forEach(function (sg) {
      if (kl.one && sg === 1) {
        for (s = 6; s < sEnd - 4; s += 13) { var tp = T(s, half - .9); kslot('pohon_sedang').push({ x: tp[0], z: tp[1], s: .95 }); ccirc(tp[0], tp[1], .45); }
        for (s = 12; s < sEnd - 6; s += 24) { var lp = T(s, half - .3), nn2 = Td(0, -1); kslot('lampu_jalan').push({ x: lp[0], z: lp[1], ry: Math.atan2(nn2[0], nn2[1]) }); ccirc(lp[0], lp[1], .25); }
        return;
      }
      var st = T(s0, sg * half), nn = Td(0, -sg);
      lotRow(kl, st[0], st[1], ds[0], ds[1], nn[0], nn[1], s1 - s0, 0);
      if (!kl.one) {
        var mg = D / 2 - (half + KP.ld);
        if (mg > 3) for (s = s0 + 4; s < s1; s += 14) { var ep = T(s, sg * (half + KP.ld + Math.min(mg - 1.2, 2.4))); kslot('pohon_sedang').push({ x: ep[0], z: ep[1], s: .9 }); ccirc(ep[0], ep[1], .45); }
      }
    });
    gateAt(kl, T(2.5, 0)[0], T(2.5, 0)[1], ds[0], ds[1], KP.rw + 2 * KP.sw + .8);
    if (!kl.one) {
      var c1 = T(sEnd + 1.5, -(D / 2 - KP.edge)), c2 = T(L - KP.edge, D / 2 - KP.edge);
      PARKS.push({ kind: 'pocket', x0: Math.min(c1[0], c2[0]), x1: Math.max(c1[0], c2[0]), z0: Math.min(c1[1], c2[1]), z1: Math.max(c1[1], c2[1]), kl: kl });
    }
  }
  var KPAL_TREE = ['pohon_sedang', 'pohon_sedang', 'pohon_besar', 'pohon_palem', 'pohon_hias'];
  function fillPark(pk) {
    var w = pk.x1 - pk.x0, d = pk.z1 - pk.z0, cx = (pk.x0 + pk.x1) / 2, cz = (pk.z0 + pk.z1) / 2, r = mulberry((Math.abs(pk.x0 * 7 + pk.z0 * 3) | 0) + 5), i, j;
    pk.paths = []; pk.pads = []; pk.beds = [];
    var keep = [], segs = [];            /* keep: [x,z,r] area yang tidak boleh ditanami pohon */
    if (pk.kind === 'ring') {
      var ti = 2.2, lake = !!pk.kl.lake;
      pk.track = [pk.x0 + ti, pk.x1 - ti, pk.z0 + ti, pk.z1 - ti];
      var prx = lake ? Math.min(w * .26, 30) : Math.min(w * .18, 14), prz = lake ? Math.min(d * .3, 12.5) : Math.min(d * .24, 8), pcx = cx + (lake ? 0 : w * .04), pcz = cz;
      pk.pond = { x: pcx, z: pcz, rx: prx, rz: prz };
      var per = Math.PI * (3 * (prx + prz) - Math.sqrt((3 * prx + prz) * (prx + 3 * prz))), nc = Math.ceil(per / 2.6);
      for (i = 0; i < nc; i++) { var an = i / nc * 6.2832; ccirc(pcx + Math.cos(an) * (prx + .6), pcz + Math.sin(an) * (prz + .6), 2); }
      if (lake) { kslot('air_mancur').push({ x: pcx, z: pcz }); }
      var gx = pk.x0 + w * .16, px = pk.x1 - w * .16;
      pk.pads.push({ k: 'plaza', x: gx, z: cz, r: 6.5 }); kslot('gazebo').push({ x: gx, z: cz, ry: 0 }); cbox(gx - 3.2, gx + 3.2, cz - 3.2, cz + 3.2);
      pk.pads.push({ k: 'sand', x: px, z: cz, w: 13, d: 10 }); kslot('mainan_anak').push({ x: px, z: cz, ry: 0 }); cbox(px - 3.4, px + 3.4, cz - 2.4, cz + 2.4);
      keep.push([gx, cz, 8], [px, cz, 9]);
      pk.paths.push([[cx, pk.z0], [cx, pcz - prz - 1.4]], [[gx + 6.5, cz], [pcx - prx - 1.4, pcz]], [[pcx + prx + 1.4, pcz], [px - 6.5, cz]]);
      segs.push([[cx, pk.z0], [cx, pcz - prz - 1.4]], [[gx + 6.5, cz], [pcx - prx - 1.4, pcz]], [[pcx + prx + 1.4, pcz], [px - 6.5, cz]]);
      var nb = Math.max(2, Math.round(w / 22)), bxs;
      for (i = 0; i < nb; i++) {
        bxs = pk.x0 + w * (i + .5) / nb;
        [[pk.z0 + ti + 1.6, 0], [pk.z1 - ti - 1.6, Math.PI]].forEach(function (b) {
          if (Math.abs(bxs - cx) < 4) return;
          kslot('bangku').push({ x: bxs, z: b[0], ry: b[1] }); cbox(bxs - 1.3, bxs + 1.3, b[0] - .6, b[0] + .6);
          kslot('tempat_sampah').push({ x: bxs + 2.2, z: b[0], s: 1 }); ccirc(bxs + 2.2, b[0], .35);
        });
      }
      for (var lx = pk.x0 + ti + 4; lx < pk.x1 - ti - 2; lx += 14) [pk.z0 + ti - 1, pk.z1 - ti + 1].forEach(function (lz) { kslot('lampu_taman').push({ x: lx, z: lz }); ccirc(lx, lz, .25); });
      for (var lz2 = pk.z0 + ti + 8; lz2 < pk.z1 - ti - 4; lz2 += 14) [pk.x0 + ti - 1, pk.x1 - ti + 1].forEach(function (lx2) { kslot('lampu_taman').push({ x: lx2, z: lz2 }); ccirc(lx2, lz2, .25); });
      for (var bx2 = pk.x0 + 4; bx2 < pk.x1 - 2; bx2 += 6) [pk.z0 + 1, pk.z1 - 1].forEach(function (bz) { kslot((Math.round(bx2 / 6) % 2) ? 'semak' : 'bunga').push({ x: bx2, z: bz, s: 1, k: bx2 | 0 }); });
      for (var bz2 = pk.z0 + 5; bz2 < pk.z1 - 3; bz2 += 6) [pk.x0 + 1, pk.x1 - 1].forEach(function (bx3) { kslot('semak').push({ x: bx3, z: bz2, s: .95 }); });
      var cnt = Math.floor(w * d / 95), tries = 0, tp = [];
      while (tp.length < cnt && tries++ < 900) {
        var x = pk.x0 + 3 + r() * (w - 6), z = pk.z0 + 3 + r() * (d - 6), ok = true;
        var ex = (x - pcx) / (prx + 3.5), ez = (z - pcz) / (prz + 3.5); if (ex * ex + ez * ez < 1) ok = false;
        for (j = 0; ok && j < keep.length; j++) if (Math.hypot(x - keep[j][0], z - keep[j][1]) < keep[j][2]) ok = false;
        for (j = 0; ok && j < segs.length; j++) if (segDist(x, z, segs[j][0], segs[j][1]) < 2.2) ok = false;
        var tk = pk.track, tsg = [[[tk[0], tk[2]], [tk[1], tk[2]]], [[tk[1], tk[2]], [tk[1], tk[3]]], [[tk[1], tk[3]], [tk[0], tk[3]]], [[tk[0], tk[3]], [tk[0], tk[2]]]];
        for (j = 0; ok && j < 4; j++) if (segDist(x, z, tsg[j][0], tsg[j][1]) < 2.6) ok = false;
        for (j = 0; ok && j < tp.length; j++) if (Math.hypot(x - tp[j][0], z - tp[j][1]) < 6) ok = false;
        if (ok) tp.push([x, z]);
      }
      tp.forEach(function (t, k) { var id = KPAL_TREE[k % 5]; kslot(id).push({ x: t[0], z: t[1], s: .9 + r() * .2, k: k }); ccirc(t[0], t[1], .5); });
    } else {
      var rr0 = Math.min(Math.min(w, d) / 2 - 1.2, 6.5);
      if (rr0 >= 3) {
        pk.pads.push({ k: 'plaza', x: cx, z: cz, r: rr0 }); kslot('air_mancur').push({ x: cx, z: cz }); ccirc(cx, cz, 2.6);
        [0, 1, 2, 3].forEach(function (q) {
          var ang = q * Math.PI / 2, bx = cx + Math.cos(ang) * (rr0 - 1.4), bz = cz + Math.sin(ang) * (rr0 - 1.4);
          kslot('bangku').push({ x: bx, z: bz, ry: Math.atan2(cx - bx, cz - bz) }); ccirc(bx, bz, .9);
          var lx3 = cx + Math.cos(ang + .785) * (rr0 + 1.2), lz3 = cz + Math.sin(ang + .785) * (rr0 + 1.2);
          kslot('lampu_taman').push({ x: lx3, z: lz3 }); ccirc(lx3, lz3, .25);
        });
        keep.push([cx, cz, rr0 + 1]);
      }
      var tsp = [[pk.x0 + 3, pk.z0 + 3], [pk.x1 - 3, pk.z0 + 3], [pk.x0 + 3, pk.z1 - 3], [pk.x1 - 3, pk.z1 - 3]];
      tsp.forEach(function (t, k) { if (Math.hypot(t[0] - cx, t[1] - cz) < rr0 + 2) return; kslot(k % 2 ? 'pohon_palem' : 'pohon_sedang').push({ x: t[0], z: t[1], s: .95, k: k }); ccirc(t[0], t[1], .5); });
      var lon = w >= d, nbd = Math.floor((lon ? w : d) / 7);
      for (i = 0; i < nbd; i++) {
        var u = (i + .5) / nbd, bx4 = lon ? pk.x0 + u * w : pk.x0 + .8, bz4 = lon ? pk.z0 + .8 : pk.z0 + u * d, bx5 = lon ? bx4 : pk.x1 - .8, bz5 = lon ? pk.z1 - .8 : bz4;
        if (Math.hypot(bx4 - cx, bz4 - cz) > rr0 + 2) kslot(i % 2 ? 'semak' : 'bunga').push({ x: bx4, z: bz4, s: 1, k: i });
        if (Math.hypot(bx5 - cx, bz5 - cz) > rr0 + 2) kslot(i % 2 ? 'bunga' : 'semak').push({ x: bx5, z: bz5, s: 1, k: i });
      }
    }
  }
  function genKomplek() {
    KOMPLEK.forEach(function (kl) {
      kl.cx = (kl.x0 + kl.x1) / 2; kl.cz = (kl.z0 + kl.z1) / 2;
      if (kl.t === 'ring') ringKomplek(kl); else bulevar(kl);
    });
    PARKS.forEach(fillPark);
  }
  genKomplek();

  /* ---------- ruko di sepanjang jalan raya (rapi, jarak sama) ---------- */
  function genRuko() {
    var r = mulberry(2026), hash = {}, HS = 12, out = [], cnt = 0;
    var rukoC = [0xf7b26a, 0xe6e6e6, 0x9cc8f2, 0xf3a6a0, 0xbfe3b4, 0xf5e27a, 0xd9c6f2];
    var avoid = [], circ = [];
    POI.forEach(function (p) { avoid.push([p.x - p.w / 2 - p.m, p.x + p.w / 2 + p.m, p.z - p.d / 2 - p.m, p.z + p.d / 2 + p.m]); });
    AREAS.forEach(function (a) { avoid.push([a.x - a.w / 2 - 2.5, a.x + a.w / 2 + 2.5, a.z - a.d / 2 - 2.5, a.z + a.d / 2 + 2.5]); });
    KOMPLEK.forEach(function (k) { avoid.push([k.x0 - 1, k.x1 + 1, k.z0 - 1, k.z1 + 1]); });
    NPC.forEach(function (d) { circ.push([d.ox, d.oz, 5]); });
    STOPS.forEach(function (s) { circ.push([s.sx, s.sz, 7], [s.ex, s.ez, 6]); });
    circ.push([SPAWN.x, SPAWN.z, 8]);
    function ok(x, z, w, d, minRoad) {
      var rad = Math.hypot(w, d) / 2;
      if (Math.abs(x) > HALF.x - 4 - w / 2 || Math.abs(z) > HALF.z - 4 - d / 2) return false;
      var ra = roadAt(x, z); if (ra.d < rad * .78 + minRoad) return false;
      if (riverDist(x, z) < RIVER_W / 2 + rad + 2.5) return false;
      var i; for (i = 0; i < avoid.length; i++) { var a = avoid[i]; if (x + w / 2 > a[0] && x - w / 2 < a[1] && z + d / 2 > a[2] && z - d / 2 < a[3]) return false; }
      for (i = 0; i < circ.length; i++) if (Math.hypot(x - circ[i][0], z - circ[i][1]) < circ[i][2] + rad) return false;
      for (var ix = Math.floor((x - w / 2 - 1) / HS); ix <= Math.floor((x + w / 2 + 1) / HS); ix++) for (var iz = Math.floor((z - d / 2 - 1) / HS); iz <= Math.floor((z + d / 2 + 1) / HS); iz++) {
        var arr = hash[ix + ',' + iz]; if (!arr) continue;
        for (var k = 0; k < arr.length; k++) { var h = arr[k]; if (Math.abs(h.x - x) < (h.w + w) / 2 + 1 && Math.abs(h.z - z) < (h.d + d) / 2 + 1) return false; }
      }
      return true;
    }
    function put(h) {
      out.push(h);
      for (var ix = Math.floor((h.x - h.w / 2) / HS); ix <= Math.floor((h.x + h.w / 2) / HS); ix++) for (var iz = Math.floor((h.z - h.d / 2) / HS); iz <= Math.floor((h.z + h.d / 2) / HS); iz++) { var k = ix + ',' + iz; (hash[k] || (hash[k] = [])).push(h); }
    }
    RD.forEach(function (rd) {
      if (rd.c === 'small') return;
      for (var i = 0; i < rd.pts.length - 1; i++) {
        var a = rd.pts[i], b = rd.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        for (var side = -1; side <= 1; side += 2) {
          for (var t = 4; t < L - 4; t += 11.5) {
            if (r() < .12) continue;
            var w = 7.5, d = 7.5, off = rd.w / 2 + 6.2, x = a[0] + ux * t + uz * side * off, z = a[1] + uz * t - ux * side * off;
            if (!ok(x, z, w, d, 1.2)) continue;
            var fx = -uz * side, fz = ux * side;
            if (Math.abs(fx) > Math.abs(fz)) { fx = fx > 0 ? 1 : -1; fz = 0; } else { fz = fz > 0 ? 1 : -1; fx = 0; }
            put({ x: x, z: z, w: w, d: d, h: 6.6, wc: rukoC[cnt++ % rukoC.length], rc: 0x8c97a3, fx: fx, fz: fz, ruko: 1 });
          }
        }
      }
    });
    RUKO = out;
  }
  genRuko();

  /* =====================================================================
     PEMBUAT VISUAL KOMPLEK (model bawaan kalau file 3D belum ada)
     ===================================================================== */
  var BAT = {}, _bo = null;
  var BDEF = {
    box: [function () { return new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0); }, 'l'],
    cyl: [function () { return new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, .5, 0); }, 'l'],
    cone: [function () { return new THREE.ConeGeometry(1, 1, 10).translate(0, .5, 0); }, 'l'],
    sph: [function () { return new THREE.SphereGeometry(1, 10, 8); }, 'l'],
    hip: [function () { var g = new THREE.ConeGeometry(1, 1, 4); g.rotateY(Math.PI / 4); g.translate(0, .5, 0); return g; }, 'l'],
    gable: [function () {
      var g = new THREE.BufferGeometry(), v = [-.5, 0, .5, .5, 0, .5, .5, 1, 0, -.5, 0, .5, .5, 1, 0, -.5, 1, 0, .5, 0, -.5, -.5, 0, -.5, -.5, 1, 0, .5, 0, -.5, -.5, 1, 0, .5, 1, 0, -.5, 0, -.5, -.5, 0, .5, -.5, 1, 0, .5, 0, .5, .5, 0, -.5, .5, 1, 0];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
    }, 'l'],
    glow: [function () { return new THREE.SphereGeometry(1, 10, 8); }, 'b'],
    glowcone: [function () { return new THREE.ConeGeometry(1, 1, 8).translate(0, .5, 0); }, 'b'],
    glowcyl: [function () { return new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, .5, 0); }, 'b'],
    sh: [function () { return new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2); }, 's']
  };
  function bat(key) {
    if (!BAT[key]) {
      var d = BDEF[key], m;
      if (d[1] === 'l') m = lam(0xffffff);
      else if (d[1] === 'b') m = new THREE.MeshBasicMaterial({ color: 0xffffff });
      else m = new THREE.MeshBasicMaterial({ color: 0x1e4a22, transparent: true, opacity: .24, depthWrite: false });
      BAT[key] = { geo: d[0](), mat: m, it: [] };
    }
    return BAT[key];
  }
  /* kput: pasang satu bagian (kotak/silinder/dll) di koordinat dunia. Rotasi urutan YXZ. */
  function kput(key, x, y, z, sx, sy, sz, ry, col, rx, rz) {
    if (!_bo) { _bo = new THREE.Object3D(); _bo.rotation.order = 'YXZ'; }
    _bo.position.set(x, y, z); _bo.rotation.set(rx || 0, ry || 0, rz || 0); _bo.scale.set(sx, sy, sz); _bo.updateMatrix();
    bat(key).it.push([_bo.matrix.clone(), col]);
  }
  function kflush() {
    var c = new THREE.Color();
    Object.keys(BAT).forEach(function (k) {
      var b = BAT[k]; if (!b.it.length) return;
      var cells = {};
      b.it.forEach(function (e) { var m = e.mx || (e.mx = e[0].elements); var ky = Math.floor(m[12] / CELL) + ',' + Math.floor(m[14] / CELL); (cells[ky] || (cells[ky] = [])).push(e); });
      Object.keys(cells).forEach(function (ky) {
        var arr = cells[ky], im = new THREE.InstancedMesh(b.geo, b.mat, arr.length), pts = [];
        arr.forEach(function (e, i) {
          var m = e[0].elements, ext = Math.max(Math.hypot(m[0], m[1], m[2]), Math.hypot(m[8], m[9], m[10]));
          im.setMatrixAt(i, e[0]); c.setHex(e[1]); im.setColorAt(i, c); pts.push([m[12], m[14], ext]);
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.frustumCulled = false; im.userData.unit = true; scene.add(im); chReg(im, pts);
      });
    });
    BAT = {};
  }
  function ow(it, lx, lz) { var s = Math.sin(it.ry || 0), c = Math.cos(it.ry || 0); return [it.x + c * lx + s * lz, it.z - s * lx + c * lz]; }
  function hput(h, key, lx, ly, lz, sx, sy, sz, col) { var p = l2w(h, lx, lz); kput(key, p[0], ly, p[1], sx, sy, sz, Math.atan2(h.fx, h.fz), col); }
  function hwin(h, lx, lz, nx, nz, y) { var p = l2w(h, lx, lz); WINS.push({ x: p[0], y: y, z: p[1], ry: Math.atan2(nx, nz) }); }

  /* rumah komplek bawaan */
  function kHouse(h) {
    var typ = h.typ, L = h.lw_, Dd = h.ld_, H = h.h, fz = Dd / 2;
    hput(h, 'box', 0, 0, 0, L + .4, .5, Dd + .4, 0xb9b2a5);
    hput(h, 'box', 0, 0, 0, L, H, Dd, h.wc);
    if (typ === 'a') hput(h, 'gable', 0, H, 0, L + 1.4, 2.7, Dd + 1.4, h.rc);
    else if (typ === 'b') hput(h, 'hip', 0, H, 0, (L + 1.4) / 1.4142, 2.2, (Dd + 1.4) / 1.4142, h.rc);
    else { hput(h, 'box', 0, H, 0, L + .8, .35, Dd + .8, 0xe9e6df); hput(h, 'box', 0, H - 1.0, 0, L + .35, .5, Dd + .35, h.acc); }
    hput(h, 'box', -1.6, 0, fz + .06, 1.3, 2.3, .16, 0x7a4a2e);
    if (typ !== 'b') {
      hput(h, 'box', -1.6, 0, fz + 1.2, 3.4, .22, 2.4, 0xd5cfc2);
      hput(h, 'box', -1.6, 3.1, fz + 1.2, 3.8, .22, 2.8, typ === 'c' ? h.acc : h.rc);
      [-3.1, -.1].forEach(function (cx) { var p = l2w(h, cx, fz + 2.2); kput('cyl', p[0], 0, p[1], .1, 3.1, .1, 0, 0xf4f1e8); });
    } else hput(h, 'box', -1.6, 0, fz + .5, 2.2, .2, 1.0, 0xd5cfc2);
    hwin(h, 2.2, fz + .04, h.fx, h.fz, 2.0);
    if (typ !== 'b') { hwin(h, -2.4, fz + .04, h.fx, h.fz, 5.1); hwin(h, 2.4, fz + .04, h.fx, h.fz, 5.1); }
    [-1, 1].forEach(function (sd) {
      hwin(h, sd * (L / 2 + .04), 0, h.tx * sd, h.tz * sd, 2.0);
      if (typ !== 'b') hwin(h, sd * (L / 2 + .04), 0, h.tx * sd, h.tz * sd, 5.1);
    });
  }

  /* model bawaan tiap slot (dipakai kalau file 3D-nya belum ada) */
  var TCOL = [0x2f8f46, 0x3aa354, 0x45b05f, 0x2b8a5a, 0x5cb85c];
  function tcol(it) { return TCOL[Math.abs(Math.floor(it.x * 3.7 + it.z * 1.9)) % 5]; }
  var FBK = {
    pohon_besar: function (l) { l.forEach(function (it) { var s = it.s * 1.25; kput('cyl', it.x, 0, it.z, .3 * s, 2.8 * s, .3 * s, 0, 0x7a5233); kput('sph', it.x, 4.2 * s, it.z, 1.9 * s, 1.65 * s, 1.9 * s, 0, tcol(it)); }); },
    pohon_sedang: function (l) { l.forEach(function (it) { var s = it.s * .95; kput('cyl', it.x, 0, it.z, .24 * s, 2.4 * s, .24 * s, 0, 0x7a5233); kput('sph', it.x, 3.7 * s, it.z, 1.75 * s, 1.5 * s, 1.75 * s, 0, tcol(it)); }); },
    pohon_hias: function (l) {
      var fc = [0xf7a8c4, 0xffd23f, 0xffffff, 0xff9f43];
      l.forEach(function (it) { var s = it.s * .8; kput('cyl', it.x, 0, it.z, .18 * s, 1.9 * s, .18 * s, 0, 0x7a5233); kput('sph', it.x, 2.9 * s, it.z, 1.35 * s, 1.15 * s, 1.35 * s, 0, fc[(it.k || 0) % 4]); });
    },
    pohon_palem: function (l) {
      l.forEach(function (it) {
        var s = it.s, th = 6.2 * s; kput('cyl', it.x, 0, it.z, .17 * s, th, .17 * s, 0, 0x8a6a45);
        for (var f = 0; f < 9; f++) { var a = f / 9 * 6.2832, tl = .55, rl = 1.15 * s; kput('box', it.x + Math.sin(a) * rl * Math.cos(tl), th - Math.sin(tl) * rl * .8, it.z + Math.cos(a) * rl * Math.cos(tl), .5 * s, .06, 2.4 * s, a, 0x3b9a46, tl); }
        kput('sph', it.x, th, it.z, .3 * s, .3 * s, .3 * s, 0, 0x6b4a2a);
      });
    },
    semak: function (l) { l.forEach(function (it) { var s = it.s || 1; kput('sph', it.x, .55 * s, it.z, .9 * s, .7 * s, .9 * s, 0, tcol(it)); }); },
    bunga: function (l) {
      var fc = [0xff6b81, 0xffd23f, 0xffffff, 0xff9f43, 0xb57cff];
      l.forEach(function (it) {
        var s = it.s || 1; kput('sph', it.x, .22 * s, it.z, .9 * s, .26 * s, .9 * s, 0, 0x3f9a4a);
        for (var f = 0; f < 5; f++) { var a = f * 1.2566 + (it.k || 0), r = .5 * s; kput('sph', it.x + Math.cos(a) * r, .38 * s, it.z + Math.sin(a) * r, .2 * s, .2 * s, .2 * s, 0, fc[(f + (it.k || 0)) % 5]); }
      });
    },
    lampu_jalan: function (l) {
      l.forEach(function (it) {
        var a = ow(it, 0, .7), b = ow(it, 0, 1.35);
        kput('cyl', it.x, 0, it.z, .07, 4.6, .07, 0, 0x444c58); kput('box', a[0], 4.5, a[1], .12, .12, 1.4, it.ry, 0x444c58); kput('glow', b[0], 4.4, b[1], .3, .2, .3, 0, 0xfff0b0);
      });
    },
    lampu_taman: function (l) { l.forEach(function (it) { kput('cyl', it.x, 0, it.z, .06, 2.8, .06, 0, 0x444c58); kput('glow', it.x, 3.0, it.z, .28, .28, .28, 0, 0xfff3c0); }); },
    tempat_sampah: function (l) { l.forEach(function (it) { kput('cyl', it.x, 0, it.z, .32, .9, .32, 0, 0x2f8f6a); kput('cyl', it.x, .9, it.z, .36, .08, .36, 0, 0x246f52); }); },
    bangku: function (l) {
      l.forEach(function (it) {
        var bk = ow(it, 0, -.34), l1 = ow(it, -1.0, 0), l2 = ow(it, 1.0, 0);
        kput('box', it.x, .5, it.z, 2.4, .12, .8, it.ry, 0x9c6b3f); kput('box', bk[0], .55, bk[1], 2.4, .6, .1, it.ry, 0x9c6b3f);
        kput('box', l1[0], 0, l1[1], .1, .5, .7, it.ry, 0x444c58); kput('box', l2[0], 0, l2[1], .1, .5, .7, it.ry, 0x444c58);
      });
    },
    gazebo: function (l) {
      l.forEach(function (it) {
        kput('box', it.x, 0, it.z, 6, .3, 6, 0, 0xc9b79c);
        [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]].forEach(function (o) { kput('cyl', it.x + o[0], .3, it.z + o[1], .14, 3.0, .14, 0, 0x8a5a36); });
        kput('hip', it.x, 3.3, it.z, 6.8 / 1.4142, 1.9, 6.8 / 1.4142, 0, 0xb8562c);
      });
    },
    air_mancur: function (l) {
      l.forEach(function (it) {
        kput('cyl', it.x, 0, it.z, 2.4, .55, 2.4, 0, 0xd8d2c4); kput('glowcyl', it.x, .5, it.z, 2.1, .06, 2.1, 0, 0x58b8e8);
        kput('cyl', it.x, .5, it.z, .35, 1.4, .35, 0, 0xd8d2c4); kput('cyl', it.x, 1.8, it.z, 1.0, .25, 1.0, 0, 0xd8d2c4); kput('glowcone', it.x, 2.05, it.z, .35, 1.1, .35, 0, 0xbfe7ff);
      });
    },
    mainan_anak: function (l) {
      l.forEach(function (it) {
        var p;
        [[-3.8, -.7], [-3.8, .7], [-.6, -.7], [-.6, .7]].forEach(function (o) { p = ow(it, o[0], o[1]); kput('cyl', p[0], 0, p[1], .07, 2.6, .07, 0, 0xe0434a); });
        p = ow(it, -2.2, 0); kput('box', p[0], 2.55, p[1], 3.4, .14, .14, it.ry, 0xe0434a);
        [-2.9, -1.5].forEach(function (x) { p = ow(it, x, 0); kput('box', p[0], .6, p[1], .6, .08, .3, it.ry, 0x2a68dc); kput('box', p[0], .65, p[1], .03, 1.9, .03, it.ry, 0x9aa5b1); });
        p = ow(it, 2.4, -1.4); kput('box', p[0], 1.55, p[1], 1.4, .1, 1.2, it.ry, 0xffc42e);
        [-.7, .7].forEach(function (o) { p = ow(it, 2.4 + o, -1.9); kput('cyl', p[0], 0, p[1], .06, 1.6, .06, 0, 0xe0434a); });
        p = ow(it, 2.4, .6); kput('box', p[0], 1.0, p[1], 1.0, .08, 2.8, it.ry, 0x2a68dc, .55);
      });
    },
    mobil: function (l) {
      l.forEach(function (it) {
        var cb = ow(it, 0, -.2);
        kput('box', it.x, .15, it.z, 1.7, .3, 4.0, it.ry, 0x222831); kput('box', it.x, .35, it.z, 1.8, .75, 4.2, it.ry, it.c); kput('box', cb[0], 1.1, cb[1], 1.55, .62, 2.2, it.ry, 0x2b3a4a);
      });
    },
    pos_satpam: function (l) {
      l.forEach(function (it) {
        kput('box', it.x, 0, it.z, 2.4, 2.6, 2.4, it.ry, 0xf3eee0); kput('box', it.x, 2.6, it.z, 3.0, .25, 3.0, it.ry, 0x7a4a2e);
        var f = ow(it, 0, 1.21); kput('box', f[0], 1.0, f[1], 1.3, 1.0, .06, it.ry, 0x9fc5db);
      });
    },
    gerbang_komplek: function (l) {
      l.forEach(function (it) {
        var sp = it.span;
        [-1, 1].forEach(function (sd) { var p = ow(it, sd * sp / 2, 0); kput('box', p[0], 0, p[1], 1.0, 4.0, 1.0, it.ry, 0xe9e4d8); kput('box', p[0], 4.0, p[1], 1.4, .3, 1.4, it.ry, 0x8a5a36); });
        kput('box', it.x, 4.0, it.z, sp + 1.2, .9, .9, it.ry, 0xf3f0e6); kput('box', it.x, 4.9, it.z, sp + 1.8, .25, 1.2, it.ry, 0x8a5a36);
      });
    }
  };
  var TREE_R = { pohon_besar: 2.6, pohon_sedang: 2.0, pohon_palem: 1.4, pohon_hias: 1.5 };
  function kTree(t, i) {
    var s = t[2], id = (i % 9 === 4) ? 'pohon_palem' : (s > 1.1 ? 'pohon_besar' : 'pohon_sedang');
    kslot(id).push({ x: t[0], z: t[1], s: id === 'pohon_palem' ? .85 + (s - .8) * .3 : .8 + (s - .8) * .45 });
  }
  function renderProps() {
    var id, list;
    Object.keys(TREE_R).forEach(function (tid) {
      list = KSL[tid] || []; if (!list.length) return;
      list.forEach(function (it) { kput('sh', it.x, .05, it.z, TREE_R[tid] * it.s, 1, TREE_R[tid] * it.s, 0, 0x1e4a22); });
      if (!Assets.instance(tid, list)) FBK[tid](list);
    });
    ['semak', 'bunga', 'lampu_jalan', 'lampu_taman', 'bangku', 'tempat_sampah', 'gazebo', 'air_mancur', 'mainan_anak', 'mobil', 'pos_satpam', 'gerbang_komplek'].forEach(function (sid) {
      list = KSL[sid] || []; if (!list.length) return;
      if (sid === 'gerbang_komplek' && Assets.has(sid)) {
        var gd = Assets.dim(sid), gl = list.map(function (it) { return { x: it.x, z: it.z, ry: it.ry, sx: it.span / ((gd && gd[0]) || 14) }; });
        if (Assets.instance(sid, gl)) return;
      }
      if (sid === 'mobil' && Assets.has('mobil')) { Assets.instance('mobil', list); return; }
      if (!Assets.instance(sid, list)) FBK[sid](list);
    });
    /* pagar tanaman: panjangnya mengikuti kavling */
    if (HEDGE.length) {
      var hd = Assets.has('pagar_tanaman') ? Assets.dim('pagar_tanaman') : null;
      if (hd) Assets.instance('pagar_tanaman', HEDGE.map(function (it) { return { x: it.x, z: it.z, ry: it.ry, sx: it.len / hd[0] }; }));
      else HEDGE.forEach(function (it) { kput('box', it.x, 0, it.z, it.len, .85, .62, it.ry, 0x2f8f46); });
    }
    /* trotoar di depan baris rumah */
    var td = Assets.has('trotoar') ? Assets.dim('trotoar') : null, tl = [];
    ROWS.forEach(function (rw) {
      var ang = Math.atan2(rw.dx, rw.dz);
      if (td) {
        var n = Math.max(1, Math.round(rw.len / td[2])), step = rw.len / n;
        for (var k = 0; k < n; k++) { var u = step * (k + .5); tl.push({ x: rw.sx + rw.dx * u + rw.nx * KP.sw / 2, z: rw.sz + rw.dz * u + rw.nz * KP.sw / 2, y: .01, ry: ang, sx: KP.sw / td[0], sz: step / td[2] }); }
      } else {
        var mx = rw.sx + rw.dx * rw.len / 2 + rw.nx * KP.sw / 2, mz = rw.sz + rw.dz * rw.len / 2 + rw.nz * KP.sw / 2;
        kput('box', mx, 0, mz, rw.len, .1, KP.sw, Math.atan2(-rw.dz, rw.dx), 0xd9d4c6);
      }
    });
    if (td) { Assets.instance('trotoar', tl); markKeep('trotoar'); }
    /* papan nama gerbang komplek */
    KOMPLEK.forEach(function (k) {
      if (!k.gt) return;
      var g = k.gt, hh = Assets.has('gerbang_komplek') ? (Assets.cfg('gerbang_komplek').ukuran || [0, 6])[1] + .9 : 5.9, ry = Math.atan2(g.dx, g.dz), tx = textTex(k.n, 640, 100, '#fff6d6', '#10233f');
      [1, -1].forEach(function (sd) {
        var pl = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(11, k.n.length * .62 + 3), 1.7), new THREE.MeshBasicMaterial({ map: tx }));
        pl.position.set(g.x + g.dx * .65 * sd, hh, g.z + g.dz * .65 * sd); pl.rotation.y = ry + (sd > 0 ? 0 : Math.PI); scene.add(pl);
      });
    });
    kflush();
  }
  function roadTiles() {
    if (!Assets.has('jalan_lurus')) return;
    var dm = Assets.dim('jalan_lurus', [1, 0, 1]), rasio = Assets.cfg('jalan_lurus').rasio || 1, list = [], idx = 0;
    function seg(a, b, w) {
      var L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < .5) return;
      var ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, n = Math.max(1, Math.ceil(L / (w * rasio))), st = L / n, ry = Math.atan2(ux, uz);
      for (var k = 0; k < n; k++) { var t = st * (k + .5); list.push({ x: a[0] + ux * t, z: a[1] + uz * t, y: .02 + (idx % 40) * .002, ry: ry, sx: w / dm[0], sz: st * 1.015 / dm[2] }); }
      idx++;
    }
    RD.forEach(function (rd) { for (var i = 0; i < rd.pts.length - 1; i++) seg(rd.pts[i], rd.pts[i + 1], rd.w); });
    KROADS.forEach(function (rd) { for (var i = 0; i < rd.pts.length - 1; i++) seg(rd.pts[i], rd.pts[i + 1], rd.w); });
    Assets.instance('jalan_lurus', list, [1, 0, 1]); markKeep('jalan_lurus');
  }
  function markKeep(id) { scene.children.forEach(function (o) { if (o.isInstancedMesh && o.userData.glb === id) o.userData.keep = true; }); }
  /* rumah komplek + ruko */
  function buildHouses() {
    COLL.forEach(function (c) { if (c.r) addCircC(c.x, c.z, c.r); else addBoxC(c.x0, c.x1, c.z0, c.z1); });
    var byT = { a: [], b: [], c: [] };
    HOUSES.forEach(function (h) {
      addBoxC(h.cx - h.w / 2, h.cx + h.w / 2, h.cz - h.d / 2, h.cz + h.d / 2);
      byT[h.typ].push({ x: h.cx, z: h.cz, ry: Math.atan2(h.fx, h.fz) });
    });
    ['a', 'b', 'c'].forEach(function (t) {
      if (Assets.instance('rumah_' + t, byT[t])) return;
      HOUSES.forEach(function (h) { if (h.typ === t) kHouse(h); });
    });
    RUKO.forEach(function (o) { addBoxC(o.x - o.w / 2, o.x + o.w / 2, o.z - o.d / 2, o.z + o.d / 2); });
    if (!RUKO.length) return;
    if (Assets.instance('ruko', RUKO.map(function (o) { return { x: o.x, z: o.z, ry: Math.atan2(o.fx, o.fz) }; }))) return;
    var nH = RUKO.length, dm = new THREE.Object3D(), col = new THREE.Color();
    var hwalls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), new THREE.MeshLambertMaterial({ map: facadeTex() }), nH);
    var rg = new THREE.ConeGeometry(1, 1, 4); rg.rotateY(Math.PI / 4); rg.translate(0, .5, 0);
    var hroofs = new THREE.InstancedMesh(rg, lam(0xffffff), nH);
    RUKO.forEach(function (o, i) {
      dm.rotation.set(0, 0, 0); dm.position.set(o.x, 0, o.z); dm.scale.set(o.w, o.h, o.d); dm.updateMatrix(); hwalls.setMatrixAt(i, dm.matrix); col.setHex(o.wc); hwalls.setColorAt(i, col);
      dm.position.set(o.x, o.h, o.z); dm.scale.set((o.w + 1.2) / 1.4142, .5, (o.d + 1.2) / 1.4142); dm.updateMatrix(); hroofs.setMatrixAt(i, dm.matrix); col.setHex(o.rc); hroofs.setColorAt(i, col);
    });
    hwalls.instanceColor.needsUpdate = true; hroofs.instanceColor.needsUpdate = true; hwalls.frustumCulled = false; hroofs.frustumCulled = false; scene.add(hwalls, hroofs);
  }

  /* ---------- gambar tanah komplek (kanvas) ---------- */
  function kGround(g, C, K) {
    var i, p, q, r = mulberry(99);
    KOMPLEK.forEach(function (k) {
      p = C(k.x0, k.z0); g.fillStyle = gfill(g, 'tanah_rumput', '#9bd384', K); g.fillRect(p[0], p[1], (k.x1 - k.x0) * K, (k.z1 - k.z0) * K);
      g.strokeStyle = '#7fb86a'; g.lineWidth = .3 * K; g.strokeRect(p[0], p[1], (k.x1 - k.x0) * K, (k.z1 - k.z0) * K);
    });
    HOUSES.forEach(function (h) {
      function R(x0, x1, z0, z1, col) { var a = lrect(h, x0, x1, z0, z1); p = C(a[0], a[2]); g.fillStyle = col; g.fillRect(p[0], p[1], (a[1] - a[0]) * K, (a[3] - a[2]) * K); }
      var hz = h.ld_ / 2, fr = hz + KP.fy;
      R(h.ls - h.sp / 2, h.ls + h.sp / 2, fr - KP.ld, fr, gfill(g, 'tanah_rumput', '#8fcd79', K));
      R(-4.5, 4.5, -hz - .4, hz + .4, '#e2dccd');
      R(-2.35, -.85, hz, fr + KP.sw * .6, gfill(g, 'tanah_paving', '#efe8da', K));
      R(4.5, 7.3, -2, fr + KP.sw * .6, gfill(g, 'tanah_paving', '#c9c4b8', K));
    });
    PARKS.forEach(function (pk) {
      p = C(pk.x0, pk.z0); g.fillStyle = gfill(g, 'tanah_rumput', '#86cc72', K); g.fillRect(p[0], p[1], (pk.x1 - pk.x0) * K, (pk.z1 - pk.z0) * K);
      for (i = 0; i < 220; i++) { g.fillStyle = r() < .5 ? 'rgba(255,255,255,.08)' : 'rgba(20,90,30,.10)'; g.fillRect(p[0] + r() * (pk.x1 - pk.x0) * K, p[1] + r() * (pk.z1 - pk.z0) * K, 3 + r() * 6, 3 + r() * 6); }
      if (pk.track) {
        var t = pk.track; q = C(t[0], t[2]); g.lineJoin = 'round';
        g.strokeStyle = '#c98259'; g.lineWidth = 2.5 * K; g.strokeRect(q[0], q[1], (t[1] - t[0]) * K, (t[3] - t[2]) * K);
        g.strokeStyle = '#e3a47c'; g.lineWidth = 1.9 * K; g.strokeRect(q[0], q[1], (t[1] - t[0]) * K, (t[3] - t[2]) * K);
      }
      (pk.paths || []).forEach(function (ph) {
        g.strokeStyle = gfill(g, 'tanah_paving', '#e8e1d1', K); g.lineWidth = 2 * K; g.lineCap = 'butt'; g.beginPath();
        ph.forEach(function (a, k) { var c = C(a[0], a[1]); if (k) g.lineTo(c[0], c[1]); else g.moveTo(c[0], c[1]); }); g.stroke();
      });
      if (pk.pond) {
        var pd = pk.pond; q = C(pd.x, pd.z);
        g.fillStyle = '#d5c79a'; g.beginPath(); g.ellipse(q[0], q[1], (pd.rx + 1.3) * K, (pd.rz + 1.3) * K, 0, 0, 7); g.fill();
        g.fillStyle = '#58b8e8'; g.beginPath(); g.ellipse(q[0], q[1], pd.rx * K, pd.rz * K, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(190,230,250,.55)'; g.beginPath(); g.ellipse(q[0] - pd.rx * .2 * K, q[1] - pd.rz * .25 * K, pd.rx * .45 * K, pd.rz * .3 * K, 0, 0, 7); g.fill();
      }
      (pk.pads || []).forEach(function (pd) {
        q = C(pd.x, pd.z);
        if (pd.k === 'plaza') { g.fillStyle = gfill(g, 'tanah_paving', '#e4dccb', K); g.beginPath(); g.arc(q[0], q[1], pd.r * K, 0, 7); g.fill(); g.strokeStyle = '#c9bfa8'; g.lineWidth = .25 * K; g.stroke(); g.beginPath(); g.arc(q[0], q[1], pd.r * .62 * K, 0, 7); g.stroke(); }
        else { g.fillStyle = '#ead9a8'; g.fillRect(q[0] - pd.w / 2 * K, q[1] - pd.d / 2 * K, pd.w * K, pd.d * K); }
      });
    });
  }
  function kRoadsGround(g, C, K) {
    function path(pts) { g.beginPath(); pts.forEach(function (q, i) { var a = C(q[0], q[1]); if (i) g.lineTo(a[0], a[1]); else g.moveTo(a[0], a[1]); }); }
    g.lineCap = 'butt'; g.lineJoin = 'round';
    [[2 * KP.sw, '#e3ded0', 'tanah_trotoar'], [0, '#5d6772', 'tanah_aspal']].forEach(function (pa) {
      KROADS.forEach(function (rd) {
        var w = rd.w + pa[0], st = gfill(g, pa[2], pa[1], K); g.strokeStyle = st; g.fillStyle = st; g.lineWidth = w * K;
        if (rd.pts.length === 2 && rd.pts[0][0] === rd.pts[1][0] && rd.pts[0][1] === rd.pts[1][1]) { var a = C(rd.pts[0][0], rd.pts[0][1]); g.beginPath(); g.arc(a[0], a[1], w / 2 * K, 0, 7); g.fill(); }
        else { path(rd.pts); g.stroke(); }
      });
    });
    MEDIANS.forEach(function (m) {
      g.strokeStyle = '#e3ded0'; g.lineWidth = (m.w + .6) * K; path([m.a, m.b]); g.stroke();
      g.strokeStyle = '#7fc66a'; g.lineWidth = m.w * K; path([m.a, m.b]); g.stroke();
    });
    g.setLineDash([2 * K, 2 * K]); g.strokeStyle = '#f1e6a8'; g.lineWidth = .14 * K;
    KROADS.forEach(function (rd) { if (rd.dash) { path(rd.pts); g.stroke(); } });
    g.setLineDash([]);
  }

  /* ---------- tanah (tekstur) ---------- */
  function drawGround(K) {
    var cw = Math.round(WX * K), ch = Math.round(WZ * K), c = document.createElement('canvas'); c.width = cw; c.height = ch; var g = c.getContext('2d');
    var C = function (x, z) { return [(x + HALF.x) * K, (z + HALF.z) * K]; }, r = mulberry(7), i, p;
    g.fillStyle = gfill(g, 'tanah_rumput', '#a9d28b', K); g.fillRect(0, 0, cw, ch);
    for (i = 0; i < 14000; i++) { g.fillStyle = r() < .5 ? 'rgba(255,255,255,.07)' : 'rgba(20,80,30,.09)'; g.fillRect(r() * cw, r() * ch, 3 + r() * 6, 3 + r() * 6); }
    kGround(g, C, K);
    RUKO.forEach(function (h) { p = C(h.x - h.w / 2 - .9, h.z - h.d / 2 - .9); g.fillStyle = h.ruko ? '#cdc8ba' : '#ddd7c6'; g.fillRect(p[0], p[1], (h.w + 1.8) * K, (h.d + 1.8) * K); });
    POI.forEach(function (b) { var m = b.id === 'pasar' ? 7 : 2.4; p = C(b.x - b.w / 2 - m, b.z - b.d / 2 - m); g.fillStyle = b.id === 'pasar' ? '#cbbf9f' : '#dcd6c3'; g.fillRect(p[0], p[1], (b.w + m * 2) * K, (b.d + m * 2) * K); });
    // sungai
    g.lineCap = 'round'; g.lineJoin = 'round';
    function poly(pts, w, col) { g.strokeStyle = col; g.lineWidth = w * K; g.beginPath(); pts.forEach(function (q, k) { var a = C(q[0], q[1]); if (k) g.lineTo(a[0], a[1]); else g.moveTo(a[0], a[1]); }); g.stroke(); }
    poly(RIVER, RIVER_W + 5, '#9bc884'); poly(RIVER, RIVER_W + 2, '#d5c79a'); poly(RIVER, RIVER_W, '#5db6ea'); poly(RIVER, RIVER_W * .45, 'rgba(160,220,250,.55)');
    // kolam, lapangan, taman
    AREAS.forEach(function (a) {
      var q = C(a.x - a.w / 2, a.z - a.d / 2);
      if (a.id === 'alun') {
        g.fillStyle = '#d9d3c0'; g.fillRect(q[0] - 2 * K, q[1] - 2 * K, (a.w + 4) * K, (a.d + 4) * K);
        g.fillStyle = '#b9b872'; g.fillRect(q[0], q[1], a.w * K, a.d * K);
        for (i = 0; i < 700; i++) { g.fillStyle = i % 2 ? 'rgba(120,140,60,.22)' : 'rgba(200,180,110,.25)'; g.fillRect(q[0] + r() * a.w * K, q[1] + r() * a.d * K, 4 + r() * 18, 3 + r() * 10); }
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = .22 * K; g.strokeRect(q[0] + 2 * K, q[1] + 2 * K, (a.w - 4) * K, (a.d - 4) * K);
        var m = C(a.x, a.z); g.beginPath(); g.moveTo(q[0] + 2 * K, m[1]); g.lineTo(q[0] + (a.w - 2) * K, m[1]); g.stroke(); g.beginPath(); g.arc(m[0], m[1], 4 * K, 0, 7); g.stroke();
      } else if (a.id === 'taman') {
        g.fillStyle = '#8fd075'; g.fillRect(q[0], q[1], a.w * K, a.d * K);
        var cols = ['#ff6b81', '#ffd23f', '#ffffff', '#ff9f43', '#b57cff'];
        for (i = 0; i < 260; i++) { g.fillStyle = cols[i % 5]; g.beginPath(); g.arc(q[0] + r() * a.w * K, q[1] + r() * a.d * K, K * .2, 0, 7); g.fill(); }
      } else {
        g.fillStyle = '#d5c79a'; g.fillRect(q[0] - 1.2 * K, q[1] - 1.2 * K, (a.w + 2.4) * K, (a.d + 2.4) * K);
        g.fillStyle = '#58b8e8'; g.fillRect(q[0], q[1], a.w * K, a.d * K);
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = .15 * K; g.beginPath(); g.arc(q[0] + a.w * .3 * K, q[1] + a.d * .35 * K, 2 * K, 3.6, 5.2); g.stroke();
      }
    });
    // jalan
    function drawRoads(extra, shade) { RD.forEach(function (rd) { poly(rd.pts, rd.w + extra, shade(rd)); }); }
    drawRoads(2.6, function () { return gfill(g, 'tanah_trotoar', '#d4cfc4', K); });
    drawRoads(0, function (rd) { return gfill(g, 'tanah_aspal', rd.c === 'main' ? '#59636f' : (rd.c === 'mid' ? '#69747f' : '#858f9a'), K); });
    g.setLineDash([2.4 * K, 2.2 * K]); g.lineCap = 'butt';
    RD.forEach(function (rd) { if (rd.c === 'small') return; poly(rd.pts, rd.c === 'main' ? .22 : .16, rd.c === 'main' ? '#ffffff' : '#f1e6a8'); });
    g.setLineDash([]); g.lineCap = 'round';
    kRoadsGround(g, C, K);
    // halte & titik mulai
    p = C(SPAWN.x, SPAWN.z); g.fillStyle = 'rgba(255,196,46,.92)'; g.beginPath(); g.arc(p[0], p[1], 3.4 * K, 0, 7); g.fill(); g.lineWidth = .35 * K; g.strokeStyle = '#10233f'; g.stroke();
    g.fillStyle = '#10233f'; g.font = '800 ' + Math.round(1.5 * K) + 'px "Baloo 2","Trebuchet MS",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('MULAI', p[0], p[1]);
    return c;
  }

  function textTex(text, w, h, bg, fg) {
    var c = document.createElement('canvas'); c.width = Math.round(w * QL.tex); c.height = Math.round(h * QL.tex); var g = c.getContext('2d'); g.scale(QL.tex, QL.tex);
    g.fillStyle = bg; rr(g, 3, 3, w - 6, h - 6, h * .22); g.fill(); g.lineWidth = h * .06; g.strokeStyle = fg; g.stroke();
    g.fillStyle = fg; g.font = '800 ' + Math.round(h * .5) + 'px "Baloo 2","Trebuchet MS",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + h * .04, w - 30);
    var t = new THREE.CanvasTexture(c); t.anisotropy = 1; if (!QL.mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; } return t;
  }
  function markTex(kind) {
    var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d');
    g.fillStyle = kind === 'q' ? '#ffc42e' : (kind === 'r' ? '#e0434a' : '#14a06e'); g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#10233f'; g.stroke();
    if (kind === 'q' || kind === 'r') { g.fillStyle = kind === 'r' ? '#ffffff' : '#10233f'; rr(g, 57, 28, 14, 44, 6); g.fill(); g.beginPath(); g.arc(64, 90, 8, 0, 7); g.fill(); }
    else { g.strokeStyle = '#fff'; g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(38, 66); g.lineTo(57, 85); g.lineTo(90, 44); g.stroke(); }
    return new THREE.CanvasTexture(c);
  }
  function facadeTex() {
    var c = document.createElement('canvas'); c.width = c.height = 128; var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, 112, 128, 16);
    g.fillStyle = '#f7f7f7'; rr(g, 14, 34, 38, 42, 4); g.fill(); g.fillStyle = '#7fa9c4'; rr(g, 18, 38, 30, 34, 3); g.fill();
    g.fillStyle = '#f7f7f7'; g.fillRect(31, 38, 3, 34); g.fillRect(18, 54, 30, 3);
    g.fillStyle = '#9a7a5a'; rr(g, 78, 50, 30, 62, 3); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(84, 58, 18, 22);
    var t = new THREE.CanvasTexture(c); t.anisotropy = QL.aniso; return t;
  }
  var STAT_Q = null;
  function addBox(x, z, w, d, h, color, y0) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(color)); m.position.set(x, (y0 || 0) + h / 2, z); scene.add(m); return m;
  }
  var WINS = [];
  function addPOI(b) {
    var fx = b.f[0], fz = b.f[1], he = fx !== 0 ? b.w / 2 : b.d / 2, ry2 = Math.atan2(fx, fz), flat = (b.kind === 'hospital' || b.kind === 'market');
    var POIF = { school: 'bangunan_sekolah', mosque: 'bangunan_masjid', hospital: 'bangunan_rs', market: 'bangunan_pasar', shop: 'bangunan_toko' }, mid = POIF[b.kind], mdl = mid && Assets.has(mid);
    if (mdl) {
      var hh = Assets.cfg(mid).tinggi || b.h + 3, node = Assets.make(mid, fx !== 0 ? [b.d, hh, b.w] : [b.w, hh, b.d]);
      node.position.set(b.x, 0, b.z); node.rotation.y = ry2; scene.add(node);
    } else {
    var walls = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), lam(b.c)); walls.position.set(b.x, b.h / 2, b.z); scene.add(walls);
    var trim = new THREE.Mesh(new THREE.BoxGeometry(b.w + .5, .6, b.d + .5), lam(0xb9b2a5)); trim.position.set(b.x, .3, b.z); scene.add(trim);
    if (flat) { var slab = new THREE.Mesh(new THREE.BoxGeometry(b.w + 1, .6, b.d + 1), lam(b.roof)); slab.position.set(b.x, b.h + .3, b.z); scene.add(slab); }
    else {
      var rg = new THREE.ConeGeometry(1, 1, 4); rg.rotateY(Math.PI / 4); var rh = b.kind === 'school' ? 1.8 : (b.kind === 'church' ? 3.2 : 2.6);
      var roof = new THREE.Mesh(rg, lam(b.roof)); roof.scale.set((b.w + 1.4) / 1.4142, rh, (b.d + 1.4) / 1.4142); roof.position.set(b.x, b.h + rh / 2, b.z); scene.add(roof);
    }
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(function (dir) {
      var h2 = dir[0] !== 0 ? b.w / 2 : b.d / 2, len = dir[0] !== 0 ? b.d : b.w, tx = Math.abs(dir[1]), tz = Math.abs(dir[0]);
      var cnt = Math.floor((len - 3) / 4), isDoor = (dir[0] === b.f[0] && dir[1] === b.f[1]), rows = b.h > 8 ? [b.h * .33, b.h * .7] : [b.h * .48];
      for (var k = 0; k < cnt; k++) {
        var off = -((cnt - 1) / 2) * 4 + k * 4;
        rows.forEach(function (wy, ri) {
          if (isDoor && ri === 0 && Math.abs(off) < 2.8) return;
          WINS.push({ x: b.x + dir[0] * (h2 + .04) + tx * off, y: wy + .3, z: b.z + dir[1] * (h2 + .04) + tz * off, ry: Math.atan2(dir[0], dir[1]) });
        });
      }
    });
    }
    var door = mdl ? null : new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.2, .2), lam(0x7a4a2e)); if (door) { door.position.set(b.x + fx * (he + .06), 1.6, b.z + fz * (he + .06)); door.rotation.y = ry2; scene.add(door); }
    var sw = clamp(b.n.length * .36, 4.6, 11), sg = new THREE.Mesh(new THREE.PlaneGeometry(sw, 1.5), new THREE.MeshBasicMaterial({ map: textTex(b.n, 640, 100, '#ffffff', '#10233f') }));
    sg.position.set(b.x + fx * (he + .16), Math.min(b.h - .9, 5.4), b.z + fz * (he + .16)); sg.rotation.y = ry2; scene.add(sg);
    if (!b.nopin) W.pin.push(b);
    addBoxC(b.x - b.w / 2 - .25, b.x + b.w / 2 + .25, b.z - b.d / 2 - .25, b.z + b.d / 2 + .25);
    var px = -fz, pz = fx; /* arah menyamping */
    function post(x, z, h, col, r) { var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), lam(col)); m.position.set(x, h / 2, z); scene.add(m); return m; }
    if (b.kind === 'school') {
      var fxp = b.x + fx * (he + 3.5) + px * (b.w / 2 + 1.2) * (fx !== 0 ? 0 : 1), fzp = b.z + fz * (he + 3.5) + pz * (b.d / 2 + 1.2) * (fz !== 0 ? 0 : 1);
      post(fxp, fzp, 8, 0xdfe5ea, .08); addBox(fxp + .6, fzp, 1.2, .05, .8, 0xe0434a, 7.1); addBox(fxp + .6, fzp, 1.2, .05, .8, 0xffffff, 6.3);
      addCircC(fxp, fzp, .3);
      if (b.id === 'pesantren') { var dome = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 10, 0, 6.283, 0, 1.57), lam(0x14a06e)); dome.position.set(b.x - b.w / 2 + 5, b.h + 1.4, b.z); scene.add(dome); addBox(b.x - b.w / 2 + 5, b.z, 4.4, 4.4, 1.4, 0xeaf6ee, b.h); post(b.x - b.w / 2 + 5, b.z, 4.6, 0xffd23f, .08).position.y = b.h + 4.8 + 1; }
    } else if (b.kind === 'mosque') {
      var dm2 = new THREE.Mesh(new THREE.SphereGeometry(4.2, 18, 10, 0, 6.283, 0, 1.57), lam(0x14a06e)); dm2.position.set(b.x, b.h + .6, b.z); scene.add(dm2);
      post(b.x, b.z, 2.2, 0xffd23f, .08).position.y = b.h + 5.1;
      var mn = addBox(b.x + b.w / 2 - 1.5, b.z + b.d / 2 - 1.5, 2.2, 2.2, b.h + 9, 0xf4f1e6, 0); var mc = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3, 8), lam(0x14a06e)); mc.position.set(mn.position.x, b.h + 10.5, mn.position.z); scene.add(mc);
      addCircC(mn.position.x, mn.position.z, 1.6);
    } else if (b.kind === 'hospital') {
      var cx = b.x + fx * (he + .2), cz = b.z + fz * (he + .2);
      var v = new THREE.Mesh(new THREE.PlaneGeometry(1, 3), new THREE.MeshBasicMaterial({ color: 0xe0434a })), hz = new THREE.Mesh(new THREE.PlaneGeometry(3, 1), new THREE.MeshBasicMaterial({ color: 0xe0434a }));
      [v, hz].forEach(function (m) { m.position.set(cx, b.h - 2.4, cz); m.rotation.y = ry2; scene.add(m); });
    } else if (b.kind === 'church') {
      var tw = addBox(b.x + fx * (he - 1), b.z + fz * (he - 1), 3.6, 3.6, b.h + 3, 0xf3ead2, 0);
      var sp = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5, 4), lam(0x5a2b45)); sp.rotation.y = Math.PI / 4; sp.position.set(tw.position.x, b.h + 5.5, tw.position.z); scene.add(sp);
      addBox(tw.position.x, tw.position.z, .3, .3, 2.2, 0xffffff, b.h + 7.6); addBox(tw.position.x, tw.position.z, 1.4, .3, .3, 0xffffff, b.h + 8.6);
    } else if (b.kind === 'market') {
      var uc = [0xe0434a, 0xffc42e, 0x2a68dc, 0x14a06e, 0xf08a24, 0xd6538a];
      for (var u = 0; u < 12; u++) {
        var ux = b.x - b.w / 2 - 4.5 + (u % 2) * 2.6, uz = b.z - b.d / 2 + 2 + Math.floor(u / 2) * 4.2;
        post(ux, uz, 2.2, 0xeeeeee, .06); var cn = new THREE.Mesh(new THREE.ConeGeometry(1.7, .9, 8), lam(uc[u % 6])); cn.position.set(ux, 2.6, uz); scene.add(cn); addBox(ux, uz, 1.4, 1, .8, 0x9c6b3f, 0); addCircC(ux, uz, 1);
      }
    }
  }
  function addArea(a) {
    if (a.id === 'alun') {
      [-1, 1].forEach(function (s) {
        var gz = a.z + s * (a.d / 2 - 2.2);
        [-3.6, 3.6].forEach(function (ox) { var p = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, 2.4, 8), lam(0xffffff)); p.position.set(a.x + ox, 1.2, gz); scene.add(p); addCircC(a.x + ox, gz, .4); });
        addBox(a.x, gz, 7.4, .2, .2, 0xffffff, 2.3);
        var net = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.3), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .25, side: THREE.DoubleSide })); net.position.set(a.x, 1.15, gz + s * 1.1); scene.add(net);
      });
    } else if (a.id === 'mancing86' || a.id === 'kolam') {
      addBoxC(a.x - a.w / 2, a.x + a.w / 2, a.z - a.d / 2, a.z + a.d / 2);
      var hx = a.x - a.w / 2 - 3.6, hz = a.z;
      [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]].forEach(function (o) { var p = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 2.4, 6), lam(0x8a5a36)); p.position.set(hx + o[0], 1.2, hz + o[1]); scene.add(p); });
      var hr = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.4, 4), lam(0xc99a63)); hr.rotation.y = Math.PI / 4; hr.position.set(hx, 3.1, hz); scene.add(hr);
      addBox(hx, hz, 2.8, 2.8, .2, 0xb98a56, .5); addBoxC(hx - 1.5, hx + 1.5, hz - 1.5, hz + 1.5);
    } else if (a.id === 'taman') {
      [[-8, 6, 0], [0, 6, 0], [8, 6, 0]].forEach(function (b) { addBench(a.x + b[0], a.z + b[1], Math.PI); });
    }
  }
  function addBench(x, z, ry) {
    var gb = new THREE.Group(), seat = new THREE.Mesh(new THREE.BoxGeometry(2.6, .2, .8), lam(0x9c6b3f)), back = new THREE.Mesh(new THREE.BoxGeometry(2.6, .7, .12), lam(0x9c6b3f)), l1 = new THREE.Mesh(new THREE.BoxGeometry(.2, .5, .7), lam(0x444c58)), l2 = l1.clone();
    seat.position.y = .55; back.position.set(0, .95, -.34); l1.position.set(-1.1, .25, 0); l2.position.set(1.1, .25, 0); gb.add(seat, back, l1, l2); gb.position.set(x, 0, z); gb.rotation.y = ry; scene.add(gb);
    addBoxC(x - 1.4, x + 1.4, z - .6, z + .6);
  }
  function addHalte(s) {
    var g = new THREE.Group(), lc = MP.LINES[s.line].cc;
    var roof = new THREE.Mesh(new THREE.BoxGeometry(4.6, .2, 2.2), lam(lc)); roof.position.set(0, 2.7, 0); g.add(roof);
    var back = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, .1), new THREE.MeshLambertMaterial({ color: 0xcfeaf7, transparent: true, opacity: .6 })); back.position.set(0, 1.5, -.95); g.add(back);
    [-2.1, 2.1].forEach(function (x) { var p = new THREE.Mesh(new THREE.BoxGeometry(.14, 2.6, .14), lam(0x444c58)); p.position.set(x, 1.3, .9); g.add(p); var p2 = p.clone(); p2.position.z = -.9; g.add(p2); });
    var bench = new THREE.Mesh(new THREE.BoxGeometry(3.2, .16, .7), lam(0x9c6b3f)); bench.position.set(0, .55, -.5); g.add(bench);
    [-1.3, 1.3].forEach(function (x) { var l = new THREE.Mesh(new THREE.BoxGeometry(.14, .5, .5), lam(0x444c58)); l.position.set(x, .25, -.5); g.add(l); });
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 4, 6), lam(0x444c58)); pole.position.set(3.1, 2, .4); g.add(pole);
    var tx = textTex(s.n, 512, 100, '#ffffff', hex(lc));
    [0, Math.PI].forEach(function (ry) { var pl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, .7), new THREE.MeshBasicMaterial({ map: tx })); pl.position.set(3.1 + (ry ? 0 : 0), 4.3, .4 + (ry ? -.05 : .05)); pl.rotation.y = ry; g.add(pl); });
    var badge = new THREE.Mesh(new THREE.CircleGeometry(.5, 16), new THREE.MeshBasicMaterial({ color: lc, side: THREE.DoubleSide })); badge.position.set(3.1, 3.5, .5); g.add(badge);
    g.position.set(s.sx, 0, s.sz); g.rotation.y = Math.atan2(-s.nx, -s.nz); scene.add(g);
    addCircC(s.sx, s.sz, 1.5); addCircC(s.sx + Math.cos(g.rotation.y) * 3.1, s.sz - Math.sin(g.rotation.y) * 3.1, .25);
  }
  /* ---------- kendaraan umum ---------- */
  function mkVehicle(col, label) {
    if (Assets.has('angkot')) {
      var gm = new THREE.Group(), am = Assets.make('angkot'), atx = textTex(label, 256, 100, '#ffffff', hex(col));
      gm.add(am); var ah = (Assets.cfg('angkot').ukuran || [0, 2.6])[1] || 2.6;
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(1.6, .12, 1.2), new THREE.MeshBasicMaterial({ color: col })); stripe.position.set(0, ah + .1, 0); gm.add(stripe);
      var bd = new THREE.Mesh(new THREE.PlaneGeometry(1.4, .55), new THREE.MeshBasicMaterial({ map: atx, side: THREE.DoubleSide })); bd.position.set(0, ah + .55, 0); gm.add(bd);
      return gm;
    }
    var g = new THREE.Group(), body = lam(col), white = lam(0xf4f1e8), glass = lam(0x7fb8d6), dark = lam(0x222831);
    var lower = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.05, 4.9), body); lower.position.y = .95; g.add(lower);
    var cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 3.7), white); cab.position.set(0, 1.98, -.35); g.add(cab);
    var win = new THREE.Mesh(new THREE.BoxGeometry(2.04, .55, 3.3), glass); win.position.set(0, 2.05, -.35); g.add(win);
    var rf = new THREE.Mesh(new THREE.BoxGeometry(2.1, .14, 3.8), body); rf.position.set(0, 2.55, -.35); g.add(rf);
    var hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, .5, 1.1), body); hood.position.set(0, 1.5, 1.8); g.add(hood);
    var ws = new THREE.Mesh(new THREE.BoxGeometry(1.9, .6, .08), glass); ws.position.set(0, 2.0, 1.52); ws.rotation.x = -.35; g.add(ws);
    [-1, 1].forEach(function (sx) {
      [1.55, -1.5].forEach(function (z) { var w = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .3, 12), dark); w.rotation.z = Math.PI / 2; w.position.set(sx * 1.0, .42, z); g.add(w); });
      var hl = new THREE.Mesh(new THREE.BoxGeometry(.4, .25, .08), new THREE.MeshBasicMaterial({ color: 0xfff3b0 })); hl.position.set(sx * .7, 1.1, 2.47); g.add(hl);
    });
    var tx = textTex(label, 256, 100, '#ffffff', hex(col));
    [1, -1].forEach(function (sx) { var pl = new THREE.Mesh(new THREE.PlaneGeometry(2.6, .8), new THREE.MeshBasicMaterial({ map: tx })); pl.position.set(sx * 1.06, 1.05, -.2); pl.rotation.y = sx * Math.PI / 2; g.add(pl); });
    var top = new THREE.Mesh(new THREE.PlaneGeometry(1.8, .7), new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide })); top.position.set(0, 2.9, 1.5); top.rotation.x = -.2; g.add(top);
    return g;
  }
  var VEH = [], LANE = 1.7;
  function addVehicles() {
    Object.keys(MP.LINES).map(function (k) { return [k, k === 'B' ? [.12, .6, .85] : [.1, .55]]; }).forEach(function (lc) {
      var rt = ROUTE[lc[0]], ln = MP.LINES[lc[0]];
      lc[1].forEach(function (f, k) {
        var g = mkVehicle(ln.cc, ln.n.replace('Angkot ', '')); scene.add(g);
        var v = { g: g, rt: rt, ph: f, tl: buildTimeline(rt, STOPS.filter(function (s) { return s.line === lc[0]; }).map(function (s) { return s.s; }), 8 + k * 1.5), circle: { x: 0, z: 0, r: 1.9 }, yaw: 0, init: false };
        VEH.push(v); W.dyn.push(v.circle);
      });
    });
  }
  function vehPlace(g, rt, s, dir, lane) {
    var p = routeAt(rt, s), dx = p.dx * dir, dz = p.dz * dir;
    g.position.set(p.x + dz * lane, 0, p.z - dx * lane);
    return Math.atan2(dx, dz);
  }
  function buildTimeline(rt, stopS, spd) {
    var pts = [0], ss = stopS.slice().sort(function (a, b) { return a - b; }), segs = [], t = 0, i;
    ss.forEach(function (s) { if (s > 4 && s < rt.len - 4) pts.push(s); }); pts.push(rt.len);
    function dwell(s, dur, dir) { segs.push({ t0: t, t1: t + dur, s0: s, s1: s, dir: dir }); t += dur; }
    function move(a, b) { var dur = Math.abs(b - a) / spd; segs.push({ t0: t, t1: t + dur, s0: a, s1: b, dir: b >= a ? 1 : -1 }); t += dur; }
    dwell(0, 1.5, 1);
    for (i = 1; i < pts.length; i++) { move(pts[i - 1], pts[i]); dwell(pts[i], i === pts.length - 1 ? 1.5 : 3, 1); }
    for (i = pts.length - 2; i >= 0; i--) { move(pts[i + 1], pts[i]); dwell(pts[i], i === 0 ? 1.5 : 3, -1); }
    return { segs: segs, cyc: t };
  }
  function timelineAt(tl, T, frac) {
    var u = (((T + frac * tl.cyc) % tl.cyc) + tl.cyc) % tl.cyc, a = tl.segs, i = 0;
    while (i < a.length - 1 && a[i].t1 <= u) i++;
    var sg = a[i], p = sg.t1 > sg.t0 ? (u - sg.t0) / (sg.t1 - sg.t0) : 0;
    return { s: sg.s0 + (sg.s1 - sg.s0) * clamp(p, 0, 1), dir: sg.dir };
  }
  /* posisi angkot hanya bergantung pada waktu server, jadi sama persis di semua pemain */
  function stepVehicles(dt) {
    var T = ST() / 1000;
    VEH.forEach(function (v) {
      if (v.dead) { v.circle.x = 9999; v.circle.z = 9999; return; }
      var r = timelineAt(v.tl, T, v.ph), ty = vehPlace(v.g, v.rt, r.s, r.dir, LANE);
      if (!v.init) { v.yaw = ty; v.init = true; }
      else { var df = Math.atan2(Math.sin(ty - v.yaw), Math.cos(ty - v.yaw)); v.yaw += df * Math.min(1, dt * 6); }
      v.g.rotation.y = v.yaw; v.circle.x = v.g.position.x; v.circle.z = v.g.position.z;
    });
  }

  function buildWorld() {
    if (!window.THREE) throw new Error('THREE tidak tersedia');
    renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: QL.aa, alpha: false, stencil: false, powerPreference: 'high-performance', precision: QL.n === 'low' ? 'mediump' : 'highp' });
    resInit();
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xcfeaf7, QL.fogN, QL.fogF);
    camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, .1, 1500); camera.rotation.order = 'YXZ';
    clock = new THREE.Clock(); W.pin = [];
    scene.add(new THREE.HemisphereLight(0xe3f4ff, 0x6fa35a, .95));
    var sun = new THREE.DirectionalLight(0xfff2d2, .8); sun.position.set(60, 100, 40); scene.add(sun);
    var sc = document.createElement('canvas'); sc.width = 8; sc.height = 256; var sg = sc.getContext('2d'), gr = sg.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#4fb0ec'); gr.addColorStop(.5, '#b9e3f7'); gr.addColorStop(.62, '#dff3fb'); gr.addColorStop(1, '#dff3fb'); sg.fillStyle = gr; sg.fillRect(0, 0, 8, 256);
    sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 16, 10), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), side: THREE.BackSide, fog: false, depthWrite: false })); scene.add(sky);
    var hr = mulberry(11), h, q;
    var cm = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, transparent: true, opacity: .93 });
    for (var cI = 0; cI < QL.clouds; cI++) {
      var cg = new THREE.Group(), n = 3 + (cI % 3);
      for (q = 0; q < n; q++) { var sp = new THREE.Mesh(new THREE.SphereGeometry(6 + hr() * 4, 8, 6), cm); sp.position.set(q * 7 - n * 3.5, hr() * 2, hr() * 3); sp.scale.y = .6; cg.add(sp); }
      cg.position.set((hr() * 2 - 1) * 420, 90 + hr() * 30, (hr() * 2 - 1) * 300); cg.userData.sp = .8 + hr() * 1.2; scene.add(cg); clouds.push(cg);
    }
    var K = Math.min(QL.K, renderer.capabilities.maxTextureSize / WX * .98);
    var gc = drawGround(K); W.groundCanvas = gc; W.K = K;
    var gt = new THREE.CanvasTexture(gc); gt.anisotropy = QL.aniso;
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(WX, WZ), new THREE.MeshLambertMaterial({ map: gt })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
    var outer = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), lam(0x74b95e)); outer.rotation.x = -Math.PI / 2; outer.position.y = -.05; scene.add(outer);
    for (h = 0; h < QL.hills; h++) {
      var ang = h / QL.hills * 6.283, dist = 560 + hr() * 60, rad = 60 + hr() * 50, hill = new THREE.Mesh(new THREE.SphereGeometry(rad, 10, 5), lam(h % 2 ? 0x7dbb8a : 0x6aa87a));
      hill.scale.y = .45; hill.position.set(Math.cos(ang) * dist * 1.3, -4, Math.sin(ang) * dist); scene.add(hill);
    }

    var dm = new THREE.Object3D(), col = new THREE.Color();
    buildHouses(); roadTiles();

    POI.forEach(addPOI); AREAS.forEach(addArea); STOPS.forEach(addHalte);
    /* jendela gedung (instancing) */
    var wf = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 1.9, .1), lam(0xffffff), WINS.length), wgl = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1.6, .14), new THREE.MeshBasicMaterial({ color: 0xbfe7ff }), WINS.length);
    WINS.forEach(function (w, i) { dm.position.set(w.x, w.y, w.z); dm.rotation.set(0, w.ry, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); wf.setMatrixAt(i, dm.matrix); wgl.setMatrixAt(i, dm.matrix); });
    wf.frustumCulled = false; wgl.frustumCulled = false; scene.add(wf, wgl);
    /* papan nama tempat (terlihat dari jauh) */
    W.pin.forEach(function (b) {
      var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex(b.zn, 640, 110, '#ffffff', '#10233f'), fog: false })); s.scale.set(15, 2.6, 1); s.position.set(b.x, b.h + 8, b.z); s.userData.p = b; scene.add(s); b.sprite = s;
    });
    AREAS.forEach(function (a) { var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex(a.zn, 640, 110, '#e1f5ec', '#10233f'), fog: false })); s.scale.set(15, 2.6, 1); s.position.set(a.x, 9, a.z); scene.add(s); a.sprite = s; });
    KOMPLEK.forEach(function (k) { var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex(k.zn, 640, 110, '#fff6d6', '#10233f'), fog: false })); s.scale.set(15, 2.6, 1); s.position.set(k.cx, 11, k.cz); scene.add(s); k.sprite = s; });
    STOPS.forEach(function (s) { var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTex('BUS ' + MP.LINES[s.line].n.replace('Angkot ', ''), 256, 100, hex(MP.LINES[s.line].cc), '#ffffff'), fog: false })); sp.scale.set(5, 2, 1); sp.position.set(s.sx, 6.4, s.sz); scene.add(sp); s.sprite = sp; });

    /* jembatan */
    BRIDGES.forEach(function (b) {
      var len = RIVER_W + 4, ry = -Math.atan2(b.dz, b.dx);
      [-1, 1].forEach(function (sd) {
        var cx = b.x + b.dz * sd * (b.w / 2 + .2), cz = b.z - b.dx * sd * (b.w / 2 + .2);
        var rail = new THREE.Mesh(new THREE.BoxGeometry(len, .18, .18), lam(0xe9e4d8)); rail.position.set(cx, 1.0, cz); rail.rotation.y = ry; scene.add(rail);
        var rail2 = rail.clone(); rail2.position.y = .45; scene.add(rail2);
      });
    });
    /* sungai: pagar penahan di tepi jalan jembatan sudah dari tabrakan lingkaran */
    var rs = [];
    for (var i = 0; i < RIVER.length - 1; i++) {
      var a = RIVER[i], b2 = RIVER[i + 1], L = Math.hypot(b2[0] - a[0], b2[1] - a[1]), steps = Math.ceil(L / 4);
      for (var k = 0; k < steps; k++) { var x = a[0] + (b2[0] - a[0]) * k / steps, z = a[1] + (b2[1] - a[1]) * k / steps; if (BRIDGES.some(function (br) { return Math.hypot(br.x - x, br.z - z) < 10.5; })) continue; addCircC(x, z, 5.6); }
    }

    /* pohon */
    var tr = mulberry(42), tpos = [];
    function treeOk(x, z, m) {
      if (Math.abs(x) > HALF.x - 3 || Math.abs(z) > HALF.z - 3) return false;
      if (roadAt(x, z).d < 1.8) return false;
      if (riverDist(x, z) < RIVER_W / 2 + 2) return false;
      var i; for (i = 0; i < KOMPLEK.length; i++) { var kq = KOMPLEK[i]; if (x > kq.x0 - 2 && x < kq.x1 + 2 && z > kq.z0 - 2 && z < kq.z1 + 2) return false; }
      for (i = 0; i < POI.length; i++) { var p = POI[i]; if (Math.abs(x - p.x) < p.w / 2 + p.m * .8 && Math.abs(z - p.z) < p.d / 2 + p.m * .8) return false; }
      for (i = 0; i < AREAS.length; i++) { var ar = AREAS[i]; if (Math.abs(x - ar.x) < ar.w / 2 + 3 && Math.abs(z - ar.z) < ar.d / 2 + 3) return false; }
      for (i = 0; i < N; i++) if (Math.hypot(x - NPC[i].ox, z - NPC[i].oz) < 4) return false;
      for (i = 0; i < STOPS.length; i++) if (Math.hypot(x - STOPS[i].sx, z - STOPS[i].sz) < 6 || Math.hypot(x - STOPS[i].ex, z - STOPS[i].ez) < 4) return false;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 8) return false;
      if (!spotFreeTree(x, z, m)) return false;
      for (i = 0; i < tpos.length; i++) if (Math.hypot(x - tpos[i][0], z - tpos[i][1]) < 4.5) return false;
      return true;
    }
    function spotFreeTree(x, z, m) {
      var arr = CG[ck(Math.floor(x / CS), Math.floor(z / CS))]; if (!arr) return true;
      for (var k = 0; k < arr.length; k++) { var it = arr[k]; if (it.box) { if (x > it.x0 - m && x < it.x1 + m && z > it.z0 - m && z < it.z1 + m) return false; } else if (Math.hypot(x - it.x, z - it.z) < it.r + m) return false; }
      return true;
    }
    RD.forEach(function (rd) {
      if (rd.c !== 'main') return;
      for (var i = 0; i < rd.pts.length - 1; i++) {
        var a = rd.pts[i], b = rd.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        for (var t = 4; t < L; t += 14 + tr() * 6) for (var sd = -1; sd <= 1; sd += 2) {
          var x = a[0] + ux * t + uz * sd * (rd.w / 2 + 2.6), z = a[1] + uz * t - ux * sd * (rd.w / 2 + 2.6);
          if (tr() < .6 && treeOk(x, z, 1.5)) tpos.push([x, z, .9 + tr() * .5]);
        }
      }
    });
    var tries = 0;
    while (tpos.length < QL.trees && tries++ < 9000) { var tx = (tr() * 2 - 1) * (HALF.x - 3), tz = (tr() * 2 - 1) * (HALF.z - 3); if (treeOk(tx, tz, 1.4)) tpos.push([tx, tz, .8 + tr() * .7]); }
    tpos.forEach(function (t, i) { addCircC(t[0], t[1], .5 * t[2]); kTree(t, i); });
    renderProps();

    /* papan nama jalan */
    var signTex = {}, poleI = [];
    RD.forEach(function (rd) {
      var tot = 0, i, segL = []; for (i = 0; i < rd.pts.length - 1; i++) { segL.push(Math.hypot(rd.pts[i + 1][0] - rd.pts[i][0], rd.pts[i + 1][1] - rd.pts[i][1])); tot += segL[i]; }
      [.3, .72].forEach(function (f, fi) {
        var s = tot * f, k = 0; while (k < segL.length - 1 && s > segL[k]) { s -= segL[k]; k++; }
        var a = rd.pts[k], b = rd.pts[k + 1], ux = (b[0] - a[0]) / segL[k], uz = (b[1] - a[1]) / segL[k], sd = fi ? 1 : -1, off = rd.w / 2 + 1.3;
        var x = a[0] + ux * s + uz * sd * off, z = a[1] + uz * s - ux * sd * off;
        if (Math.abs(x) > HALF.x - 4 || Math.abs(z) > HALF.z - 4 || riverDist(x, z) < 9 || !spotFreeTree(x, z, .8)) return;
        var tx = signTex[rd.n] || (signTex[rd.n] = textTex(rd.n, 512, 100, '#0b7a4b', '#ffffff')), ry = Math.atan2(ux, uz);
        [0, Math.PI].forEach(function (d) { var pl = new THREE.Mesh(new THREE.PlaneGeometry(3.6, .72), new THREE.MeshBasicMaterial({ map: tx })); pl.position.set(x, 3.3, z); pl.rotation.y = ry + d; pl.translateZ(.04); scene.add(pl); });
        poleI.push([x, z]);
      });
    });
    var poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(.06, .06, 3.4, 6), lam(0x444c58), poleI.length);
    poleI.forEach(function (p, i) { dm.position.set(p[0], 1.7, p[1]); dm.rotation.set(0, 0, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); poles.setMatrixAt(i, dm.matrix); }); poles.frustumCulled = false; scene.add(poles);

    /* pagar tepi kota */
    var fc = document.createElement('canvas'); fc.width = 64; fc.height = 64; var fg = fc.getContext('2d'); fg.fillStyle = '#ffffff'; fg.fillRect(6, 0, 20, 64); fg.fillRect(38, 0, 20, 64); fg.fillStyle = '#c9d4e2'; fg.fillRect(0, 18, 64, 5); fg.fillRect(0, 44, 64, 5);
    function fence(x, z, len, ry) {
      var t = new THREE.CanvasTexture(fc); t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 2.4, 1);
      var m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.6), new THREE.MeshLambertMaterial({ map: t, alphaTest: .5, side: THREE.DoubleSide })); m.position.set(x, .8, z); m.rotation.y = ry; scene.add(m);
    }
    fence(0, -HALF.z, WX, 0); fence(0, HALF.z, WX, 0); fence(-HALF.x, 0, WZ, Math.PI / 2); fence(HALF.x, 0, WZ, Math.PI / 2);

    addVehicles();
    W.rideVeh = {}; Object.keys(MP.LINES).forEach(function (k) { var g = mkVehicle(MP.LINES[k].cc, MP.LINES[k].n.replace('Angkot ', '')); g.visible = false; scene.add(g); W.rideVeh[k] = g; });

    /* tokoh (NPC) */
    var qTex = markTex('q'), cTex = markTex('c'), rTex = markTex('r'), shG = new THREE.CircleGeometry(.6, 14).rotateX(-Math.PI / 2), shM = new THREE.MeshBasicMaterial({ color: 0x1e3a20, transparent: true, opacity: .3, depthWrite: false });
    NPC.forEach(function (d, i) {
      var g = new THREE.Group(), body = new THREE.Group(), skin = lam(d.skin), shirt = lam(d.c), pants = lam(d.p || 0x24344f), hair = lam(d.hair);
      var legL = new THREE.Mesh(new THREE.BoxGeometry(.24, .72, .26), pants), legR = legL.clone(); legL.position.set(-.14, .36, 0); legR.position.set(.14, .36, 0);
      var torso = new THREE.Mesh(new THREE.CylinderGeometry(.34, .38, .85, 12), shirt); torso.position.y = 1.12;
      var armG = new THREE.BoxGeometry(.17, .72, .19).translate(0, -.36, 0), armL = new THREE.Mesh(armG, shirt), armR = new THREE.Mesh(armG, shirt); armL.position.set(-.47, 1.46, 0); armR.position.set(.47, 1.46, 0);
      var head = new THREE.Mesh(new THREE.SphereGeometry(.27, 14, 12), skin); head.position.y = 1.76;
      var eg = new THREE.SphereGeometry(.034, 6, 6), ebm = new THREE.MeshBasicMaterial({ color: 0x10233f }), e1 = new THREE.Mesh(eg, ebm), e2 = new THREE.Mesh(eg, ebm); e1.position.set(-.09, 1.8, .245); e2.position.set(.09, 1.8, .245);
      body.add(legL, legR, torso, armL, armR, head, e1, e2);
      var cap = new THREE.Mesh(new THREE.SphereGeometry(.295, 14, 8, 0, 6.283, 0, 1.75), hair); cap.position.y = 1.77;
      if (d.look === 'hijab') {
        var vm = lam(d.v || 0xffffff), veil = new THREE.Mesh(new THREE.SphereGeometry(.34, 14, 12), vm); veil.position.set(0, 1.76, -.1); veil.scale.y = 1.06; body.add(veil);
        var vt = new THREE.Mesh(new THREE.SphereGeometry(.31, 12, 8, 0, 6.283, 0, 1.2), vm); vt.position.set(0, 1.8, -.03); body.add(vt);
      } else {
        body.add(cap);
        if (d.look === 'long') { var lh = new THREE.Mesh(new THREE.BoxGeometry(.52, .75, .14), hair); lh.position.set(0, 1.5, -.2); body.add(lh); }
        if (d.look === 'cap') { var ch = new THREE.Mesh(new THREE.CylinderGeometry(.3, .31, .13, 14), lam(0x2f6b3a)); ch.position.y = 2.0; var vis = new THREE.Mesh(new THREE.BoxGeometry(.4, .04, .22), lam(0x2f6b3a)); vis.position.set(0, 1.97, .3); body.add(ch, vis); }
      }
      g.add(body); g.userData.keep = true; g.position.set(d.x, 0, d.z); g.rotation.y = Math.atan2(SPAWN.x - d.x, SPAWN.z - d.z); scene.add(g);
      var sh = new THREE.Mesh(shG, shM); sh.position.set(d.x, .045, d.z); scene.add(sh);
      var mk = new THREE.Sprite(new THREE.SpriteMaterial({ map: res[i] ? cTex : qTex, fog: false, depthTest: true })); mk.scale.set(.95, .95, 1); mk.position.set(d.x, 2.7, d.z); scene.add(mk);
      var circ = { x: d.x, z: d.z, r: .6 };
      W.npc.push({ g: g, body: body, armL: armL, armR: armR, mk: mk, sh: sh, circle: circ, flee: null, home: { x: d.x, z: d.z }, wander: null, walking: false, ph: i * 1.7, qTex: qTex, cTex: cTex, rTex: rTex });
      W.dyn.push(circ);
    });
    /* titik tujuan kabur */
    W.spots = [];
    POI.forEach(function (b) { var he = b.f[0] !== 0 ? b.w / 2 : b.d / 2; W.spots.push([b.x + b.f[0] * (he + 5), b.z + b.f[1] * (he + 5)]); });
    AREAS.forEach(function (a) { W.spots.push([a.x, a.z + a.d / 2 + 6]); });
    STOPS.forEach(function (s) { W.spots.push([s.ex, s.ez]); });
    NPC.forEach(function (d) { W.spots.push([d.ox, d.oz]); });
    tgBuild();
    window.addEventListener('resize', onResize);
  }
  function onResize() {
    if (!renderer) return;
    renderer.setSize(window.innerWidth, window.innerHeight, false); camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  }
  function ensureWorld() {
    if (W.ready || W.fail) return;
    try { buildWorld(); W.ready = true; } catch (err) { if (window.console) console.error(err); W.fail = true; }
  }
  function syncWorld() {
    if (!W.ready) return;
    W.npc.forEach(function (o, i) {
      var d = NPC[i]; o.home = { x: d.x, z: d.z }; o.wander = null; o.walking = false; o.flee = null; o.armL.rotation.x = 0; o.armR.rotation.x = 0; o.g.scale.set(1, 1, 1);
      o.circle.x = d.x; o.circle.z = d.z; o.g.position.set(d.x, 0, d.z); o.sh.position.set(d.x, .045, d.z); o.mk.position.x = d.x; o.mk.position.z = d.z;
      o.mkS = null;
    });
  }

  /* ---------- bermain ---------- */
  function startPlay() {
    if (Assets.loading() && !W.ready) {
      var bs = $('btnSiap');
      if (bs) { bs.dataset.t = bs.dataset.t || bs.textContent; bs.disabled = true; bs.textContent = 'Memuat model 3D...'; }
      Assets.whenReady(function () { if (bs) { bs.disabled = false; bs.textContent = bs.dataset.t; } startPlay(); });
      return;
    }
    ensureWorld();
    if (W.fail) { show('baca'); $('glErr').hidden = false; setState('read'); return; }
    show(''); $('hud').hidden = false; $('gl').classList.add('on'); $('btnSkip').hidden = true;
    setState('play'); hudUpdate();
    if (!started) { started = true; yaw = startYaw; pitch = 0; pos.set(startX, 1.6, startZ); loop(); }
    onResize();
    if (!isTouch) lockPointer();
    wsStart();
    if (location.hash === '#dansa' && !window.__dz) { window.__dz = 1; setTimeout(function () { startMini(function () { backToPlay(); }); }, 1200); }
  }
  function resetGame() {
    resetData(); syncWorld(); ride = null; $('rideBox').hidden = true;
    $('toast').hidden = true;
    pos.set(startX, 1.6, startZ); yaw = startYaw; pitch = 0; hudUpdate();
  }
  function hudUpdate() {
    $('hN').textContent = done; $('hTot').textContent = N; $('hBar').style.width = (done / N * 100) + '%'; $('hPts').textContent = Math.round(score); $('hStars').textContent = stars; if ($('hCoins')) $('hCoins').textContent = coins;
    $('hNext').textContent = done >= N ? 'Semua soal selesai!' : 'Ayo Dansa: ' + (5 - done % 5) + ' soal lagi';
  }
  function nearest(maxD) {
    var best = -1, bd = maxD;
    for (var i = 0; i < N; i++) { if (W.npc[i].fleeing) continue; var d = Math.hypot(pos.x - NPC[i].x, pos.z - NPC[i].z); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function nearestStop(maxD) {
    var best = -1, bd = maxD;
    STOPS.forEach(function (s, i) { var d = Math.hypot(pos.x - s.sx, pos.z - s.sz); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  var toastT = null;
  function showToast(msg) { var el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, 4500); }
  var zoneList = [];
  POI.forEach(function (b) { zoneList.push({ n: b.zn, x: b.x, z: b.z, hw: b.w / 2 + 11, hd: b.d / 2 + 11 }); });
  AREAS.forEach(function (a) { zoneList.push({ n: a.zn, x: a.x, z: a.z, hw: a.w / 2 + 6, hd: a.d / 2 + 6 }); });
  KOMPLEK.forEach(function (k) { zoneList.push({ n: k.zn, x: k.cx, z: k.cz, hw: (k.x1 - k.x0) / 2, hd: (k.z1 - k.z0) / 2 }); });
  function zoneAt(x, z) {
    for (var i = 0; i < zoneList.length; i++) { var q = zoneList[i]; if (Math.abs(x - q.x) < q.hw && Math.abs(z - q.z) < q.hd) return q.n; }
    var ra = roadAt(x, z); if (ra.d < 5 && ra.r) return ra.r.n;
    return 'Kampung Kranggan';
  }

  /* =====================================================================
     SKILL API (Pyro Titan): SEMUA BENDA BISA TERBAKAR & HANCUR, kecuali NPC dan pemain.
     - Daftar sasaran (TG) dibuat dari data peta yang sama di semua komputer, jadi nomor sasarannya sama untuk semua pemain.
     - Yang menembak menuliskan nomor sasaran ke Firebase (kranggan/<ruang>/boom/<nomor>); semua pemain ikut melihatnya terbakar.
     - Efek api memakai model 'api' (api.glb) atau gambar 'api_sprite' (api.png) kalau ada; kalau tidak, api bawaan.
     ===================================================================== */
  var REBUILD_MS = 240000;       /* benda yang hancur dibangun lagi setelah 4 menit supaya kota tidak habis (isi 0 = hancur selamanya) */
  var BURN_DELAY = 1.1, BURN_TIME = 8;   /* detik: api membesar sebelum benda runtuh; lama api menyala */
  var TG = { list: [], grid: {}, cs: 12, veh: [], burns: [], ready: false };
  var PROPD = {                  /* [radius sasaran, tinggi, nama] */
    pohon_besar: [1.6, 9, 'Pohon'], pohon_sedang: [1.3, 6.5, 'Pohon'], pohon_palem: [.9, 8, 'Pohon palem'], pohon_hias: [1, 4, 'Pohon'],
    semak: [.9, 1.2, 'Semak'], bunga: [.9, .8, 'Bunga'], lampu_jalan: [.6, 5.2, 'Lampu jalan'], lampu_taman: [.5, 3, 'Lampu taman'],
    bangku: [1.3, 1.2, 'Bangku'], tempat_sampah: [.55, 1.1, 'Tempat sampah'], gazebo: [3, 4.4, 'Gazebo'], air_mancur: [2.6, 3, 'Air mancur'],
    mainan_anak: [3.5, 3.2, 'Mainan anak'], mobil: [2.1, 1.7, 'Mobil'], pos_satpam: [1.5, 2.8, 'Pos satpam'], gerbang_komplek: [1, 6, 'Gerbang komplek']
  };
  function tgAdd(t) {
    t.id = TG.list.length; t.gone = false; t.burning = false; TG.list.push(t);
    if (t.veh) return t;
    var b = t.circ ? [t.cx - t.r, t.cx + t.r, t.cz - t.r, t.cz + t.r] : [t.x0, t.x1, t.z0, t.z1], cs = TG.cs, ix, iz, k;
    for (ix = Math.floor(b[0] / cs); ix <= Math.floor(b[1] / cs); ix++) for (iz = Math.floor(b[2] / cs); iz <= Math.floor(b[3] / cs); iz++) { k = ix + ',' + iz; (TG.grid[k] || (TG.grid[k] = [])).push(t); }
    return t;
  }
  function tgBuild() {
    TG.list = []; TG.grid = {}; TG.veh = []; TG.burns = []; TG.ready = false;
    POI.forEach(function (b) {
      tgAdd({ k: 'poi', n: b.zn, poi: b, big: true, x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, h: b.h + 4, scan: [b.x - b.w / 2 - 1, b.x + b.w / 2 + 1, b.z - b.d / 2 - 1, b.z + b.d / 2 + 1] });
    });
    HOUSES.forEach(function (h) {
      var x0 = h.cx - h.w / 2, x1 = h.cx + h.w / 2, z0 = h.cz - h.d / 2, z1 = h.cz + h.d / 2, e = [x0 - .8, x1 + .8, z0 - .8, z1 + .8];
      if (h.fx > 0) e[1] += 3.2; else if (h.fx < 0) e[0] -= 3.2;
      if (h.fz > 0) e[3] += 3.2; else if (h.fz < 0) e[2] -= 3.2;
      tgAdd({ k: 'house', n: 'Rumah', big: true, x0: x0, x1: x1, z0: z0, z1: z1, h: h.h + 3, scan: e });
    });
    RUKO.forEach(function (o) {
      tgAdd({ k: 'ruko', n: 'Ruko', big: true, x0: o.x - o.w / 2, x1: o.x + o.w / 2, z0: o.z - o.d / 2, z1: o.z + o.d / 2, h: o.h + 2, scan: [o.x - o.w / 2 - .8, o.x + o.w / 2 + .8, o.z - o.d / 2 - .8, o.z + o.d / 2 + .8] });
    });
    Object.keys(PROPD).forEach(function (id) {
      (KSL[id] || []).forEach(function (it) {
        var d = PROPD[id], r = id === 'gerbang_komplek' ? (it.span || 10) / 2 + 1 : d[0] * (it.s || 1);
        tgAdd({ k: 'prop', n: d[2], circ: true, cx: it.x, cz: it.z, r: r, h: d[1] });
      });
    });
    HEDGE.forEach(function (it) { tgAdd({ k: 'prop', n: 'Pagar tanaman', circ: true, cx: it.x, cz: it.z, r: Math.max(.8, it.len / 2), h: .9 }); });
    STOPS.forEach(function (s) { tgAdd({ k: 'halte', n: s.n, stop: s, circ: true, cx: s.sx, cz: s.sz, r: 2.6, h: 3 }); });
    VEH.forEach(function (v, i) { TG.veh.push(tgAdd({ k: 'veh', n: 'Angkot', veh: true, v: v, h: 3 })); });
    TG.ready = true;
  }
  /* sinar api: melaju lurus (menukik kalau penembak sedang terbang), berhenti di sasaran pertama atau di tanah */
  function tgTrace(ox, oy, oz, hx, hz) {
    var hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    var vs = -clamp((oy - 1.2) / 50, 0, 3), range = 70, step = .6, d, x, y, z, arr, i, t, vp;
    for (d = 0; d <= range; d += step) {
      x = ox + hx * d; z = oz + hz * d; y = oy + vs * d;
      if (y <= .05) return { t: null, x: x, y: 0, z: z, d: d };
      if (Math.abs(x) > HALF.x - 1 || Math.abs(z) > HALF.z - 1) return { t: null, x: x, y: Math.max(.3, y), z: z, d: d };
      arr = TG.grid[Math.floor(x / TG.cs) + ',' + Math.floor(z / TG.cs)];
      if (arr) for (i = 0; i < arr.length; i++) {
        t = arr[i]; if (t.gone || y > t.h + .3) continue;
        if (t.circ ? (Math.hypot(x - t.cx, z - t.cz) < t.r) : (x > t.x0 && x < t.x1 && z > t.z0 && z < t.z1)) return { t: t, x: x, y: y, z: z, d: d };
      }
      for (i = 0; i < TG.veh.length; i++) {
        t = TG.veh[i]; if (t.gone) continue; vp = t.v.g.position;
        if (y < 3.2 && Math.hypot(x - vp.x, z - vp.z) < 2.3) return { t: t, x: x, y: y, z: z, d: d };
      }
    }
    return { t: null, x: ox + hx * range, y: Math.max(.3, oy + vs * range), z: oz + hz * range, d: range };
  }
  var _bb = null, _bz = null;
  /* bagian bangunan yang digambar dengan instancing: kecilkan jadi nol (disimpan supaya bisa dikembalikan) */
  function tgScanInst(sc, th, rec) {
    var big = Math.max(sc[1] - sc[0], sc[3] - sc[2]) + 6, y1 = th + 8;
    scene.children.forEach(function (o) {
      if (!o.isInstancedMesh || o.userData.keep || !o.geometry) return;
      var g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
      var c = g.boundingSphere.center, a = o.instanceMatrix.array, n = o.count, i, e, X, Y, Z, hit = false;
      for (i = 0; i < n; i++) {
        e = i * 16;
        X = a[e] * c.x + a[e + 4] * c.y + a[e + 8] * c.z + a[e + 12];
        Z = a[e + 2] * c.x + a[e + 6] * c.y + a[e + 10] * c.z + a[e + 14];
        if (X < sc[0] || X > sc[1] || Z < sc[2] || Z > sc[3]) continue;
        Y = a[e + 1] * c.x + a[e + 5] * c.y + a[e + 9] * c.z + a[e + 13];
        if (Y < -.8 || Y > y1) continue;
        if (a[e] === 0 && a[e + 5] === 0 && a[e + 10] === 0) continue;
        if (o.userData.unit && (Math.hypot(a[e], a[e + 1], a[e + 2]) > big || Math.hypot(a[e + 8], a[e + 9], a[e + 10]) > big)) continue;
        rec.inst.push([o, i, Array.prototype.slice.call(a, e, e + 16)]);
        a[e] = a[e + 1] = a[e + 2] = a[e + 4] = a[e + 5] = a[e + 6] = a[e + 8] = a[e + 9] = a[e + 10] = 0; hit = true;
      }
      if (hit) o.instanceMatrix.needsUpdate = true;
    });
  }
  /* benda biasa (bukan instancing): sembunyikan. NPC & pemain ditandai userData.keep sehingga tidak pernah ikut. */
  function tgScanObj(sc, th, rec) {
    if (!_bb) { _bb = new THREE.Box3(); _bz = new THREE.Vector3(); }
    var big = Math.max(sc[1] - sc[0], sc[3] - sc[2]), small = Math.min(sc[1] - sc[0], sc[3] - sc[2]);
    scene.children.slice().forEach(function (o) {
      if (!o.position || !o.visible || o.userData.keep || o.isInstancedMesh || o.isSprite || o.isLight || o === sky || !(o.isMesh || o.isGroup)) return;
      var p = o.position; if (p.x < sc[0] || p.x > sc[1] || p.z < sc[2] || p.z > sc[3] || p.y < 0 || p.y >= th + 5) return;
      _bb.setFromObject(o); if (_bb.isEmpty()) return; _bb.getSize(_bz);
      if (_bz.y > th + 12) return;
      if (o.isMesh) { if (_bz.x > big + 8 || _bz.z > big + 8) return; }
      else { var a = Math.max(_bz.x, _bz.z), b = Math.min(_bz.x, _bz.z); if (a < big * .5 || b < small * .5 || a > big + 8) return; }
      o.visible = false; rec.obj.push(o);
    });
  }
  /* tabrakan: benda yang sudah hancur tidak lagi menghalangi jalan */
  function tgCols(sc, rec) {
    var ix, iz, arr, k, it, cx, cz;
    for (ix = Math.floor((sc[0] - .6) / CS); ix <= Math.floor((sc[1] + .6) / CS); ix++) for (iz = Math.floor((sc[2] - .6) / CS); iz <= Math.floor((sc[3] + .6) / CS); iz++) {
      arr = CG[ck(ix, iz)]; if (!arr) continue;
      for (k = 0; k < arr.length; k++) {
        it = arr[k]; if (it.dead) continue;
        cx = it.box ? (it.x0 + it.x1) / 2 : it.x; cz = it.box ? (it.z0 + it.z1) / 2 : it.z;
        if (cx >= sc[0] && cx <= sc[1] && cz >= sc[2] && cz <= sc[3]) { it.dead = true; rec.cols.push(it); }
      }
    }
  }
  function tgDims(t) {
    if (t.veh) { var vp = t.v.g.position; return [vp.x, vp.z, 2.4, 4.6, 2.4]; }
    var b = t.circ ? [t.cx - t.r, t.cx + t.r, t.cz - t.r, t.cz + t.r] : [t.x0, t.x1, t.z0, t.z1];
    return [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, b[1] - b[0], b[3] - b[2], Math.min(t.h, 10)];
  }
  function tgKill(t, dm) {
    if (t.gone) return; t.gone = true; dm = dm || tgDims(t);
    var rec = t.rec = { inst: [], obj: [], cols: [], deco: null };
    if (t.veh) { t.v.dead = true; t.v.g.visible = false; }
    else {
      var sc = t.scan || [dm[0] - dm[2] / 2 - .6, dm[0] + dm[2] / 2 + .6, dm[1] - dm[3] / 2 - .6, dm[1] + dm[3] / 2 + .6];
      tgScanInst(sc, t.h, rec); tgScanObj(sc, t.h, rec); tgCols(sc, rec);
      if (t.poi) { t.poi.dead = true; if (t.poi.sprite) t.poi.sprite.visible = false; }
      if (t.stop) { t.stop.dead = true; if (t.stop.sprite) t.stop.sprite.visible = false; }
    }
    var f = t.big ? 1.05 : .8, m = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(1.6, dm[2] * f), Math.max(1.6, dm[3] * f)).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x25211e, transparent: true, opacity: .82, depthWrite: false }));
    m.position.set(dm[0], .07, dm[1]); m.userData.keep = true; scene.add(m); rec.deco = m;
  }
  function tgRevive(t) {
    var rec = t.rec; t.burning = false;
    if (!rec) return;
    rec.inst.forEach(function (e) { var a = e[0].instanceMatrix.array, j; for (j = 0; j < 16; j++) a[e[1] * 16 + j] = e[2][j]; e[0].instanceMatrix.needsUpdate = true; });
    rec.obj.forEach(function (o) { o.visible = true; });
    rec.cols.forEach(function (c) { c.dead = false; });
    if (rec.deco) { scene.remove(rec.deco); rec.deco.geometry.dispose(); rec.deco.material.dispose(); }
    if (t.poi) t.poi.dead = false;
    if (t.stop) t.stop.dead = false;
    if (t.veh) { t.v.dead = false; t.v.g.visible = true; }
    t.rec = null; t.gone = false;
  }
  /* mulai terbakar: api membesar, sebentar kemudian benda runtuh. ts = waktu server saat kena (null = baru saja). */
  function tgIgnite(t, ts) {
    if (!t || t.burning || t.gone || !W.ready) return false;
    var age = ts ? Math.max(0, ST() - ts) : 0;
    if (REBUILD_MS && age >= REBUILD_MS) return false;
    t.burning = true;
    var dm = tgDims(t);
    if (age < 5000) {
      fxBurn(dm[0], dm[1], dm[2], dm[3], dm[4], BURN_TIME);
      if (Math.hypot(dm[0] - pos.x, dm[1] - pos.z) < 90) { beep(170, .25, 'sawtooth'); beep(95, .35, 'square', .06); }
      var wait = t.veh ? .05 : BURN_DELAY;
      ANIM.push(function (dt) { wait -= dt; if (wait > 0) return true; tgKill(t, dm); return false; });
    } else tgKill(t, dm);        /* baru masuk ruang yang sudah terbakar: langsung hancur tanpa animasi */
    if (REBUILD_MS) setTimeout(function () { tgRevive(t); }, Math.max(1000, REBUILD_MS - age));
    return true;
  }
  /* pemain yang menembak: bakar sasaran lalu kabarkan ke semua pemain lewat Firebase */
  function boomShoot(t) {
    if (!tgIgnite(t, null)) return;
    if (FB.on && FB.base) { try { FB.base.child('boom/' + t.id).set(firebase.database.ServerValue.TIMESTAMP).catch(function () { }); } catch (e) { } }
  }
  /* kabar dari Firebase (juga untuk pemain yang baru masuk ke ruang yang sudah ada benda terbakar) */
  function tgRemote(key, ts) {
    var t = TG.list[+key]; if (!t || !TG.ready || typeof ts !== 'number') return;
    if (REBUILD_MS && ST() - ts >= REBUILD_MS) { try { FB.base.child('boom/' + key).remove(); } catch (e) { } return; }
    tgIgnite(t, ts);
  }
  /* ledakan kecil: benda-benda kecil di sekitar titik jatuh ikut terbakar */
  function tgBlast(x, z, skip) {
    var n = 0, cs = TG.cs, ix, iz, arr, i, t, seen = {}, cx, cz;
    for (ix = Math.floor((x - 4) / cs); ix <= Math.floor((x + 4) / cs); ix++) for (iz = Math.floor((z - 4) / cs); iz <= Math.floor((z + 4) / cs); iz++) {
      arr = TG.grid[ix + ',' + iz]; if (!arr) continue;
      for (i = 0; i < arr.length; i++) {
        t = arr[i]; if (t.gone || t.burning || t.big || t === skip || seen[t.id]) continue; seen[t.id] = 1;
        cx = t.circ ? t.cx : (t.x0 + t.x1) / 2; cz = t.circ ? t.cz : (t.z0 + t.z1) / 2;
        if (Math.hypot(cx - x, cz - z) > 2.8 + (t.r || 0)) continue;
        boomShoot(t); if (++n >= 8) return n;
      }
    }
    return n;
  }
  /* ---- efek api ---- */
  var FXT = {}, FXM = {};
  function fxFlameTex() {
    if (FXT.flame) return FXT.flame;
    var im = Assets.tex('api_sprite');
    if (im) { var t0 = new THREE.Texture(im); t0.needsUpdate = true; FXT.flame = t0; FXT.asp = (im.height / im.width) || 1.6; return t0; }
    var c = document.createElement('canvas'); c.width = 64; c.height = 128; var g = c.getContext('2d');
    g.translate(32, 80); g.scale(1, 1.7);
    var gr = g.createRadialGradient(0, 2, 2, 0, -5, 28);
    gr.addColorStop(0, 'rgba(255,252,215,1)'); gr.addColorStop(.28, 'rgba(255,208,70,.96)'); gr.addColorStop(.6, 'rgba(255,112,26,.72)'); gr.addColorStop(1, 'rgba(205,40,0,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 28, 0, 6.2832); g.fill();
    FXT.flame = new THREE.CanvasTexture(c); FXT.asp = 1.7; return FXT.flame;
  }
  function fxSmokeTex() {
    if (FXT.smoke) return FXT.smoke;
    var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gr.addColorStop(0, 'rgba(70,64,60,.85)'); gr.addColorStop(1, 'rgba(40,38,36,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    FXT.smoke = new THREE.CanvasTexture(c); return FXT.smoke;
  }
  function flameMat() {
    return FXM.flame || (FXM.flame = new THREE.SpriteMaterial({ map: fxFlameTex(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  }
  function fxBurn(x, z, w, d, h, dur) {
    if (!W.ready) return;
    var glb = Assets.has('api'), B = { t: 0, dur: dur || BURN_TIME, f: [], sm: [], h: Math.max(.5, h), ended: false };
    var nF = clamp(Math.round(w * d / 9) + 5, 5, 20), nS = Math.min(7, Math.ceil(nF / 2.5)), sz = clamp(Math.sqrt(w * d) / 2.6, 1.3, 4.2), i, f, o;
    for (i = 0; i < nF; i++) {
      f = { bx: x + (Math.random() - .5) * w * .85, bz: z + (Math.random() - .5) * d * .85, by: Math.random() * Math.max(.2, h * .7), ph: Math.random() * 6.28, sp: .8 + Math.random() * .9, sz: sz * (.65 + Math.random() * .7), glb: glb };
      o = glb ? Assets.make('api', [f.sz, f.sz * 1.5, f.sz]) : new THREE.Sprite(flameMat());
      o.scale.setScalar(.01); o.position.set(f.bx, f.by, f.bz); scene.add(o); f.o = o; B.f.push(f);
    }
    for (i = 0; i < nS; i++) {
      var m = new THREE.SpriteMaterial({ map: fxSmokeTex(), transparent: true, depthWrite: false, opacity: 0 }), sp = new THREE.Sprite(m);
      sp.visible = false; scene.add(sp);
      B.sm.push({ o: sp, m: m, bx: x + (Math.random() - .5) * w * .6, bz: z + (Math.random() - .5) * d * .6, life: Math.random() });
    }
    TG.burns.push(B); if (TG.burns.length > 9) fxEnd(TG.burns.shift());
    ANIM.push(function (dt) { return fxStep(B, dt); });
  }
  function fxStep(B, dt) {
    if (B.ended) return false;
    B.t += dt;
    var t = B.t, k = Math.min(1, t / .9) * (t > B.dur - 2 ? Math.max(0, (B.dur - t) / 2) : 1), i, f, o, s, sc, asp = FXT.asp || 1.7, fl;
    for (i = 0; i < B.f.length; i++) {
      f = B.f[i]; o = f.o; fl = k * (.85 + .25 * Math.sin(t * 9 * f.sp + f.ph));
      if (f.glb) { o.scale.setScalar(Math.max(.01, fl)); o.position.set(f.bx + Math.sin(t * 3 + f.ph) * .12, f.by, f.bz); o.rotation.y = f.ph + t * .8; }
      else { sc = Math.max(.01, f.sz * fl * .9); o.scale.set(sc, sc * asp, 1); o.position.set(f.bx + Math.sin(t * 3 + f.ph) * .12, f.by + sc * asp * .5, f.bz); }
    }
    for (i = 0; i < B.sm.length; i++) {
      s = B.sm[i]; s.life += dt * .22; if (s.life > 1) s.life -= 1;
      s.o.visible = k > .15; s.m.opacity = .45 * k * Math.sin(Math.PI * s.life);
      sc = 1.8 + s.life * 5; s.o.scale.set(sc, sc, 1); s.o.position.set(s.bx + s.life * 1.5, B.h + s.life * 9, s.bz);
    }
    if (t >= B.dur) { fxEnd(B); return false; }
    return true;
  }
  function fxEnd(B) {
    if (B.ended) return; B.ended = true;
    B.f.forEach(function (f) { scene.remove(f.o); });
    B.sm.forEach(function (s) { scene.remove(s.o); s.m.dispose(); });
    var i = TG.burns.indexOf(B); if (i >= 0) TG.burns.splice(i, 1);
  }
  /* bola api yang melesat dari penembak sampai titik jatuh (dipakai juga untuk pemain lain) */
  function syncFireball(x, y, z, dx, dz, tr) {
    if (!W.ready) return;
    var hl = Math.hypot(dx, dz); if (hl < .001) return; dx /= hl; dz /= hl;
    var sx = x + dx * 1.3, sy = y, sz = z + dz * 1.3, ex = tr ? tr.x : x + dx * 45, ey = tr ? Math.max(.3, tr.y) : y, ez = tr ? tr.z : z + dz * 45;
    var tot = Math.max(.08, Math.hypot(ex - sx, ey - sy, ez - sz) / 60), life = 0, trailT = 0, trails = [], tm = flameMat(), ball = new THREE.Sprite(tm);
    ball.scale.set(1.5, 2.4, 1); ball.position.set(sx, sy, sz); scene.add(ball);
    ANIM.push(function (dt) {
      life += dt; var k = Math.min(1, life / tot), i, q, fl;
      if (k < 1) {
        ball.position.set(sx + (ex - sx) * k, sy + (ey - sy) * k, sz + (ez - sz) * k);
        fl = 1 + Math.sin(life * 40) * .12; ball.scale.set(1.5 * fl, 2.4 * fl, 1);
        trailT += dt;
        if (trailT > .03) { trailT = 0; q = new THREE.Sprite(tm); q.position.copy(ball.position); q.userData.s = 1; q.scale.set(1.1, 1.7, 1); scene.add(q); trails.push(q); }
      } else if (ball.parent) scene.remove(ball);
      for (i = trails.length - 1; i >= 0; i--) {
        q = trails[i]; q.userData.s -= dt * 3.2;
        if (q.userData.s <= 0) { scene.remove(q); trails.splice(i, 1); } else q.scale.set(1.1 * q.userData.s, 1.7 * q.userData.s, 1);
      }
      return !(k >= 1 && !trails.length);
    });
    return tot;
  }
  function shootFire() {
    if (!W.ready || fireCooldown > 0) return; fireCooldown = .5;
    var oy = 1.2 + playerY, hx = -Math.sin(yaw), hz = -Math.cos(yaw), tr = tgTrace(pos.x, oy, pos.z, hx, hz);
    mpFire = { id: Math.round(ST()), x: pos.x, y: oy, z: pos.z, dx: hx, dz: hz, hit: -1 };
    if (FB.on) fbSend(true);
    var wait = syncFireball(pos.x, oy, pos.z, hx, hz, tr) || .1;
    ANIM.push(function (dt) {              /* api mengenai sasaran saat bolanya tiba */
      wait -= dt; if (wait > 0) return true;
      if (tr.t) { showToast('🔥 ' + tr.t.n + ' terbakar!'); boomShoot(tr.t); }
      else { fxBurn(tr.x, tr.z, 2.6, 2.6, 1.6, 4.5); showToast('🔥 Bola api!'); }
      tgBlast(tr.x, tr.z, tr.t);
      return false;
    });
  }

  /* ---------- loop utama ---------- */
  function loop() {
    requestAnimationFrame(loop);
    var dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    if (state === 'play') {
      var f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) + joy.y;
      var s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + joy.x;
      var len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
      var shiftK = keys.ShiftLeft || keys.ShiftRight, nos = activePower('rider') && motorOn && shiftK; nosActive = !!nos;
      var spd = (shiftK ? 10 : 6) * (activePower('rider') && motorOn ? (nos ? 3.1 : 2.0) : 1) * dt;
      moving = len > .05;
      if (flying) { playerY = Math.max(2, playerY); if (keys.Space) playerY = Math.min(FLY_MAX, playerY + 30 * dt); if (shiftK) playerY = Math.max(2, playerY - 30 * dt); }
      else if (jumpV !== 0 || playerY > 0) { jumpV = Math.max(-34, jumpV - 38 * dt); playerY += jumpV * dt; if (playerY <= 0) { playerY = 0; jumpV = 0; } }
      pos.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * spd; pos.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * spd;
      if (!flying) collide(pos); else { pos.x = clamp(pos.x, -HALF.x + 2, HALF.x - 2); pos.z = clamp(pos.z, -HALF.z + 2, HALF.z - 2); }
      if (moving) bobT += dt * (nos ? 22 : (shiftK ? 13 : 9));
    } else moving = false;
    if (state === 'ride' && ride) rideStep(dt);
    if (state === 'mini') danceUpdate(dt, t);
    pvStep(dt); wsUpdate(dt, t);
    if (ride) { camera.position.set(ride.cx, ride.cy, ride.cz); camera.rotation.set(-.2, ride.cyaw, 0); }
    else if (CAM.mode !== 'fp') camStep(dt);
    else { camera.position.set(pos.x, 1.6 + playerY + (moving && state === 'play' ? Math.sin(bobT) * .035 : 0), pos.z); camera.rotation.set(pitch, yaw, 0); }
    sky.position.copy(camera.position);
    /* makin tinggi terbang, kabut makin jauh sehingga seluruh peta terlihat */
    VIEWK = 1 + clamp(playerY - 6, 0, FLY_MAX) / 22;
    if (scene.fog) { scene.fog.near = QL.fogN * VIEWK; scene.fog.far = Math.min(QL.n === 'low' ? 700 : 1350, QL.fogF * VIEWK); }
    if ((cullN++) % 3 === 0) cullStep();
    resStep(dt);
    clouds.forEach(function (c) { c.position.x += c.userData.sp * dt; if (c.position.x > 480) c.position.x = -480; });
    stepVehicles(dt);
    if (W.motor) { var lnf = W.motor.getObjectByName('nosFlame'); if (lnf) lnf.visible = !!(motorOn && nosActive); if (motorOn) { W.motor.position.set(pos.x, playerY, pos.z); W.motor.rotation.y = yaw; } }
    if (fireCooldown > 0) fireCooldown = Math.max(0, fireCooldown - dt);
    ANIM = ANIM.filter(function (fn) { return fn(dt); });
    W.pin.forEach(function (b) { b.sprite.visible = !b.dead && Math.hypot(pos.x - b.x, pos.z - b.z) < 190 * VIEWK; });
    AREAS.forEach(function (a) { a.sprite.visible = Math.hypot(pos.x - a.x, pos.z - a.z) < 190 * VIEWK; });
    KOMPLEK.forEach(function (k) { if (k.sprite) k.sprite.visible = Math.hypot(pos.x - k.cx, pos.z - k.cz) < 190 * VIEWK; });
    STOPS.forEach(function (a) { a.sprite.visible = !a.dead && Math.hypot(pos.x - a.sx, pos.z - a.sz) < 80 * Math.min(VIEWK, 3); });
    for (var i = 0; i < N; i++) {
      var o = W.npc[i], d = NPC[i], dx, dz, dist;
      if (o.dance) { o.mk.visible = false; continue; }
      npcSim(o, d, i);
      dx = pos.x - d.x; dz = pos.z - d.z; dist = Math.hypot(dx, dz);
      o.body.position.y = o.fleeRun ? Math.abs(Math.sin(t * 12)) * .12 : (o.walking ? Math.abs(Math.sin(t * 7 + o.ph)) * .03 : Math.sin(t * 2 + o.ph) * .015);
      if (!o.fleeRun && !o.walking && dist < 9) { var target = Math.atan2(dx, dz), diff = Math.atan2(Math.sin(target - o.g.rotation.y), Math.cos(target - o.g.rotation.y)); o.g.rotation.y += diff * Math.min(1, dt * 4); }
      if (o.fleeRun) { o.armL.rotation.x = Math.sin(t * 14) * .9; o.armR.rotation.x = -Math.sin(t * 14) * .9; o.armL.rotation.z = 0; o.armR.rotation.z = 0; }
      else {
        if (res[i] && dist < 14) { o.armR.rotation.z = 2.6 + Math.sin(t * 7 + o.ph) * .3; o.armL.rotation.z = -.1; }
        else { o.armR.rotation.z = Math.sin(t * 1.5 + o.ph) * .05; o.armL.rotation.z = -Math.sin(t * 1.5 + o.ph) * .05; }
        o.armL.rotation.x = o.walking ? Math.sin(t * 5 + o.ph) * .3 : 0; o.armR.rotation.x = o.walking ? -Math.sin(t * 5 + o.ph) * .3 : 0;
      }
      var want = res[i] ? 'c' : (d.fl ? 'r' : 'q');
      if (o.mkS !== want) { o.mkS = want; o.mk.material.map = want === 'c' ? o.cTex : (want === 'r' ? o.rTex : o.qTex); o.mk.material.needsUpdate = true; }
      o.mk.visible = (dist < 45 * Math.min(VIEWK, 3) || activePower('tracker')) && !o.hideMk; o.mk.position.y = 2.65 + Math.sin(t * 3 + o.ph) * .12;
    }
    frameN++;
    if (frameN % QL.mini === 0) { if (state === 'play' || state === 'ride') drawMini(); promptUpdate(); }
    if (frameN % 30 === 0) { var zn = zoneAt(pos.x, pos.z); if ($('zone').textContent !== zn) $('zone').textContent = zn; }
    renderer.render(scene, camera);
  }

  /* ---------- tokoh kabur & berkeliling (deterministik: sama di semua pemain) ---------- */
  var FLEE_RUN = 1.5, FLEE_SHR = .35, FLEE_GROW = .35, FLEE_END = FLEE_RUN + FLEE_SHR + FLEE_GROW;
  function npcClue(i) {
    var d = NPC[i], f = d.fl;
    if (!f) return d.oclue;
    return (ST() - f.fa) / 1000 < FLEE_END ? 'Kabur naik angkot ke arah ' + zoneAt(f.tx, f.tz) : 'Terlihat di ' + zoneAt(f.tx, f.tz);
  }
  function startFlee(i) {
    var d = NPC[i], best = null, tries = 0, tx, tz;
    while (tries++ < 120 && !best) {
      var sp = W.spots[Math.floor(Math.random() * W.spots.length)]; tx = sp[0]; tz = sp[1];
      if (Math.hypot(tx - pos.x, tz - pos.z) > 70 && Math.hypot(tx - d.x, tz - d.z) > 60 && spotFree(tx, tz)) best = [tx, tz];
    }
    if (!best) best = [d.ox, d.oz];
    var ax = d.x - pos.x, az = d.z - pos.z, al = Math.hypot(ax, az) || 1;
    var fl = { fa: Math.round(ST()), sx: r2(d.x), sz: r2(d.z), ux: r2(ax / al), uz: r2(az / al), tx: r2(best[0]), tz: r2(best[1]) };
    d.fl = fl;
    showToast(d.n + ' kabur ke arah ' + zoneAt(best[0], best[1]) + '! Cari dia lagi.');
    wsFlee(i, fl); save();
  }
  function npcSim(o, d, i) {
    var f = d.fl, now = ST(), x = d.x, z = d.z, sc = 1, run = false, hide = false, flee = false, hx = null, hz = null, hd = 0, tmp, dt, a;
    if (f) {
      dt = (now - f.fa) / 1000;
      if (dt < 0) { x = f.sx; z = f.sz; }
      else if (dt < FLEE_RUN) { x = f.sx + f.ux * 8 * dt; z = f.sz + f.uz * 8 * dt; run = true; flee = true; }
      else if (dt < FLEE_RUN + FLEE_SHR) { x = f.sx + f.ux * 8 * FLEE_RUN; z = f.sz + f.uz * 8 * FLEE_RUN; sc = Math.max(.01, 1 - (dt - FLEE_RUN) / FLEE_SHR); hide = true; flee = true; }
      else if (dt < FLEE_END) { x = f.tx; z = f.tz; sc = Math.min(1, .01 + (dt - FLEE_RUN - FLEE_SHR) / FLEE_GROW); hide = true; flee = true; }
      else { hx = f.tx; hz = f.tz; }
    } else { hx = d.ox; hz = d.oz; }
    if (hx !== null) {
      a = now / 1000 * .22 + i * 1.7;
      x = hx + Math.cos(a) * 1.3; z = hz + Math.sin(a * .8) * 1.3; hd = Math.atan2(-Math.sin(a), .8 * Math.cos(a * .8));
    } else if (run) {
      tmp = { x: x, z: z }; collide(tmp, .6, null, true); x = tmp.x; z = tmp.z; hd = Math.atan2(f.ux, f.uz);
    }
    d.x = x; d.z = z; o.fleeing = flee; o.fleeRun = run; o.hideMk = hide;
    o.walking = hx !== null && Math.hypot(pos.x - x, pos.z - z) > 6;
    o.circle.x = x; o.circle.z = z; o.g.position.set(x, 0, z); o.sh.position.set(x, .045, z); o.mk.position.x = x; o.mk.position.z = z; o.g.scale.set(sc, sc, sc);
    if (run) turn(o.g, hd, .5); else if (o.walking) turn(o.g, hd, .2);
  }
  var promptKind = '', promptIdx = -1;
  function promptUpdate() {
    var el = $('prompt');
    if (state !== 'play') { el.hidden = true; promptKind = ''; return; }
    var i = nearest(3.8);
    if (i >= 0) {
      promptKind = 'npc'; promptIdx = i; el.hidden = false; el.classList.toggle('quiet', !!res[i]); $('btnTalk').hidden = !!res[i]; $('btnTalk').textContent = 'Bicara';
      $('pTxt').innerHTML = res[i] ? NPC[i].n + ' sudah kamu bantu.' : (isTouch ? 'Ada ' + NPC[i].n + ' di dekatmu' : 'Tekan <kbd>E</kbd> untuk bicara dengan <strong>' + NPC[i].n + '</strong>');
      return;
    }
    var s = nearestStop(6.5);
    if (s >= 0) {
      promptKind = 'stop'; promptIdx = s; el.hidden = false; el.classList.remove('quiet'); $('btnTalk').hidden = false; $('btnTalk').textContent = 'Naik Angkot';
      $('pTxt').innerHTML = (isTouch ? '' : 'Tekan <kbd>E</kbd> untuk naik ') + '<strong>' + MP.LINES[STOPS[s].line].n + '</strong> di ' + STOPS[s].n;
      return;
    }
    promptKind = ''; el.hidden = true;
  }

  /* ---------- peta kecil & peta kota ---------- */
  var mctx = $('mini').getContext('2d'), mdpr = Math.min(window.devicePixelRatio || 1, 2);
  function arrow(g, px, pz, ang, L, lw) {
    var fx = -Math.sin(ang), fz = -Math.cos(ang);
    g.fillStyle = '#e0434a'; g.strokeStyle = '#fff'; g.lineWidth = lw; g.beginPath();
    g.moveTo(px + fx * L, pz + fz * L); g.lineTo(px - fx * L * .6 - fz * L * .6, pz - fz * L * .6 + fx * L * .6); g.lineTo(px - fx * L * .6 + fz * L * .6, pz - fz * L * .6 - fx * L * .6); g.closePath(); g.fill(); g.stroke();
  }
  function drawMini() {
    var cv = $('mini'), size = cv.clientWidth || 150; if (cv.width !== Math.round(size * mdpr)) { cv.width = cv.height = Math.round(size * mdpr); }
    var S = cv.width, g = mctx, gc = W.groundCanvas, K = W.K, VIEW = 130, x0 = pos.x - VIEW / 2, z0 = pos.z - VIEW / 2;
    g.fillStyle = '#a9d28b'; g.fillRect(0, 0, S, S);
    if (gc) {
      var sx = (x0 + HALF.x) * K, sy = (z0 + HALF.z) * K, sw = VIEW * K, cx0 = Math.max(sx, 0), cy0 = Math.max(sy, 0), cx1 = Math.min(sx + sw, gc.width), cy1 = Math.min(sy + sw, gc.height);
      if (cx1 > cx0 && cy1 > cy0) g.drawImage(gc, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx) / sw * S, (cy0 - sy) / sw * S, (cx1 - cx0) / sw * S, (cy1 - cy0) / sw * S);
    }
    var M = function (x, z) { return [(x - x0) / VIEW * S, (z - z0) / VIEW * S]; }, m = S / VIEW, q;
    POI.forEach(function (b) { q = M(b.x - b.w / 2, b.z - b.d / 2); g.fillStyle = hex(b.roof); g.fillRect(q[0], q[1], b.w * m, b.d * m); });
    STOPS.forEach(function (s) { q = M(s.sx, s.sz); if (q[0] < -6 || q[1] < -6 || q[0] > S + 6 || q[1] > S + 6) return; g.fillStyle = MP.LINES[s.line].col; g.beginPath(); g.arc(q[0], q[1], 4.2 * mdpr, 0, 7); g.fill(); g.lineWidth = 1.5 * mdpr; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#fff'; g.font = '700 ' + 6 * mdpr + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('B', q[0], q[1] + .3); });
    for (var i = 0; i < N; i++) {
      var d = NPC[i], dist = Math.hypot(pos.x - d.x, pos.z - d.z);
      if (res[i]) { g.fillStyle = '#14a06e'; } else if (activePower('tracker') || dist < 34) { g.fillStyle = att[i] ? '#e0434a' : '#ffc42e'; } else continue;
      q = M(d.x, d.z); g.beginPath(); g.arc(q[0], q[1], 3.4 * mdpr, 0, 7); g.fill(); g.lineWidth = 1.5 * mdpr; g.strokeStyle = '#10233f'; g.stroke();
    }
    for (var wk in WS.remote) { var wr = WS.remote[wk]; q = M(wr.x, wr.z); if (q[0] < -6 || q[1] < -6 || q[0] > S + 6 || q[1] > S + 6) continue; g.fillStyle = '#2a8fd0'; g.beginPath(); g.arc(q[0], q[1], 4 * mdpr, 0, 7); g.fill(); g.lineWidth = 1.5 * mdpr; g.strokeStyle = '#fff'; g.stroke(); }
    q = M(pos.x, pos.z); arrow(g, q[0], q[1], yaw, 7 * mdpr, 1.5 * mdpr);
  }
  function openMap() {
    if (state !== 'play') return;
    releaseLock(); setState('peta');
    var cv = $('bigmap'), W2 = 1100, H2 = Math.round(W2 * WZ / WX); cv.width = W2; cv.height = H2; var g = cv.getContext('2d'), k = W2 / WX;
    var M = function (x, z) { return [(x + HALF.x) * k, (z + HALF.z) * k]; }, q;
    g.drawImage(W.groundCanvas, 0, 0, W2, H2);
    Object.keys(MP.LINES).forEach(function (ln, li) {
      var rt = ROUTE[ln]; g.strokeStyle = MP.LINES[ln].col; g.globalAlpha = .75; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round'; g.setLineDash(li === 0 ? [] : (li === 1 ? [14, 8] : [3, 8])); g.beginPath();
      rt.pts.forEach(function (p, i) { var a = M(p[0], p[1]); if (i) g.lineTo(a[0], a[1]); else g.moveTo(a[0], a[1]); }); g.stroke(); g.globalAlpha = 1; g.setLineDash([]);
    });
    g.font = '700 12px "Lexend",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    function label(txt, x, y, bg, fg) { var w = g.measureText(txt).width + 10; g.fillStyle = bg; rr(g, x - w / 2, y - 9, w, 18, 6); g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#10233f'; g.stroke(); g.fillStyle = fg; g.fillText(txt, x, y + 1); }
    POI.forEach(function (b) { q = M(b.x, b.z); g.fillStyle = hex(b.roof); g.fillRect(q[0] - b.w / 2 * k, q[1] - b.d / 2 * k, b.w * k, b.d * k); });
    POI.forEach(function (b) { q = M(b.x, b.z); label(b.zn, q[0], q[1] - b.d / 2 * k - 11, '#ffffff', '#10233f'); });
    AREAS.forEach(function (a) { q = M(a.x, a.z); label(a.zn, q[0], q[1], '#e1f5ec', '#10233f'); });
    KOMPLEK.forEach(function (k) { q = M(k.cx, k.cz); label(k.zn, q[0], q[1], '#fff6d6', '#10233f'); });
    STOPS.forEach(function (s) { q = M(s.sx, s.sz); g.fillStyle = MP.LINES[s.line].col; g.beginPath(); g.arc(q[0], q[1], 9, 0, 7); g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#fff'; g.font = '800 10px "Lexend",sans-serif'; g.fillText(s.id, q[0], q[1] + .5); g.font = '700 12px "Lexend",sans-serif'; });
    for (var i = 0; i < N; i++) if (res[i] || activePower('tracker')) { q = M(NPC[i].x, NPC[i].z); g.fillStyle = res[i] ? '#14a06e' : '#ffc42e'; g.beginPath(); g.arc(q[0], q[1], 6, 0, 7); g.fill(); g.lineWidth = 2; g.strokeStyle = '#10233f'; g.stroke(); }
    for (var wk2 in WS.remote) { var wr2 = WS.remote[wk2]; q = M(wr2.x, wr2.z); g.fillStyle = '#2a8fd0'; g.beginPath(); g.arc(q[0], q[1], 7, 0, 7); g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke(); label(wr2.n, q[0], q[1] - 16, '#eaf4ff', '#10233f'); }
    q = M(pos.x, pos.z); arrow(g, q[0], q[1], yaw, 13, 2.5);
    $('mapLegend').innerHTML = STOPS.map(function (s) { return ''; }).join('') + Object.keys(MP.LINES).map(function (ln) {
      return '<div class="lg"><i style="background:' + MP.LINES[ln].col + '"></i><b>' + MP.LINES[ln].n + '</b> <span>' + MP.LINES[ln].desc + '</span><em>' + STOPS.filter(function (s) { return s.line === ln; }).map(function (s) { return s.id + ' ' + s.n.replace('Halte ', ''); }).join(' · ') + '</em></div>';
    }).join('');
    $('peta').hidden = false; $('pcard2').focus();
  }
  function closeMap() { $('peta').hidden = true; setState('play'); if (!isTouch) lockPointer(); }
  $('btnMap').addEventListener('click', function () { if (state === 'play') openMap(); });
  $('mClose').addEventListener('click', closeMap);

  /* ---------- naik angkot ---------- */
  var boardIdx = -1;
  function openBoard(si) {
    releaseLock(); setState('naik'); boardIdx = si; var s = STOPS[si], ln = MP.LINES[s.line];
    $('nTitle').textContent = ln.n + ' dari ' + s.n; $('nSub').textContent = ln.desc + '. Pilih halte tujuanmu!';
    var box = $('nList'); box.innerHTML = '';
    STOPS.forEach(function (t, ti) {
      if (t.line !== s.line || ti === si) return;
      var dist = Math.abs(t.s - s.s), b = document.createElement('button'); b.type = 'button'; b.className = 'stopbtn';
      b.innerHTML = '<span class="bd" style="background:' + ln.col + '">' + t.id + '</span><span class="who"><b>' + t.n + '</b><span>' + t.d + ' · sekitar ' + Math.max(1, Math.round(dist / 34)) + ' detik naik angkot</span></span>';
      b.addEventListener('click', function () { startRide(si, ti); }); box.appendChild(b);
    });
    $('naik').hidden = false; $('ncard').focus();
  }
  function closeBoard() { $('naik').hidden = true; setState('play'); if (!isTouch) lockPointer(); }
  $('nClose').addEventListener('click', closeBoard);
  function startRide(from, to) {
    var a = STOPS[from], b = STOPS[to], rt = ROUTE[a.line]; $('naik').hidden = true;
    ride = { rt: rt, line: a.line, s0: a.s, s1: b.s, dir: b.s >= a.s ? 1 : -1, t: 0, dur: clamp(Math.abs(b.s - a.s) / 34 + 1.2, 3, 14), to: b, yaw: 0, cx: pos.x, cy: 3.8, cz: pos.z, cyaw: yaw };
    var g = W.rideVeh[a.line]; g.visible = true; ride.g = g; ride.yaw = vehPlace(g, rt, a.s, ride.dir, LANE); g.rotation.y = ride.yaw;
    setState('ride'); $('prompt').hidden = true; $('rideBox').hidden = false; $('rideTxt').innerHTML = '<b>' + MP.LINES[a.line].n + '</b> menuju ' + b.n; beep(440, .12, 'triangle'); beep(660, .12, 'triangle', .1);
  }
  function rideStep(dt) {
    ride.t += dt; var p = clamp(ride.t / ride.dur, 0, 1), e = p * p * (3 - 2 * p), s = ride.s0 + (ride.s1 - ride.s0) * e;
    var ty = vehPlace(ride.g, ride.rt, s, ride.dir, LANE), df = Math.atan2(Math.sin(ty - ride.yaw), Math.cos(ty - ride.yaw)); ride.yaw += df * Math.min(1, dt * 6); ride.g.rotation.y = ride.yaw;
    var fx = Math.sin(ride.yaw), fz = Math.cos(ride.yaw); pos.x = ride.g.position.x; pos.z = ride.g.position.z;
    ride.cx = pos.x - fx * 8.5; ride.cz = pos.z - fz * 8.5; ride.cy = 4.2; ride.cyaw = Math.atan2(-fx, -fz); yaw = ride.cyaw;
    $('rideBar').style.width = (p * 100) + '%';
    if (p >= 1) endRide();
  }
  function endRide() {
    if (!ride) return; var b = ride.to; ride.g.visible = false; ride = null; $('rideBox').hidden = true;
    pos.x = b.ex; pos.z = b.ez; collide(pos); yaw = Math.atan2(b.nx, b.nz); pitch = 0;
    setState('play'); if (!isTouch) lockPointer(); showToast('Kamu tiba di ' + b.n + '. Cari guru di sekitar sini!'); beep(784, .12, 'triangle'); beep(988, .16, 'triangle', .1); save();
  }
  $('rideSkip').addEventListener('click', function () { if (ride) ride.t = ride.dur; });

  /* ---------- input ---------- */
  var cv = $('gl');
  function lockPointer() { try { var p = cv.requestPointerLock && cv.requestPointerLock(); if (p && p.catch) p.catch(function () { }); } catch (e) { } }
  cv.addEventListener('mousedown', function (e) { if (state !== 'play') return; dragging = true; lockPointer(); e.preventDefault(); });
  window.addEventListener('mouseup', function () { dragging = false; });
  window.addEventListener('mousemove', function (e) {
    if (state !== 'play' || !(locked || dragging)) return;
    yaw -= (e.movementX || 0) * .0023; pitch = clamp(pitch - (e.movementY || 0) * .0023, -1.3, 1.3);
  });
  document.addEventListener('pointerlockchange', function () { locked = (document.pointerLockElement === cv); updatePause(); });
  window.addEventListener('blur', function () { keys = {}; dragging = false; });
  window.addEventListener('keydown', function (e) {
    if (state === 'mini' || state === 'ride') return;
    if (state === 'prak') { if (e.code === 'Escape') { e.preventDefault(); closePractice(); } return; }
    if (state === 'dialog') {
      if (e.code === 'Escape') { closeDialog(qLocked); return; }
      var m = /^(Digit|Numpad)([1-5])$/.exec(e.code);
      if (m && cur >= 0 && NPC[cur].t !== 'isian' && !qLocked) { toggleOpt(+m[2] - 1); e.preventDefault(); }
      if (e.code === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); if (qLocked) closeDialog(true); else submitAnswer(); }
      return;
    }
    if (state === 'list') { if (e.code === 'Escape' || e.code === 'Tab' || e.code === 'KeyH') { e.preventDefault(); closeList(); } return; }
    if (state === 'shop') { if (e.code === 'Escape' || e.code === 'KeyB') { e.preventDefault(); closeShop(); } return; }
    if (state === 'peta') { if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); closeMap(); } return; }
    if (state === 'naik') { if (e.code === 'Escape') { e.preventDefault(); closeBoard(); } return; }
    if (state === 'confirm') { if (e.code === 'Escape') { e.preventDefault(); closeFinish(); } return; }
    if (state !== 'play') return;
    if (e.code === 'Tab' || e.code === 'KeyH') { e.preventDefault(); openList(); return; }
    if (e.code === 'KeyM') { openMap(); return; }
    if (e.code === 'KeyB') { openShop(); return; }
    if (e.code === 'KeyE') { tryTalk(); return; }
    if (e.code === 'KeyF' && activePower('fire')) { shootFire(); return; }
    if (e.code === 'KeyG' && activePower('flyer')) { flying = !flying; if (!flying) jumpV = 0; showToast(flying ? 'Mode terbang aktif: W/A/S/D bergerak, Space naik (sampai ' + FLY_MAX + ' m), Shift turun. Makin tinggi, pandangan makin luas.' : 'Kamu mendarat.'); if (FB.on) fbSend(true); return; }
    if (e.code === 'KeyR' && activePower('rider')) { toggleMotor(); return; }
    if (e.code === 'Space' && activePower('jumper') && playerY <= 0.02 && !flying) { jumpV = 18; e.preventDefault(); }
    keys[e.code] = true;
    if (e.code.indexOf('Arrow') === 0 || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  var tzL = $('tzL'), tzR = $('tzR'), jb = $('joyBase'), jk = $('joyKnob');
  tzL.addEventListener('pointerdown', function (e) {
    if (joy.id !== null) return; joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; jb.style.left = e.clientX + 'px'; jb.style.top = e.clientY + 'px'; jb.hidden = false; jk.style.transform = ''; try { tzL.setPointerCapture(e.pointerId); } catch (x) { }
  });
  tzL.addEventListener('pointermove', function (e) {
    if (e.pointerId !== joy.id) return; var dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, l = Math.hypot(dx, dy), mx = 50; if (l > mx) { dx = dx / l * mx; dy = dy / l * mx; }
    joy.x = dx / mx; joy.y = -dy / mx; jk.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  });
  function joyEnd(e) { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; jb.hidden = true; }
  tzL.addEventListener('pointerup', joyEnd); tzL.addEventListener('pointercancel', joyEnd);
  tzR.addEventListener('pointerdown', function (e) { if (lookId !== null) return; lookId = e.pointerId; lookLast = [e.clientX, e.clientY]; try { tzR.setPointerCapture(e.pointerId); } catch (x) { } });
  tzR.addEventListener('pointermove', function (e) {
    if (e.pointerId !== lookId) return; yaw -= (e.clientX - lookLast[0]) * .0055; pitch = clamp(pitch - (e.clientY - lookLast[1]) * .0055, -1.3, 1.3); lookLast = [e.clientX, e.clientY];
  });
  function lookEnd(e) { if (e.pointerId === lookId) lookId = null; }
  tzR.addEventListener('pointerup', lookEnd); tzR.addEventListener('pointercancel', lookEnd);
  function releaseLock() { try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) { } keys = {}; joy.x = joy.y = 0; dragging = false; }
  function backToPlay() { setState('play'); if (!isTouch) lockPointer(); }
  function tryTalk() {
    if (state !== 'play') return;
    var i = nearest(3.8); if (i >= 0) { if (!res[i]) openDialog(i); return; }
    var s = nearestStop(6.5); if (s >= 0) openBoard(s);
  }
  $('btnTalk').addEventListener('click', tryTalk);

  /* ---------- dialog soal ---------- */
  var qLocked = false;
  var TAGTXT = { pg: 'Pilih SATU jawaban yang benar', pgk: 'Pilih SEMUA jawaban yang benar', isian: 'Ketik jawaban singkat' };
  var HINTTXT = { pg: 'Pilih satu jawaban. Tombol angka 1 sampai 4 juga bisa dipakai. Kalau salah, temanmu akan kabur!', pgk: 'Bisa 2, 3, 4, atau semua jawaban yang benar. Tombol angka 1 sampai 5 juga bisa dipakai. Kalau belum benar semua, temanmu akan kabur!', isian: 'Ketik jawabanmu lalu tekan Enter. Kalau belum tepat, temanmu akan kabur!' };
  function openDialog(i) {
    cur = i; qLocked = false; releaseLock(); var d = NPC[i];
    setState('dialog'); beep(660, .1, 'triangle'); beep(880, .12, 'triangle', .09);
    $('dAv').textContent = d.n.replace(/^(Bu|Pak|Pa|Nenek|Kak|Mang)\s/, '').charAt(0); $('dAv').style.background = hex(d.c === 0xffffff ? 0xd8232a : d.c);
    $('dName').textContent = d.n; $('dRole').textContent = d.r; $('dQ').innerHTML = d.s;
    $('dHi').textContent = att[i] ? 'Kamu menemukanku lagi! Coba jawab sekali lagi, ya.' : GREET[Math.floor(Math.random() * GREET.length)];
    document.querySelector('.qtag').textContent = TYPE_NAME[d.t] + ' · ' + TAGTXT[d.t] + ' · ' + d.pts + ' poin' + (att[i] ? ' · Percobaan ke-' + (att[i] + 1) : '');
    var box = $('dOpts'); box.innerHTML = ''; box.classList.toggle('one', d.t === 'isian'); qopts = [];
    if (d.t === 'isian') {
      var inp = document.createElement('input'); inp.type = 'text'; inp.className = 'fillin'; inp.id = 'dFill'; inp.autocomplete = 'off'; inp.setAttribute('aria-label', 'Jawabanmu'); inp.placeholder = 'Ketik jawabanmu di sini'; box.appendChild(inp);
    } else {
      qopts = shuffle(d.o.map(function (o) { return { t: o[0], ok: !!o[1] }; }));
      qopts.forEach(function (o, k) {
        var lab = document.createElement('label'); lab.className = 'opt' + (d.t === 'pg' ? ' radio' : '');
        lab.innerHTML = '<input type="' + (d.t === 'pg' ? 'radio' : 'checkbox') + '" name="dq" id="opt' + k + '"><span class="box"></span><span class="ot"></span><span class="tag"></span>';
        lab.querySelector('.ot').innerHTML = '<b>' + 'ABCDE'.charAt(k) + '.</b> ' + o.t; o.el = lab; o.inp = lab.querySelector('input');
        o.inp.addEventListener('change', function () { qopts.forEach(function (x) { x.el.classList.toggle('sel', x.inp.checked); }); });
        box.appendChild(lab);
      });
    }
    $('dRes').hidden = true; $('dHint').hidden = false; $('dHint').textContent = HINTTXT[d.t]; $('dSubmit').textContent = 'Periksa Jawaban'; $('dLater').hidden = false;
    $('dialog').hidden = false; $('dialog').scrollTop = 0; if (d.t === 'isian') $('dFill').focus(); else $('dcard').focus();
  }
  function toggleOpt(k) {
    var o = qopts[k]; if (!o) return;
    if (NPC[cur].t === 'pg') o.inp.checked = true; else o.inp.checked = !o.inp.checked;
    qopts.forEach(function (x) { x.el.classList.toggle('sel', x.inp.checked); });
  }
  function normIsian(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '').replace(/["'\u201c\u201d\u2018\u2019`]/g, '').replace(/\.$/, ''); }
  function submitAnswer() {
    if (qLocked) { closeDialog(true); return; }
    var d = NPC[cur], hits = 0, wrong = 0, total = 0, perfect = false, info = '';
    if (d.t === 'isian') {
      var v = $('dFill').value; if (!normIsian(v)) { $('dFill').focus(); return; }
      perfect = d.q.accept.some(function (x) { return normIsian(x) === normIsian(v); });
      $('dFill').disabled = true; $('dFill').classList.add(perfect ? 'ok' : 'no');
    } else {
      qopts.forEach(function (o) { if (o.ok) total++; if (o.inp.checked && o.ok) hits++; if (o.inp.checked && !o.ok) wrong++; });
      if (d.t === 'pg' && hits + wrong === 0) return;
      perfect = (hits === total && wrong === 0);
      if (d.t === 'pg') info = perfect ? '' : 'Jawabanmu belum tepat.'; else info = 'Kamu memilih ' + hits + ' jawaban yang tepat dan ' + wrong + ' yang kurang tepat. Jumlah semua jawaban yang benar: ' + total + '.';
    }
    qLocked = true; lastOk = perfect;
    if (perfect) { coins += 100; if ($('hCoins')) $('hCoins').textContent = coins; save(); }
    qopts.forEach(function (o) { o.inp.disabled = true; o.el.classList.add('lock'); if (perfect) { o.el.classList.remove('sel'); o.el.classList.add('ok'); o.el.querySelector('.tag').textContent = o.ok ? 'Benar' : ''; } });
    var box = $('dRes'); box.hidden = false;
    if (perfect) {
      var pts = r2(d.pts * TRY_F[Math.min(att[cur], 2)]);
      res[cur] = { pts: pts, max: d.pts, tries: att[cur] + 1 }; done++; score += pts;
      box.className = 'res good';
      box.innerHTML = '<b>Sempurna! +' + pts + ' poin</b><span>' + d.w + '</span>';
      var nm = W.npc[cur]; nm.mk.material.map = nm.cTex; nm.mk.material.needsUpdate = true;
      var needMini = Math.floor(done / 5) > mg;
      $('dSubmit').textContent = needMini ? 'Main Ayo Dansa!' : (done === N ? 'Lihat Hasil' : 'Lanjut Mencari');
      beep(784, .12, 'triangle'); beep(988, .12, 'triangle', .11); beep(1318, .2, 'triangle', .22);
    } else {
      att[cur]++;
      box.className = 'res nope';
      box.innerHTML = '<b>Belum tepat, ' + d.n + ' kabur!</b>' + (info ? '<span>' + info + '</span>' : '') + '<span>' + d.w + '</span><span>Cari dia lagi (lihat Daftar atau Peta), lalu jawab sampai benar. Poin makin kecil kalau salah lebih banyak.</span>';
      $('dSubmit').textContent = 'Cari Dia Lagi';
      beep(220, .25, 'sawtooth');
    }
    $('dHint').hidden = true; $('dLater').hidden = true; hudUpdate(); save();
    if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function closeDialog(answered) {
    $('dialog').hidden = true;
    var solved = (answered === true && qLocked && lastOk);
    if (solved) { afterSolved(); return; }
    backToPlay();
    if (answered === true && qLocked && !lastOk) startFlee(cur);
  }
  function afterSolved() {
    if (Math.floor(done / 5) > mg) { startMini(function () { if (done === N) showResults(); else backToPlay(); }); return; }
    if (done === N) { showResults(); return; }
    backToPlay();
  }
  $('dSubmit').addEventListener('click', function () { submitAnswer(); });
  $('dLater').addEventListener('click', function () { closeDialog(false); });
  $('dClose').addEventListener('click', function () { closeDialog(qLocked); });

  /* ---------- mini game: Ayo Dansa ----------
     Alur: 3 teman datang ke depan pemain -> kamera pindah ke third person -> avatar pemain berjalan ke barisan ->
     hitung mundur -> lagu 2 menit (24 putaran x 5 detik) -> papan skor -> teman kembali ke tempatnya -> kamera kembali first person. */
  var DIRS = ['up', 'down', 'left', 'right'];
  var DKEY = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  var SONG_LEN = 120, ROUND_LEN = 5, N_ROUND = 24, ZONE0 = .55, ZONE1 = .85, NPC_SLOTS = [0, 2, 3];
  var MEDAL = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49', '4'];
  var FBTXT = { perfect: 'SEMPURNA!', good: 'TERLALU CEPAT', late: 'TELAT', miss: 'MELESET' };
  var mgCb = null, mgLvl = 1, mgStarsGot = 0, mgPhase = 'idle';
  var CAM = { mode: 'fp', t: 0, v: null }, DN = { phase: 'off', n: 0, npcs: [], labels: [], sc: [0, 0, 0, 0], combo: [0, 0, 0, 0], names: [], stat: {}, ev: [], seq: [], round: -1, el: 0 }, PR = null;

  function arrowSVG(dir, col) {
    var rot = { up: 0, right: 90, down: 180, left: 270 }[dir];
    return '<svg viewBox="0 0 24 24" style="transform:rotate(' + rot + 'deg)" fill="none" stroke="' + (col || '#fff') + '" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20V5M5.5 11.5L12 5l6.5 6.5"/></svg>';
  }
  function ease(x) { return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; }
  function turn(g, a, k) { var df = Math.atan2(Math.sin(a - g.rotation.y), Math.cos(a - g.rotation.y)); g.rotation.y += df * Math.min(1, k); }
  function acx() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { AC = null; } return AC; }
  function blip(f, d, type, delay, v) {
    try {
      var a = acx(); if (!a) return; var t0 = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
      o.type = type || 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(v || .14, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + d);
      o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + d + .02);
    } catch (e) { }
  }

  /* ----- lagu 2 menit (dibuat langsung oleh WebAudio, 120 BPM x 60 birama) ----- */
  var SONG = { timer: null, step: 0, next: 0, t0: 0, ctx: null, fade: null, mute: null, noise: null, muted: false, on: false };
  var CT = [[220, 261.63, 329.63], [174.61, 220, 261.63], [261.63, 329.63, 392], [196, 246.94, 293.66]];
  var BR = [110, 87.31, 130.81, 98];
  var LD = [[440, 523.25, 659.25, 523.25], [349.23, 440, 523.25, 440], [392, 523.25, 659.25, 392], [493.88, 587.33, 783.99, 587.33]];
  var ARP = [0, 1, 2, 1, 0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1];
  function sNote(f, t, d, type, v) {
    var a = SONG.ctx, o = a.createOscillator(), g = a.createGain(); o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g); g.connect(SONG.fade); o.start(t); o.stop(t + d + .02);
  }
  function sNoise(t, d, ft, ff, v) {
    var a = SONG.ctx, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); s.buffer = SONG.noise; f.type = ft; f.frequency.value = ff;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); s.connect(f); f.connect(g); g.connect(SONG.fade); s.start(t, Math.random() * .5); s.stop(t + d + .02);
  }
  function sKick(t) {
    var a = SONG.ctx, o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + .13);
    g.gain.setValueAtTime(.95, t); g.gain.exponentialRampToValueAtTime(.0001, t + .2); o.connect(g); g.connect(SONG.fade); o.start(t); o.stop(t + .22);
  }
  function songStep(s, t) {
    var bar = s >> 4, st = s & 15, c = bar % 4, brk = (bar >= 28 && bar < 32), drums = bar >= 1 && !brk;
    if (st === 0) CT[c].forEach(function (f) { sNote(f, t, 1.9, 'triangle', .05); });
    if (drums && st % 4 === 0) sKick(t);
    if (drums && bar >= 3 && (st === 4 || st === 12)) sNoise(t, .14, 'bandpass', 1800, .35);
    if (bar >= 2 && !brk && st % 4 === 2) sNoise(t, .05, 'highpass', 7000, .18);
    if (bar >= 16 && !brk && st % 2 === 1) sNoise(t, .03, 'highpass', 8000, .07);
    if (bar >= 1 && !brk && st % 2 === 0) sNote(BR[c] * (st % 8 === 6 ? 2 : 1), t, .2, 'triangle', .24);
    if (bar >= 4) sNote(CT[c][ARP[st]] * 2, t, .11, 'square', .035);
    if (((bar >= 8 && bar < 28) || (bar >= 36 && bar < 56)) && (st === 0 || st === 6 || st === 8 || st === 12)) {
      var f = LD[c][st === 0 ? 0 : (st === 6 ? 1 : (st === 8 ? 2 : 3))]; sNote(f, t, .28, 'triangle', .12); sNote(f, t, .16, 'square', .025);
    }
    if (bar === 59 && st === 12) CT[0].concat(CT[2]).forEach(function (f2) { sNote(f2 * 2, t, 1.2, 'triangle', .07); });
  }
  function songStart() {
    var a = acx(); SONG.on = true;
    if (!a) { DN.t0 = performance.now() + 200; return; }
    SONG.ctx = a;
    var comp = a.createDynamicsCompressor(); SONG.fade = a.createGain(); SONG.mute = a.createGain(); SONG.mute.gain.value = SONG.muted ? 0 : .5;
    SONG.fade.connect(SONG.mute); SONG.mute.connect(comp); comp.connect(a.destination);
    if (!SONG.noise || SONG.noise.sampleRate !== a.sampleRate) { var nb = a.createBuffer(1, a.sampleRate, a.sampleRate), dd = nb.getChannelData(0); for (var i = 0; i < dd.length; i++) dd[i] = Math.random() * 2 - 1; SONG.noise = nb; }
    SONG.t0 = a.currentTime + .2 + ((MPL.on && DZ.startAt) ? Math.max(0, DZ.startAt - ST()) / 1000 : 0); SONG.next = SONG.t0; SONG.step = 0;
    SONG.fade.gain.setValueAtTime(1, SONG.t0 + SONG_LEN - 3); SONG.fade.gain.linearRampToValueAtTime(.0001, SONG.t0 + SONG_LEN - .05);
    DN.t0 = (MPL.on && DZ.startAt) ? performance.now() + Math.max(0, DZ.startAt - ST()) + 200 : performance.now() + (SONG.t0 - a.currentTime) * 1000;
    clearInterval(SONG.timer);
    SONG.timer = setInterval(function () {
      while (SONG.step < 960 && SONG.next < a.currentTime + .3) { songStep(SONG.step, SONG.next); SONG.next += .125; SONG.step++; }
      if (SONG.step >= 960) clearInterval(SONG.timer);
    }, 40);
  }
  function songStop() {
    clearInterval(SONG.timer); SONG.on = false;
    try { if (SONG.fade && SONG.ctx) { SONG.fade.gain.cancelScheduledValues(SONG.ctx.currentTime); SONG.fade.gain.setTargetAtTime(.0001, SONG.ctx.currentTime, .08); } } catch (e) { }
  }
  $('dnMute').addEventListener('click', function () {
    SONG.muted = !SONG.muted; if (SONG.mute) SONG.mute.gain.value = SONG.muted ? 0 : .5;
    this.textContent = SONG.muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'; this.setAttribute('aria-label', SONG.muted ? 'Nyalakan suara lagu' : 'Matikan suara lagu');
  });

  /* ----- avatar pemain & panggung ----- */
  function buildPlayerRig() {
    if (PR) return;
    var g = new THREE.Group(), body = new THREE.Group(), skin = lam(0xe0ac84), shirt = lam(0xffffff), pants = lam(0xd8232a), hair = lam(0x1c1c1c), red = lam(0xd8232a);
    var legL = new THREE.Mesh(new THREE.BoxGeometry(.24, .72, .26), pants), legR = legL.clone(); legL.position.set(-.14, .36, 0); legR.position.set(.14, .36, 0);
    var torso = new THREE.Mesh(new THREE.CylinderGeometry(.34, .38, .85, 12), shirt); torso.position.y = 1.12;
    var armG = new THREE.BoxGeometry(.17, .72, .19).translate(0, -.36, 0), armL = new THREE.Mesh(armG, shirt), armR = new THREE.Mesh(armG, shirt); armL.position.set(-.47, 1.46, 0); armR.position.set(.47, 1.46, 0);
    var head = new THREE.Mesh(new THREE.SphereGeometry(.27, 14, 12), skin); head.position.y = 1.76;
    var eg = new THREE.SphereGeometry(.034, 6, 6), ebm = new THREE.MeshBasicMaterial({ color: 0x10233f }), e1 = new THREE.Mesh(eg, ebm), e2 = new THREE.Mesh(eg, ebm); e1.position.set(-.09, 1.8, .245); e2.position.set(.09, 1.8, .245);
    var cap = new THREE.Mesh(new THREE.SphereGeometry(.295, 14, 8, 0, 6.283, 0, 1.75), hair); cap.position.y = 1.77;
    var hat = new THREE.Mesh(new THREE.CylinderGeometry(.3, .31, .13, 14), red); hat.position.y = 2.0;
    var vis = new THREE.Mesh(new THREE.BoxGeometry(.4, .04, .22), red); vis.position.set(0, 1.97, .3);
    var sh = new THREE.Mesh(new THREE.CircleGeometry(.6, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1e3a20, transparent: true, opacity: .3, depthWrite: false })); sh.position.y = .045;
    body.add(legL, legR, torso, armL, armR, head, e1, e2, cap, hat, vis); g.add(body, sh); g.visible = false; scene.add(g);
    PR = { g: g, body: body, armL: armL, armR: armR, legL: legL, legR: legR };
  }
  function ensureStage() {
    if (DN.floor) return;
    var c = document.createElement('canvas'); c.width = 512; c.height = 160; var g = c.getContext('2d'), cols = ['#ff5fa2', '#ffc42e', '#3ad0ff', '#7cf06a'], x, y;
    for (y = 0; y < 5; y++) for (x = 0; x < 16; x++) { g.fillStyle = cols[(x + y) % 4]; g.fillRect(x * 32, y * 32, 32, 32); if ((x + y) % 2) { g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x * 32, y * 32, 32, 32); } }
    var fl = new THREE.Mesh(new THREE.PlaneGeometry(32, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })); fl.position.y = .05; fl.visible = false; scene.add(fl); DN.floor = fl;
    DN.beams = [];
    for (var i = 0; i < 4; i++) {
      var bm = new THREE.Mesh(new THREE.CylinderGeometry(.35, 1.5, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      bm.position.y = 4.5; bm.visible = false; scene.add(bm); DN.beams.push(bm);
    }
  }
  function addLabel(text, bg, who) {
    var tex = textTex(text, 512, 100, bg, '#10233f'), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false }));
    sp.scale.set(2.7, .53, 1); sp.visible = false; scene.add(sp); DN.labels.push({ sp: sp, tex: tex, who: who }); return sp;
  }
  function npcPlace(o, d) { o.circle.x = d.x; o.circle.z = d.z; o.g.position.set(d.x, 0, d.z); o.sh.position.set(d.x, .045, d.z); o.mk.position.x = d.x; o.mk.position.z = d.z; }

  /* ----- pose badan (kotak ala Roblox) ----- */
  var POSE0 = { aL: -.12, aR: .12, xL: 0, xR: 0, by: 0, bz: 0, ty: 0, lL: 0, lR: 0 };
  function rigPose(rig, tg, dt) {
    var c = rig.cur || (rig.cur = { aL: -.12, aR: .12, xL: 0, xR: 0, by: 0, bz: 0, ty: 0, lL: 0, lR: 0 }), k = Math.min(1, dt * 14), n;
    for (n in c) c[n] += ((tg[n] === undefined ? POSE0[n] : tg[n]) - c[n]) * k;
    rig.armL.rotation.z = c.aL; rig.armR.rotation.z = c.aR; rig.armL.rotation.x = c.xL; rig.armR.rotation.x = c.xR;
    rig.body.position.y = c.by; rig.body.rotation.z = c.bz; rig.body.rotation.y = c.ty; rig.legL.rotation.x = c.lL; rig.legR.rotation.x = c.lR;
  }
  function rigReset(rig) {
    rig.cur = null; rig.armL.rotation.set(0, 0, 0); rig.armR.rotation.set(0, 0, 0); rig.body.position.y = 0; rig.body.rotation.set(0, 0, 0); rig.legL.rotation.set(0, 0, 0); rig.legR.rotation.set(0, 0, 0);
  }
  function danceTarget(dir, bp) {
    var bn = Math.abs(Math.sin(bp * Math.PI)), sw = Math.sin(bp * Math.PI * 2);
    switch (dir) {
      case 'up': return { aL: -2.8, aR: 2.8, by: .08 + .1 * bn, lL: .15, lR: -.15 };
      case 'down': return { aL: -.4, aR: .4, xL: -1, xR: -1, by: -.1, lL: .6, lR: -.6 };
      case 'left': return { aL: -1.55, aR: 2.6, bz: .24, ty: .35, by: .05 * bn };
      case 'right': return { aL: -2.6, aR: 1.55, bz: -.24, ty: -.35, by: .05 * bn };
    }
    return { aL: -.4 - .25 * sw, aR: .4 + .25 * sw, by: .06 * bn, lL: .08 * sw, lR: -.08 * sw };
  }
  function walkTarget(t, ph) { var s = Math.sin(t * 11 + ph); return { lL: s * .6, lR: -s * .6, xL: -s * .7, xR: s * .7, by: Math.abs(s) * .06 }; }

  /* ----- kamera ----- */
  function camStep(dt) {
    var V = CAM.v; if (!V) { CAM.mode = 'fp'; return; }
    var asp = window.innerWidth / window.innerHeight, need = 8 / (Math.tan(.6283) * asp), back = clamp(need - DN.dist, 3.6, 16), k;
    V.c.set(pos.x - DN.fx * back, 3 + back * .14, pos.z - DN.fz * back); V.look.set(DN.sx, 1.15, DN.sz);
    V.cam.position.copy(V.c); V.cam.lookAt(V.look); V.qc.copy(V.cam.quaternion);
    V.fp.set(pos.x, 1.6, pos.z); V.qf.setFromEuler(V.eu.set(pitch, yaw, 0, 'YXZ'));
    if (CAM.mode === 'to3') {
      CAM.t += dt / 1.4; k = ease(Math.min(1, CAM.t)); camera.position.lerpVectors(V.fp, V.c, k); camera.quaternion.copy(V.qf).slerp(V.qc, k);
      if (CAM.t >= 1) CAM.mode = '3p';
    } else if (CAM.mode === '3p') { camera.position.copy(V.c); camera.quaternion.copy(V.qc); }
    else if (CAM.mode === 'to1') {
      CAM.t += dt / 1.4; k = ease(Math.min(1, CAM.t)); camera.position.lerpVectors(V.c, V.fp, k); camera.quaternion.copy(V.qc).slerp(V.qf, k);
      if (k > .6 && PR) PR.g.visible = false;
      if (CAM.t >= 1) CAM.mode = 'fp';
    }
  }

  /* ----- papan skor & tampilan ----- */
  function banner(txt) { var b = $('dnBanner'); if (txt) { b.textContent = txt; b.hidden = false; } else b.hidden = true; }
  function boardRender() {
    var en = entries(), me = 0, i, rows;
    for (i = 0; i < en.length; i++) if (en[i].k === 0) me = i;
    rows = en.map(function (e, r) { return { e: e, r: r }; }).slice(0, 5); if (me >= 5) rows.push({ e: en[me], r: me });
    $('dnBoard').innerHTML = '<div class="l">Skor pertandingan</div>' + rows.map(function (o) {
      return '<div class="row' + (o.e.k === 0 ? ' me' : '') + '"><span class="rk">' + (o.r + 1) + '</span><span class="nm">' + esc(o.e.n) + '</span><span class="pt">' + o.e.s + '</span></div>';
    }).join('');
  }
  function fb(kind) {
    var el = $('dnFb'); el.textContent = FBTXT[kind]; el.className = 'dn-fb ' + kind; void el.offsetWidth; el.className = 'dn-fb show ' + kind;
    if (kind === 'perfect') { blip(880, .1, 'triangle', 0, .16); blip(1175, .16, 'triangle', .08, .16); }
    else if (kind === 'good') blip(660, .14, 'triangle', 0, .14);
    else if (kind === 'late') blip(440, .16, 'triangle', 0, .12);
    else blip(150, .22, 'sawtooth', 0, .1);
  }
  function award(who, kind) {
    if (kind === 'miss') { DN.combo[who] = 0; if (who === 0) DN.stat.miss++; }
    else { DN.combo[who]++; DN.sc[who] += ({ perfect: 100, good: 60, late: 40 })[kind] + Math.min(DN.combo[who] - 1, 5) * 10; if (who === 0) DN.stat[kind]++; }
    if (who === 0) $('dnCombo').textContent = DN.combo[0] > 1 ? 'Kombo x' + DN.combo[0] : '';
    boardRender();
  }

  /* ----- putaran ----- */
  function roundStart(r) {
    DN.round = r; var n = r < 5 ? 4 : (r < 12 ? 5 : (r < 18 ? 6 : 7)), seq = [], k, rg = MPL.on ? mulberry(MPL.seed + r * 7919) : Math.random;
    for (k = 0; k < n; k++) seq.push(DIRS[Math.floor(rg() * 4)]);
    DN.seq = seq; DN.idx = 0; DN.done = false;
    $('dnSeq').innerHTML = seq.map(function (d, i) { return '<span class="ar' + (i === 0 ? ' now' : '') + '">' + arrowSVG(d) + '</span>'; }).join('');
    DN.ev = [];
    for (k = 0; k < DN.n; k++) {
      if (DN.rem && DN.rem[k]) { DN.ev.push({ kind: 'none', trig: 9, fired: true }); continue; }
      var s = DN.skill[k], roll = Math.random(), pm = Math.max(.03, (1 - s) * .45), pp = s * .65, kind, trig;
      if (roll < pm) { kind = 'miss'; trig = .97; }
      else if (roll < pm + pp) { kind = 'perfect'; trig = .58 + Math.random() * .24; }
      else if (Math.random() < .5) { kind = 'good'; trig = .3 + Math.random() * .2; }
      else { kind = 'late'; trig = .87 + Math.random() * .09; }
      DN.ev.push({ kind: kind, trig: trig, fired: false });
    }
  }
  function roundClose() {
    if (DN.round < 0) return;
    if (!DN.done) { DN.done = true; award(0, 'miss'); fb('miss'); }
    DN.ev.forEach(function (ev, k) { if (!ev.fired) { ev.fired = true; award(k + 1, ev.kind); } });
  }
  function dnPress(dir) {
    if (DN.phase !== 'play' || DN.round < 0 || DN.done) return;
    var now = performance.now(), el = (now - DN.t0) / 1000; if (el < 0) return;
    var kids = $('dnSeq').children, i;
    if (dir === DN.seq[DN.idx]) {
      kids[DN.idx].className = 'ar ok'; DN.idx++; DN.pose = { dir: dir, until: now + 380 }; blip(500 + DN.idx * 70, .08, 'triangle', 0, .1);
      if (DN.idx >= DN.seq.length) {
        var p = (el - DN.round * ROUND_LEN) / ROUND_LEN, kind = p < ZONE0 ? 'good' : (p <= ZONE1 ? 'perfect' : 'late');
        DN.done = true; award(0, kind); fb(kind);
      } else kids[DN.idx].className = 'ar now';
    } else {
      blip(170, .14, 'sawtooth', 0, .1); DN.idx = 0;
      for (i = 0; i < kids.length; i++) kids[i].className = i === 0 ? 'ar now' : 'ar';
      var sq = $('dnSeq'); sq.classList.remove('shake'); void sq.offsetWidth; sq.classList.add('shake');
      DN.combo[0] = 0; $('dnCombo').textContent = '';
    }
  }
  window.addEventListener('keydown', function (e) {
    if (state !== 'mini' || DN.phase !== 'play') return;
    var dir = DKEY[e.code]; if (!dir) return; e.preventDefault(); if (e.repeat) return;
    dnPress(dir); var b = $('dnPad').querySelector('[data-dir="' + dir + '"]'); if (b) { b.classList.add('on'); setTimeout(function () { b.classList.remove('on'); }, 110); }
  });
  (function buildPad() {
    var pad = $('dnPad'), names = { left: 'Kiri', down: 'Bawah', up: 'Atas', right: 'Kanan' };
    ['left', 'down', 'up', 'right'].forEach(function (d) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-dir', d); b.setAttribute('aria-label', 'Panah ' + names[d]); b.innerHTML = arrowSVG(d, '#10233f');
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); dnPress(d); });
      pad.appendChild(b);
    });
  })();

  /* ----- alur pertandingan ----- */
  function pickStage() {
    var stagePos = (MPL.on && DZ.anchor) ? DZ.anchor : pos, stageYaw = (MPL.on && DZ.anchor) ? DZ.anchor.yaw : yaw;
    var offs = [0, .5, -.5, 1, -1, 1.5, -1.5, 2.1, -2.1, 2.8, 3.14], ds = [11, 9.5, 12.5, 14], pass, a, d, o, ang, fx, fz, sx, sz, ok, x, z;
    for (pass = 0; pass < 3; pass++) for (a = 0; a < offs.length; a++) for (d = 0; d < ds.length; d++) {
      ang = stageYaw + offs[a]; fx = -Math.sin(ang); fz = -Math.cos(ang); sx = stagePos.x + fx * ds[d]; sz = stagePos.z + fz * ds[d]; ok = true;
      for (o = -6; o <= 6 && ok; o += 3) {
        x = sx - fz * o; z = sz + fx * o;
        if (Math.abs(x) > HALF.x - 10 || Math.abs(z) > HALF.z - 10 || !spotFree(x, z)) ok = false;
        else if (riverDist(x, z) < RIVER_W / 2 + 3) ok = false;
        else if (pass === 0 && roadAt(x, z).d < 3) ok = false;
      }
      if (ok && pass === 1) { for (o = -6; o <= 6 && ok; o += 3) { x = sx - fz * o; z = sz + fx * o; if (roadAt(x, z).d < -1) ok = false; } }
      if (ok) return { ang: ang, fx: fx, fz: fz, sx: sx, sz: sz, d: ds[d] };
    }
    ang = stageYaw; fx = -Math.sin(ang); fz = -Math.cos(ang);
    return { ang: ang, fx: fx, fz: fz, sx: clamp(stagePos.x + fx * 10, -HALF.x + 10, HALF.x - 10), sz: clamp(stagePos.z + fz * 10, -HALF.z + 10, HALF.z - 10), d: 10 };
  }
  function danceBegin() {
    buildPlayerRig(); ensureStage(); acx();
    if (!CAM.v) CAM.v = { fp: new THREE.Vector3(), c: new THREE.Vector3(), look: new THREE.Vector3(), qf: new THREE.Quaternion(), qc: new THREE.Quaternion(), eu: new THREE.Euler(), cam: new THREE.PerspectiveCamera() };
    mgPhase = 'run'; $('mgame').hidden = true; $('hud').hidden = true;
    var st = pickStage(), i;
    /* hentikan skill kostum selama dansa */
    flying = false; jumpV = 0; playerY = 0; nosActive = false; if (motorOn) { motorOn = false; if (W.motor) W.motor.visible = false; }
    if (MPL.on && DZ.anchor) {
      st.ang = Number(DZ.anchor.yaw) || 0; st.fx = -Math.sin(st.ang); st.fz = -Math.cos(st.ang);
      st.sx = Number(DZ.anchor.x) || 0; st.sz = Number(DZ.anchor.z) || 0; st.d = 0;
      var colsS = 4, rowS = Math.floor(DZ.slot / colsS), colS = DZ.slot % colsS, rxS = -st.fz, rzS = st.fx;
      pos.x = st.sx + rxS * ((colS - 1.5) * 2.4) - st.fx * (rowS * 2.6);
      pos.z = st.sz + rzS * ((colS - 1.5) * 2.4) - st.fz * (rowS * 2.6);
      PV.init = false;
    }
    DN.fx = st.fx; DN.fz = st.fz; DN.sx = st.sx; DN.sz = st.sz; DN.dist = st.d; DN.yawT = st.ang; DN.faceCam = Math.atan2(-st.fx, -st.fz);
    var rx = -st.fz, rz = st.fx;
    DN.slot = [-4.5, -1.5, 1.5, 4.5].map(function (o) { return { x: st.sx + rx * o, z: st.sz + rz * o }; });
    var cand = []; for (i = 0; i < N; i++) if (!W.npc[i].fleeing) cand.push({ i: i, d: Math.hypot(pos.x - NPC[i].x, pos.z - NPC[i].z) });
    cand.sort(function (a, b) { return a.d - b.d; });
    var ch = cand.slice(0, 3).map(function (c) { return c.i; });
    ch.sort(function (a, b) { return ((NPC[a].x - pos.x) * rx + (NPC[a].z - pos.z) * rz) - ((NPC[b].x - pos.x) * rx + (NPC[b].z - pos.z) * rz); });
    DN.npcs = ch; DN.n = ch.length; DN.names = [playerName || 'Kamu']; DN.sc = [0, 0, 0, 0]; DN.combo = [0, 0, 0, 0]; DN.stat = { perfect: 0, good: 0, late: 0, miss: 0 };
    DN.round = -1; DN.seq = []; DN.ev = []; DN.pose = null; DN.rank = []; DN.winK = -1; DN.final = null; DN.el = 0; DN.t0 = 0; DN.cd = -1; DN.endShown = false;
    var base = [.5, .62, .74, .84][mgLvl - 1]; DN.skill = [Math.min(.95, base + .08), base, base - .08];
    DN.labels = []; DN.rname = []; DN.rem = [false, false, false]; MPL.rpid = []; MPL.remDone = [];
    if (MPL.on) { MPL.t0 = performance.now(); MPL.began = true; MPL.waitMsg = 0; MPL.all = Object.keys(WS.remote).map(function (k) { return { pid: k, name: WS.remote[k].n, score: 0, done: false }; }).sort(function (a, b) { return a.pid < b.pid ? -1 : 1; }); MPL.all.slice(0, 3).forEach(function (p, k) { DN.rname[k] = p.name; DN.rem[k] = true; MPL.rpid[k] = p.pid; MPL.remDone[k] = false; }); } else { MPL.all = []; }
    ch.forEach(function (ni, k) {
      var o = W.npc[ni], d = NPC[ni], sl = DN.slot[NPC_SLOTS[k]], dd;
      DN.names.push(DN.rname[k] || d.n);
      o.rig = { g: o.g, body: o.body, armL: o.armL, armR: o.armR, legL: o.body.children[0], legR: o.body.children[1], cur: null };
      o.dance = { k: k, mode: 'walk', tx: sl.x, tz: sl.z, sp: 8.5, t: 0, home: { x: d.x, z: d.z }, arrived: false, ret: false, lab: addLabel(DN.rname[k] || d.n, '#ffffff', k + 1) };
      dd = Math.hypot(d.x - sl.x, d.z - sl.z);
      if (dd > 26) { d.x = sl.x + (d.x - sl.x) / dd * 26; d.z = sl.z + (d.z - sl.z) / dd * 26; collide(d, .6, o.circle); npcPlace(o, d); }
      o.wander = null; o.walking = false; o.flee = null; o.mk.visible = false; o.dance.lab.visible = true;
    });
    DN.plLab = addLabel(DN.names[0], '#ffc42e', 0);
    DN.pp = { x: pos.x, z: pos.z, mode: 'wait', tx: 0, tz: 0, sp: 5.5, face: DN.faceCam + Math.PI, arrived: false };
    PR.g.position.set(pos.x, 0, pos.z); PR.g.rotation.y = DN.faceCam + Math.PI; rigReset(PR); PR.g.visible = false;
    DN.floor.position.set(st.sx, .05, st.sz); DN.floor.rotation.y = DN.faceCam; DN.floor.visible = true;
    DN.beams.forEach(function (b, k) { b.position.x = DN.slot[k].x; b.position.z = DN.slot[k].z; b.visible = true; });
    ['dnTop', 'dnBoard', 'dnMain', 'dnPad', 'dnMute'].forEach(function (id) { $(id).hidden = true; });
    $('dnCount').hidden = true; $('dance').hidden = false; $('dnClock').textContent = fmt(SONG_LEN * 1000); $('dnBar').style.width = '0%'; $('dnCombo').textContent = ''; $('dnFb').className = 'dn-fb';
    boardRender(); setPhase('gather');
  }
  function setPhase(p) {
    DN.phase = p; DN.pt = 0;
    if (p === 'gather') { banner('Ada ' + DN.n + ' teman datang menantangmu berdansa!'); beep(523, .1, 'triangle'); beep(784, .15, 'triangle', .1); }
    else if (p === 'cam3') {
      banner('Kamera pindah! Bersiap berbaris bersama mereka.'); CAM.mode = 'to3'; CAM.t = 0; PR.g.position.set(pos.x, 0, pos.z); PR.g.visible = true; DN.plLab.visible = true;
    } else if (p === 'walkin') {
      if (MPL.on && DZ.anchor) { banner('Barisan dansa siap!'); DN.pp.mode = 'idle'; DN.pp.tx = DN.pp.x; DN.pp.tz = DN.pp.z; DN.pp.arrived = true; DN.pp.face = DN.faceCam; }
      else { banner('Ayo berbaris sejajar dengan mereka!'); DN.pp.mode = 'walk'; DN.pp.tx = DN.slot[1].x; DN.pp.tz = DN.slot[1].z; DN.pp.arrived = false; DN.pp.face = DN.faceCam; }
    }
    else if (p === 'turn') { banner(null); }
    else if (p === 'count') {
      DN.cd = -1; ['dnTop', 'dnBoard', 'dnMute', 'dnPad'].forEach(function (id) { $(id).hidden = false; });
      $('dnCount').hidden = false; $('dnCount').textContent = '3';
    } else if (p === 'play') {
      $('dnCount').textContent = 'DANSA!'; DN.cdHide = 1.1; $('dnMain').hidden = false; songStart();
    } else if (p === 'end') {
      mpFinal(); songStop(); ['dnTop', 'dnBoard', 'dnMain', 'dnPad', 'dnMute'].forEach(function (id) { $(id).hidden = true; });
DN.final = entries(); DN.winK = DN.final[0].k;
      $('dnCount').hidden = false; $('dnCount').textContent = DN.winK === 0 ? 'JUARA!' : 'SELESAI!';
      beep(523, .15, 'triangle'); beep(659, .15, 'triangle', .14); beep(784, .15, 'triangle', .28); beep(1047, .3, 'triangle', .42);
    } else if (p === 'back') {
      $('dnCount').hidden = true; DN.beams.forEach(function (b) { b.visible = false; });
      DN.npcs.forEach(function (ni) { var D = W.npc[ni].dance; if (D) { D.mode = 'walk'; D.tx = D.home.x; D.tz = D.home.z; D.ret = true; D.t = 0; D.arrived = false; D.sp = 8.5; } });
      DN.pp.mode = 'walk'; DN.pp.tx = pos.x; DN.pp.tz = pos.z; DN.pp.sp = 6; DN.pp.arrived = false; DN.pp.face = DN.faceCam + Math.PI;
    } else if (p === 'cam1') { CAM.mode = 'to1'; CAM.t = 0; DN.plLab.visible = false; DN.floor.visible = false; }
  }
  function showMatchResult() {
    var en = DN.final || entries(), me = 0, i;
    for (i = 0; i < en.length; i++) if (en[i].k === 0) me = i;
    var got = [3, 2, 1, 0][Math.min(3, me)]; mgStarsGot = got; mgPhase = 'done';
    var msg = me === 0 ? 'Juara 1! Kamu rajanya dansa!' : (me === 1 ? 'Hebat, juara 2!' : (me === 2 ? 'Bagus, juara 3!' : 'Tidak apa-apa, coba lagi nanti!'));
    var rows = en.map(function (e, r) { return { e: e, r: r }; }).slice(0, 8); if (me >= 8) rows.push({ e: en[me], r: me });
    $('mgTitle').textContent = 'Hasil Pertandingan Dansa'; $('mgSub').textContent = DN.names[0] + ' melawan ' + (en.length - 1) + ' lawan';
    $('mgBody').innerHTML = '<p class="mgtxt"><strong>' + msg + '</strong> Skormu ' + DN.sc[0] + ', peringkat ' + (me + 1) + ' dari ' + en.length + '.</p>' +
      '<ul class="list">' + rows.map(function (o) {
        return '<li class="' + (o.e.k === 0 ? 'done' : '') + '"><span class="who"><b>' + (MEDAL[o.r] || (o.r + 1)) + ' ' + esc(o.e.n) + '</b><span>Peringkat ' + (o.r + 1) + '</span></span><span class="p">' + o.e.s + '</span></li>';
      }).join('') + '</ul>' +
      '<p class="hint">Sempurna: ' + DN.stat.perfect + ' · Terlalu cepat: ' + DN.stat.good + ' · Telat: ' + DN.stat.late + ' · Meleset: ' + DN.stat.miss + '</p>' +
      '<div class="mgres">Kamu mendapat <strong>' + got + ' bintang</strong> bonus.</div>';
    $('mgGo').textContent = 'Lanjut Petualangan'; $('mgGo').hidden = false; $('mgGo').disabled = false; $('mgSkip').hidden = true; $('dance').hidden = true;
    $('mgame').hidden = false; $('mgame').scrollTop = 0; $('mgcard').focus();
  }
  function finishDance() {
    if (DZ.home) { pos.x = DZ.home.x; pos.z = DZ.home.z; yaw = DZ.home.yaw; PV.init = false; DZ.home = null; DZ.anchor = null; DZ.roster = []; DZ.startAt = 0; }
    mpStop();
    DN.phase = 'off'; $('dance').hidden = true; if (PR) PR.g.visible = false; if (DN.floor) DN.floor.visible = false;
    DN.labels.forEach(function (l) { scene.remove(l.sp); l.tex.dispose(); l.sp.material.dispose(); }); DN.labels = [];
    $('hud').hidden = false; mgFinish(mgStarsGot);
  }
  function danceUpdate(dt, t) {
    var ph = DN.phase; if (ph === 'off' || ph === 'intro') return;
    DN.pt += dt;
    var i, allNpc = true, bp = t * 2, el = 0;
    DN.npcs.forEach(function (ni) { var D = W.npc[ni].dance; if (D && !(D.arrived && !D.ret)) allNpc = false; });
    if (ph === 'gather') {
      yaw += Math.atan2(Math.sin(DN.yawT - yaw), Math.cos(DN.yawT - yaw)) * Math.min(1, dt * 3); pitch += (0 - pitch) * Math.min(1, dt * 3);
      if ((allNpc && DN.pt > 1) || DN.pt > 12) setPhase('cam3');
    } else if (ph === 'cam3') { if (CAM.mode === '3p') setPhase('walkin'); }
    else if (ph === 'walkin') { if (DN.pp.arrived) setPhase('turn'); }
    else if (ph === 'turn') { if (DN.pt > .8) setPhase('count'); }
    else if (ph === 'count') {
      var n = 3 - Math.floor(DN.pt); if (DN.pt < 3 && n !== DN.cd) { DN.cd = n; $('dnCount').textContent = String(n); blip(440, .12, 'triangle', 0, .15); }
      if (DN.pt >= 3) setPhase('play');
    } else if (ph === 'play') {
      if (DN.cdHide > 0) { DN.cdHide -= dt; if (DN.cdHide <= 0) $('dnCount').hidden = true; }
      el = (performance.now() - DN.t0) / 1000; DN.el = Math.max(0, el); bp = DN.el * 2;
      if (el >= 0) {
        if (el >= SONG_LEN) { roundClose(); setPhase('end'); }
        else {
          var r = Math.min(N_ROUND - 1, Math.floor(el / ROUND_LEN));
          if (r !== DN.round) { roundClose(); roundStart(r); }
          var p = (el - r * ROUND_LEN) / ROUND_LEN, hot = p >= ZONE0 && p <= ZONE1;
          $('dnMk').style.left = (p * 100) + '%'; if (hot !== DN.hot) { DN.hot = hot; $('dnZone').classList.toggle('hot', hot); }
          DN.ev.forEach(function (ev, k) { if (!ev.fired && p >= ev.trig) { ev.fired = true; award(k + 1, ev.kind); } });
          var ck = fmt((SONG_LEN - el) * 1000); if ($('dnClock').textContent !== ck) $('dnClock').textContent = ck;
          $('dnBar').style.width = (el / SONG_LEN * 100) + '%';
        }
      }
    } else if (ph === 'end') {
      if (MPL.on) {
        if (DN.pt > 2.2 && !DN.endShown) {
          if (!mpAllDone() && DN.pt < 16) { if (!MPL.waitMsg) { MPL.waitMsg = 1; banner('Menunggu pemain lain selesai\u2026'); } }
          else { DN.endShown = true; banner(null); mpCalcOrder(); showMatchResult(); }
        }
      } else if (DN.pt > 2.2 && !DN.endShown) { DN.endShown = true; showMatchResult(); }
    } else if (ph === 'back') {
      var home = true; DN.npcs.forEach(function (ni) { if (W.npc[ni].dance) home = false; });
      if ((home && DN.pp.arrived && DN.pt > .6) || DN.pt > 14) { DN.npcs.forEach(function (ni) { var o = W.npc[ni]; if (o.dance) npcFinish(o, NPC[ni]); }); setPhase('cam1'); }
    } else if (ph === 'cam1') { if (CAM.mode === 'fp') finishDance(); return; }

    /* gerak lantai panggung & lampu */
    if (DN.floor && DN.floor.visible) {
      var pulse = ph === 'play' ? Math.pow(1 - (DN.el * 2) % 1, 2) : .3, v = .62 + .38 * pulse; DN.floor.material.color.setRGB(v, v, v);
    }
    if (DN.beams) DN.beams.forEach(function (b, k) { if (b.visible) b.material.color.setHSL((t * .12 + k * .25) % 1, .9, .6); });

    /* avatar pemain */
    var P = DN.pp;
    if (PR && PR.g.visible) {
      var tg;
      if (P.mode === 'walk') {
        var dx = P.tx - P.x, dz = P.tz - P.z, dd = Math.hypot(dx, dz);
        if (dd < .1 || DN.pt > 12) { P.x = P.tx; P.z = P.tz; P.mode = 'idle'; P.arrived = true; }
        else { var s2 = Math.min(dd, P.sp * dt); P.x += dx / dd * s2; P.z += dz / dd * s2; turn(PR.g, Math.atan2(dx, dz), dt * 10); }
        tg = walkTarget(t, 0);
      } else {
        turn(PR.g, P.face, dt * 7);
        if (ph === 'play' && DN.pose && performance.now() < DN.pose.until) tg = danceTarget(DN.pose.dir, bp);
        else if (ph === 'end' && DN.winK === 0) tg = danceTarget(Math.floor(bp) % 2 ? 'up' : 'idle', bp);
        else tg = danceTarget('idle', bp);
      }
      PR.g.position.set(P.x, 0, P.z); rigPose(PR, tg, dt);
      DN.plLab.position.set(P.x, 2.55, P.z);
    }

    /* teman-teman */
    DN.npcs.forEach(function (ni) { var o = W.npc[ni]; if (o.dance) npcDance(ni, o, NPC[ni], dt, t, bp); });
  }
  function npcFinish(o, d) {
    var D = o.dance; d.x = D.home.x; d.z = D.home.z; npcPlace(o, d); rigReset(o.rig); o.body.position.y = 0; o.rig = null;
    D.lab.visible = false; o.dance = null; o.home = { x: d.x, z: d.z }; o.wander = null; o.walking = false;
  }
  function npcDance(ni, o, d, dt, t, bp) {
    var D = o.dance, ph = DN.phase, tg;
    if (D.mode === 'walk') {
      var dx = D.tx - d.x, dz = D.tz - d.z, dd = Math.hypot(dx, dz); D.t += dt;
      if (dd < .1 || D.t > 11) {
        if (D.ret) { npcFinish(o, d); return; }
        d.x = D.tx; d.z = D.tz; npcPlace(o, d); D.mode = 'idle'; D.arrived = true;
      } else {
        var st = Math.min(dd, D.sp * dt); d.x += dx / dd * st; d.z += dz / dd * st; if (dd > 1.5) collide(d, .6, o.circle); npcPlace(o, d);
        turn(o.g, Math.atan2(dx, dz), dt * 10); rigPose(o.rig, walkTarget(t, ni), dt); D.lab.position.set(d.x, 2.55, d.z); return;
      }
    }
    turn(o.g, DN.faceCam, dt * 8);
    if (ph === 'play' && DN.seq.length) {
      var ev = DN.ev[D.k];
      if (ev && ev.fired && ev.kind === 'miss') tg = danceTarget('idle', bp);
      else tg = danceTarget(DN.seq[(Math.floor(bp) + D.k) % DN.seq.length], bp);
    } else if (ph === 'end' && DN.winK === D.k + 1) tg = danceTarget(Math.floor(bp) % 2 ? 'up' : 'idle', bp);
    else tg = danceTarget('idle', bp + D.k * .25);
    rigPose(o.rig, tg, dt); D.lab.position.set(d.x, 2.55, d.z);
  }

  /* ----- dansa bersama + dunia bersama (Apps Script, polling cepat ~1 detik) ----- */
  var MPL = { on: false, pid: '', began: false, seed: 1, all: [], rpid: [], remDone: [], waitMsg: 0, t0: 0 };
  var DZ = { handled: '', cur: '', forced: false, anchor: null, roster: [], home: null, slot: 0, startAt: 0 };
  /* dansa bersama: semua pemain memakai titik panggung yang sama (x, z, yaw dari node dance) & berbaris dalam grid */
  function dzSetup(dz) {
    DZ.anchor = null; DZ.home = null; DZ.roster = []; DZ.slot = 0; DZ.startAt = 0;
    if (!FB.on || !dz || typeof dz.x !== 'number' || typeof dz.z !== 'number') return;
    DZ.home = { x: pos.x, z: pos.z, yaw: yaw };
    DZ.anchor = { x: Number(dz.x) || 0, z: Number(dz.z) || 0, yaw: Number(dz.yaw) || 0 };
    DZ.startAt = Number(dz.at || ST()) + 15000;
    var roster = Object.keys(WS.remote || {});
    if (MPL.pid && roster.indexOf(MPL.pid) < 0) roster.push(MPL.pid);
    roster.sort(); DZ.roster = roster; DZ.slot = Math.max(0, roster.indexOf(MPL.pid));
  }
  var WORLD_ROOM = 'DUNIA';          // semua yang online berkumpul di satu dunia. Kosongkan ('') untuk memisahkan per kelas.
  function mpUrl() { return CFG.APPS_SCRIPT_URL && CFG.APPS_SCRIPT_URL.indexOf('PASTE') < 0 ? CFG.APPS_SCRIPT_URL : ''; }
  function mpClean(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); }
  function wsRoom() { var c = WORLD_ROOM || ('W' + mpClean(kelas)); while (c.length < 3) c += 'X'; return c.slice(0, 8); }
  function api(action, extra) {
    if (!MPL.pid) MPL.pid = (sid || 's') + '-' + Math.random().toString(36).slice(2, 7);
    var body = { token: CFG.TOKEN, action: action, room: wsRoom(), pid: MPL.pid, name: playerName || 'Pemain' }, k;
    for (k in (extra || {})) body[k] = extra[k];
    var ctl = ('AbortController' in window) ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 9000), t0 = Date.now();
    return fetch(mpUrl(), { method: 'POST', body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) { clearTimeout(to); if (j) { j._t0 = t0; j._t1 = Date.now(); } return j; }, function (e) { clearTimeout(to); throw e; });
  }
  /* jam bersama: semua pemain memakai waktu server yang sama */
  function srvSync(j) {
    if (!j.now || !j._t0) return;
    if (j._t1 - j._t0 > 2500) return;
    var off = j.now - (j._t0 + j._t1) / 2;
    if (!SRV.ok || Math.abs(off - SRV.off) > 4000) { SRV.off = off; SRV.ok = true; } else SRV.off += (off - SRV.off) * .1;
  }
  function mpStop() { MPL.on = false; MPL.began = false; MPL.waitMsg = 0; MPL.all = []; DZ.cur = ''; }
  function entries() {
    var e = [], i;
    for (i = 0; i <= DN.n; i++) e.push({ k: i, n: DN.names[i], s: DN.sc[i] });
    (MPL.on ? MPL.all.slice(DN.n) : []).forEach(function (p, j) { e.push({ k: 10 + j, n: p.name, s: p.score }); });
    e.sort(function (a, b) { return b.s - a.s || a.k - b.k; });
    return e;
  }
  function mpAllDone() { return MPL.all.every(function (p) { return p.done; }); }
  function mpCalcOrder() { DN.final = entries(); DN.winK = DN.final[0].k; $('dnCount').textContent = DN.winK === 0 ? 'JUARA!' : 'SELESAI!'; }
  function mpFinal() { if (MPL.on) { if (FB.on) fbSend(true); else wsTick(); } }
  function dzScores(ds) {
    if (!MPL.on || !MPL.began) return;
    var now = ST(), waited = performance.now() - MPL.t0;
    MPL.all.forEach(function (p, idx) {
      var q = null; ds.forEach(function (x) { if (x.pid === p.pid) q = x; });
      if (q) { p.score = Math.max(p.score, q.s); p.done = !!q.dn || (!FB.on && now - q.t > 15000); }
      else p.done = waited > 14000;
      if (idx < DN.n) { DN.sc[idx + 1] = p.score; MPL.remDone[idx] = p.done; }
    });
    boardRender();
  }
  function forceCloseUI() {
    if (!$('dialog').hidden && qLocked && !lastOk && cur >= 0) startFlee(cur);
    ['dialog', 'peta', 'naik', 'daftar', 'konfirm', 'shop'].forEach(function (id) { $(id).hidden = true; });
    if (ride) endRide();
    $('toast').hidden = true; $('prompt').hidden = true; releaseLock();
  }
  /* seseorang menekan "Ayo Dansa!": semua pemain online langsung ditarik ke pertandingan */
  function dzCheck(dz) {
    if (!dz || !dz.id || dz.id === DZ.handled) return;
    DZ.handled = dz.id;
    if (ST() - dz.at > 25000 || !inGame || finished || !W.ready) return;
    var ok = (state === 'play' || state === 'dialog' || state === 'list' || state === 'peta' || state === 'naik' || state === 'confirm' || state === 'ride' || (state === 'mini' && mgPhase === 'ready'));
    if (!ok) return;
    DZ.cur = dz.id; MPL.seed = dz.seed; MPL.on = true; dzSetup(dz);
    if (state === 'mini') { danceBegin(); return; }
    forceCloseUI();
    DZ.forced = true; setState('mini'); mgPhase = 'ready'; DN.phase = 'intro'; mgLvl = Math.min(mg + 1, 4); mgStarsGot = 0;
    mgCb = function () { if (done === N) showResults(); else backToPlay(); };
    danceBegin();
  }
  function startShared() {
    var btn = $('mgGo'); btn.disabled = true;
    function go(dz) {
      btn.disabled = false;
      if (mgPhase !== 'ready') return;
      if (dz) { DZ.handled = dz.id; DZ.cur = dz.id; MPL.seed = dz.seed; MPL.on = true; dzSetup(dz); } else { MPL.on = false; DZ.cur = ''; }
      danceBegin();
    }
    if (!WS.on) { go(null); return; }
    if (FB.on) { fbGo(go); return; }
    api('dansaGo', {}).then(function (j) { go(j && j.ok && j.dz && !j.busy ? j.dz : null); }, function () { go(null); });
  }

  /* ----- dunia bersama: semua pemain online tampil di peta (lewat Apps Script) ----- */
  var WS = { on: false, timer: null, busy: false, fails: 0, remote: {}, count: 0, geo: null, mats: {}, lastErr: '' };
  var PV = { vx: 0, vz: 0, lx: 0, lz: 0, init: false };
  function pvStep(dt) {
    if (!PV.init) { PV.lx = pos.x; PV.lz = pos.z; PV.init = true; return; }
    if (dt <= 0) return;
    var vx = (pos.x - PV.lx) / dt, vz = (pos.z - PV.lz) / dt, sp = Math.hypot(vx, vz), k = Math.min(1, dt * 6);
    if (sp > 14) { vx *= 14 / sp; vz *= 14 / sp; }
    PV.vx += (vx - PV.vx) * k; PV.vz += (vz - PV.vz) * k; PV.lx = pos.x; PV.lz = pos.z;
  }
  function wsStart() {
    if (WS.on) return;
    if (fbReady() && fbStart()) return;          // mode realtime Firebase
    if (!mpUrl()) return;
    WS.on = true; WS.fails = 0; wsLoop();        // cadangan: polling Apps Script
  }
  function wsStop() {
    if (FB.on) fbStop();
    clearTimeout(WS.timer); WS.timer = null; WS.on = false; WS.busy = false;
    Object.keys(WS.remote).forEach(function (k) { wsDrop(k); }); wsPanel();
  }
  function wsLoop() {
    if (!WS.on) return;
    wsTick().then(function () {
      if (!WS.on) return;
      clearTimeout(WS.timer); WS.timer = setTimeout(wsLoop, WS.fails > 2 ? 3000 : (WS.count > 1 ? 1000 : 2500));
    });
  }
  function wsTick() {
    if (!WS.on || WS.busy) return Promise.resolve();
    WS.busy = true;
    var me = ride ? { x: ride.cx, z: ride.cz } : pos, fin = MPL.on && MPL.began && (DN.phase === 'end' || DN.phase === 'back' || DN.phase === 'cam1');
    return api('dansaWorld', {
      x: me.x, z: me.z, yaw: yaw, m: moving ? 1 : 0, r: ride ? 1 : 0, done: done, vx: ride ? 0 : PV.vx, vz: ride ? 0 : PV.vz,
      dz: MPL.on ? DZ.cur : '', sc: (MPL.on && MPL.began) ? DN.sc[0] : 0, dd: fin ? 1 : 0
    }).then(function (j) {
      WS.busy = false; if (!WS.on) return;
      if (!j || !j.ok) { WS.fails++; WS.lastErr = String(j && (j.err || j.error) || ''); wsPanel(); return; }
      WS.fails = 0; WS.count = j.count || 0; srvSync(j); wsApply(j.players || []); nfApply(j.nf || {});
      if (j.ds) dzScores(j.ds);
      if (j.dz) dzCheck(j.dz);
      wsPanel();
    }, function () { WS.busy = false; WS.fails++; wsPanel(); });
  }
  /* status NPC kabur: server adalah sumber kebenaran, semua pemain melihat hal yang sama */
  function nfApply(nf) {
    var now = ST(), i, s, d, l;
    for (i = 0; i < N; i++) {
      s = nf[i]; d = NPC[i]; l = d.fl;
      if (s) { if (!l || s.fa >= l.fa) d.fl = s; }
      else if (l && now - l.fa > 8000) d.fl = null;
    }
  }
  function wsFlee(i, fl) {
    if (FB.on) { fbFlee(i, fl); return; }
    if (!WS.on) return;
    api('dansaFlee', { i: i, fl: fl }).then(function (j) {
      if (!j || !j.ok) return;
      if (j.busy && j.nf && j.nf[i]) NPC[i].fl = j.nf[i];
      if (j.nf) nfApply(j.nf);
    }, function () { });
  }

  function wsMakeMotor() {
    var g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(.8, .55, 1.8), new THREE.MeshLambertMaterial({ color: 0xffc42e })), seat = new THREE.Mesh(new THREE.BoxGeometry(.55, .2, .65), new THREE.MeshLambertMaterial({ color: 0x222831})), w1 = new THREE.Mesh(new THREE.CylinderGeometry(.32, .32, .18, 12), new THREE.MeshLambertMaterial({ color: 0x222831 })), w2 = w1.clone();
    w1.rotation.z = w2.rotation.z = Math.PI / 2; w1.position.set(0, .32, .62); w2.position.set(0, .32, -.65); body.position.y = .72; seat.position.set(0, 1.08, -.15);
    var flame = new THREE.Mesh(new THREE.ConeGeometry(.22, .9, 8), new THREE.MeshBasicMaterial({ color: 0x25c9ff, transparent: true, opacity: .9 })); flame.rotation.x = -Math.PI / 2; flame.position.set(0, .55, 1.25); flame.visible = false; flame.name = 'nosFlame';
    g.add(body, seat, w1, w2, flame); g.visible = false; scene.add(g); return g;
  }
  function wsApplyCostume(r, costume) {
    if (!r || r.costume === (costume || '')) return;
    var colors = { tracker: 0x2a68dc, jumper: 0x14a06e, rider: 0xffc42e, fire: 0xe0434a, flyer: 0x9c72e8 };
    if (r.baseShirt === undefined && r.shirt && r.shirt.color) r.baseShirt = r.shirt.color.getHex();
    if (r.shirt && r.shirt.color) r.shirt.color.setHex(colors[costume] || r.baseShirt || 0x2a8fd0);
    r.costume = costume || '';
  }
  function wsAbilityUpdate(r, p) {
    if (!r || !p) return;
    r.fly = !!p.fl; r.motorOn = !!p.mo; r.nos = !!p.ns; r.py = Number(p.py) || 0;
    if (r.motorOn && !r.motor) r.motor = wsMakeMotor();
    if (r.motor) { var nf = r.motor.getObjectByName('nosFlame'); if (nf) nf.visible = r.motorOn && r.nos; }
    if (p.fe && p.fe !== r.lastFire) {
      var first = (r.lastFire === undefined); r.lastFire = p.fe;
      if (!first && W.ready) {
        var fox = Number(p.fx) || p.x, foy = Number(p.fy) || 1.2, foz = Number(p.fz) || p.z, fdx = Number(p.fdx) || 0, fdz = Number(p.fdz) || -1, ftr = tgTrace(fox, foy, foz, fdx, fdz);
        var fwait = syncFireball(fox, foy, foz, fdx, fdz, ftr) || .1;
        if (!ftr.t) ANIM.push(function (dt) { fwait -= dt; if (fwait > 0) return true; fxBurn(ftr.x, ftr.z, 2.6, 2.6, 1.6, 4.5); return false; });
      }
    } else if (r.lastFire === undefined) r.lastFire = p.fe || 0;
  }
  function wsMake(p) {
    if (!WS.geo) WS.geo = { leg: new THREE.BoxGeometry(.24, .72, .26), torso: new THREE.CylinderGeometry(.34, .38, .85, 12), arm: new THREE.BoxGeometry(.17, .72, .19).translate(0, -.36, 0), head: new THREE.SphereGeometry(.27, 14, 12), eye: new THREE.SphereGeometry(.034, 6, 6), cap: new THREE.SphereGeometry(.295, 14, 8, 0, 6.283, 0, 1.75), sh: new THREE.CircleGeometry(.6, 14).rotateX(-Math.PI / 2) };
    var G = WS.geo, h = 0, i; for (i = 0; i < p.pid.length; i++) h = (h * 31 + p.pid.charCodeAt(i)) >>> 0;
    var cols = [0x2a8fd0, 0xe0763a, 0x7a3b5e, 0x14a06e, 0xd6538a, 0xc98a2a, 0x1f6f8b, 0x6a5acd], skins = [0xe0ac84, 0xf1c7a0, 0xc68a5e], col = cols[h % cols.length], skin = skins[(h >> 3) % skins.length];
    var shirt = lam(col), pants = lam(0x24344f), hair = lam(0x1c1c1c), sk = lam(skin);
    var g = new THREE.Group(), body = new THREE.Group();
    var legL = new THREE.Mesh(G.leg, pants), legR = new THREE.Mesh(G.leg, pants); legL.position.set(-.14, .36, 0); legR.position.set(.14, .36, 0);
    var torso = new THREE.Mesh(G.torso, shirt); torso.position.y = 1.12;
    var armL = new THREE.Mesh(G.arm, shirt), armR = new THREE.Mesh(G.arm, shirt); armL.position.set(-.47, 1.46, 0); armR.position.set(.47, 1.46, 0);
    var head = new THREE.Mesh(G.head, sk); head.position.y = 1.76;
    var ebm = WS.mats.eye || (WS.mats.eye = new THREE.MeshBasicMaterial({ color: 0x10233f })), e1 = new THREE.Mesh(G.eye, ebm), e2 = new THREE.Mesh(G.eye, ebm); e1.position.set(-.09, 1.8, .245); e2.position.set(.09, 1.8, .245);
    var cap = new THREE.Mesh(G.cap, hair); cap.position.y = 1.77;
    var shd = new THREE.Mesh(G.sh, WS.mats.sh || (WS.mats.sh = new THREE.MeshBasicMaterial({ color: 0x1e3a20, transparent: true, opacity: .3, depthWrite: false }))); shd.position.y = .045;
    body.add(legL, legR, torso, armL, armR, head, e1, e2, cap); g.add(body, shd); g.userData.keep = true;
    var tex = textTex(p.n, 512, 100, '#ffffff', '#10233f'), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthTest: false })); sp.scale.set(2.7, .53, 1); sp.position.y = 2.55; sp.renderOrder = 9; g.add(sp);
    g.position.set(p.x, 0, p.z); scene.add(g);
    return { g: g, legL: legL, legR: legR, armL: armL, armR: armR, sp: sp, tex: tex, mats: [shirt, pants, hair, sk], shirt: shirt, costume: '', py: 0, cy: 0, ph: Math.random() * 6 };
  }
  function wsDrop(pid) {
    var r = WS.remote[pid]; if (!r) return; scene.remove(r.g); if (r.motor) { scene.remove(r.motor); } r.tex.dispose(); r.sp.material.dispose(); r.mats.forEach(function (m) { m.dispose(); }); delete WS.remote[pid];
  }
  function wsApply(list) {
    var seen = {};
    list.forEach(function (p) {
      if (!p || !p.pid || p.pid === MPL.pid) return; seen[p.pid] = 1;
      var r = WS.remote[p.pid];
      if (r && r.n !== p.n) { wsDrop(p.pid); r = null; }
      if (!r) { r = WS.remote[p.pid] = wsMake(p); r.n = p.n; r.x = p.x; r.z = p.z; r.yaw = p.y; }
      r.sx = p.x; r.sz = p.z; r.vx = p.m ? (p.vx || 0) : 0; r.vz = p.m ? (p.vz || 0) : 0; r.st = p.t;
      r.ty = p.y; r.m = !!p.m; r.rd = !!p.r; r.d = p.d;
    });
    Object.keys(WS.remote).forEach(function (k) { if (!seen[k]) wsDrop(k); });
  }
  function wsUpdate(dt, t) {
    var k, r, age, px, pz, da, vis, dist, mv, kk, ox, oz, sw;
    for (k in WS.remote) {
      r = WS.remote[k]; age = clamp((ST() - r.st) / 1000, 0, 2.2);
      px = r.sx + r.vx * age; pz = r.sz + r.vz * age;
      kk = Math.min(1, dt * 9); ox = r.x; oz = r.z; r.x += (px - r.x) * kk; r.z += (pz - r.z) * kk;
      da = r.ty - r.yaw; da = Math.atan2(Math.sin(da), Math.cos(da)); r.yaw += da * Math.min(1, dt * 8);
      mv = Math.hypot(r.x - ox, r.z - oz) / Math.max(dt, .001) > .6;
      dist = Math.hypot(r.x - pos.x, r.z - pos.z);
      vis = !r.rd && (state !== 'mini' || (MPL.on && !!DZ.cur)) && dist < 240 * VIEWK;
      r.g.visible = vis; if (!vis) continue;
      var ty = r.fly ? Math.max(2, r.py) : Math.max(0, r.py); r.cy += (ty - r.cy) * Math.min(1, dt * 12);
      r.g.position.set(r.x, r.cy, r.z); r.g.rotation.y = r.yaw;
      if (r.motor) { r.motor.visible = r.motorOn; if (r.motorOn) { r.motor.position.set(r.x, r.cy, r.z); r.motor.rotation.y = r.yaw; } }
      r.sp.visible = dist < 70;
      if (mv) { sw = Math.sin(t * 9 + r.ph) * .7; r.legL.rotation.x = sw; r.legR.rotation.x = -sw; r.armL.rotation.x = -sw * .8; r.armR.rotation.x = sw * .8; }
      else { r.legL.rotation.x *= .8; r.legR.rotation.x *= .8; r.armL.rotation.x *= .8; r.armR.rotation.x *= .8; }
    }
  }
  /* ----- mode Firebase: realtime sungguhan (listener WebSocket). Aktif kalau CFG.FIREBASE_DB_URL diisi ----- */
  var FB = { on: false, db: null, base: null, me: null, conn: false, sig: '', last: 0, timer: null, tick: 0, pl: {}, refs: [], prev: null, err: 0 };
  function fbUrl() { var u = CFG.FIREBASE_DB_URL; return u && String(u).indexOf('PASTE') < 0 ? String(u).trim() : ''; }
  function fbReady() { return !!(fbUrl() && window.firebase && firebase.database); }
  function r1(v) { return Math.round(v * 10) / 10; }
  /* aturan Firebase membatasi nama maksimal 24 huruf, sedangkan kolom nama boleh 40 huruf */
  function netName() {
    var w = String(playerName || 'Pemain').trim().replace(/\s+/g, ' ').split(' '), out = w[0], i, nx;
    for (i = 1; i < w.length; i++) { nx = out + ' ' + w[i]; if (nx.length <= 24) out = nx; else if ((out + ' ' + w[i].charAt(0) + '.').length <= 24) out += ' ' + w[i].charAt(0) + '.'; }
    return out.slice(0, 24) || 'Pemain';
  }
  function fbCount() { var n = Object.keys(FB.pl).length; WS.count = FB.pl[MPL.pid] ? n : n + 1; }
  function fbListen(ref, ev, fn) { ref.on(ev, fn); FB.refs.push([ref, ev, fn]); }
  function wsPut(pid, p) {
    if (!p || pid === MPL.pid || typeof p.x !== 'number') return;
    var r = WS.remote[pid];
    if (r && r.n !== p.n) { wsDrop(pid); r = null; }
    if (!r) { r = WS.remote[pid] = wsMake({ pid: pid, n: p.n, x: p.x, z: p.z }); r.n = p.n; r.x = p.x; r.z = p.z; r.yaw = p.y || 0; }
    wsApplyCostume(r, p.c || ''); wsAbilityUpdate(r, p); r.sx = p.x; r.sz = p.z; r.vx = p.m ? (p.vx || 0) : 0; r.vz = p.m ? (p.vz || 0) : 0; r.st = p.t || ST();
    r.ty = p.y || 0; r.m = !!p.m; r.rd = !!p.r; r.d = p.d || 0;
  }
  function fbStart() {
    if (FB.on) return true;
    try {
      if (!firebase.apps.length) firebase.initializeApp({ databaseURL: fbUrl() });
      FB.db = firebase.database(); FB.db.goOnline();
    } catch (e) { if (window.console) console.error(e); FB.db = null; return false; }
    if (!MPL.pid) MPL.pid = (sid || 's') + '-' + Math.random().toString(36).slice(2, 7);
    FB.base = FB.db.ref('kranggan/' + wsRoom()); FB.me = FB.base.child('players/' + MPL.pid);
    FB.on = true; WS.on = true; WS.fails = 0; FB.pl = {}; FB.sig = ''; FB.conn = false;
    fbListen(FB.db.ref('.info/serverTimeOffset'), 'value', function (s) { SRV.off = +s.val() || 0; SRV.ok = true; });
    fbListen(FB.db.ref('.info/connected'), 'value', function (s) {
      FB.conn = !!s.val(); WS.fails = FB.conn ? 0 : 3;
      if (FB.conn) { FB.prev = null; FB.me.onDisconnect().remove(); fbSend(true); }
      wsPanel();
    });
    var pl = FB.base.child('players'), put = function (s) { FB.pl[s.key] = s.val(); wsPut(s.key, s.val()); fbCount(); wsPanel(); };
    fbListen(pl, 'child_added', put); fbListen(pl, 'child_changed', put);
    fbListen(pl, 'child_removed', function (s) { delete FB.pl[s.key]; wsDrop(s.key); fbCount(); wsPanel(); });
    fbListen(FB.base.child('npcs'), 'value', function (s) { nfApply(s.val() || {}); });
    fbListen(FB.base.child('dance'), 'value', function (s) { var dz = s.val(); if (dz && dz.id) dzCheck(dz); });
    fbListen(FB.base.child('boom'), 'child_added', function (s) { tgRemote(s.key, s.val()); });
    FB.timer = setInterval(function () { fbSend(false); if ((++FB.tick) % 2 === 0) fbScores(); }, 250);
    return true;
  }
  function fbStop() {
    clearInterval(FB.timer); FB.timer = null;
    FB.refs.forEach(function (a) { try { a[0].off(a[1], a[2]); } catch (e) { } }); FB.refs = [];
    try { if (FB.me) { FB.me.onDisconnect().cancel(); FB.me.remove(); } } catch (e) { }
    try { if (FB.db) FB.db.goOffline(); } catch (e) { }
    FB.on = false; FB.conn = false; FB.pl = {}; FB.prev = null;
  }
  window.addEventListener('pagehide', function () { try { if (FB.on && FB.me) FB.me.remove(); } catch (e) { } });
  /* kirim posisi hanya kalau berubah (hemat kuota), maksimal 5 kali per detik */
  function fbSend(force) {
    if (!FB.on || !FB.conn || !FB.me) return;
    var me = ride ? { x: ride.cx, z: ride.cz } : pos, now = Math.round(ST()), inDz = !!(MPL.on && DZ.cur);
    var fin = MPL.on && MPL.began && (DN.phase === 'end' || DN.phase === 'back' || DN.phase === 'cam1');
    var o = {
      n: netName(), x: r1(me.x), z: r1(me.z), y: Math.round(Math.atan2(Math.sin(yaw), Math.cos(yaw)) * 20) / 20,
      c: activeCostume || '', fl: flying ? 1 : 0, mo: motorOn ? 1 : 0, ns: nosActive ? 1 : 0, py: r1(clamp(playerY, -99, 99)), fe: mpFire ? mpFire.id : 0, fx: mpFire ? r1(clamp(mpFire.x, -1999, 1999)) : 0, fy: mpFire ? r1(clamp(mpFire.y, -99, 99)) : 1.2, fz: mpFire ? r1(clamp(mpFire.z, -1999, 1999)) : 0, fdx: mpFire ? r1(clamp(mpFire.dx, -1, 1)) : 0, fdz: mpFire ? r1(clamp(mpFire.dz, -1, 1)) : -1, fh: mpFire ? clamp(mpFire.hit, -1, 99) : -1, m: moving ? 1 : 0, r: ride ? 1 : 0, d: done,
      vx: r1(ride ? 0 : PV.vx), vz: r1(ride ? 0 : PV.vz), t: now,
      dz: inDz ? DZ.cur : null, sc: (inDz && MPL.began) ? DN.sc[0] : null, dd: fin ? 1 : null
    };
    var sig = [o.x, o.z, o.y, o.c, o.fl, o.mo, o.ns, o.py, o.fe, o.fx, o.fy, o.fz, o.fdx, o.fdz, o.fh, o.m, o.r, o.d, o.dz, o.sc, o.dd].join('|');
    var others = false, kk; for (kk in FB.pl) { if (kk !== MPL.pid) { others = true; break; } }
    if (!force && (sig === FB.sig || now - FB.last < (others ? 200 : 1200))) return;   /* sendirian: kirim jarang saja */
    var prev = FB.prev, diff = {}, cnt = 0, pr;
    if (prev) {                                  /* kirim hanya data yang berubah (hemat kuota & tidak lag) */
      for (kk in o) if (o[kk] !== prev[kk]) { diff[kk] = o[kk]; cnt++; }
      for (kk in prev) if (!(kk in o)) { diff[kk] = null; cnt++; }
      if (!cnt) return;
    }
    FB.sig = sig; FB.last = now;
    pr = prev ? FB.me.update(diff) : FB.me.set(o); FB.prev = o;
    if (pr && pr.then) pr.then(function () { FB.err = 0; }, function (e) { FB.prev = null; FB.err++; WS.lastErr = String(e && (e.code || e.message) || 'gagal kirim'); });
  }
  function fbScores() {
    if (!MPL.on || !MPL.began) return;
    var ds = [];
    Object.keys(FB.pl).forEach(function (k) { var p = FB.pl[k]; if (p && p.dz && p.dz === DZ.cur) ds.push({ pid: k, n: p.n, s: p.sc || 0, dn: p.dd || 0, t: ST() }); });
    dzScores(ds);
  }
  /* NPC kabur: transaksi, supaya kalau dua pemain salah bersamaan hanya satu yang menang */
  function fbFlee(i, fl) {
    FB.base.child('npcs/' + i).transaction(function (cur) {
      if (cur && ST() - cur.fa < 2300) return;
      return fl;
    }, function (err, committed, snap) {
      var v = snap && snap.val();
      if (!committed && v) NPC[i].fl = v;
    }, false);
  }
  /* tombol Ayo Dansa!: transaksi membuat acara; semua klien yang mendengarkan langsung ikut */
  function fbGo(cb) {
    var fin = false, to = setTimeout(function () { if (!fin) { fin = true; cb(null); } }, 6000), name = playerName || 'Pemain';
    FB.base.child('dance').transaction(function (cur) {
      var now = ST();
      if (cur && now - cur.at < 170000) return;
      return { id: Math.round(now).toString(36) + Math.floor(Math.random() * 1e6).toString(36), seed: 1 + Math.floor(Math.random() * 1e9), at: Math.round(now), by: MPL.pid, bn: netName(), x: r1(clamp(pos.x, -1999, 1999)), z: r1(clamp(pos.z, -1999, 1999)), yaw: r1(Math.atan2(Math.sin(yaw), Math.cos(yaw))) };
    }, function (err, committed, snap) {
      if (fin) return; fin = true; clearTimeout(to);
      var dz = snap && snap.val();
      if (err || !dz) { cb(null); return; }
      cb(committed || ST() - dz.at < 25000 ? dz : null);
    }, false);
  }

  function wsNearNpc(x, z) {
    var best = -1, bd = 22, i, d; for (i = 0; i < N; i++) { d = Math.hypot(NPC[i].x - x, NPC[i].z - z); if (d < bd) { bd = d; best = i; } } return best;
  }
  function wsPanel() {
    var box = $('onl'); if (!box) return;
    if (!WS.on) { box.hidden = true; return; }
    box.hidden = false;
    var ks = Object.keys(WS.remote), rows = ks.map(function (k) { var r = WS.remote[k]; return { r: r, d: Math.hypot(r.x - pos.x, r.z - pos.z) }; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 5);
    $('onlHead').textContent = WS.fails > 2 ? 'Offline (tidak tersambung)' : (FB.err > 2 ? 'Online, data gagal terkirim: ' + (WS.lastErr || '') : 'Online: ' + (WS.count || 1) + ' pemain');
    var list = $('onlList'); list.textContent = '';
    rows.forEach(function (o) {
      var row = document.createElement('div'), nm = document.createElement('b'), info = document.createElement('small'), ni = wsNearNpc(o.r.x, o.r.z);
      row.className = 'r'; nm.textContent = o.r.n; info.textContent = (ni >= 0 ? 'dekat ' + NPC[ni].n + ' · ' : Math.round(o.d) + ' m · ') + o.r.d + '/' + N;
      row.appendChild(nm); row.appendChild(info); list.appendChild(row);
    });
    if (WS.fails > 2 && WS.lastErr) { var e = document.createElement('small'); e.textContent = WS.lastErr.slice(0, 60); list.appendChild(e); }
  }
  setInterval(function () { if (WS.on) wsPanel(); }, 1500);

  function renderIntro(msg) {
    $('mgTitle').textContent = 'Tantangan Ayo Dansa!';
    $('mgSub').textContent = 'Hadiah untuk ' + (mg + 1) * 5 + ' soal benar · Tingkat ' + mgLvl + ' dari 4';
    $('mgBody').innerHTML = (msg ? '<div class="mgres">' + esc(msg) + '</div>' : '') +
      (WS.on ? '<div class="mproom"><b>Dansa bersama!</b><span>Begitu kamu menekan <b>Ayo Dansa!</b>, semua pemain yang sedang online ikut ditarik ke pertandingan, termasuk yang sedang menjawab soal. Tidak perlu kode ruang. Pemain online sekarang: <b>' + Math.max(1, WS.count || 1) + '</b>.</span></div>' : '') +
      '<p class="mgtxt">3 temanmu datang menantang berdansa! Lagunya berdurasi <strong>2 menit</strong>.</p>' +
      '<div class="arrow-demo">' + ['up', 'down', 'left', 'right'].map(function (d) { return '<span class="ar">' + arrowSVG(d) + '</span>'; }).join('') + '</div>' +
      '<ol class="mgsteps">' +
      '<li>Lihat urutan panah di gelembung biru.</li>' +
      '<li>Tekan panah yang sama berurutan: <span class="keys"><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd>&larr;</kbd><kbd>&rarr;</kbd></span> atau <span class="keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>, atau ketuk tombol panah di layar.</li>' +
      '<li>Selesaikan urutan saat penanda hijau berada di <strong>zona abu-abu</strong> untuk nilai SEMPURNA.</li>' +
      '<li>Salah tekan? Urutan mengulang dari awal.</li></ol>' +
      '<p class="hint">Juara 1 dapat 3 bintang, juara 2 dapat 2 bintang, juara 3 dapat 1 bintang.</p>';
    $('mgGo').textContent = 'Ayo Dansa!'; $('mgGo').hidden = false; $('mgGo').disabled = false; $('mgSkip').textContent = 'Lewati'; $('mgSkip').hidden = false;
    $('mgame').scrollTop = 0;
  }

  /* ----- modal pembuka & penutup ----- */
  function startMini(cb) {
    releaseLock(); setState('mini'); mgCb = cb; mgPhase = 'ready'; DN.phase = 'intro'; mgLvl = Math.min(mg + 1, 4); mgStarsGot = 0; mpStop();
    renderIntro();
    $('mgame').hidden = false; $('mgcard').focus(); beep(523, .1, 'triangle'); beep(784, .15, 'triangle', .1);
  }
  function mgFinish(got) {
    if (DZ.forced) { DZ.forced = false; if (Math.floor(done / 5) > mg) mg++; } else mg++;
    stars += got; mgPhase = 'idle'; DN.phase = 'off'; $('mgame').hidden = true; $('hud').hidden = false; hudUpdate(); save();
    var cb = mgCb; mgCb = null; if (cb) cb();
  }
  $('mgGo').addEventListener('click', function () {
    if (mgPhase === 'ready') startShared();
    else if (mgPhase === 'done') { mgPhase = 'back'; $('mgGo').disabled = true; $('mgame').hidden = true; setPhase('back'); }
  });
  $('mgSkip').addEventListener('click', function () { if (mgPhase === 'ready') mgFinish(0); });

  /* ---------- daftar ---------- */
  function openList() {
    releaseLock(); setState('list');
    $('lList').innerHTML = NPC.map(function (d, i) {
      var r = res[i]; return '<li class="' + (r ? 'done' : '') + '"><span class="dot">' + (r ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5l2.6 2.6L10 3.4"/></svg>' : '') + '</span><span class="who"><b>' + d.n + '</b><span>' + d.r + ' · ' + (r ? 'sudah benar' : npcClue(i)) + (att[i] && !r ? ' · salah ' + att[i] + 'x' : '') + '</span></span>' + (r ? '<span class="p">' + r.pts + '</span>' : '') + '</li>';
    }).join('');
    $('daftar').hidden = false; $('lcard').focus();
  }
  function closeList() { $('daftar').hidden = true; setState('play'); if (!isTouch) lockPointer(); }
  $('btnList').addEventListener('click', function () { if (state === 'play') openList(); });
  $('lClose').addEventListener('click', closeList);

  /* ---------- selesaikan ujian ---------- */
  function openFinish() {
    if (state !== 'play') return;
    releaseLock(); setState('confirm');
    $('kMsg').textContent = 'Baru ' + done + ' dari ' + N + ' soal yang dijawab benar. Soal yang belum dijawab dihitung 0 poin. Yakin ingin menyelesaikan ujian dan melihat nilaimu?';
    $('konfirm').hidden = false; $('kcard').focus();
  }
  function closeFinish() { $('konfirm').hidden = true; setState('play'); if (!isTouch) lockPointer(); }
  $('btnFinish').addEventListener('click', openFinish);
  $('kNo').addEventListener('click', closeFinish);
  $('kYes').addEventListener('click', function () { $('konfirm').hidden = true; showResults(); });

  /* ---------- hasil & kirim nilai ---------- */
  function secScore(t) { var s = 0, m = 0; NPC.forEach(function (d, i) { if (d.t === t) { m += d.pts; if (res[i]) s += res[i].pts; } }); return [s, m]; }
  function lvl(b) { return (b === 'C1' || b === 'C2') ? 0 : (b === 'C3' ? 1 : 2); }
  function buildPayload(reason) {
    var c = [[0, 0], [0, 0], [0, 0]], det = [], ans = {};
    NPC.forEach(function (d, i) { var e = res[i] ? res[i].pts : 0, L = lvl(d.bloom); c[L][0] += e; c[L][1] += d.pts; det.push(d.qid + ':' + r2(e)); ans[d.qid] = { tokoh: d.n, percobaanSalah: att[i], benar: !!res[i], poin: e }; });
    var pg = secScore('pg'), pgk = secScore('pgk'), isi = secScore('isian'), cp = function (a) { return a[1] ? Math.round(a[0] / a[1] * 100) : 0; };
    return {
      token: CFG.TOKEN, id: sid, nama: playerName, kelas: kelas, absen: absen, alasan: reason, durasiDetik: 0,
      skorPG: Math.round(pg[0]), skorPGK: Math.round(pgk[0]), skorIsian: Math.round(isi[0]), skorSK: 0, nilai: Math.round(score),
      c1: cp(c[0]), c2: cp(c[1]), c3: cp(c[2]), answers: ans, detail: det.join(' | ')
    };
  }
  function sendResult(reason) {
    var el = $('sendStatus');
    if (practiceOnly) { el.innerHTML = '<span class="s-amb">Mode latihan: nilai tidak dikirim ulang ke guru.</span>'; return; }
    if (sent) { el.innerHTML = '<span class="s-ok">✅ Nilai sudah terkirim ke guru.</span>'; return; }
    if (!CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf('PASTE') >= 0) { el.innerHTML = '<span class="s-amb">Mode demo: alamat pengiriman belum diisi.</span>'; return; }
    el.innerHTML = '<span class="s-blue">Mengirim nilai…</span>'; $('btnResend').hidden = true;
    var fp; try { fp = fetch(CFG.APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(buildPayload(reason)) }); } catch (er) { el.innerHTML = '<span class="s-bad">Gagal koneksi internet.</span>'; $('btnResend').hidden = false; return; }
    fp.then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) { sent = true; save(); el.innerHTML = '<span class="s-ok">✅ Berhasil dikirim ke guru.</span>'; }
      else { el.innerHTML = '<span class="s-bad">Gagal: ' + esc(j && j.error) + '</span>'; $('btnResend').hidden = false; }
    }).catch(function () { el.innerHTML = '<span class="s-bad">Gagal koneksi internet.</span>'; $('btnResend').hidden = false; });
  }
  var lastReason = '';
  $('btnResend').addEventListener('click', function () { sendResult(lastReason); });
  function showResults() {
    releaseLock(); setState('end'); $('hud').hidden = true; $('prompt').hidden = true; $('toast').hidden = true; $('rideBox').hidden = true;
    finished = true; save(); wsStop();
    var first = res.filter(function (r) { return r && r.tries === 1; }).length, wrongs = att.reduce(function (x, y) { return x + y; }, 0), nilai = Math.round(score), tuntas = nilai >= 75;
    $('rName').textContent = (playerName ? playerName + ' · ' : '') + (kelas ? 'Kelas ' + kelas + ' · ' : '') + (done === N ? 'Semua soal terjawab benar' : done + ' dari ' + N + ' soal terjawab benar');
    $('rTitle').textContent = tuntas ? 'Juara Cara Kerja Komputer!' : 'Kamu berhasil sampai akhir!';
    $('rMsg').textContent = tuntas ? 'Selamat, kamu TUNTAS! Kamu paham cara kerja komputer: input, storage, processing, dan output.' : 'Nilaimu belum mencapai 75, jadi belum tuntas. Baca materinya lagi lalu coba main lagi untuk latihan!';
    if (done < N) $('rMsg').textContent += ' Soal yang belum dijawab dihitung 0 poin.';
    $('rScore').textContent = nilai; $('rPerfect').textContent = first + ' / ' + N; $('rPts').textContent = wrongs; $('rStars').textContent = stars + ' / ' + (Math.floor(N / 5) * 3);
    var gl = [['LOTS (C1-C2)', 0, 0], ['MOTS (C3)', 0, 0], ['HOTS (C4-C6)', 0, 0]];
    NPC.forEach(function (d, i) { var L = lvl(d.bloom); gl[L][2] += d.pts; if (res[i]) gl[L][1] += res[i].pts; });
    $('rSec').style.gridTemplateColumns = 'repeat(3,minmax(0,1fr))';
    $('rSec').innerHTML = gl.map(function (a) { return '<div class="stat sm"><div class="n">' + Math.round(a[1] * 10) / 10 + ' <small>/ ' + a[2] + '</small></div><div class="l">' + a[0] + '</div></div>'; }).join('');
    $('rList').innerHTML = NPC.map(function (d, i) {
      var r = res[i], tn = TYPE_NAME[d.t];
      if (!r) return '<li class="bad"><span class="dot"></span><span class="who"><b>' + d.n + '</b><span>' + tn + ' · belum dijawab benar</span></span><span class="p">0</span></li>';
      var cls = r.tries === 1 ? 'done' : (r.tries <= 3 ? 'part' : 'bad');
      return '<li class="' + cls + '"><span class="dot"></span><span class="who"><b>' + d.n + '</b><span>' + tn + ' · benar di percobaan ke-' + r.tries + '</span></span><span class="p">' + r.pts + '/' + d.pts + '</span></li>';
    }).join('');
    show('hasil'); $('hasil').scrollTop = 0; $('btnResend').hidden = true;
    lastReason = done === N ? 'Selesai (semua soal)' : 'Selesai lebih awal'; sendResult(lastReason);
    beep(523, .15, 'triangle'); beep(659, .15, 'triangle', .14); beep(784, .15, 'triangle', .28); beep(1047, .3, 'triangle', .42);
  }
  $('btnAgain').addEventListener('click', function () { var was = sent || practiceOnly; resetGame(); practiceOnly = was; inGame = true; save(); startPlay(); });
  $('btnReread').addEventListener('click', function () { var was = sent || practiceOnly; resetGame(); practiceOnly = was; inGame = false; $('hud').hidden = true; startRead(); });

  /* ---------- awal: cek progres tersimpan ---------- */
  resetData();
  var saved = loadSave();
  if (saved) {
    restore(saved);
    $('nama').value = playerName; $('kelas').value = kelas; $('absen').value = absen;
    var jam = Math.max(1, Math.round((DAY_MS - (Date.now() - saved.savedAt)) / 3600000));
    $('resumeMsg').textContent = (playerName ? playerName + ', ' : '') + (finished ? 'ujianmu sudah selesai dengan ' + done + ' dari ' + N + ' soal benar.' : 'kamu sudah menjawab benar ' + done + ' dari ' + N + ' soal dan mengumpulkan ' + stars + ' bintang.') + (coins || Object.keys(ownedCostumes).length ? ' Koin: ' + coins + ', kostum dimiliki: ' + Object.keys(ownedCostumes).length + '.' : '') + ' Progres ini tersimpan sekitar ' + jam + ' jam lagi.';
    $('btnResume').textContent = finished ? 'Lihat Hasil' : 'Lanjutkan Petualangan';
    $('resumeBox').hidden = false; $('nameForm').hidden = true;
  }
  $('btnResume').addEventListener('click', function () {
    inGame = true; ensureWorld();
    if (finished) { if (!W.ready && !W.fail) ensureWorld(); showResultsSafe(); } else { startPlay(); }
  });
  function showResultsSafe() { if (W.ready) syncWorld(); showResults(); }
  var freshArm = false;
  $('btnFresh').addEventListener('click', function () {
    if (!freshArm) { freshArm = true; $('btnFresh').textContent = 'Klik lagi untuk menghapus progres'; return; }
    clearSave(); resetData(); practiceOnly = false; inGame = false; freshArm = false;
    coins = 0; ownedCostumes = {}; activeCostume = ''; if (W.ready) syncWorld();
    $('resumeBox').hidden = true; $('nameForm').hidden = false; $('btnFresh').textContent = 'Mulai dari Awal';
  });

  /* ---------- loading: muat semua aset 3D, bangun kota, lalu hangatkan tampilan sebelum pemain bisa mulai ---------- */
  function bootLoad() {
    var box = $('loading'), bar = $('ldBar'), msg = $('ldMsg'), skip = $('ldSkip'), phase = 0, ended = false, skT;
    function set(pc, m) { pc = Math.round(clamp(pc, 0, 100)); bar.style.width = pc + '%'; msg.textContent = m + ' ' + pc + '%'; }
    function end() { if (ended) return; ended = true; clearTimeout(skT); box.hidden = true; }
    skT = setTimeout(function () { if (!ended && phase === 0) skip.hidden = false; }, 20000);
    skip.addEventListener('click', function () { Assets.forceFinish(); });
    Assets.onProgress(function (a, b) { if (phase === 0) set(b ? a / b * 60 : 60, 'Memuat model 3D dan gambar…'); });
    set(0, 'Memuat model 3D dan gambar…');
    Assets.whenReady(function () {
      phase = 1; skip.hidden = true; set(62, 'Membangun kota Kranggan…');
      setTimeout(function () {
        ensureWorld();
        if (W.fail) { end(); return; }
        var dirs = [0, 1.5708, 3.1416, 4.7124], i = 0; phase = 2;
        (function warm() {
          if (i >= dirs.length) { set(100, 'Siap!'); setTimeout(end, 250); return; }
          set(80 + i * 5, 'Menyiapkan tampilan…');
          try { camera.position.set(SPAWN.x, 1.6, SPAWN.z); camera.rotation.set(0, dirs[i], 0); sky.position.copy(camera.position); renderer.render(scene, camera); } catch (e) { }
          i++; setTimeout(warm, 40);
        })();
      }, 80);
    });
  }
  bootLoad();
})();

