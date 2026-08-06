// ==========================================
// KONFIGURASI UTAMA
// ==========================================
const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
const PENGAJUAN_SHEET_NAME = 'PengajuanPesanan';
const PENGAJUAN_HEADERS = [
  'ID Pengajuan', 'Nama Pelanggan', 'Tanggal Pengajuan', 'Jam Pengajuan',
  'Detail Produk', 'Qty', 'Total', 'Status', 'Dibuat Pada', 'Item JSON',
  'Disetujui Oleh', 'Tanggal Approve', 'Jam Approve', 'Ditolak Oleh',
  'Tanggal Reject', 'Jam Reject', 'Alasan Penolakan', 'ID Transaksi Hutang',
  'Dibatalkan Oleh', 'Tanggal Batal', 'Jam Batal'
];

function getSheet(sheetName) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
}

// ==========================================================================
// REST API ROUTER (ContentService / JSON)
// ==========================================================================
// Frontend sekarang berdiri sendiri (statis di Vercel) dan berbicara ke
// Web App ini murni lewat fetch()/JSON — bukan lagi lewat HtmlService +
// google.script.run. doGet() dan doPost() adalah SATU-SATUNYA pintu masuk;
// keduanya di-routing berdasarkan parameter query string `action`.
//
// Konvensi:
// - action WAJIB dikirim sebagai query string: ?action=namaAction
//   (berlaku untuk GET maupun POST, karena e.parameter selalu dibaca dari
//   URL pada kedua method di Apps Script).
// - Untuk POST, payload data dikirim sebagai JSON di body request, lalu
//   di-parse manual dari e.postData.contents (lihat handleRequest_).
// - Action yang hanya MEMBACA data publik (tanpa token sesi) boleh dipanggil
//   lewat GET maupun POST. Action yang butuh sesi (mengandung `actor`) atau
//   yang MENULIS data WAJIB lewat POST, supaya token sesi/],payload tidak
//   pernah nampil di URL/log server.
//
// CATATAN CORS (penting untuk frontend di domain lain / Vercel):
// Apps Script Web App tidak menangani preflight (OPTIONS). Agar browser
// tidak mengirim preflight, request dari frontend WAJIB berupa "simple
// request": method GET/POST, TANPA header custom seperti
// 'Content-Type: application/json'. Body JSON tetap dikirim sebagai string
// biasa (Content-Type default browser: text/plain), dan diparse manual di
// sini lewat JSON.parse(e.postData.contents). Lihat script.js (apiRequest).

function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  return handleRequest_(e, 'POST');
}

// Action yang aman diakses lewat GET: tidak mengubah data, dan tidak
// membutuhkan token sesi (actor). Semua action lain (menulis data, atau
// membutuhkan actor/sessionToken) hanya boleh lewat POST.
const GET_ALLOWED_ACTIONS_ = [
  'getProdukList',
  'getPelangganList',
  'getSemuaTransaksi',
  'getAdminDashboardData',
  'getRiwayatPelangganLogin'
];

function handleRequest_(e, method) {
  try {
    e = e || {};
    const params = e.parameter || {};
    const action = params.action;

    if (!action) {
      return jsonOutput_({ success: false, message: 'Parameter "action" wajib diisi. Contoh: ?action=getProdukList' });
    }

    if (method === 'GET' && GET_ALLOWED_ACTIONS_.indexOf(action) === -1) {
      return jsonOutput_({ success: false, message: 'Action "' + action + '" hanya dapat diakses melalui POST.' });
    }

    // Body JSON (khusus POST). Sengaja dibungkus try/catch sendiri: body
    // kosong/invalid tidak boleh menggagalkan seluruh request, karena
    // sebagian action (mis. getProdukList) tidak butuh body sama sekali.
    let body = {};
    if (e.postData && e.postData.contents) {
      try {
        body = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        return jsonOutput_({ success: false, message: 'Body request bukan JSON yang valid.' });
      }
    }

    const result = routeAction_(action, params, body);
    return jsonOutput_(result);
  } catch (err) {
    // Jaring pengaman terakhir: apa pun error tak terduga dari fungsi bisnis
    // (mis. sesi kedaluwarsa via getUserSesi_) tetap pulang sebagai JSON rapi,
    // bukan halaman error HTML bawaan Apps Script yang tidak bisa di-parse fetch().
    return jsonOutput_({ success: false, message: 'Error server: ' + err.message });
  }
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Actor (user login: {id, nama, role, sessionToken}) dikirim dari frontend.
// Lewat POST selalu ada di body.actor. GET tidak dipakai untuk action
// yang butuh actor (lihat GET_ALLOWED_ACTIONS_), jadi parseActorFromParams_
// hanya jaring pengaman bila suatu saat ada kebutuhan GET+actor.
function parseActorFromParams_(params) {
  if (!params || !params.actor) return null;
  try { return JSON.parse(params.actor); } catch (e) { return null; }
}

function ambilActor_(params, body) {
  return (body && body.actor) || parseActorFromParams_(params) || null;
}

// Peta action -> fungsi bisnis. Setiap fungsi bisnis di bawah (loginUser,
// simpanTransaksiHutang, dst.) TIDAK diubah sama sekali — router ini hanya
// menerjemahkan request HTTP menjadi pemanggilan fungsi seperti sebelumnya
// dipanggil lewat google.script.run.
function routeAction_(action, params, body) {
  switch (action) {

    // --- AUTH ---
    case 'loginUser':
      return loginUser(body.username, body.password);
    case 'logoutUser':
      return logoutUser(ambilActor_(params, body));
    case 'ubahKredensialPelanggan':
      return ubahKredensialPelanggan(ambilActor_(params, body), body.usernameBaru, body.passwordLama, body.passwordBaru);

    // --- DASHBOARD & LAPORAN ---
    case 'getAdminDashboardData':
      return getAdminDashboardData();
    case 'getSemuaTransaksi':
      return getSemuaTransaksi();
    case 'getRiwayatPelangganLogin':
      return getRiwayatPelangganLogin(body.nama || params.nama, body.range || params.range);

    // --- PRODUK ---
    case 'getProdukList':
      return getProdukList();
    case 'tambahProduk':
      return tambahProduk(body.nama, body.harga);
    case 'hapusProduk':
      return hapusProduk(body.id || params.id);

    // --- PELANGGAN ---
    case 'getPelangganList':
      return getPelangganList();
    case 'tambahPelanggan':
      return tambahPelanggan(body.nama, body.username, body.password);
    case 'hapusPelanggan':
      return hapusPelanggan(body.id || params.id);

    // --- TRANSAKSI (HUTANG & BAYAR) ---
    case 'simpanTransaksiHutang':
      return simpanTransaksiHutang(body.payload || body);
    case 'simpanPembayaran':
      return simpanPembayaran(body.payload || body);

    // --- PENGAJUAN JAJAN: PELANGGAN ---
    case 'getProdukUntukPengajuan':
      return getProdukUntukPengajuan(ambilActor_(params, body));
    case 'buatPengajuanJajan':
      return buatPengajuanJajan(ambilActor_(params, body), body.items);
    case 'getPengajuanPelanggan':
      return getPengajuanPelanggan(ambilActor_(params, body));
    case 'batalkanPengajuanJajan':
      return batalkanPengajuanJajan(ambilActor_(params, body), body.idPengajuan);

    // --- PENGAJUAN JAJAN: ADMIN ---
    case 'getRingkasanPengajuanAdmin':
      return getRingkasanPengajuanAdmin(ambilActor_(params, body));
    case 'getPengajuanPendingAdmin':
      return getPengajuanPendingAdmin(ambilActor_(params, body));
    case 'approvePengajuanJajan':
      return approvePengajuanJajan(ambilActor_(params, body), body.idPengajuan);
    case 'rejectPengajuanJajan':
      return rejectPengajuanJajan(ambilActor_(params, body), body.idPengajuan, body.alasan);

    default:
      return { success: false, message: 'Action "' + action + '" tidak dikenali.' };
  }
}

// ==========================================
// SETUP INITIAL DATABASE
// ==========================================
function setupDatabase() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  const sheets = [
    { name: 'Users', headers: ['ID', 'Nama', 'Username', 'Password', 'Role', 'Status'], initialData: [['USR-001', 'Pemilik Warung', 'admin', 'admin123', 'Admin', 'Aktif'], ['USR-002', 'Budi', 'budi', 'budi123', 'Pelanggan', 'Aktif']] },
    { name: 'Produk', headers: ['ID Produk', 'Nama Produk', 'Harga', 'Status'] },
    { name: 'Transaksi', headers: ['ID', 'Tanggal', 'Nama Pelanggan', 'Jenis Transaksi', 'Detail Produk', 'Qty', 'Subtotal', 'Total', 'Nominal Bayar', 'Deposit', 'Metode Pembayaran', 'Status', 'Admin Input', 'Timestamp'] },
    { name: 'Saldo', headers: ['Nama Pelanggan', 'Total Hutang', 'Total Bayar', 'Total Deposit', 'Sisa Hutang'] },
    // Sheet ini berdiri sendiri agar alur Transaksi/Hutang yang lama tidak berubah.
    { name: PENGAJUAN_SHEET_NAME, headers: PENGAJUAN_HEADERS }
  ];

  sheets.forEach(s => {
    let sheet = ss.getSheetByName(s.name);
    if (!sheet) {
      sheet = ss.insertSheet(s.name);
      sheet.appendRow(s.headers);
      if (s.initialData) s.initialData.forEach(row => sheet.appendRow(row));
    }
  });

  return "Database berhasil diinisialisasi!";
}

// ==========================================
// LOGIN & USER MANAGEMENT
// ==========================================
function loginUser(username, password) {
  try {
    const sheet = getSheet('Users');
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      const [id, nama, user, pass, role, status] = data[i];
      if (user.toString().trim().toLowerCase() === username.trim().toLowerCase() && pass.toString() === password) {
        if (status !== 'Aktif') return { success: false, message: 'Akun Anda non-aktif.' };
        const userData = { id, nama, username: user, role };
        // Token sesi dipakai khusus oleh API pengajuan, sehingga pelanggan tidak
        // dapat mengajukan/mengelola pesanan atas nama akun lain dari browser.
        userData.sessionToken = buatTokenSesi_(userData);
        return { success: true, user: userData };
      }
    }
    return { success: false, message: 'Username atau Password salah!' };
  } catch (e) {
    return { success: false, message: 'Error server: ' + e.message };
  }
}

// ==========================================
// FUNGSI LAINNYA (DASHBOARD, CRUD)
// ==========================================
function getAdminDashboardData() {
  const saldoSheet = getSheet('Saldo');
  const txSheet = getSheet('Transaksi');
  
  const saldoData = saldoSheet.getLastRow() > 1 ? saldoSheet.getDataRange().getValues() : [];
  const txData = txSheet.getLastRow() > 1 ? txSheet.getDataRange().getValues() : [];
  
  // Menggunakan Timezone lokal WIB / Asia Jakarta
  const tz = Session.getScriptTimeZone() || "Asia/Jakarta";
  const todayStr = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");

  let totalHutang = 0, totalDeposit = 0, pendapatan = 0, txCount = 0;

  for (let i = 1; i < saldoData.length; i++) {
    totalHutang += Number(saldoData[i][4]) || 0;
    totalDeposit += Number(saldoData[i][3]) || 0;
  }

  for (let i = 1; i < txData.length; i++) {
    let tgl = txData[i][1];
    let txDateStr = "";
    
    if (tgl instanceof Date) {
      txDateStr = Utilities.formatDate(tgl, tz, "yyyy-MM-dd");
    } else if (tgl) {
      let str = String(tgl).trim();
      if (str.includes("T")) {
        txDateStr = str.split("T")[0];
      } else {
        txDateStr = str;
      }
    }

    // Hitung pendapatan dan jumlah transaksi khusus untuk HARI INI
    if (txDateStr === todayStr) {
      txCount++;
      pendapatan += Number(txData[i][8]) || 0; // Nominal Bayar yang masuk
    }
  }

  return { totalHutang, pendapatan, deposit: totalDeposit, txCount };
}

function getSaldoPelanggan(namaPelanggan) {
  const sheet = getSheet('Saldo');
  if (sheet.getLastRow() < 2) return { nama: namaPelanggan, totalHutang: 0, totalBayar: 0, totalDeposit: 0, sisaHutang: 0 };
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toLowerCase() === namaPelanggan.toLowerCase()) {
      return {
        nama: data[i][0],
        totalHutang: Number(data[i][1]) || 0,
        totalBayar: Number(data[i][2]) || 0,
        totalDeposit: Number(data[i][3]) || 0,
        sisaHutang: Number(data[i][4]) || 0
      };
    }
  }
  return { nama: namaPelanggan, totalHutang: 0, totalBayar: 0, totalDeposit: 0, sisaHutang: 0 };
}

function updateSaldoPelanggan(namaPelanggan) {
  const txSheet = getSheet('Transaksi');
  const txData = txSheet.getLastRow() > 1 ? txSheet.getDataRange().getValues() : [];
  
  let totalHutang = 0, totalBayar = 0, totalDeposit = 0;

  for (let i = 1; i < txData.length; i++) {
    const [id, tgl, nama, jenis, detail, qty, subtotal, total, bayar, deposit] = txData[i];
    if (nama.toString().toLowerCase() === namaPelanggan.toLowerCase()) {
      if (jenis === 'Hutang') totalHutang += Number(total) || 0;
      else if (jenis === 'Bayar') totalBayar += Number(bayar) || 0;
      totalDeposit += Number(deposit) || 0;
    }
  }

  let sisaHutang = totalHutang - totalBayar;
  if (sisaHutang < 0) sisaHutang = 0;

  const saldoSheet = getSheet('Saldo');
  const saldoData = saldoSheet.getLastRow() > 0 ? saldoSheet.getDataRange().getValues() : [];
  let found = false;

  for (let i = 1; i < saldoData.length; i++) {
    if (saldoData[i][0].toString().toLowerCase() === namaPelanggan.toLowerCase()) {
      saldoSheet.getRange(i + 1, 2, 1, 4).setValues([[totalHutang, totalBayar, totalDeposit, sisaHutang]]);
      found = true; break;
    }
  }
  if (!found) saldoSheet.appendRow([namaPelanggan, totalHutang, totalBayar, totalDeposit, sisaHutang]);
}

function getPelangganList() {
  const userSheet = getSheet('Users');
  const userData = userSheet.getLastRow() > 1 ? userSheet.getDataRange().getValues() : [];
  let result = [];
  for (let i = 1; i < userData.length; i++) {
    if (userData[i][4] === 'Pelanggan') {
      let saldo = getSaldoPelanggan(userData[i][1]);
      result.push({ id: userData[i][0], nama: userData[i][1], username: userData[i][2], sisaHutang: saldo.sisaHutang, deposit: saldo.totalDeposit });
    }
  }
  return result;
}

function tambahPelanggan(nama, username, password) {
  const sheet = getSheet('Users');
  sheet.appendRow(['USR-' + new Date().getTime(), nama, username, password, 'Pelanggan', 'Aktif']);
  updateSaldoPelanggan(nama);
  return { success: true, message: 'Pelanggan ditambahkan!' };
}

function hapusPelanggan(id) {
  const sheet = getSheet('Users');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) { sheet.deleteRow(i + 1); return { success: true, message: 'Terhapus!' }; }
  }
  return { success: false, message: 'Tidak ditemukan.' };
}

function getProdukList() {
  const sheet = getSheet('Produk');
  if(sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  let result = [];
  for (let i = 1; i < data.length; i++) {
    result.push({ id: data[i][0], nama: data[i][1], harga: Number(data[i][2]) || 0, status: data[i][3] });
  }
  return result;
}

function tambahProduk(nama, harga) {
  getSheet('Produk').appendRow(['PRD-' + new Date().getTime(), nama, Number(harga), 'Aktif']);
  return { success: true, message: 'Produk ditambahkan!' };
}

function hapusProduk(id) {
  const sheet = getSheet('Produk');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) { sheet.deleteRow(i + 1); return { success: true, message: 'Terhapus!' }; }
  }
  return { success: false, message: 'Tidak ditemukan.' };
}

function simpanTransaksiHutang(payload) {
  const sheet = getSheet('Transaksi');
  const saldo = getSaldoPelanggan(payload.namaPelanggan);
  let totalBelanja = Number(payload.total);
  let sisaDeposit = saldo.totalDeposit;
  let depositDipakai = (sisaDeposit >= totalBelanja) ? totalBelanja : sisaDeposit;
  let statusTx = (depositDipakai >= totalBelanja) ? 'Sudah Lunas' : 'Masih Hutang';
  let itemDetails = payload.items.map(i => `${i.nama} x${i.qty}`).join(', ');
  if (payload.catatan) itemDetails += ' — ' + payload.catatan;

  const tz = Session.getScriptTimeZone() || "Asia/Jakarta";
  // Default: waktu saat ini (perilaku lama). Jika admin memasukkan tanggal/jam
  // manual (transaksi backdate), gunakan nilai tersebut untuk kolom Tanggal & Timestamp.
  const waktuTx = (payload.tanggalWaktu && !isNaN(new Date(payload.tanggalWaktu).getTime()))
    ? new Date(payload.tanggalWaktu)
    : new Date();
  const tanggalStr = Utilities.formatDate(waktuTx, tz, "yyyy-MM-dd");

  const transactionId = payload.transactionId || ('TX-' + new Date().getTime());
  sheet.appendRow([
    transactionId, tanggalStr, payload.namaPelanggan, 'Hutang', itemDetails,
    payload.items.reduce((sum, i) => sum + Number(i.qty), 0), totalBelanja, totalBelanja, 0, -depositDipakai, 'Cash', statusTx, payload.adminName, waktuTx
  ]);
  updateSaldoPelanggan(payload.namaPelanggan);
  return { success: true, message: 'Hutang berhasil dicatat!', transactionId: transactionId };
}

function simpanPembayaran(payload) {
  const sheet = getSheet('Transaksi');
  const saldo = getSaldoPelanggan(payload.namaPelanggan);
  let nominalBayar = Number(payload.nominal);
  let depositBaru = nominalBayar > saldo.sisaHutang ? nominalBayar - saldo.sisaHutang : 0;
  let statusTx = nominalBayar >= saldo.sisaHutang ? 'Sudah Lunas' : 'Masih Hutang';
  if (depositBaru > 0) statusTx = 'Deposit';

  const tz = Session.getScriptTimeZone() || "Asia/Jakarta";
  // Default: waktu saat ini (perilaku lama). Jika admin memasukkan tanggal/jam
  // manual (transaksi backdate), gunakan nilai tersebut untuk kolom Tanggal & Timestamp.
  const waktuTx = (payload.tanggalWaktu && !isNaN(new Date(payload.tanggalWaktu).getTime()))
    ? new Date(payload.tanggalWaktu)
    : new Date();
  const tanggalStr = Utilities.formatDate(waktuTx, tz, "yyyy-MM-dd");

  sheet.appendRow([
    'TX-' + new Date().getTime(), tanggalStr, payload.namaPelanggan, 'Bayar', payload.keterangan || 'Pembayaran',
    1, nominalBayar, nominalBayar, nominalBayar, depositBaru, payload.metode, statusTx, payload.adminName, waktuTx
  ]);
  updateSaldoPelanggan(payload.namaPelanggan);
  return { success: true, message: 'Pembayaran diterima!' };
}

function getSemuaTransaksi() {
  const sheet = getSheet('Transaksi');
  if(sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone() || "Asia/Jakarta";
  let result = [];
  for (let i = data.length - 1; i >= 1; i--) {
    let tgl = data[i][1];
    let dateFormatted = "";
    if (tgl instanceof Date) {
      dateFormatted = Utilities.formatDate(tgl, tz, "dd/MM/yyyy");
    } else if (tgl) {
      let str = String(tgl).trim();
      if (str.includes("T")) str = str.split("T")[0];
      else dateFormatted = str;
    }

    let ts = data[i][13];
    // Jam transaksi (contoh: "23:15"), diambil dari kolom Timestamp
    let jamFormatted = "";
    if (ts instanceof Date) {
      jamFormatted = Utilities.formatDate(ts, tz, "HH:mm");
    } else if (ts) {
      let dTs = new Date(ts);
      if (!isNaN(dTs.getTime())) jamFormatted = Utilities.formatDate(dTs, tz, "HH:mm");
    }

    // Pisahkan "Catatan Admin" dari kolom Detail Produk untuk kebutuhan detail view,
    // tanpa mengubah field `detail` asli yang sudah dipakai tampilan lain.
    const jenisTx = data[i][3];
    const detailMentah = String(data[i][4] || '');
    let catatanAdmin = '';
    let detailBersih = detailMentah;
    if (jenisTx === 'Hutang') {
      const idxPemisah = detailMentah.indexOf(' — ');
      if (idxPemisah !== -1) {
        detailBersih = detailMentah.substring(0, idxPemisah);
        catatanAdmin = detailMentah.substring(idxPemisah + 3).trim();
      }
    } else {
      // Untuk 'Bayar', kolom Detail Produk berisi keterangan pembayaran itu sendiri
      catatanAdmin = (detailMentah && detailMentah !== 'Pembayaran') ? detailMentah : '';
    }

    result.push({
      id: data[i][0], 
      tanggal: dateFormatted || String(tgl),
      jam: jamFormatted,
      nama: data[i][2], 
      jenis: jenisTx, 
      detail: data[i][4], 
      detailBersih: detailBersih,
      total: Number(data[i][7]) || 0,
      bayar: Number(data[i][8]) || 0, 
      deposit: Number(data[i][9]) || 0,
      status: data[i][11], 
      metode: data[i][10],
      adminInput: data[i][12] || '',
      catatan: catatanAdmin,
      _ts: ts instanceof Date ? ts.getTime() : i // hanya dipakai internal utk urutan kronologis
    });
  }

  hitungUlangStatusHutang(result);

  // Buang field internal sebelum dikirim ke client
  result.forEach(t => delete t._ts);

  return result;
}

// ==========================================
// AUTO-UPDATE STATUS "MASIH HUTANG" <-> "SUDAH LUNAS"
// ==========================================
// Status yang tersimpan di kolom Sheet hanyalah "foto" kondisi saat baris itu
// dibuat, dan tidak pernah berubah lagi meski ada pembayaran susulan. Fungsi
// ini menghitung ULANG status setiap transaksi 'Hutang' berdasarkan seluruh
// pembayaran yang sudah masuk, per pelanggan, secara kronologis (FIFO):
// hutang yang paling lama dianggap dilunasi lebih dulu oleh pembayaran baru.
// Baris 'Bayar' tidak diubah statusnya (dibiarkan sebagai catatan historis).
function hitungUlangStatusHutang(daftarTransaksi) {
  const grup = {};
  daftarTransaksi.forEach(t => {
    const key = t.nama.toString().toLowerCase();
    if (!grup[key]) grup[key] = [];
    grup[key].push(t);
  });

  Object.keys(grup).forEach(key => {
    // Urutkan dari transaksi paling lama ke paling baru
    const urutKronologis = grup[key].slice().sort((a, b) => a._ts - b._ts);

    const hutangTerbuka = []; // antrian hutang yang belum lunas, urut dari yang tertua

    urutKronologis.forEach(t => {
      if (t.jenis === 'Hutang') {
        // Jika saat transaksi dibuat sudah langsung ditutup sebagian/penuh oleh deposit
        // (lihat simpanTransaksiHutang -> kolom Deposit bernilai negatif = dipakai)
        let sisaAwal = t.total;
        if (t.deposit < 0) {
          sisaAwal += t.deposit; // deposit negatif, jadi ini mengurangi sisaAwal
          if (sisaAwal < 0) sisaAwal = 0;
        }
        t._sisa = sisaAwal;
        hutangTerbuka.push(t);
      } else if (t.jenis === 'Bayar') {
        let sisaBayar = t.bayar;
        for (let j = 0; j < hutangTerbuka.length && sisaBayar > 0; j++) {
          const h = hutangTerbuka[j];
          if (h._sisa <= 0) continue;
          const potong = Math.min(h._sisa, sisaBayar);
          h._sisa -= potong;
          sisaBayar -= potong;
        }
        // Sisa pembayaran setelah semua hutang tertutup otomatis menjadi deposit
        // (sudah tercatat terpisah lewat kolom Deposit & sheet Saldo).
      }
    });

    hutangTerbuka.forEach(h => {
      h.status = h._sisa <= 0 ? 'Sudah Lunas' : 'Masih Hutang';
      delete h._sisa;
    });
  });
}

// ==========================================
// RIWAYAT TRANSAKSI PELANGGAN (dengan filter rentang hari)
// ==========================================
// rangeHari: 30 (default) | 90 | 'semua'
// - Transaksi berstatus "Masih Hutang" SELALU ditampilkan, berapa pun umurnya,
//   karena itu tagihan yang masih harus diingat pelanggan.
// - Transaksi lain (sudah lunas / riwayat pembayaran) mengikuti rentang hari
//   yang dipilih. Data di Sheet TIDAK PERNAH dihapus, ini hanya filter tampilan.
function getRiwayatPelangganLogin(namaPelanggan, rangeHari) {
  const saldo = getSaldoPelanggan(namaPelanggan);
  const semuaTransaksi = getSemuaTransaksi().filter(tx => tx.nama.toLowerCase() === namaPelanggan.toLowerCase());

  const range = rangeHari || 30;
  let transaksiTampil;

  if (range === 'semua') {
    transaksiTampil = semuaTransaksi;
  } else {
    const batas = new Date();
    batas.setDate(batas.getDate() - Number(range));

    transaksiTampil = semuaTransaksi.filter(tx => {
      if (tx.status === 'Masih Hutang') return true;
      const tglTx = parseTanggalDDMMYYYY(tx.tanggal);
      return tglTx && tglTx >= batas;
    });
  }

  return {
    saldo: saldo,
    transaksi: transaksiTampil,
    totalRiwayat: semuaTransaksi.length,
    rangeAktif: range
  };
}

// Helper: ubah string tanggal format "dd/MM/yyyy" (hasil dari getSemuaTransaksi) jadi objek Date
function parseTanggalDDMMYYYY(str) {
  if (!str) return null;
  const parts = String(str).split('/');
  if (parts.length !== 3) return null;
  return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
}

// ==========================================
// PENGAJUAN JAJAN PELANGGAN
// ==========================================
// Seluruh data pengajuan disimpan di sheet terpisah. Kolom Transaksi tetap
// hanya diisi oleh simpanTransaksiHutang(), termasuk ketika admin menyetujui.

function buatTokenSesi_(user) {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(
    'catatan_warung_session_' + token,
    JSON.stringify({ id: String(user.id), nama: String(user.nama), role: String(user.role) }),
    21600 // 6 jam
  );
  return token;
}

function getUserSesi_(actor, roleWajib) {
  if (!actor || !actor.sessionToken) throw new Error('Sesi berakhir. Silakan masuk kembali.');
  const raw = CacheService.getScriptCache().get('catatan_warung_session_' + actor.sessionToken);
  if (!raw) throw new Error('Sesi berakhir. Silakan masuk kembali.');

  const user = JSON.parse(raw);
  if (roleWajib && user.role !== roleWajib) throw new Error('Anda tidak memiliki akses untuk tindakan ini.');
  return user;
}

function logoutUser(actor) {
  if (actor && actor.sessionToken) {
    CacheService.getScriptCache().remove('catatan_warung_session_' + actor.sessionToken);
  }
  return { success: true };
}

// Pelanggan hanya dapat mengubah kredensial akun miliknya sendiri. Nama tetap
// memakai data master Users agar saldo dan histori yang bergantung pada nama
// pelanggan tidak ikut berubah.
function ubahKredensialPelanggan(actor, usernameBaru, passwordLama, passwordBaru) {
  const pelanggan = getUserSesi_(actor, 'Pelanggan');
  const username = String(usernameBaru || '').trim();
  const passwordLamaStr = String(passwordLama || '');
  const passwordBaruStr = String(passwordBaru || '');

  if (username.length < 3 || username.length > 40) {
    return { success: false, message: 'Username harus terdiri dari 3–40 karakter.' };
  }
  if (!passwordLamaStr) return { success: false, message: 'Masukkan password saat ini untuk menyimpan perubahan.' };
  if (passwordBaruStr && (passwordBaruStr.length < 4 || passwordBaruStr.length > 100)) {
    return { success: false, message: 'Password baru harus terdiri dari 4–100 karakter.' };
  }

  const sheet = getSheet('Users');
  const data = sheet.getDataRange().getValues();
  let rowPelanggan = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === pelanggan.id) rowPelanggan = i;
    if (String(data[i][2]).trim().toLowerCase() === username.toLowerCase() && String(data[i][0]) !== pelanggan.id) {
      return { success: false, message: 'Username tersebut sudah digunakan.' };
    }
  }

  if (rowPelanggan === -1 || String(data[rowPelanggan][4]) !== 'Pelanggan') {
    return { success: false, message: 'Akun pelanggan tidak ditemukan.' };
  }
  if (String(data[rowPelanggan][3]) !== passwordLamaStr) {
    return { success: false, message: 'Password saat ini tidak sesuai.' };
  }

  const usernameLama = String(data[rowPelanggan][2]);
  if (username === usernameLama && !passwordBaruStr) {
    return { success: false, message: 'Belum ada perubahan yang disimpan.' };
  }

  sheet.getRange(rowPelanggan + 1, 3, 1, 2).setValues([[
    username,
    passwordBaruStr || String(data[rowPelanggan][3])
  ]]);

  return {
    success: true,
    message: 'Pengaturan akun berhasil diperbarui.',
    user: { id: pelanggan.id, nama: pelanggan.nama, username: username, role: 'Pelanggan', sessionToken: actor.sessionToken }
  };
}

function getPengajuanSheetData_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(PENGAJUAN_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PENGAJUAN_SHEET_NAME);
    sheet.getRange(1, 1, 1, PENGAJUAN_HEADERS.length).setValues([PENGAJUAN_HEADERS]);
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, PENGAJUAN_HEADERS.length).setValues([PENGAJUAN_HEADERS]);
  } else {
    const existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(h => String(h).trim());
    const missingHeaders = PENGAJUAN_HEADERS.filter(h => existingHeaders.indexOf(h) === -1);
    if (missingHeaders.length) {
      sheet.getRange(1, sheet.getLastColumn() + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    }
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((header, index) => { map[String(header).trim()] = index + 1; });
  return { sheet: sheet, map: map };
}

function nilaiPengajuan_(row, map, field) {
  const column = map[field];
  return column ? row[column - 1] : '';
}

function setNilaiPengajuan_(sheet, map, rowNumber, fields) {
  Object.keys(fields).forEach(field => {
    if (map[field]) sheet.getRange(rowNumber, map[field]).setValue(fields[field]);
  });
}

function cariPengajuan_(sheet, map, idPengajuan) {
  if (sheet.getLastRow() < 2) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const id = String(idPengajuan || '');
  for (let i = 0; i < data.length; i++) {
    if (String(nilaiPengajuan_(data[i], map, 'ID Pengajuan')) === id) {
      return { rowNumber: i + 2, row: data[i] };
    }
  }
  return null;
}

function formatWaktuServer_(date, format) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Asia/Jakarta', format);
}

// Baris lama pada sheet mungkin tersimpan sebagai Date, sedangkan baris baru
// berupa teks. Keduanya dikirim ke UI sebagai format ringkas yang konsisten.
function formatTanggalPengajuan_(value) {
  if (!value) return '';
  if (value instanceof Date) return formatWaktuServer_(value, 'dd/MM/yyyy');
  const text = String(value).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) return text;
  const parsed = new Date(text.replace(/\s*\([^)]*\)\s*/g, ' '));
  return isNaN(parsed.getTime()) ? text : formatWaktuServer_(parsed, 'dd/MM/yyyy');
}

function formatJamPengajuan_(value) {
  if (!value) return '';
  if (value instanceof Date) return formatWaktuServer_(value, 'HH:mm');
  const text = String(value).trim();
  if (/^\d{1,2}:\d{2}$/.test(text)) return text;
  const parsed = new Date(text.replace(/\s*\([^)]*\)\s*/g, ' '));
  return isNaN(parsed.getTime()) ? text : formatWaktuServer_(parsed, 'HH:mm');
}

function parseItemPengajuan_(raw) {
  try {
    const items = JSON.parse(String(raw || '[]'));
    return Array.isArray(items) ? items : [];
  } catch (e) {
    return [];
  }
}

function buatObjekPengajuan_(row, map) {
  const dibuatPada = nilaiPengajuan_(row, map, 'Dibuat Pada');
  const timeValue = dibuatPada instanceof Date ? dibuatPada.getTime() : new Date(dibuatPada).getTime();
  return {
    id: String(nilaiPengajuan_(row, map, 'ID Pengajuan') || ''),
    nama: String(nilaiPengajuan_(row, map, 'Nama Pelanggan') || ''),
    tanggal: formatTanggalPengajuan_(nilaiPengajuan_(row, map, 'Tanggal Pengajuan')),
    jam: formatJamPengajuan_(nilaiPengajuan_(row, map, 'Jam Pengajuan')),
    detail: String(nilaiPengajuan_(row, map, 'Detail Produk') || ''),
    qty: Number(nilaiPengajuan_(row, map, 'Qty')) || 0,
    total: Number(nilaiPengajuan_(row, map, 'Total')) || 0,
    status: String(nilaiPengajuan_(row, map, 'Status') || 'Pending'),
    items: parseItemPengajuan_(nilaiPengajuan_(row, map, 'Item JSON')),
    approvedBy: String(nilaiPengajuan_(row, map, 'Disetujui Oleh') || ''),
    tanggalApprove: formatTanggalPengajuan_(nilaiPengajuan_(row, map, 'Tanggal Approve')),
    jamApprove: formatJamPengajuan_(nilaiPengajuan_(row, map, 'Jam Approve')),
    rejectedBy: String(nilaiPengajuan_(row, map, 'Ditolak Oleh') || ''),
    tanggalReject: formatTanggalPengajuan_(nilaiPengajuan_(row, map, 'Tanggal Reject')),
    jamReject: formatJamPengajuan_(nilaiPengajuan_(row, map, 'Jam Reject')),
    alasanPenolakan: String(nilaiPengajuan_(row, map, 'Alasan Penolakan') || ''),
    transaksiId: String(nilaiPengajuan_(row, map, 'ID Transaksi Hutang') || ''),
    tanggalBatal: formatTanggalPengajuan_(nilaiPengajuan_(row, map, 'Tanggal Batal')),
    jamBatal: formatJamPengajuan_(nilaiPengajuan_(row, map, 'Jam Batal')),
    dibuatPadaSort: isNaN(timeValue) ? 0 : timeValue
  };
}

function getProdukUntukPengajuan(actor) {
  getUserSesi_(actor, 'Pelanggan');
  return getProdukList().filter(produk => String(produk.status || '').toLowerCase() === 'aktif');
}

function buatPengajuanJajan(actor, daftarItem) {
  const pelanggan = getUserSesi_(actor, 'Pelanggan');
  if (!Array.isArray(daftarItem) || !daftarItem.length) {
    return { success: false, message: 'Keranjang masih kosong.' };
  }

  // Harga dan nama barang selalu diambil dari sheet Produk di server, bukan
  // dari browser. Ini mencegah pelanggan mengubah harga melalui request manual.
  const produkAktif = {};
  getProdukList().forEach(produk => {
    if (String(produk.status || '').toLowerCase() === 'aktif') {
      produkAktif[String(produk.id)] = produk;
    }
  });

  const gabunganQty = {};
  daftarItem.forEach(item => {
    const id = String(item && item.id || '');
    const qty = Math.floor(Number(item && item.qty));
    if (!id || !produkAktif[id] || !isFinite(qty) || qty < 1 || qty > 999) {
      throw new Error('Terdapat produk atau jumlah barang yang tidak valid.');
    }
    gabunganQty[id] = (gabunganQty[id] || 0) + qty;
    if (gabunganQty[id] > 999) throw new Error('Jumlah maksimal tiap produk adalah 999.');
  });

  const items = Object.keys(gabunganQty).map(id => {
    const produk = produkAktif[id];
    const qty = gabunganQty[id];
    const harga = Number(produk.harga) || 0;
    return { id: String(produk.id), nama: String(produk.nama), harga: harga, qty: qty, subtotal: harga * qty };
  });
  const total = items.reduce((sum, item) => sum + item.subtotal, 0);
  const sekarang = new Date();
  const idPengajuan = 'PJ-' + sekarang.getTime() + '-' + Utilities.getUuid().slice(0, 8);
  const sheetData = getPengajuanSheetData_();
  const { sheet, map } = sheetData;
  const row = new Array(sheet.getLastColumn()).fill('');
  const isi = {
    'ID Pengajuan': idPengajuan,
    'Nama Pelanggan': pelanggan.nama,
    'Tanggal Pengajuan': formatWaktuServer_(sekarang, 'dd/MM/yyyy'),
    'Jam Pengajuan': formatWaktuServer_(sekarang, 'HH:mm'),
    'Detail Produk': items.map(item => item.nama + ' x' + item.qty).join(', '),
    'Qty': items.reduce((sum, item) => sum + item.qty, 0),
    'Total': total,
    'Status': 'Pending',
    'Dibuat Pada': sekarang,
    'Item JSON': JSON.stringify(items)
  };
  Object.keys(isi).forEach(field => { if (map[field]) row[map[field] - 1] = isi[field]; });
  sheet.appendRow(row);

  return { success: true, id: idPengajuan, message: 'Pengajuan berhasil dikirim dan menunggu persetujuan admin.' };
}

function getPengajuanPelanggan(actor) {
  const pelanggan = getUserSesi_(actor, 'Pelanggan');
  const { sheet, map } = getPengajuanSheetData_();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .map(row => buatObjekPengajuan_(row, map))
    .filter(pengajuan => pengajuan.nama.toLowerCase() === pelanggan.nama.toLowerCase())
    .sort((a, b) => b.dibuatPadaSort - a.dibuatPadaSort)
    .map(pengajuan => {
      delete pengajuan.dibuatPadaSort;
      return pengajuan;
    });
}

function batalkanPengajuanJajan(actor, idPengajuan) {
  const pelanggan = getUserSesi_(actor, 'Pelanggan');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const { sheet, map } = getPengajuanSheetData_();
    const ditemukan = cariPengajuan_(sheet, map, idPengajuan);
    if (!ditemukan) return { success: false, message: 'Pengajuan tidak ditemukan.' };

    const pengajuan = buatObjekPengajuan_(ditemukan.row, map);
    if (pengajuan.nama.toLowerCase() !== pelanggan.nama.toLowerCase()) {
      return { success: false, message: 'Pengajuan ini bukan milik Anda.' };
    }
    if (pengajuan.status !== 'Pending') {
      return { success: false, message: 'Hanya pengajuan berstatus Pending yang dapat dibatalkan.' };
    }

    const sekarang = new Date();
    setNilaiPengajuan_(sheet, map, ditemukan.rowNumber, {
      'Status': 'Dibatalkan',
      'Dibatalkan Oleh': pelanggan.nama,
      'Tanggal Batal': formatWaktuServer_(sekarang, 'dd/MM/yyyy'),
      'Jam Batal': formatWaktuServer_(sekarang, 'HH:mm')
    });
    return { success: true, message: 'Pengajuan berhasil dibatalkan.' };
  } finally {
    lock.releaseLock();
  }
}

function getRingkasanPengajuanAdmin(actor) {
  getUserSesi_(actor, 'Admin');
  const { sheet, map } = getPengajuanSheetData_();
  if (sheet.getLastRow() < 2) return { pending: 0 };
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  return { pending: data.filter(row => String(nilaiPengajuan_(row, map, 'Status')) === 'Pending').length };
}

function getPengajuanPendingAdmin(actor) {
  getUserSesi_(actor, 'Admin');
  const { sheet, map } = getPengajuanSheetData_();
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues()
    .map(row => buatObjekPengajuan_(row, map))
    .filter(pengajuan => pengajuan.status === 'Pending')
    .sort((a, b) => b.dibuatPadaSort - a.dibuatPadaSort)
    .map(pengajuan => {
      delete pengajuan.dibuatPadaSort;
      return pengajuan;
    });
}

function transaksiDenganIdSudahAda_(idTransaksi) {
  const sheet = getSheet('Transaksi');
  if (sheet.getLastRow() < 2) return false;
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  return ids.some(row => String(row[0]) === String(idTransaksi));
}

function approvePengajuanJajan(actor, idPengajuan) {
  const admin = getUserSesi_(actor, 'Admin');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const { sheet, map } = getPengajuanSheetData_();
    const ditemukan = cariPengajuan_(sheet, map, idPengajuan);
    if (!ditemukan) return { success: false, message: 'Pengajuan tidak ditemukan.' };

    const pengajuan = buatObjekPengajuan_(ditemukan.row, map);
    if (pengajuan.status !== 'Pending') {
      return { success: false, message: 'Pengajuan ini sudah diproses.' };
    }
    if (!pengajuan.items.length || pengajuan.total < 0) {
      return { success: false, message: 'Data barang pengajuan tidak valid.' };
    }

    // ID transaksi yang stabil membuat percobaan ulang aman jika eksekusi sempat
    // terputus setelah transaksi hutang tercatat tetapi sebelum status diubah.
    const idTransaksi = pengajuan.transaksiId || ('TX-' + pengajuan.id);
    if (!transaksiDenganIdSudahAda_(idTransaksi)) {
      // Wajib memakai alur lama: fungsi ini tetap menghitung pemakaian deposit,
      // status hutang, serta memperbarui sheet Saldo seperti Catat Hutang Admin.
      simpanTransaksiHutang({
        transactionId: idTransaksi,
        namaPelanggan: pengajuan.nama,
        items: pengajuan.items,
        total: pengajuan.total,
        adminName: admin.nama,
        tanggalWaktu: new Date(),
        catatan: 'Dari pengajuan jajan ' + pengajuan.id
      });
    } else {
      // Pulihkan saldo secara idempoten bila eksekusi sebelumnya terhenti
      // sesaat setelah baris transaksi tersimpan.
      updateSaldoPelanggan(pengajuan.nama);
    }

    const sekarang = new Date();
    setNilaiPengajuan_(sheet, map, ditemukan.rowNumber, {
      'Status': 'Approved',
      'Disetujui Oleh': admin.nama,
      'Tanggal Approve': formatWaktuServer_(sekarang, 'dd/MM/yyyy'),
      'Jam Approve': formatWaktuServer_(sekarang, 'HH:mm'),
      'ID Transaksi Hutang': idTransaksi
    });
    return { success: true, message: 'Pengajuan disetujui dan hutang berhasil dicatat.' };
  } finally {
    lock.releaseLock();
  }
}

function rejectPengajuanJajan(actor, idPengajuan, alasan) {
  const admin = getUserSesi_(actor, 'Admin');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const { sheet, map } = getPengajuanSheetData_();
    const ditemukan = cariPengajuan_(sheet, map, idPengajuan);
    if (!ditemukan) return { success: false, message: 'Pengajuan tidak ditemukan.' };

    const pengajuan = buatObjekPengajuan_(ditemukan.row, map);
    if (pengajuan.status !== 'Pending') {
      return { success: false, message: 'Pengajuan ini sudah diproses.' };
    }

    const sekarang = new Date();
    setNilaiPengajuan_(sheet, map, ditemukan.rowNumber, {
      'Status': 'Rejected',
      'Ditolak Oleh': admin.nama,
      'Tanggal Reject': formatWaktuServer_(sekarang, 'dd/MM/yyyy'),
      'Jam Reject': formatWaktuServer_(sekarang, 'HH:mm'),
      'Alasan Penolakan': String(alasan || '').trim().slice(0, 500)
    });
    return { success: true, message: 'Pengajuan ditolak.' };
  } finally {
    lock.releaseLock();
  }
}
