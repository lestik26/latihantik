window.MAP = (function () {
/* Data peta Kranggan versi citra satelit (koordinat piksel gambar -> dunia game).
   Luas dunia tetap 524 x 316 unit. Skala seragam 0.2843 unit/piksel; sisa tinggi dunia diisi lanjutan jalan. */
var SC = 0.2843, CX = 921.5, CY = 498.5;
function P(px, py) { return [Math.round((px - CX) * SC * 10) / 10, Math.round((py - CY) * SC * 10) / 10]; }
var HALF = { x: 262, z: 158 };
var ROADS = [
  { n: 'Jl. Raya Kranggan', w: 9, c: 'main', p: [[30,-60],[50,0],[58,110],[52,230],[46,330],[36,450],[22,640],[10,760],[-5,900],[-15,1060]] },
  { n: 'Jl. Raya Ps. Kranggan', w: 9, c: 'main', p: [[58,102],[400,86],[760,68],[880,92],[1000,130],[1120,172],[1250,215],[1380,258],[1480,288],[1568,318]] },
  { n: 'Jl. Raya Ps. Kranggan', w: 9, c: 'main', p: [[1568,318],[1700,308],[1843,302],[1900,300]] },
  { n: 'Jl. Raya Ps. Kranggan', w: 9, c: 'main', p: [[1568,318],[1578,400],[1596,500],[1610,620],[1630,760],[1655,900],[1675,1060]] },
  { n: 'Jl. Puskesmas', w: 6.5, c: 'mid', p: [[25,700],[130,680],[300,650],[500,620],[700,598],[900,575],[1050,572],[1250,585],[1450,606],[1604,645]] },
  { n: 'Jl. Camat', w: 6.5, c: 'mid', p: [[52,445],[250,422],[415,408],[418,500],[410,598]] },
  { n: 'Gg. Absok', w: 4.5, c: 'small', p: [[395,88],[392,160],[390,250]] },
  { n: 'Jl. Sawo Apel', w: 5.5, c: 'small', p: [[1568,318],[1556,240],[1575,140],[1600,-60]] },
  { n: 'Gg. Puskesmas I', w: 4.5, c: 'small', p: [[300,650],[292,780],[300,900],[310,1060]] },
  { n: 'Gg. Puskesmas II', w: 4.5, c: 'small', p: [[900,575],[915,700],[930,850],[945,1060]] },
  { n: 'Gg. Cempaka', w: 4.5, c: 'small', p: [[1000,130],[1010,60],[1020,-60]] },
  { n: 'Gg. Kranggan', w: 4.5, c: 'small', p: [[110,102],[130,300],[205,423]] }
];
var RIVER = [];
var STOPS = [
  { id: 'A1', n: 'Halte Raya Kranggan', line: 'A', px: [112, 98], d: 'dekat Jl. Raya Kranggan' },
  { id: 'A2', n: 'Halte Gg. Absok', line: 'A', px: [395, 86], d: 'dekat Gg. Absok' },
  { id: 'A3', n: 'Halte Toko Plastik', line: 'A', px: [887, 96], d: 'dekat Toko Plastik Abel' },
  { id: 'A4', n: 'Halte Alun-alun Kranggan', line: 'A', px: [1135, 176], d: 'dekat Alun-alun' },
  { id: 'A5', n: 'Halte SDN Jatisampurna I & IX', line: 'A', px: [1390, 262], d: 'dekat SDN Jatisampurna I & IX' },
  { id: 'A6', n: 'Halte Simpang Sawo Apel', line: 'A', px: [1525, 301], d: 'simpang Jl. Sawo Apel' },
  { id: 'A7', n: 'Halte Kranggan Timur', line: 'A', px: [1790, 304], d: 'jalan raya sisi timur' },
  { id: 'B1', n: 'Halte Raya Kranggan Utara', line: 'B', px: [52, 215], d: 'Jl. Raya Kranggan utara' },
  { id: 'B2', n: 'Halte Jl. Camat', line: 'B', px: [38, 480], d: 'dekat Jl. Camat' },
  { id: 'B3', n: 'Halte Puskesmas Barat', line: 'B', px: [150, 676], d: 'Jl. Puskesmas bagian barat' },
  { id: 'B4', n: 'Halte RSUD Jatisampurna', line: 'B', px: [700, 598], d: 'dekat RSUD Jatisampurna' },
  { id: 'B5', n: 'Halte SDN Jatisampurna V & X', line: 'B', px: [930, 572], d: 'dekat SDN Jatisampurna V & X' },
  { id: 'B6', n: 'Halte SDIT Hidayatut Taufiq', line: 'B', px: [1440, 606], d: 'dekat SDIT Hidayatut Taufiq' },
  { id: 'B7', n: 'Halte Pasar Kranggan', line: 'B', px: [1540, 640], d: 'dekat Pasar Kranggan (sisi barat perempatan)' },
  { id: 'C1', n: 'Halte Sawo Apel', line: 'C', px: [1580, 120], d: 'Jl. Sawo Apel utara' },
  { id: 'C2', n: 'Halte Sawo Apel Selatan', line: 'C', px: [1556, 262], d: 'dekat simpang' },
  { id: 'C3', n: 'Halte Masjid Hidayatut Taufiq', line: 'C', px: [1592, 490], d: 'dekat Masjid Jami Hidayatut Taufiq' },
  { id: 'C4', n: 'Halte Pasar Kranggan Selatan', line: 'C', px: [1625, 720], d: 'selatan Pasar Kranggan' },
  { id: 'C5', n: 'Halte Kranggan Selatan', line: 'C', px: [1650, 880], d: 'ujung selatan' }
];
var ROUTES = {
  A: [[58,102],[400,86],[760,68],[880,92],[1000,130],[1120,172],[1250,215],[1380,258],[1480,288],[1568,318],[1700,308],[1843,302],[1900,300]],
  B: [[50,150],[52,230],[46,330],[36,450],[22,640],[25,700],[130,680],[300,650],[500,620],[700,598],[900,575],[1050,572],[1250,585],[1450,606],[1604,645]],
  C: [[1600,-60],[1575,140],[1556,240],[1568,318],[1578,400],[1596,500],[1610,620],[1630,760],[1655,900],[1675,1060]]
};
var LINES = {
  A: { n: 'Angkot 01', col: '#e0434a', cc: 0xe0434a, desc: 'Jl. Raya Ps. Kranggan (barat - timur)' },
  B: { n: 'Angkot 02', col: '#2a68dc', cc: 0x2a68dc, desc: 'Jl. Raya Kranggan - Jl. Puskesmas - Pasar' },
  C: { n: 'Angkot 03', col: '#14a06e', cc: 0x14a06e, desc: 'Jl. Sawo Apel - Jl. Raya Ps. Kranggan (selatan)' }
};
var POIS = [
  { id: 'sdit', n: 'SDIT HIDAYATUT TAUFIQ', z: 'SDIT Hidayatut Taufiq', px: [1383, 532], w: 30, d: 19, h: 7, c: 0xfff1c9, roof: 0x2f8f6a, f: [0, 1], kind: 'school' },
  { id: 'masjid', n: 'MASJID JAMI HIDAYATUT TAUFIQ', z: 'Masjid Jami Hidayatut Taufiq', px: [1495, 522], w: 24, d: 21, h: 8, c: 0xf4f1e6, roof: 0x14a06e, f: [0, 1], kind: 'mosque' },
  { id: 'rsud', n: 'RSUD JATISAMPURNA', z: 'RSUD Jatisampurna', px: [570, 458], w: 46, d: 22, h: 9, c: 0xffffff, roof: 0xe0434a, f: [0, 1], kind: 'hospital' },
  { id: 'rsud2', n: 'GEDUNG RSUD', z: 'RSUD Jatisampurna', px: [712, 485], w: 26, d: 48, h: 14, c: 0xf2f4f6, roof: 0xb9bfc7, f: [0, 1], kind: 'hospital', nopin: 1 },
  { id: 'sdn5', n: 'SDN JATISAMPURNA V & X', z: 'SDN Jatisampurna V & X', px: [860, 412], w: 54, d: 13, h: 7, c: 0xf6e3c8, roof: 0xb8562c, f: [0, 1], kind: 'school' },
  { id: 'sdn5b', n: 'SDN JATISAMPURNA V & X', z: 'SDN Jatisampurna V & X', px: [925, 497], w: 15, d: 32, h: 7, c: 0xf6e3c8, roof: 0xb8562c, f: [-1, 0], kind: 'school', nopin: 1 },
  { id: 'sdn1', n: 'SDN JATISAMPURNA I & IX', z: 'SDN Jatisampurna I & IX', px: [1430, 190], w: 56, d: 17, h: 7, c: 0xf6e3c8, roof: 0xb8562c, f: [0, 1], kind: 'school' },
  { id: 'sdn1b', n: 'SDN JATISAMPURNA I & IX', z: 'SDN Jatisampurna I & IX', px: [1430, 120], w: 38, d: 12, h: 7, c: 0xf6e3c8, roof: 0xb8562c, f: [0, 1], kind: 'school', nopin: 1 },
  { id: 'pasar', n: 'PASAR KRANGGAN', z: 'Pasar Kranggan', px: [1745, 525], w: 36, d: 36, h: 6, c: 0xf2c98d, roof: 0x2a68dc, f: [-1, 0], kind: 'market' },
  { id: 'toko', n: 'TOKO PLASTIK ABEL', z: 'Toko Plastik Abel', px: [640, 130], w: 11, d: 8, h: 4.5, c: 0xcdeeff, roof: 0x2a68dc, f: [0, -1], kind: 'shop' },
  { id: 'aula', n: 'AULA CEMPAKA KSP KOPPAS', z: 'Aula Cempaka KSP Koppas', px: [1080, 98], w: 12, d: 9, h: 5, c: 0xe7d2ff, roof: 0x7a3b5e, f: [0, 1], kind: 'shop' },
  { id: 'renara', n: 'PT. RENARA WISATA PRIMA', z: 'Pt. Renara Wisata Prima', px: [700, 28], w: 11, d: 8, h: 5, c: 0xe9e4d8, roof: 0x6b7d8c, f: [0, 1], kind: 'shop' },
  { id: 'geprek', n: 'GEPREKIN AJA', z: 'Geprekin Aja', px: [1690, 82], w: 11, d: 8, h: 4.5, c: 0xffb48a, roof: 0xd8232a, f: [0, 1], kind: 'shop' },
  { id: 'afdi', n: 'KANTOR AFDITUOR', z: 'Kantor Afdituor', px: [1740, 228], w: 13, d: 10, h: 5.5, c: 0xfce7d6, roof: 0x8a5a36, f: [0, 1], kind: 'shop' }
];
var AREAS = [
  { id: 'alun', n: 'ALUN-ALUN KRANGGAN', z: 'Alun-alun Kranggan', px: [1115, 385], w: 64, d: 80 }
];
var NPCPOS = [
  { px: [1370, 590], clue: 'Di depan SDIT Hidayatut Taufiq, tempat kamu mulai' },
  { px: [560, 532], clue: 'Di depan RSUD Jatisampurna, tepi Jl. Puskesmas' },
  { px: [775, 545], clue: 'Di sebelah timur Gedung RSUD' },
  { px: [835, 505], clue: 'Di halaman SDN Jatisampurna V & X' },
  { px: [1110, 556], clue: 'Di selatan Alun-alun Kranggan' },
  { px: [1060, 214], clue: 'Di utara Alun-alun, dekat Halte Alun-alun' },
  { px: [1070, 130], clue: 'Di depan Aula Cempaka KSP Koppas Kranggan' },
  { px: [610, 106], clue: 'Dekat Toko Plastik Abel, Jl. Raya Ps. Kranggan' },
  { px: [745, 42], clue: 'Di depan Pt. Renara Wisata Prima' },
  { px: [1470, 247], clue: 'Di sebelah SDN Jatisampurna I & IX' },
  { px: [1650, 112], clue: 'Dekat Geprekin Aja, Jl. Sawo Apel bagian utara' },
  { px: [1735, 262], clue: 'Di depan Kantor Afdituor, sisi timur' },
  { px: [1642, 562], clue: 'Di depan Pasar Kranggan' },
  { px: [1500, 580], clue: 'Di depan Masjid Jami Hidayatut Taufiq' },
  { px: [160, 190], clue: 'Di Jl. Raya Kranggan, bagian utara (barat)' },
  { px: [210, 398], clue: 'Di Jl. Camat dekat Jl. Raya Kranggan' },
  { px: [210, 626], clue: 'Di Jl. Puskesmas bagian barat' },
  { px: [335, 800], clue: 'Di gang selatan Jl. Puskesmas' },
  { px: [1765, 336], clue: 'Di jalan raya sisi timur, setelah simpang Sawo Apel' },
  { px: [1692, 860], clue: 'Di Jl. Raya Ps. Kranggan bagian selatan' }
];
if (typeof module !== 'undefined') module.exports = { P, ROADS, RIVER, STOPS, ROUTES, LINES, POIS, AREAS, NPCPOS, SC, CX, CY, HALF };

return { P: P, ROADS: ROADS, RIVER: RIVER, STOPS: STOPS, ROUTES: ROUTES, LINES: LINES, POIS: POIS, AREAS: AREAS, NPCPOS: NPCPOS, HALF: HALF };
})();

/* ===== DATA SOAL & TOKOH =====
   Materi: Cara Kerja Komputer (Pertemuan 12): Input, Storage, Processing, Output.
   Komposisi 20 soal (kelas 5): LOTS C1-C2 = 5 soal (25%), MOTS C3 = 9 soal (45%), HOTS C4-C6 = 6 soal (30%).
   t: 'pg' (pilihan ganda, 1 benar), 'pgk' (pilihan ganda kompleks, pilih semua yang benar), 'isian' (jawaban singkat).
   pts = bobot nilai (20 soal x 5 = 100). Format pilihan: [teks, 1 jika benar / 0 jika salah]. w = pembahasan. */
window.GAME_DATA = {
  npcs: [
    { n: 'Bu Syifa', r: 'Guru Kelas 1', look: 'hijab', skin: 0xe0ac84, hair: 0x2b1b12, c: 0xf08a24, p: 0x24344f, v: 0xf08a24 },
    { n: 'Bu Septi', r: 'Guru Kelas 2', look: 'long', skin: 0xf1c7a0, hair: 0x2b1b12, c: 0x2a8fd0, p: 0x24344f },
    { n: 'Bu Lina', r: 'Guru Kelas 3a', look: 'hijab', skin: 0xc68a5e, hair: 0x1c1c1c, c: 0x2f8f6a, p: 0x5b3a29, v: 0x2f8f6a },
    { n: 'Bu Ayu', r: 'Guru Kelas 3b', look: 'long', skin: 0xf1c7a0, hair: 0x3a2418, c: 0xe0763a, p: 0x24344f },
    { n: 'Bu Nurul', r: 'Guru Kelas 4b', look: 'hijab', skin: 0xe0ac84, hair: 0x1c1c1c, c: 0x7a3b5e, p: 0x1c1c2c, v: 0x7a3b5e },
    { n: 'Bu Sena', r: 'Guru Kelas 5', look: 'long', skin: 0xf1c7a0, hair: 0x2b1b12, c: 0x1f6f8b, p: 0x24344f },
    { n: 'Bu Nurhayati', r: 'Guru Kelas 6', look: 'hijab', skin: 0xc68a5e, hair: 0x1c1c1c, c: 0xd65f2a, p: 0x333d4f, v: 0xd65f2a },
    { n: 'Bu Rohati', r: 'Guru Agama', look: 'hijab', skin: 0xe0ac84, hair: 0x1c1c1c, c: 0x14a06e, p: 0x24344f, v: 0x14a06e },
    { n: 'Bu Sari', r: 'Guru Agama', look: 'long', skin: 0xc68a5e, hair: 0x1c1c1c, c: 0xc98a2a, p: 0x5b3a29 },
    { n: 'Bu Dinda', r: 'Guru Agama', look: 'hijab', skin: 0xf1c7a0, hair: 0x2b1b12, c: 0xd6538a, p: 0x24344f, v: 0xd6538a },
    { n: 'Bu Rita', r: 'Guru PJOK', look: 'long', skin: 0xc68a5e, hair: 0x1c1c1c, c: 0xd8232a, p: 0x24344f },
    { n: 'Pa Anto', r: 'Guru TIK', look: 'short', skin: 0xc68a5e, hair: 0x1c1c1c, c: 0x2a68dc, p: 0x24344f },
    { n: 'Bu Nia', r: 'Kepala Sekolah', look: 'hijab', skin: 0xe0ac84, hair: 0x1c1c1c, c: 0x10233f, p: 0x24344f, v: 0x10233f },
    { n: 'Pa Danny', r: 'Yayasan', look: 'cap', skin: 0x9a6440, hair: 0x1c1c1c, c: 0x333d4f, p: 0x1c1c2c },
    { n: 'Bu Penny', r: 'Ketua Yayasan', look: 'long', skin: 0xf1c7a0, hair: 0x2b1b12, c: 0x8a5a36, p: 0x24344f },
    { n: 'Mang Koto', r: 'Penjaga Sekolah', look: 'cap', skin: 0x7a4a2e, hair: 0x1c1c1c, c: 0x2f6b3a, p: 0x3a3f2b },
    { n: 'Bu Dewi', r: 'Guru', look: 'hijab', skin: 0xe0ac84, hair: 0x1c1c1c, c: 0x6b5bd6, p: 0x24344f, v: 0x6b5bd6 },
    { n: 'Bu Ida', r: 'Guru', look: 'long', skin: 0xf1c7a0, hair: 0x2b1b12, c: 0xd9822b, p: 0x24344f },
    { n: 'Bu Muning', r: 'Staf', look: 'hijab', skin: 0xc68a5e, hair: 0x1c1c1c, c: 0x1f8f8f, p: 0x24344f, v: 0x1f8f8f },
    { n: 'Bu Ira', r: 'Guru', look: 'long', skin: 0xe0ac84, hair: 0x1c1c1c, c: 0xb5455e, p: 0x24344f }
  ],
  questions: [
    /* ---- LOTS: C1 & C2 (5 soal) ---- */
    { t: 'pg', id: 'S1', bloom: 'C1', pts: 5, s: 'Apa fungsi tahapan <b>input</b> dalam cara kerja komputer?',
      o: [['Memasukkan data atau perintah ke komputer', 1], ['Mengolah data menjadi informasi yang berguna', 0], ['Menyimpan data agar bisa digunakan kapan saja', 0], ['Menampilkan hasil olahan data', 0]],
      w: 'Input adalah tahap memasukkan data atau perintah ke komputer. Mengolah data adalah processing, menyimpan adalah storage, dan menampilkan hasil adalah output.' },
    { t: 'isian', id: 'S2', bloom: 'C1', pts: 5, s: 'Komputer bekerja melalui empat tahapan: Input, Storage, ...., dan Output. (jawab satu kata bahasa Inggris)',
      accept: ['processing', 'pemrosesan', 'proses'], key: 'Processing',
      w: 'Empat tahapan kerja komputer adalah Input, Storage, Processing, dan Output.' },
    { t: 'pg', id: 'S3', bloom: 'C2', pts: 5, s: 'Perangkat yang termasuk dalam kategori <b>input</b> adalah ....',
      o: [['Keyboard', 1], ['Monitor', 0], ['CPU', 0], ['Printer', 0]],
      w: 'Keyboard adalah perangkat input untuk memasukkan teks atau perintah. Monitor dan printer adalah output, sedangkan CPU melakukan processing.' },
    { t: 'pgk', id: 'S4', bloom: 'C2', pts: 5, s: 'Pilih <b>semua</b> perangkat yang termasuk kategori <b>output</b>!',
      o: [['Monitor', 1], ['Speaker', 1], ['Printer', 1], ['Keyboard', 0], ['Microphone', 0]],
      w: 'Output menampilkan hasil olahan data: monitor menampilkan teks atau gambar, speaker mengeluarkan suara, printer mencetak ke kertas. Keyboard dan microphone adalah perangkat input.' },
    { t: 'pg', id: 'S5', bloom: 'C2', pts: 5, s: 'Apa yang terjadi pada data di <b>RAM</b> saat komputer dimatikan?',
      o: [['Data hilang', 1], ['Data tersimpan permanen', 0], ['Data otomatis pindah ke HDD', 0], ['Data berubah menjadi suara', 0]],
      w: 'RAM menyimpan data yang sedang digunakan secara sementara, sehingga data di RAM hilang saat komputer dimatikan.' },
    /* ---- MOTS: C3 (9 soal) ---- */
    { t: 'pg', id: 'S6', bloom: 'C3', pts: 5, s: 'Dewi ingin merekam suaranya untuk tugas membaca puisi. Perangkat input yang harus ia gunakan adalah ....',
      o: [['Microphone', 1], ['Speaker', 0], ['Printer', 0], ['Monitor', 0]],
      w: 'Microphone memasukkan suara ke komputer. Suara diubah menjadi data digital oleh komputer.' },
    { t: 'pg', id: 'S7', bloom: 'C3', pts: 5, s: 'Keluarga Andi ingin menyimpan banyak dokumen dan foto di komputer secara permanen. Perangkat storage yang cocok adalah ....',
      o: [['Hard Disk Drive (HDD)', 1], ['RAM', 0], ['Monitor', 0], ['Microphone', 0]],
      w: 'HDD menyimpan data besar seperti dokumen dan foto secara permanen. RAM hanya menyimpan data sementara.' },
    { t: 'pg', id: 'S8', bloom: 'C3', pts: 5, s: 'Budi ingin membawa file tugas dari komputer sekolah untuk diedit di laptop rumah. Perangkat yang paling praktis ia gunakan adalah ....',
      o: [['USB Flash Drive', 1], ['Monitor', 0], ['CPU', 0], ['Printer', 0]],
      w: 'USB Flash Drive menyimpan data di memori flash dan mudah dibawa, sehingga cocok untuk memindahkan data antar perangkat.' },
    { t: 'pg', id: 'S9', bloom: 'C3', pts: 5, s: 'Ani harus mengumpulkan dokumen tugasnya dalam bentuk kertas. Perangkat output yang ia gunakan adalah ....',
      o: [['Printer', 1], ['Keyboard', 0], ['Mouse', 0], ['Microphone', 0]],
      w: 'Printer mengubah data digital menjadi cetakan fisik di kertas, misalnya dokumen tugas.' },
    { t: 'isian', id: 'S10', bloom: 'C3', pts: 5, s: 'Rina ingin membuka aplikasi dengan mengklik ikonnya di layar. Perangkat input yang ia gerakkan adalah .... (jawab satu kata)',
      accept: ['mouse', 'maus'], key: 'Mouse',
      w: 'Mouse mengubah gerakan dan klik menjadi perintah di layar, misalnya membuka aplikasi.' },
    { t: 'pgk', id: 'S11', bloom: 'C3', pts: 5, s: 'Rani mengetik laporan, lalu hasilnya muncul di layar. Pilih <b>semua</b> perangkat dan perannya yang tepat dalam kegiatan itu!',
      o: [['Keyboard sebagai perangkat input', 1], ['CPU sebagai pengolah data (processing)', 1], ['Monitor sebagai perangkat output', 1], ['Speaker sebagai perangkat input', 0], ['Printer sebagai perangkat storage', 0]],
      w: 'Rani memasukkan teks lewat keyboard (input), CPU mengolahnya (processing), dan monitor menampilkannya (output). Speaker adalah output, printer juga output.' },
    { t: 'isian', id: 'S12', bloom: 'C3', pts: 5, s: 'Menyimpan dokumen tugas ke USB Flash Drive termasuk tahapan .... (jawab: input / storage / processing / output)',
      accept: ['storage', 'penyimpanan'], key: 'storage',
      w: 'Menyimpan data agar bisa digunakan kapan saja adalah tahap storage.' },
    { t: 'pg', id: 'S13', bloom: 'C3', pts: 5, s: 'Dina ingin menyimpan data di perangkat yang lebih cepat dari HDD dan tidak memiliki bagian yang bergerak. Perangkat yang tepat adalah ....',
      o: [['Solid State Drive (SSD)', 1], ['Hard Disk Drive (HDD)', 0], ['Microphone', 0], ['Printer', 0]],
      w: 'SSD menyimpan data di chip memori tanpa bagian bergerak sehingga lebih cepat dari HDD. HDD memakai piringan magnetik yang berputar.' },
    { t: 'pgk', id: 'S14', bloom: 'C3', pts: 5, s: 'Pilih <b>semua</b> pasangan perangkat dan tahapannya yang <b>BENAR</b>!',
      o: [['Keyboard : input', 1], ['Hard Disk Drive : storage', 1], ['CPU : processing', 1], ['Speaker : input', 0], ['Printer : processing', 0]],
      w: 'Keyboard adalah input, HDD adalah storage, CPU adalah processing. Speaker dan printer adalah perangkat output.' },
    /* ---- HOTS: C4, C5, C6 (6 soal) ---- */
    { t: 'pg', id: 'S15', bloom: 'C4', pts: 5, s: 'Tono mengetik laporan, tetapi listrik tiba-tiba padam dan komputernya mati sebelum ia menyimpan laporannya. Saat dinyalakan lagi, laporannya hilang. Penyebab yang paling tepat adalah ....',
      o: [['Laporan yang belum disimpan hanya berada di RAM, dan data RAM hilang saat komputer dimatikan.', 1], ['HDD hanya menyimpan data sementara sehingga laporan ikut terhapus.', 0], ['CPU rusak karena listrik padam sehingga semua data di storage terhapus.', 0], ['Monitor mati sehingga laporan tidak bisa ditampilkan lagi.', 0]],
      w: 'Data yang sedang dikerjakan ada di RAM, yang bersifat sementara. Karena belum disimpan ke storage (misalnya HDD atau SSD), laporan hilang saat komputer mati.' },
    { t: 'pg', id: 'S16', bloom: 'C4', pts: 5, s: 'Manakah pernyataan yang <b>membedakan</b> HDD dan RAM dengan tepat?',
      o: [['HDD menyimpan data secara permanen, sedangkan RAM menyimpan data sementara yang hilang saat komputer dimatikan.', 1], ['HDD menyimpan data sementara, sedangkan RAM menyimpan data secara permanen.', 0], ['HDD dan RAM sama-sama menyimpan data sementara untuk mempercepat pemrosesan.', 0], ['HDD adalah perangkat output, sedangkan RAM adalah perangkat input.', 0]],
      w: 'HDD adalah storage yang menyimpan data permanen di piringan magnetik. RAM adalah bagian processing yang menyimpan data sementara untuk mempercepat pemrosesan.' },
    { t: 'pgk', id: 'S17', bloom: 'C4', pts: 5, s: 'Siti merekam suara lagu, menyimpannya di SSD, mengolahnya di aplikasi, lalu memutarnya di speaker. Pilih <b>semua</b> analisis yang <b>BENAR</b>!',
      o: [['Merekam suara lagu adalah tahap input.', 1], ['Mengolah lagu di aplikasi adalah tahap processing.', 1], ['Memutar lagu di speaker adalah tahap output.', 1], ['Menyimpan lagu di SSD adalah tahap processing.', 0], ['Speaker berfungsi memasukkan suara ke komputer.', 0]],
      w: 'Alurnya: rekam (input), simpan di SSD (storage), olah di aplikasi (processing), putar di speaker (output). Menyimpan di SSD adalah storage, dan speaker adalah output.' },
    { t: 'pg', id: 'S18', bloom: 'C5', pts: 5, s: 'Rafi berkata, &ldquo;Tugas yang kuketik pasti aman selamanya di RAM, jadi tidak perlu disimpan.&rdquo; Nia menjawab, &ldquo;RAM menyimpan data sementara, jadi tugas harus disimpan di storage.&rdquo; Penilaian yang paling tepat adalah ....',
      o: [['Nia benar, karena data di RAM hilang saat komputer dimatikan sehingga tugas perlu disimpan di storage.', 1], ['Rafi benar, karena RAM menyimpan data secara permanen.', 0], ['Keduanya benar, karena RAM dan storage sama-sama menyimpan data permanen.', 0], ['Keduanya salah, karena tugas cukup disimpan di monitor.', 0]],
      w: 'Pendapat Nia tepat. RAM hanya menyimpan data yang sedang digunakan dan hilang saat komputer dimatikan, jadi tugas harus disimpan di storage.' },
    { t: 'isian', id: 'S19', bloom: 'C5', pts: 5, s: 'Kakak berkata, &ldquo;Microphone termasuk perangkat output karena berhubungan dengan suara.&rdquo; Menurutmu, pernyataan kakak benar atau salah? (jawab: benar / salah)',
      accept: ['salah', 'tidakbenar', 'keliru'], key: 'salah',
      w: 'Pernyataan kakak salah. Microphone memasukkan suara ke komputer, jadi termasuk perangkat input. Yang mengeluarkan suara adalah speaker (output).' },
    { t: 'pg', id: 'S20', bloom: 'C6', pts: 5, s: 'Kamu diminta merancang alur membuat laporan tugas yang memakai empat tahapan kerja komputer. Rancangan yang paling tepat dan lengkap adalah ....',
      o: [['Mengetik dengan keyboard (input), menyimpan ke USB Flash Drive (storage), mengedit di aplikasi pengolah kata (processing), lalu mencetak dengan printer (output).', 1], ['Mengetik dengan keyboard (input), mengedit di monitor (processing), menyimpan ke speaker (storage), lalu mencetak dengan mouse (output).', 0], ['Mencetak dengan printer (output), menyimpan ke USB Flash Drive (storage), lalu mengetik dengan keyboard (input).', 0], ['Mengetik dengan keyboard (input), lalu menyimpannya di RAM sebagai penyimpanan permanen (storage).', 0]],
      w: 'Rancangan lengkap memuat keempat tahap dengan perangkat yang sesuai dan urutan yang masuk akal: input (keyboard), storage (USB), processing (aplikasi pengolah kata dan CPU), output (printer).' }
  ],
  config: {
    APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbw0GtXcPWrQCOS5hh5nRiXLbKGkcC4002KZ1XjYSAFuT9pk-DfpkUR_DpOoi9H7aNsZ/exec',
    TOKEN: 'tik6-ujian-2026',
    FIREBASE_DB_URL: 'https://online-a93e9-default-rtdb.asia-southeast1.firebasedatabase.app'
  }
};

