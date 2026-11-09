/* =====================================================================================
   MANIFEST 3D  —  TEMPAT MENARUH FILE 3D (.glb / .gltf)
   -------------------------------------------------------------------------------------
   CARA PAKAI (3 langkah):
   1. Buat folder  assets/3d/  di sebelah file HTML ini (atau ubah "folder" di bawah).
   2. Cari file 3D-nya (format .glb paling aman), lalu RENAME sesuai kolom  file  di bawah
      dan taruh di folder itu.  Contoh: model rumah Anda -> rename jadi  rumah_a.glb
   3. Buka game. Slot yang filenya ada otomatis dipakai; slot yang filenya belum ada
      tetap memakai model bawaan (kotak/bola sederhana), jadi game tidak pernah rusak.

   CATATAN PENTING
   - Harus dibuka lewat server/hosting (Firebase Hosting, Live Server, dsb). Kalau dibuka
     langsung dobel-klik (file://) browser memblokir pemuatan .glb.
   - Ukuran model TIDAK perlu dibenahi di Blender: game otomatis mengecilkan/membesarkan
     model agar muat di kotak  ukuran: [lebar, tinggi, panjang]  (satuan dunia; tinggi
     karakter = 1.8). Isi 0 pada salah satu angka kalau bagian itu bebas.
   - Arah DEPAN model harus menghadap sumbu +Z (standar GLB/Blender "forward"). Kalau
     modelnya menghadap ke arah lain, isi  putar: 90 / 180 / -90  (derajat).
   - naik: geser model ke atas (+) atau ke bawah (-) kalau kakinya melayang/terbenam.
   - Untuk cek hasilnya: buka Console browser, ketik  __aset3d  (daftar slot terpasang).
   - isi: true / false  -> khusus rumah_*, ruko, dan bangunan_*: model otomatis DIPERBESAR/DIKECILKAN agar mengisi penuh lebar & panjang
     bangunan di peta (tinggi menyesuaikan). Ubah ke  isi: false  kalau ingin model hanya dimuatkan tanpa melar.
   - Matikan semua model sekaligus: ubah  aktif: false
   ===================================================================================== */
window.MANIFEST_3D = {
  aktif: true,
  folder: 'assets/3d/',
  batasWaktu: 60000,           // ms; layar loading menunggu semua aset selesai. Kalau lebih lama dari ini, game jalan dengan model bawaan

  models: {
    /* ============================ RUMAH ============================ */
    /* Rumah komplek dipasang berulang & rapi. Tiga tipe dipasang selang-seling. */
    rumah_a:  { file: 'rumah_a.glb',  ukuran: [8.4, 7.0, 8.6], putar: 0, naik: 0, ket: 'Rumah 2 lantai atap pelana' },
    rumah_b:  { file: 'rumah_b.glb',  ukuran: [8.4, 4.6, 8.6], putar: 0, naik: 0, ket: 'Rumah 1 lantai atap perisai' },
    rumah_c:  { file: 'rumah_c.glb',  ukuran: [8.4, 6.4, 8.6], putar: 0, naik: 0, ket: 'Rumah modern minimalis atap datar' },
    ruko:     { file: 'ruko.glb',     ukuran: [7.5, 7.5, 7.5], putar: 0, naik: 0, ket: 'Ruko di pinggir jalan raya' },

    /* ============================ GERBANG & KOMPLEK ============================ */
    gerbang_komplek: { file: 'gerbang_komplek.glb', ukuran: [14, 6, 3],     putar: 0, naik: 0, ket: 'Gerbang masuk komplek (lebar = lebar jalan masuk)' },
    pos_satpam:      { file: 'pos_satpam.glb',      ukuran: [2.6, 2.8, 2.6], putar: 0, naik: 0, ket: 'Pos satpam di samping gerbang' },

    /* ============================ JALAN ============================ */
    /* jalan_lurus = SATU ubin jalan (persegi). Dipasang berderet sepanjang semua jalan, lebarnya
       mengikuti lebar jalan. rasio = panjang ubin dibanding lebar jalan (1 = persegi). */
    jalan_lurus: { file: 'jalan_lurus.glb', ukuran: [1, 0, 1], rasio: 1, putar: 0, naik: 0, ket: 'Ubin aspal (sisi panjang = arah jalan, sumbu Z)' },
    /* trotoar = satu potong trotoar, dipasang berderet di depan rumah komplek */
    trotoar:     { file: 'trotoar.glb',     ukuran: [1.8, 0.3, 2],  putar: 0, naik: 0, ket: 'Potongan trotoar (sumbu Z = arah memanjang)' },

    /* ============================ TUMBUHAN ============================ */
    pohon_besar:  { file: 'pohon_besar.glb',  ukuran: [6.0, 9.0, 6.0],  putar: 0, naik: 0, ket: 'Pohon besar (trembesi/mangga)' },
    pohon_sedang: { file: 'pohon_sedang.glb', ukuran: [4.5, 6.5, 4.5],  putar: 0, naik: 0, ket: 'Pohon sedang peneduh jalan' },
    pohon_palem:  { file: 'pohon_palem.glb',  ukuran: [3.5, 8.0, 3.5],  putar: 0, naik: 0, ket: 'Palem (median jalan & taman)' },
    pohon_hias:   { file: 'pohon_hias.glb',   ukuran: [2.6, 4.0, 2.6],  putar: 0, naik: 0, ket: 'Pohon kecil berbunga (halaman belakang)' },
    semak:        { file: 'semak.glb',        ukuran: [1.8, 1.2, 1.8],  putar: 0, naik: 0, ket: 'Semak bulat' },
    bunga:        { file: 'bunga.glb',        ukuran: [1.8, 0.8, 1.8],  putar: 0, naik: 0, ket: 'Rumpun bunga / bedeng bunga' },
    pagar_tanaman:{ file: 'pagar_tanaman.glb',ukuran: [4.0, 1.0, 0.8],  putar: 0, naik: 0, ket: 'Pagar tanaman (panjangnya otomatis memanjang)' },

    /* ============================ TAMAN & PERLENGKAPAN ============================ */
    air_mancur:   { file: 'air_mancur.glb',   ukuran: [5, 3, 5],        putar: 0, naik: 0, ket: 'Air mancur' },
    gazebo:       { file: 'gazebo.glb',       ukuran: [6, 4.4, 6],      putar: 0, naik: 0, ket: 'Gazebo / saung taman' },
    mainan_anak:  { file: 'mainan_anak.glb',  ukuran: [7, 3.2, 5],      putar: 0, naik: 0, ket: 'Ayunan & perosotan' },
    bangku:       { file: 'bangku.glb',       ukuran: [2.4, 1.2, 0.9],  putar: 0, naik: 0, ket: 'Bangku taman (depan = sisi duduk menghadap)' },
    lampu_jalan:  { file: 'lampu_jalan.glb',  ukuran: [1.6, 5.2, 0.6],  putar: 0, naik: 0, ket: 'Lampu jalan (lengan lampu ke arah +Z)' },
    lampu_taman:  { file: 'lampu_taman.glb',  ukuran: [0.6, 3.0, 0.6],  putar: 0, naik: 0, ket: 'Lampu taman pendek' },
    tempat_sampah:{ file: 'tempat_sampah.glb',ukuran: [0.8, 1.1, 0.8],  putar: 0, naik: 0, ket: 'Tempat sampah' },

    /* ============================ KENDARAAN ============================ */
    mobil:  { file: 'mobil.glb',  ukuran: [1.9, 1.6, 4.3], putar: 0, naik: 0, ket: 'Mobil parkir di carport rumah' },
    angkot: { file: 'angkot.glb', ukuran: [2.2, 2.6, 5.0], putar: 0, naik: 0, ket: 'Angkot yang berkeliling (menggantikan angkot bawaan)' },
    /* ============================ EFEK API (skill Pyro Titan) ============================ */
    /* Satu kobaran api. Dipasang berulang di bangunan/benda yang terbakar. Kalau file belum ada, game memakai api bawaan. */
    api:    { file: 'api.glb',    ukuran: [1.6, 2.4, 1.6], putar: 0, naik: 0, ket: 'Kobaran api untuk efek kebakaran' },

    /* ============================ BANGUNAN FASILITAS ============================ */
    /* Lebar & panjang MENGIKUTI denah tiap bangunan (otomatis). Hanya tinggi yang bisa diatur. */
    bangunan_sekolah: { file: 'bangunan_sekolah.glb', tinggi: 8,  putar: 0, naik: 0, ket: 'Semua sekolah (SDIT, SDN)' },
    bangunan_masjid:  { file: 'bangunan_masjid.glb',  tinggi: 14, putar: 0, naik: 0, ket: 'Masjid' },
    bangunan_rs:      { file: 'bangunan_rs.glb',      tinggi: 14, putar: 0, naik: 0, ket: 'RSUD' },
    bangunan_pasar:   { file: 'bangunan_pasar.glb',   tinggi: 8,  putar: 0, naik: 0, ket: 'Pasar' },
    bangunan_toko:    { file: 'bangunan_toko.glb',    tinggi: 6.5,putar: 0, naik: 0, ket: 'Toko / kantor kecil' }
  },

  /* ============================ TEKSTUR TANAH (gambar .jpg / .png) ============================
     Gambar dipakai sebagai pola ulang untuk menggambar tanah. ulang = berapa unit dunia per satu
     kali ulang gambar (makin kecil = pola makin rapat). Idealnya gambar bisa disambung (seamless). */
  tekstur: {
    tanah_rumput:  { file: 'tanah_rumput.jpg',  ulang: 8, ket: 'Rumput: halaman, taman, dasar peta' },
    tanah_aspal:   { file: 'tanah_aspal.jpg',   ulang: 6, ket: 'Aspal jalan' },
    tanah_trotoar: { file: 'tanah_trotoar.jpg', ulang: 4, ket: 'Trotoar / bahu jalan' },
    tanah_paving:  { file: 'tanah_paving.jpg',  ulang: 4, ket: 'Paving taman, plaza, jalan setapak' },
    /* Cadangan efek api kalau tidak punya model 3D: gambar PNG transparan (api menghadap ke atas). */
    api_sprite:    { file: 'api.png',          ulang: 1, ket: 'Gambar api PNG transparan (dipakai kalau api.glb tidak ada)' }
  }
};
