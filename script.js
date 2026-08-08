// ==========================================================================
// KONFIGURASI API
// ==========================================================================
// Ganti dengan URL Web App hasil deploy Google Apps Script Anda, contoh:
// "https://script.google.com/macros/s/AKfycbXXXXXXXXXXXXXXXXXXXXXX/exec"
const API_URL = "https://script.google.com/macros/s/AKfycbypIG48h8o5NMLPJmOjcO46FAGx9-J2OdCCMBeFPzgjqL7zfbAwkhysvHDG0Xm1unuj/exec";

// --- HELPER FETCH TERPUSAT KE APPS SCRIPT REST API ---
// Catatan penting soal CORS:
// Google Apps Script Web App TIDAK menangani preflight request (OPTIONS).
// Agar browser tidak mengirim preflight, request POST di sini SENGAJA tidak
// diberi header 'Content-Type: application/json' secara manual — dengan
// body berupa string, browser otomatis memakai 'text/plain;charset=UTF-8'
// yang termasuk "CORS-safelisted", sehingga request POST tetap dianggap
// "simple request" dan tidak memicu preflight. Di sisi server (Code.gs),
// body ini tetap di-parse sebagai JSON secara manual dari e.postData.contents.
async function apiRequest(action, { method = 'GET', params = {}, body = null } = {}) {
  if (!API_URL || API_URL === 'YOUR_APPS_SCRIPT_URL') {
    throw new Error('API_URL belum diatur. Isi API_URL di script.js dengan URL Web App Apps Script Anda.');
  }

  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.keys(params).forEach(key => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.set(key, params[key]);
    }
  });

  const options = { method };
  if (body !== null) {
    // Sengaja TANPA header Content-Type manual (lihat catatan CORS di atas).
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), options);
  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' ' + response.statusText);
  }

  const hasil = await response.json();
  // Backend membungkus error internal sebagai { success:false, message:'Error server: ...' }
  // alih-alih HTTP error code, agar konsisten dipakai lewat GET maupun POST.
  return hasil;
}

// ==========================================================================
// TAMPILAN MODERN: LOADING / BERHASIL / GAGAL
// Helper terpusat dipakai oleh SEMUA proses penyimpanan data (login,
// transaksi hutang, pembayaran, pelanggan, produk) agar konsisten.
// Catatan: ini murni lapisan tampilan (UI/UX) — tidak ada alur bisnis,
// validasi, atau data yang diubah.
// ==========================================================================

// LOADING: indikator kecil, di tengah, background transparan (tidak fullscreen)
function tampilkanLoadingModern(pesan) {
  Swal.fire({
    html: `
      <div class="modern-spinner-wrap">
        <div class="modern-spinner"></div>
        <div class="modern-spinner-text">${pesan || 'Menyimpan...'}</div>
      </div>
    `,
    background: 'transparent',
    backdrop: 'rgba(15, 23, 42, 0.25)',
    showConfirmButton: false,
    allowOutsideClick: false,
    allowEscapeKey: false,
    customClass: { popup: 'swal-modern-loading-popup' }
  });
}

// BERHASIL: ikon centang hijau, animasi singkat, otomatis tertutup (~1 detik)
function tampilkanSuksesModern(pesan) {
  Swal.fire({
    icon: 'success',
    title: pesan || 'Transaksi berhasil disimpan',
    showConfirmButton: false,
    timer: 1100,
    timerProgressBar: true,
    customClass: { popup: 'swal-modern-success-popup' },
    showClass: { popup: 'swal-fade-scale-in' },
    hideClass: { popup: 'swal-fade-scale-out' }
  });
}

// GAGAL: ikon error modern + tombol "Coba Lagi" (animasi fade + scale)
function tampilkanGagalModern(pesan, onRetry) {
  const opsi = {
    icon: 'error',
    title: 'Gagal',
    text: pesan || 'Gagal menyimpan transaksi',
    reverseButtons: true,
    customClass: { popup: 'swal-modern-error-popup' },
    showClass: { popup: 'swal-fade-scale-in' },
    hideClass: { popup: 'swal-fade-scale-out' }
  };
  if (typeof onRetry === 'function') {
    opsi.confirmButtonText = 'Coba Lagi';
    opsi.showCancelButton = true;
    opsi.cancelButtonText = 'Tutup';
  } else {
    opsi.confirmButtonText = 'Tutup';
  }
  Swal.fire(opsi).then(result => {
    if (result.isConfirmed && typeof onRetry === 'function') {
      onRetry();
    }
  });
}

// --- STATE MANAGEMENT ---
let currentUser = null;
let listProdukGlobal = [];
let keranjang = [];
let listProdukJajan = [];
let keranjangJajan = [];
let pengajuanNotifTimer = null;

function showView(viewId) {
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(viewId);
  if (target) target.classList.add('active');

  const isLogin = (viewId === 'viewLogin');
  const isAdminUser = (!isLogin && currentUser && currentUser.role === 'Admin');
  const isPelangganUser = (!isLogin && currentUser && currentUser.role === 'Pelanggan');

  // Tombol Logout di header HANYA untuk Admin. Untuk Pelanggan, aksi
  // logout dipindahkan ke dalam menu "Pengaturan Akun" (lihat
  // logoutDariPengaturan) supaya header mobile tidak padat/terpotong.
  document.getElementById('btnLogout').style.display = isAdminUser ? 'inline-flex' : 'none';
  document.getElementById('userInfoHeader').style.display = isLogin ? 'none' : 'flex';
  const btnNotifikasi = document.getElementById('btnNotifikasiPengajuan');
  if (btnNotifikasi) {
    btnNotifikasi.style.display = isAdminUser ? 'inline-flex' : 'none';
  }
  const btnPengaturan = document.getElementById('btnPengaturanPelanggan');
  if (btnPengaturan) {
    btnPengaturan.style.display = isPelangganUser ? 'inline-flex' : 'none';
  }

  if (currentUser) {
    document.getElementById('txtUserRole').innerText = `${currentUser.nama} (${currentUser.role})`;
  }

  // Banner ajakan instal PWA HANYA relevan di layar Login (sebelum masuk).
  if (isLogin) {
    maybeShowPwaBanner();
  } else {
    hidePwaBanner();
  }
}

function bukaModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function tutupModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function formatRp(num) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num || 0);
}

function escapeHTML(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ==========================================================================
// SKELETON LOADER — pengganti teks "Memuat..." di seluruh app. Setiap fungsi
// di bawah menghasilkan blok placeholder abu-abu (shimmer, lihat style.css)
// yang bentuknya mengikuti konten asli (baris tabel / kartu list / grid
// produk / baris picker), supaya transisi ke data asli terasa mulus dan
// tidak "meloncat" bentuknya.
// ==========================================================================

function skeletonTableRows(colWidths, count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<tr>' + colWidths.map(w =>
      `<td class="py-3 px-4"><div class="skeleton h-3.5 rounded" style="width:${w}"></div></td>`
    ).join('') + '</tr>';
  }
  return html;
}

function skeletonListCards(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="p-4 flex items-start justify-between gap-3">
        <div class="space-y-2 flex-1 min-w-0">
          <div class="skeleton h-3 rounded" style="width:35%"></div>
          <div class="skeleton h-4 rounded" style="width:65%"></div>
        </div>
        <div class="skeleton h-5 rounded shrink-0" style="width:64px"></div>
      </div>`;
  }
  return html;
}

function skeletonArticleCards(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <article class="border border-slate-100 rounded-2xl p-3.5 sm:p-4">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div class="space-y-2">
            <div class="skeleton h-3 rounded" style="width:120px"></div>
            <div class="skeleton h-2.5 rounded" style="width:80px"></div>
          </div>
          <div class="skeleton h-5 rounded-full" style="width:70px"></div>
        </div>
        <div class="skeleton h-12 rounded-xl"></div>
      </article>`;
  }
  return html;
}

function skeletonGridCards(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="p-2.5 border border-slate-200 rounded-xl">
        <div class="skeleton h-3 rounded mb-2" style="width:85%"></div>
        <div class="skeleton h-3 rounded" style="width:45%"></div>
      </div>`;
  }
  return html;
}

function skeletonPickerRows(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `
      <div class="w-full flex items-center gap-2.5 px-4 py-2.5">
        <div class="skeleton w-8 h-8 rounded-full shrink-0"></div>
        <div class="skeleton h-3.5 rounded flex-1" style="max-width:140px"></div>
      </div>`;
  }
  return html;
}

// ==========================================================================
// ANIMASI ANGKA KPI — dari nilai yang sedang tampil ke nilai baru, halus
// (easing ease-out), dipakai untuk 4 kartu KPI dashboard Admin dan saldo
// dashboard Pelanggan. Menyimpan nilai terakhir per elemen supaya refresh
// berikutnya menghitung dari angka SEBELUMNYA (bukan selalu dari 0).
// ==========================================================================
const _kpiAnimState = {};
const _kpiAnimToken = {};

function animateKpiValue(elId, targetValue, opts) {
  opts = opts || {};
  const isCurrency = opts.isCurrency !== false;
  const duration = opts.duration || 900;
  const el = document.getElementById(elId);
  if (!el) return;

  targetValue = Number(targetValue) || 0;
  const startValue = _kpiAnimState[elId] || 0;
  const change = targetValue - startValue;
  const startTime = performance.now();

  // Token unik per pemanggilan: kalau ada animasi BARU dimulai untuk elemen
  // yang sama sebelum animasi LAMA selesai (mis. tombol Segarkan diklik
  // dobel cepat), animasi lama otomatis berhenti nulis begitu tokennya
  // sudah tidak cocok lagi — supaya tidak ada dua animasi rebutan menulis
  // ke elemen yang sama di frame yang sama (bikin angka kedip/lompat).
  const myToken = Symbol();
  _kpiAnimToken[elId] = myToken;

  function easeOutExpo(t) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }

  function step(now) {
    if (_kpiAnimToken[elId] !== myToken) return; // sudah digantikan animasi yang lebih baru
    const t = Math.min((now - startTime) / duration, 1);
    const current = Math.round(startValue + change * easeOutExpo(t));
    el.innerText = isCurrency ? formatRp(current) : new Intl.NumberFormat('id-ID').format(current);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      _kpiAnimState[elId] = targetValue;
    }
  }
  requestAnimationFrame(step);
}

// --- TOGGLE TAMPILKAN/SEMBUNYIKAN PASSWORD ---
function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const icon = btnEl.querySelector('span');
  const willShow = input.type === 'password';
  input.type = willShow ? 'text' : 'password';
  if (icon) icon.innerText = willShow ? 'visibility' : 'visibility_off';
}

// ==========================================================================
// PWA: AJAKAN INSTAL APLIKASI (khusus Android + browser biasa)
// Tidak tampil untuk: iOS/desktop (banner Android khusus), yang sudah pakai
// versi terpasang (baik lewat PWA maupun APK Kodular — dua-duanya tidak
// akan pernah memicu event beforeinstallprompt), yang sudah menutup manual
// sebelumnya (disimpan di localStorage), dan SELALU disembunyikan begitu
// sudah login (lihat showView).
// ==========================================================================
let pwaDeferredPrompt = null;
const PWA_DISMISS_KEY = 'warungPwaBannerDitutup';

function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isAndroidBrowser() {
  return /Android/i.test(navigator.userAgent || '');
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pwaDeferredPrompt = e;
  maybeShowPwaBanner();
});

window.addEventListener('appinstalled', () => {
  pwaDeferredPrompt = null;
  hidePwaBanner();
});

function maybeShowPwaBanner() {
  const banner = document.getElementById('pwaInstallBanner');
  if (!banner) return;
  const sudahDitutup = localStorage.getItem(PWA_DISMISS_KEY) === '1';
  const bolehTampil = !!pwaDeferredPrompt && isAndroidBrowser() && !isRunningStandalone() && !sudahDitutup && !currentUser;
  banner.classList.toggle('hidden', !bolehTampil);
  if (bolehTampil) banner.classList.add('pwa-banner-show');
}

function hidePwaBanner() {
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.classList.add('hidden');
}

function pwaDismissBanner() {
  localStorage.setItem(PWA_DISMISS_KEY, '1');
  hidePwaBanner();
}

function pwaInstallClick() {
  if (!pwaDeferredPrompt) return;
  pwaDeferredPrompt.prompt();
  pwaDeferredPrompt.userChoice.finally(() => {
    pwaDeferredPrompt = null;
    hidePwaBanner();
  });
}

// Registrasi service worker — syarat wajib supaya Chrome menganggap app ini
// "installable". Dibiarkan diam-diam gagal (mis. saat development lokal
// tanpa https) supaya tidak mengganggu pengalaman pakai app seperti biasa.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';
  const clockEl = document.getElementById('liveClock');
  if (clockEl) clockEl.innerText = timeStr;
}
setInterval(updateClock, 1000);
updateClock();

window.onload = function () {
  const savedUser = localStorage.getItem('warungUserPro');
  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      // Token sesi ditambahkan pada versi pengajuan jajan. Data login lama
      // sengaja diminta masuk ulang agar API baru tetap terlindungi.
      if (!currentUser.sessionToken) throw new Error('Sesi versi lama');
      setupDashboard();
    } catch (e) {
      localStorage.removeItem('warungUserPro');
      showView('viewLogin');
    }
  } else {
    showView('viewLogin');
  }
};

async function handleLogin() {
  const u = document.getElementById('loginUsername').value;
  const p = document.getElementById('loginPassword').value;

  tampilkanLoadingModern('Memeriksa kredensial...');

  try {
    const res = await apiRequest('loginUser', { method: 'POST', body: { username: u, password: p } });
    if (res.success) {
      Swal.close();
      currentUser = res.user;
      localStorage.setItem('warungUserPro', JSON.stringify(res.user));
      setupDashboard();
    } else {
      tampilkanGagalModern(res.message || 'Username atau password salah.', handleLogin);
    }
  } catch (err) {
    tampilkanGagalModern('Gagal terhubung ke server. Periksa koneksi internet Anda.', handleLogin);
  }
}

function logout() {
  if (currentUser && currentUser.sessionToken) {
    // Fire-and-forget: tidak menunggu respons, tidak memblokir proses logout di UI.
    apiRequest('logoutUser', { method: 'POST', body: { actor: currentUser } }).catch(() => {});
  }
  localStorage.removeItem('warungUserPro');
  if (pengajuanNotifTimer) clearInterval(pengajuanNotifTimer);
  pengajuanNotifTimer = null;
  currentUser = null;
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  showView('viewLogin');
}

// Logout dari dalam menu Pengaturan Akun (khusus Pelanggan): tutup modal
// dahulu baru proses logout, supaya transisi ke layar login terasa mulus.
function logoutDariPengaturan() {
  tutupModal('modalPengaturanAkun');
  logout();
}

function bukaModalPengaturanAkun() {
  if (!currentUser || currentUser.role !== 'Pelanggan') return;
  document.getElementById('settingNamaPelanggan').value = currentUser.nama || '';
  document.getElementById('settingUsernamePelanggan').value = currentUser.username || '';
  document.getElementById('settingPasswordLama').value = '';
  document.getElementById('settingPasswordBaru').value = '';
  document.getElementById('settingKonfirmasiPassword').value = '';
  bukaModal('modalPengaturanAkun');
  setTimeout(() => document.getElementById('settingUsernamePelanggan').focus(), 150);
}

async function simpanPengaturanAkun() {
  const username = document.getElementById('settingUsernamePelanggan').value.trim();
  const passwordLama = document.getElementById('settingPasswordLama').value;
  const passwordBaru = document.getElementById('settingPasswordBaru').value;
  const konfirmasi = document.getElementById('settingKonfirmasiPassword').value;
  if (!username || !passwordLama) return Swal.fire('Data Belum Lengkap', 'Username dan password saat ini wajib diisi.', 'warning');
  if (passwordBaru !== konfirmasi) return Swal.fire('Konfirmasi Tidak Sesuai', 'Password baru dan konfirmasi password harus sama.', 'warning');

  tampilkanLoadingModern('Menyimpan pengaturan...');
  try {
    const res = await apiRequest('ubahKredensialPelanggan', {
      method: 'POST',
      body: { actor: currentUser, usernameBaru: username, passwordLama, passwordBaru }
    });
    if (res && res.success) {
      currentUser = { ...currentUser, ...(res.user || {}), username: (res.user && res.user.username) || username };
      localStorage.setItem('warungUserPro', JSON.stringify(currentUser));
      document.getElementById('settingPasswordLama').value = '';
      document.getElementById('settingPasswordBaru').value = '';
      document.getElementById('settingKonfirmasiPassword').value = '';
      tutupModal('modalPengaturanAkun');
      showView('viewCustomerDashboard');
      tampilkanSuksesModern(res.message || 'Pengaturan akun berhasil diperbarui');
    } else {
      tampilkanGagalModern((res && res.message) || 'Pengaturan akun tidak dapat diperbarui.', simpanPengaturanAkun);
    }
  } catch (err) {
    tampilkanGagalModern('Gagal menyimpan pengaturan akun. Silakan masuk ulang.', simpanPengaturanAkun);
  }
}

function setupDashboard() {
  if (currentUser.role === 'Admin') {
    showView('viewAdminDashboard');
    loadAdminData();
    if (pengajuanNotifTimer) clearInterval(pengajuanNotifTimer);
    // Perbarui badge tanpa mengganggu pekerjaan admin yang sedang berjalan.
    pengajuanNotifTimer = setInterval(loadNotifikasiPengajuan, 30000);
  } else {
    if (pengajuanNotifTimer) clearInterval(pengajuanNotifTimer);
    pengajuanNotifTimer = null;
    showView('viewCustomerDashboard');
    document.getElementById('custWelcome').innerText = currentUser.nama;
    loadCustomerData();
  }
}

// --- ADMIN DATA & DASHBOARD ---
function loadAdminData() {
  // Tampilkan skeleton dulu di tabel aktivitas selagi kedua request berjalan.
  document.getElementById('tblRecentAdmin').innerHTML = skeletonTableRows(['20%', '25%', '15%', '30%', '15%', '15%'], 5);

  (async () => {
    try {
      const d = await apiRequest('getAdminDashboardData', { method: 'GET' });
      animateKpiValue('dashTotalHutang', d.totalHutang, { isCurrency: true });
      animateKpiValue('dashPendapatan', d.pendapatan, { isCurrency: true });
      animateKpiValue('dashDeposit', d.deposit, { isCurrency: true });
      animateKpiValue('dashTxCount', d.txCount, { isCurrency: false });
    } catch (err) {
      // Biarkan nilai default tampil bila ringkasan gagal dimuat.
    }
  })();

  (async () => {
    try {
      const data = await apiRequest('getSemuaTransaksi', { method: 'GET' });
      cacheTransaksi(data);
      let html = '';
      if (!data || data.length === 0) {
        html = '<tr><td colspan="6" class="p-6 text-center text-slate-400">Belum ada aktivitas.</td></tr>';
      } else {
        data.slice(0, 5).forEach(t => {
          const isLunas = t.status === 'Sudah Lunas';
          const badgeClass = isLunas ? 'bg-emerald-100 text-emerald-700' : (t.jenis === 'Bayar' ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700');
          html += `
            <tr onclick="bukaDetailTransaksi('${t.id}')" class="hover:bg-slate-50 transition-colors cursor-pointer">
              <td class="py-3 px-4 text-xs font-semibold text-slate-500">${t.tanggal}</td>
              <td class="py-3 px-4 font-bold text-slate-800">${t.nama}</td>
              <td class="py-3 px-4"><span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${t.jenis === 'Bayar' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}">${t.jenis}</span></td>
              <td class="py-3 px-4 text-xs text-slate-600">${t.detailBersih || t.detail}</td>
              <td class="py-3 px-4 text-right font-extrabold ${t.jenis === 'Bayar' ? 'text-emerald-600' : 'text-rose-600'}">${formatRp(t.jenis === 'Bayar' ? t.bayar : t.total)}</td>
              <td class="py-3 px-4 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeClass}">${t.status}</span></td>
            </tr>
          `;
        });
      }
      document.getElementById('tblRecentAdmin').innerHTML = html;
    } catch (err) {
      document.getElementById('tblRecentAdmin').innerHTML = '<tr><td colspan="6" class="p-6 text-center text-rose-500">Gagal memuat aktivitas terbaru.</td></tr>';
    }
  })();

  loadNotifikasiPengajuan();
}

async function loadNotifikasiPengajuan() {
  if (!currentUser || currentUser.role !== 'Admin') return;
  try {
    const res = await apiRequest('getRingkasanPengajuanAdmin', { method: 'POST', body: { actor: currentUser } });
    const jumlah = Number(res && res.pending) || 0;
    const badge = document.getElementById('badgePengajuanPending');
    if (!badge) return;
    badge.innerText = jumlah > 99 ? '99+' : jumlah;
    badge.classList.toggle('hidden', jumlah <= 0);
  } catch (err) {
    // Tidak mengganggu dashboard lama bila sesi pengajuan telah kedaluwarsa.
    const badge = document.getElementById('badgePengajuanPending');
    if (badge) badge.classList.add('hidden');
  }
}

// --- CUSTOMER DATA ---
async function loadCustomerData(range) {
  range = range || 30;

  // Tandai tombol filter yang sedang aktif
  document.querySelectorAll('.filter-riwayat-btn').forEach(btn => {
    btn.classList.toggle('active', String(btn.dataset.range) === String(range));
  });

  document.getElementById('listRiwayatPelanggan').innerHTML = skeletonListCards(4);

  try {
    const res = await apiRequest('getRiwayatPelangganLogin', {
      method: 'GET',
      params: { nama: currentUser.nama, range: range }
    });
    animateKpiValue('custHutang', res.saldo.sisaHutang, { isCurrency: true });
    animateKpiValue('custDeposit', res.saldo.totalDeposit, { isCurrency: true });
    cacheTransaksi(res.transaksi);

    let html = '';
    if (!res.transaksi || res.transaksi.length === 0) {
      html = '<div class="p-8 text-center text-slate-400 text-xs">Belum ada riwayat transaksi.</div>';
    } else {
      res.transaksi.forEach(t => {
        const isLunas = t.status === 'Sudah Lunas';
        const statusBg = isLunas ? 'bg-emerald-100 text-emerald-700' : (t.jenis === 'Bayar' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-800');
        html += `
          <div onclick="bukaDetailTransaksi('${t.id}')" class="p-4 hover:bg-slate-50 active:bg-slate-100 transition-colors flex items-start justify-between gap-3 cursor-pointer">
            <div class="space-y-1">
              <div class="flex items-center space-x-2">
                <span class="text-xs font-bold text-slate-400">${t.tanggal}</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBg}">${t.status}</span>
              </div>
              <h4 class="font-bold text-slate-800 text-sm">${t.detailBersih || t.detail}</h4>
            </div>
            <div class="text-right shrink-0 flex items-center gap-1">
              <div>
                <span class="text-xs text-slate-400 block">${t.jenis}</span>
                <span class="font-black text-sm ${t.jenis === 'Bayar' ? 'text-emerald-600' : 'text-rose-600'}">${formatRp(t.jenis === 'Bayar' ? t.bayar : t.total)}</span>
              </div>
              <span class="material-icons-outlined text-slate-300 text-lg">chevron_right</span>
            </div>
          </div>
        `;
      });
    }
    document.getElementById('listRiwayatPelanggan').innerHTML = html;

    // Info berapa transaksi yang disembunyikan oleh filter saat ini
    const infoEl = document.getElementById('infoRiwayatPelanggan');
    const totalRiwayat = res.totalRiwayat || res.transaksi.length;
    if (totalRiwayat > res.transaksi.length) {
      infoEl.classList.remove('hidden');
      infoEl.innerText = `Menampilkan ${res.transaksi.length} dari ${totalRiwayat} transaksi. Transaksi "Masih Hutang" selalu ditampilkan apapun umurnya.`;
    } else {
      infoEl.classList.add('hidden');
    }
  } catch (err) {
    document.getElementById('listRiwayatPelanggan').innerHTML = '<div class="p-8 text-center text-rose-500 text-xs">Gagal memuat riwayat transaksi.</div>';
  }
}

// --- PENGAJUAN JAJAN PELANGGAN ---
async function bukaModalCatatJajan() {
  keranjangJajan = [];
  listProdukJajan = [];
  document.getElementById('cariProdukJajan').value = '';
  renderKeranjangJajan();
  document.getElementById('gridProdukJajan').innerHTML = skeletonGridCards(6);
  bukaModal('modalCatatJajan');

  try {
    const data = await apiRequest('getProdukUntukPengajuan', { method: 'POST', body: { actor: currentUser } });
    listProdukJajan = Array.isArray(data) ? data : [];
    renderGridProdukJajan('');
  } catch (err) {
    document.getElementById('gridProdukJajan').innerHTML = '<div class="col-span-2 sm:col-span-3 text-center text-rose-500 text-xs py-4">Gagal memuat produk. Silakan masuk ulang.</div>';
  }
}

function renderGridProdukJajan(searchTerm) {
  const term = (searchTerm || '').toLowerCase().trim();
  const list = term ? listProdukJajan.filter(p => String(p.nama).toLowerCase().includes(term)) : listProdukJajan;
  const grid = document.getElementById('gridProdukJajan');
  if (!list.length) {
    grid.innerHTML = '<div class="col-span-2 sm:col-span-3 text-center text-slate-400 text-xs py-4">Produk tidak ditemukan.</div>';
    return;
  }
  grid.innerHTML = list.map(p => `
    <button type="button" onclick="pilihProdukJajan('${encodeURIComponent(String(p.id))}')" class="produk-card text-left p-2.5 bg-white border border-slate-200 rounded-xl hover:border-emerald-500 hover:bg-emerald-50/60 transition-all shadow-sm">
      <div class="font-bold text-slate-800 text-xs leading-tight truncate">${escapeHTML(p.nama)}</div>
      <div class="text-emerald-600 font-bold text-[11px] mt-0.5">${formatRp(p.harga)}</div>
    </button>
  `).join('');
}

function pilihProdukJajan(encodedId) {
  const id = decodeURIComponent(encodedId);
  const produk = listProdukJajan.find(p => String(p.id) === id);
  if (!produk) return;
  const item = keranjangJajan.find(k => String(k.id) === id);
  if (item) {
    item.qty += 1;
    item.subtotal = item.qty * item.harga;
  } else {
    keranjangJajan.push({ id: produk.id, nama: produk.nama, harga: Number(produk.harga) || 0, qty: 1, subtotal: Number(produk.harga) || 0 });
  }
  renderKeranjangJajan();
}

function ubahQtyJajan(index, delta) {
  const item = keranjangJajan[index];
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) keranjangJajan.splice(index, 1);
  else item.subtotal = item.qty * item.harga;
  renderKeranjangJajan();
}

function hapusItemJajan(index) {
  keranjangJajan.splice(index, 1);
  renderKeranjangJajan();
}

function totalKeranjangJajan() {
  return keranjangJajan.reduce((total, item) => total + (Number(item.subtotal) || 0), 0);
}

function renderKeranjangJajan() {
  const container = document.getElementById('listKeranjangJajan');
  const total = totalKeranjangJajan();
  document.getElementById('txtTotalJajan').innerText = formatRp(total);
  document.getElementById('jumlahItemJajan').innerText = `${keranjangJajan.reduce((n, item) => n + item.qty, 0)} barang`;
  if (!keranjangJajan.length) {
    container.innerHTML = '<div class="p-5 text-center text-slate-400 text-xs">Keranjang masih kosong. Pilih barang di atas.</div>';
    return;
  }
  container.innerHTML = keranjangJajan.map((item, index) => `
    <div class="p-3 flex items-center gap-2">
      <div class="min-w-0 flex-1">
        <div class="font-bold text-slate-800 text-sm truncate">${escapeHTML(item.nama)}</div>
        <div class="text-[11px] font-semibold text-emerald-600 mt-0.5">${formatRp(item.harga)} · ${formatRp(item.subtotal)}</div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button type="button" onclick="ubahQtyJajan(${index}, -1)" class="qty-btn w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold">−</button>
        <span class="w-5 text-center text-sm font-black">${item.qty}</span>
        <button type="button" onclick="ubahQtyJajan(${index}, 1)" class="qty-btn w-7 h-7 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold">+</button>
        <button type="button" onclick="hapusItemJajan(${index})" class="ml-1 w-7 h-7 rounded-lg text-rose-500 hover:bg-rose-50 flex items-center justify-center" aria-label="Hapus barang"><span class="material-icons-outlined text-base">delete_outline</span></button>
      </div>
    </div>
  `).join('');
}

function kirimPengajuanJajan() {
  if (!keranjangJajan.length) return Swal.fire('Keranjang Kosong', 'Pilih setidaknya satu barang terlebih dahulu.', 'warning');
  const total = totalKeranjangJajan();
  Swal.fire({
    title: 'Kirim pengajuan?',
    html: `<div class="text-sm text-slate-500">Total pengajuan <b class="text-emerald-700">${formatRp(total)}</b>.<br>Pengajuan belum menjadi hutang sebelum disetujui admin.</div>`,
    icon: 'question', showCancelButton: true, confirmButtonText: 'Ya, Kirim', cancelButtonText: 'Periksa Lagi',
    confirmButtonColor: '#16a34a'
  }).then(async result => {
    if (!result.isConfirmed) return;
    tampilkanLoadingModern('Mengirim pengajuan...');
    const items = keranjangJajan.map(item => ({ id: item.id, qty: item.qty }));
    try {
      const res = await apiRequest('buatPengajuanJajan', { method: 'POST', body: { actor: currentUser, items } });
      if (res && res.success) {
        tampilkanSuksesModern(res.message || 'Pengajuan berhasil dikirim');
        keranjangJajan = [];
        tutupModal('modalCatatJajan');
      } else {
        tampilkanGagalModern((res && res.message) || 'Pengajuan tidak dapat dikirim.', kirimPengajuanJajan);
      }
    } catch (err) {
      tampilkanGagalModern('Gagal mengirim pengajuan. Sesi mungkin telah berakhir.', kirimPengajuanJajan);
    }
  });
}

function statusPengajuanMeta(status) {
  const daftar = {
    Pending: { label: '🟡 Pending', cls: 'bg-amber-100 text-amber-800' },
    Approved: { label: '🟢 Approved', cls: 'bg-emerald-100 text-emerald-700' },
    Rejected: { label: '🔴 Rejected', cls: 'bg-rose-100 text-rose-700' },
    Dibatalkan: { label: '⚪ Dibatalkan', cls: 'bg-slate-100 text-slate-600' }
  };
  return daftar[status] || { label: escapeHTML(status), cls: 'bg-slate-100 text-slate-600' };
}

function detailItemPengajuan(items, fallback) {
  if (!Array.isArray(items) || !items.length) return `<p class="text-xs text-slate-500">${escapeHTML(fallback || '-')}</p>`;
  return `<ul class="space-y-1">${items.map(item => `<li class="text-xs text-slate-600 flex justify-between gap-2"><span class="truncate">${escapeHTML(item.nama)} <span class="text-slate-400">×${Number(item.qty) || 0}</span></span><span class="font-bold text-slate-700 shrink-0">${formatRp(item.subtotal)}</span></li>`).join('')}</ul>`;
}

function bukaModalStatusPesanan() {
  bukaModal('modalStatusPesanan');
  muatStatusPesanan();
}

async function muatStatusPesanan() {
  const container = document.getElementById('listStatusPesanan');
  container.innerHTML = skeletonArticleCards(3);
  try {
    const data = await apiRequest('getPengajuanPelanggan', { method: 'POST', body: { actor: currentUser } });
    if (!Array.isArray(data) || !data.length) {
      container.innerHTML = '<div class="p-10 text-center"><span class="material-icons-outlined text-slate-300 text-4xl">inbox</span><p class="text-slate-400 text-sm mt-2">Belum ada pengajuan jajan.</p></div>';
      return;
    }
    container.innerHTML = data.map(pengajuan => renderStatusPesanan(pengajuan)).join('');
  } catch (err) {
    container.innerHTML = '<div class="p-8 text-center text-rose-500 text-xs">Gagal memuat pengajuan. Silakan masuk ulang.</div>';
  }
}

function renderStatusPesanan(pengajuan) {
  const meta = statusPengajuanMeta(pengajuan.status);
  let infoStatus = '';
  if (pengajuan.status === 'Approved') {
    infoStatus = `Disetujui ${escapeHTML(pengajuan.approvedBy || 'admin')} · ${escapeHTML(pengajuan.tanggalApprove || '-')} ${escapeHTML(pengajuan.jamApprove || '')}`;
  } else if (pengajuan.status === 'Rejected') {
    infoStatus = `Ditolak ${escapeHTML(pengajuan.rejectedBy || 'admin')} · ${escapeHTML(pengajuan.tanggalReject || '-')} ${escapeHTML(pengajuan.jamReject || '')}`;
    if (pengajuan.alasanPenolakan) infoStatus += `<br><span class="text-rose-600">Alasan: ${escapeHTML(pengajuan.alasanPenolakan)}</span>`;
  } else if (pengajuan.status === 'Dibatalkan') {
    infoStatus = `Dibatalkan · ${escapeHTML(pengajuan.tanggalBatal || '-')} ${escapeHTML(pengajuan.jamBatal || '')}`;
  } else {
    infoStatus = 'Menunggu persetujuan admin';
  }
  const tombolBatal = pengajuan.status === 'Pending'
    ? `<button onclick="batalkanPengajuanJajan('${encodeURIComponent(pengajuan.id)}')" class="mt-3 text-xs font-bold text-rose-600 hover:text-rose-700">Batalkan pengajuan</button>` : '';
  return `<article class="border border-slate-100 rounded-2xl p-3.5 sm:p-4 shadow-sm">
    <div class="flex items-start justify-between gap-3 mb-3"><div><p class="font-bold text-slate-800 text-sm">${escapeHTML(pengajuan.tanggal)} <span class="font-medium text-slate-400">· ${escapeHTML(pengajuan.jam)}</span></p><p class="text-[11px] text-slate-400 mt-0.5">ID: ${escapeHTML(pengajuan.id)}</p></div><span class="px-2.5 py-1 rounded-full text-[10px] font-bold whitespace-nowrap ${meta.cls}">${meta.label}</span></div>
    <div class="bg-slate-50 rounded-xl p-3">${detailItemPengajuan(pengajuan.items, pengajuan.detail)}</div>
    <div class="mt-3 flex items-end justify-between gap-3"><p class="text-[11px] leading-relaxed text-slate-500">${infoStatus}</p><p class="text-sm font-black text-emerald-700 shrink-0">${formatRp(pengajuan.total)}</p></div>${tombolBatal}
  </article>`;
}

function batalkanPengajuanJajan(encodedId) {
  const id = decodeURIComponent(encodedId);
  Swal.fire({ title: 'Batalkan pengajuan?', text: 'Pengajuan yang dibatalkan tidak akan dicatat sebagai hutang.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Ya, Batalkan', cancelButtonText: 'Kembali', confirmButtonColor: '#e11d48' }).then(async result => {
    if (!result.isConfirmed) return;
    tampilkanLoadingModern('Membatalkan pengajuan...');
    try {
      const res = await apiRequest('batalkanPengajuanJajan', { method: 'POST', body: { actor: currentUser, idPengajuan: id } });
      if (res && res.success) {
        tampilkanSuksesModern(res.message || 'Pengajuan dibatalkan');
        muatStatusPesanan();
      } else {
        tampilkanGagalModern((res && res.message) || 'Pengajuan tidak dapat dibatalkan.');
      }
    } catch (err) {
      tampilkanGagalModern('Gagal membatalkan pengajuan.');
    }
  });
}

// --- PENGAJUAN JAJAN ADMIN ---
function bukaModalPengajuanAdmin() {
  bukaModal('modalPengajuanAdmin');
  muatPengajuanAdmin();
}

async function muatPengajuanAdmin() {
  const container = document.getElementById('listPengajuanAdmin');
  container.innerHTML = skeletonArticleCards(3);
  try {
    const data = await apiRequest('getPengajuanPendingAdmin', { method: 'POST', body: { actor: currentUser } });
    if (!Array.isArray(data) || !data.length) {
      container.innerHTML = '<div class="p-10 text-center"><span class="material-icons-outlined text-emerald-300 text-4xl">task_alt</span><p class="text-slate-500 text-sm font-semibold mt-2">Tidak ada pengajuan Pending.</p></div>';
      return;
    }
    container.innerHTML = data.map(pengajuan => `
      <article class="border border-slate-100 rounded-2xl p-3.5 sm:p-4 shadow-sm">
        <div class="flex items-start justify-between gap-3"><div><h4 class="font-bold text-slate-800 text-sm">${escapeHTML(pengajuan.nama)}</h4><p class="text-[11px] text-slate-400 mt-0.5">${escapeHTML(pengajuan.tanggal)} · ${escapeHTML(pengajuan.jam)}</p></div><span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">🟡 Pending</span></div>
        <div class="mt-3 bg-slate-50 rounded-xl p-3">${detailItemPengajuan(pengajuan.items, pengajuan.detail)}</div>
        <div class="mt-3 flex items-center justify-between gap-3"><span class="text-sm font-black text-emerald-700">${formatRp(pengajuan.total)}</span><div class="flex gap-2"><button onclick="tolakPengajuanAdmin('${encodeURIComponent(pengajuan.id)}')" class="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold">Reject</button><button onclick="setujuiPengajuanAdmin('${encodeURIComponent(pengajuan.id)}')" class="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold">Approve</button></div></div>
      </article>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="p-8 text-center text-rose-500 text-xs">Gagal memuat pengajuan. Silakan masuk ulang.</div>';
  }
}

function setujuiPengajuanAdmin(encodedId) {
  const id = decodeURIComponent(encodedId);
  Swal.fire({ title: 'Setujui pengajuan?', text: 'Pesanan akan langsung dicatat sebagai hutang melalui proses Catat Hutang yang sama.', icon: 'question', showCancelButton: true, confirmButtonText: 'Approve', cancelButtonText: 'Kembali', confirmButtonColor: '#16a34a' }).then(async result => {
    if (!result.isConfirmed) return;
    tampilkanLoadingModern('Menyetujui pengajuan...');
    try {
      const res = await apiRequest('approvePengajuanJajan', { method: 'POST', body: { actor: currentUser, idPengajuan: id } });
      if (res && res.success) {
        tampilkanSuksesModern(res.message || 'Pengajuan disetujui');
        muatPengajuanAdmin();
        loadAdminData();
      } else {
        tampilkanGagalModern((res && res.message) || 'Pengajuan tidak dapat disetujui.');
      }
    } catch (err) {
      tampilkanGagalModern('Gagal menyetujui pengajuan.');
    }
  });
}

function tolakPengajuanAdmin(encodedId) {
  const id = decodeURIComponent(encodedId);
  Swal.fire({ title: 'Tolak pengajuan?', input: 'text', inputLabel: 'Alasan penolakan (opsional)', inputPlaceholder: 'Contoh: stok barang habis', icon: 'warning', showCancelButton: true, confirmButtonText: 'Reject', cancelButtonText: 'Kembali', confirmButtonColor: '#e11d48' }).then(async result => {
    if (!result.isConfirmed) return;
    tampilkanLoadingModern('Menolak pengajuan...');
    try {
      const res = await apiRequest('rejectPengajuanJajan', { method: 'POST', body: { actor: currentUser, idPengajuan: id, alasan: result.value || '' } });
      if (res && res.success) {
        tampilkanSuksesModern(res.message || 'Pengajuan ditolak');
        muatPengajuanAdmin();
        loadNotifikasiPengajuan();
      } else {
        tampilkanGagalModern((res && res.message) || 'Pengajuan tidak dapat ditolak.');
      }
    } catch (err) {
      tampilkanGagalModern('Gagal menolak pengajuan.');
    }
  });
}

// --- UTIL: default tanggal/jam = sekarang (input datetime-local butuh format lokal, bukan UTC) ---
function setDefaultWaktu(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  el.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function resetLabelPelanggan(labelId) {
  const lbl = document.getElementById(labelId);
  lbl.innerText = 'Cari atau pilih pelanggan';
  lbl.classList.add('text-slate-400');
}

// --- MODAL ACTIONS: CATAT HUTANG ---
async function bukaModalCatatHutang() {
  keranjang = []; renderKeranjang();
  document.getElementById('selectPelangganHutang').value = '';
  resetLabelPelanggan('labelPelangganHutang');
  document.getElementById('catatanHutang').value = '';
  document.getElementById('cariProdukHutang').value = '';
  setDefaultWaktu('waktuTransaksiHutang');

  document.getElementById('gridProdukHutang').innerHTML = skeletonGridCards(6);
  bukaModal('modalTambahHutang');

  try {
    const data = await apiRequest('getProdukList', { method: 'GET' });
    listProdukGlobal = data;
    renderGridProduk('');
  } catch (err) {
    document.getElementById('gridProdukHutang').innerHTML = '<div class="col-span-2 sm:col-span-3 text-center text-rose-500 text-xs py-4">Gagal memuat produk.</div>';
  }
}

// --- GRID PRODUK: tap = langsung masuk keranjang ---
function renderGridProduk(searchTerm) {
  const term = (searchTerm || '').toLowerCase().trim();
  const list = term ? listProdukGlobal.filter(p => p.nama.toLowerCase().includes(term)) : listProdukGlobal;
  const grid = document.getElementById('gridProdukHutang');

  if (!list.length) {
    grid.innerHTML = '<div class="col-span-2 sm:col-span-3 text-center text-slate-400 text-xs py-4">Produk tidak ditemukan.</div>';
    return;
  }

  grid.innerHTML = list.map(p => `
    <button type="button" onclick="pilihProdukKeranjang('${p.id}')"
      class="produk-card text-left p-2.5 bg-white border border-slate-200 rounded-xl hover:border-emerald-500 hover:bg-emerald-50/60 transition-all shadow-sm">
      <div class="font-bold text-slate-800 text-xs leading-tight truncate">${p.nama}</div>
      <div class="text-emerald-600 font-bold text-[11px] mt-0.5">${formatRp(p.harga)}</div>
    </button>
  `).join('');
}

// --- KERANJANG: tap produk yang sama = qty bertambah, tanpa baris baru ---
function pilihProdukKeranjang(id) {
  const prd = listProdukGlobal.find(p => p.id === id);
  if (!prd) return;

  const existing = keranjang.find(k => k.id === id);
  if (existing) {
    existing.qty += 1;
    existing.subtotal = existing.qty * existing.harga;
  } else {
    keranjang.push({ id: prd.id, nama: prd.nama, harga: prd.harga, qty: 1, subtotal: prd.harga });
  }
  renderKeranjang();
}

// --- Tombol [-] / [+] pada item keranjang, realtime. Qty 0 = otomatis dihapus ---
function ubahQtyKeranjang(idx, delta) {
  const item = keranjang[idx];
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) {
    keranjang.splice(idx, 1);
  } else {
    item.subtotal = item.qty * item.harga;
  }
  renderKeranjang();
}

function renderKeranjang() {
  let html = '', total = 0;
  keranjang.forEach((k, i) => {
    total += k.subtotal;
    html += `
      <tr>
        <td class="p-2.5 font-bold text-slate-800">${k.nama}</td>
        <td class="p-2.5">${formatRp(k.harga)}</td>
        <td class="p-2.5">
          <div class="flex items-center justify-center gap-1.5">
            <button type="button" onclick="ubahQtyKeranjang(${i}, -1)" class="qty-btn w-6 h-6 flex items-center justify-center rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-sm">−</button>
            <span class="w-5 text-center font-bold">${k.qty}</span>
            <button type="button" onclick="ubahQtyKeranjang(${i}, 1)" class="qty-btn w-6 h-6 flex items-center justify-center rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-bold text-sm">+</button>
          </div>
        </td>
        <td class="p-2.5 text-right font-bold text-slate-800">${formatRp(k.subtotal)}</td>
      </tr>
    `;
  });
  document.getElementById('tblKeranjang').innerHTML = html || '<tr><td colspan="4" class="p-4 text-center text-slate-400">Keranjang kosong</td></tr>';
  document.getElementById('txtTotalBelanja').innerText = formatRp(total);
}

async function prosesSimpanHutang() {
  let nama = document.getElementById('selectPelangganHutang').value;
  if (!nama || keranjang.length === 0) return Swal.fire('Data Belum Lengkap', 'Pilih pelanggan dan produk!', 'warning');

  const waktu = document.getElementById('waktuTransaksiHutang').value;
  const catatan = document.getElementById('catatanHutang').value;

  tampilkanLoadingModern('Menyimpan transaksi...');

  try {
    const res = await apiRequest('simpanTransaksiHutang', {
      method: 'POST',
      body: {
        namaPelanggan: nama,
        items: keranjang,
        total: keranjang.reduce((a, b) => a + b.subtotal, 0),
        adminName: currentUser.nama,
        tanggalWaktu: waktu,
        catatan: catatan
      }
    });
    if (res && res.success) {
      tampilkanSuksesModern(res.message || 'Transaksi berhasil disimpan');
      tutupModal('modalTambahHutang');
      loadAdminData();
    } else {
      tampilkanGagalModern((res && res.message) || 'Gagal menyimpan transaksi.', prosesSimpanHutang);
    }
  } catch (err) {
    tampilkanGagalModern('Gagal menyimpan transaksi. Periksa koneksi internet Anda.', prosesSimpanHutang);
  }
}

// --- MODAL ACTIONS: TERIMA BAYAR ---
function bukaModalTerimaBayar() {
  document.getElementById('selectPelangganBayar').value = '';
  resetLabelPelanggan('labelPelangganBayar');
  document.getElementById('inputNominalBayar').value = '';
  document.getElementById('inputKetBayar').value = '';
  setDefaultWaktu('waktuTransaksiBayar');
  bukaModal('modalTerimaBayar');
}

function setFastNominal(val) {
  document.getElementById('inputNominalBayar').value = val;
}

async function prosesSimpanBayar() {
  let n = document.getElementById('selectPelangganBayar').value;
  let nom = document.getElementById('inputNominalBayar').value;
  if (!n || !nom) return Swal.fire('Peringatan', 'Isi data pembayaran dengan benar!', 'warning');

  const waktu = document.getElementById('waktuTransaksiBayar').value;

  tampilkanLoadingModern('Menyimpan transaksi...');

  try {
    const res = await apiRequest('simpanPembayaran', {
      method: 'POST',
      body: {
        namaPelanggan: n,
        nominal: nom,
        metode: document.getElementById('selectMetodeBayar').value,
        keterangan: document.getElementById('inputKetBayar').value,
        adminName: currentUser.nama,
        tanggalWaktu: waktu
      }
    });
    if (res && res.success) {
      tampilkanSuksesModern(res.message || 'Transaksi berhasil disimpan');
      document.getElementById('inputNominalBayar').value = '';
      tutupModal('modalTerimaBayar');
      loadAdminData();
    } else {
      tampilkanGagalModern((res && res.message) || 'Gagal menyimpan transaksi.', prosesSimpanBayar);
    }
  } catch (err) {
    tampilkanGagalModern('Gagal menyimpan transaksi. Periksa koneksi internet Anda.', prosesSimpanBayar);
  }
}

// --- PICKER PELANGGAN MODERN (dipakai bersama oleh Catat Hutang & Terima Bayar) ---
let pickerContext = null; // 'hutang' | 'bayar'
let daftarPelangganGlobal = [];

async function bukaPickerPelanggan(context) {
  pickerContext = context;
  document.getElementById('cariPelangganPicker').value = '';
  document.getElementById('listPickerPelanggan').innerHTML = skeletonPickerRows(6);

  bukaModal('modalPickerPelanggan');
  setTimeout(() => document.getElementById('cariPelangganPicker').focus(), 200);

  try {
    const data = await apiRequest('getPelangganList', { method: 'GET' });
    daftarPelangganGlobal = data;
    renderPickerPelanggan('');
  } catch (err) {
    document.getElementById('listPickerPelanggan').innerHTML = '<div class="p-6 text-center text-rose-500 text-xs">Gagal memuat data pelanggan.</div>';
  }
}

function getRecentPelanggan() {
  try { return JSON.parse(localStorage.getItem('warungRecentPelanggan') || '[]'); }
  catch (e) { return []; }
}

function simpanRecentPelanggan(nama) {
  let list = getRecentPelanggan().filter(n => n.toLowerCase() !== nama.toLowerCase());
  list.unshift(nama);
  localStorage.setItem('warungRecentPelanggan', JSON.stringify(list.slice(0, 5)));
}

function renderDaftarPelangganHTML(list) {
  return list.map(p => `
    <button type="button" onclick="pilihPelangganDariPicker('${p.nama.replace(/'/g, "\\'")}')"
      class="w-full flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-emerald-50 active:bg-emerald-100 transition-colors text-left">
      <span class="flex items-center gap-2.5 min-w-0">
        <span class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">${p.nama.charAt(0).toUpperCase()}</span>
        <span class="font-semibold text-slate-800 text-sm truncate">${p.nama}</span>
      </span>
      <span class="text-[11px] font-bold text-rose-500 shrink-0">${formatRp(p.sisaHutang)}</span>
    </button>
  `).join('');
}

function renderPickerPelanggan(searchTerm) {
  const term = (searchTerm || '').toLowerCase().trim();
  const container = document.getElementById('listPickerPelanggan');

  // Mode pencarian aktif: tampilkan hasil filter saja (flat list)
  if (term) {
    const hasil = daftarPelangganGlobal.filter(p => p.nama.toLowerCase().includes(term));
    container.innerHTML = hasil.length
      ? renderDaftarPelangganHTML(hasil)
      : '<div class="p-6 text-center text-slate-400 text-xs">Pelanggan tidak ditemukan.</div>';
    return;
  }

  // Tampilan default: Terakhir Dipilih (maks 5) + Semua Pelanggan
  const recentData = getRecentPelanggan()
    .map(n => daftarPelangganGlobal.find(p => p.nama.toLowerCase() === n.toLowerCase()))
    .filter(Boolean)
    .slice(0, 5);

  let html = '';
  if (recentData.length) {
    html += `<div class="px-4 pt-3 pb-1.5 text-[11px] font-bold text-amber-600 uppercase tracking-wider flex items-center gap-1">
      <span>⭐</span><span>Terakhir Dipilih</span>
    </div>`;
    html += renderDaftarPelangganHTML(recentData);
    html += `<div class="border-t border-slate-100 my-1"></div>`;
  }

  html += `<div class="px-4 pt-2 pb-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Semua Pelanggan</div>`;
  html += daftarPelangganGlobal.length
    ? renderDaftarPelangganHTML(daftarPelangganGlobal)
    : '<div class="p-6 text-center text-slate-400 text-xs">Belum ada data pelanggan.</div>';

  container.innerHTML = html;
}

function pilihPelangganDariPicker(nama) {
  simpanRecentPelanggan(nama);

  if (pickerContext === 'hutang') {
    document.getElementById('selectPelangganHutang').value = nama;
    const lbl = document.getElementById('labelPelangganHutang');
    lbl.innerText = nama;
    lbl.classList.remove('text-slate-400');
  } else if (pickerContext === 'bayar') {
    document.getElementById('selectPelangganBayar').value = nama;
    const lbl = document.getElementById('labelPelangganBayar');
    lbl.innerText = nama;
    lbl.classList.remove('text-slate-400');
  }

  tutupModal('modalPickerPelanggan');
}

function bukaModalPelanggan() {
  loadTabelPelanggan();
  bukaModal('modalPelanggan');
}

async function loadTabelPelanggan() {
  document.getElementById('tblPelanggan').innerHTML = skeletonTableRows(['30%', '25%', '20%', '15%'], 4);
  try {
    const data = await apiRequest('getPelangganList', { method: 'GET' });
    let html = '';
    data.forEach(p => {
      html += `
        <tr class="hover:bg-slate-50">
          <td class="p-2.5 font-bold text-slate-800">${p.nama}</td>
          <td class="p-2.5 text-slate-500">${p.username}</td>
          <td class="p-2.5 font-bold text-rose-600">${formatRp(p.sisaHutang)}</td>
          <td class="p-2.5 text-center"><button onclick="hpsPlg('${p.id}')" class="px-2 py-1 bg-rose-100 text-rose-600 rounded font-bold hover:bg-rose-200">Hapus</button></td>
        </tr>
      `;
    });
    document.getElementById('tblPelanggan').innerHTML = html;
  } catch (err) {
    document.getElementById('tblPelanggan').innerHTML = '<tr><td colspan="4" class="p-4 text-center text-rose-500">Gagal memuat data pelanggan.</td></tr>';
  }
}

async function prosesTambahPelanggan() {
  let n = document.getElementById('addNamaP').value, u = document.getElementById('addUsernameP').value, p = document.getElementById('addPasswordP').value;
  if (!n || !u || !p) return Swal.fire('Error', 'Semua kolom wajib diisi!', 'warning');

  tampilkanLoadingModern('Menyimpan pelanggan...');

  try {
    const res = await apiRequest('tambahPelanggan', { method: 'POST', body: { nama: n, username: u, password: p } });
    tampilkanSuksesModern((res && res.message) || 'Pelanggan berhasil disimpan');
    document.getElementById('addNamaP').value = '';
    document.getElementById('addUsernameP').value = '';
    document.getElementById('addPasswordP').value = '';
    loadTabelPelanggan();
  } catch (err) {
    tampilkanGagalModern('Gagal menyimpan data pelanggan. Periksa koneksi internet Anda.', prosesTambahPelanggan);
  }
}

function hpsPlg(id) {
  Swal.fire({
    title: 'Hapus Pelanggan?',
    text: 'Aksi ini tidak dapat dibatalkan.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Ya, Hapus'
  }).then(async res => {
    if (res.isConfirmed) {
      tampilkanLoadingModern('Menghapus data...');
      try {
        const result = await apiRequest('hapusPelanggan', { method: 'POST', body: { id } });
        if (result && result.success === false) {
          tampilkanGagalModern(result.message || 'Gagal menghapus pelanggan.', () => hpsPlg(id));
          return;
        }
        tampilkanSuksesModern((result && result.message) || 'Pelanggan berhasil dihapus');
        loadTabelPelanggan();
      } catch (err) {
        tampilkanGagalModern('Gagal menghapus pelanggan. Periksa koneksi internet Anda.', () => hpsPlg(id));
      }
    }
  });
}

function bukaModalProduk() {
  loadTabelProduk();
  bukaModal('modalProduk');
}

async function loadTabelProduk() {
  document.getElementById('tblProduk').innerHTML = skeletonTableRows(['45%', '30%', '25%'], 4);
  try {
    const data = await apiRequest('getProdukList', { method: 'GET' });
    let html = '';
    data.forEach(p => {
      html += `
        <tr class="hover:bg-slate-50">
          <td class="p-2.5 font-bold text-slate-800">${p.nama}</td>
          <td class="p-2.5 font-bold text-emerald-600">${formatRp(p.harga)}</td>
          <td class="p-2.5 text-center"><button onclick="hpsPrd('${p.id}')" class="px-2 py-1 bg-rose-100 text-rose-600 rounded font-bold hover:bg-rose-200">Hapus</button></td>
        </tr>
      `;
    });
    document.getElementById('tblProduk').innerHTML = html;
  } catch (err) {
    document.getElementById('tblProduk').innerHTML = '<tr><td colspan="3" class="p-4 text-center text-rose-500">Gagal memuat data barang.</td></tr>';
  }
}

async function prosesTambahProduk() {
  let n = document.getElementById('addNamaPrd').value, h = document.getElementById('addHargaPrd').value;
  if (!n || !h) return Swal.fire('Error', 'Isi nama & harga produk!', 'warning');

  tampilkanLoadingModern('Menyimpan produk...');

  try {
    const res = await apiRequest('tambahProduk', { method: 'POST', body: { nama: n, harga: h } });
    tampilkanSuksesModern((res && res.message) || 'Produk berhasil disimpan');
    document.getElementById('addNamaPrd').value = '';
    document.getElementById('addHargaPrd').value = '';
    loadTabelProduk();
  } catch (err) {
    tampilkanGagalModern('Gagal menyimpan produk. Periksa koneksi internet Anda.', prosesTambahProduk);
  }
}

function hpsPrd(id) {
  Swal.fire({
    title: 'Hapus Produk?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Ya, Hapus'
  }).then(async res => {
    if (res.isConfirmed) {
      tampilkanLoadingModern('Menghapus data...');
      try {
        const result = await apiRequest('hapusProduk', { method: 'POST', body: { id } });
        if (result && result.success === false) {
          tampilkanGagalModern(result.message || 'Gagal menghapus produk.', () => hpsPrd(id));
          return;
        }
        tampilkanSuksesModern((result && result.message) || 'Produk berhasil dihapus');
        loadTabelProduk();
      } catch (err) {
        tampilkanGagalModern('Gagal menghapus produk. Periksa koneksi internet Anda.', () => hpsPrd(id));
      }
    }
  });
}

async function bukaModalLaporan() {
  bukaModal('modalLaporan');
  document.getElementById('tblLaporan').innerHTML = skeletonTableRows(['15%', '20%', '15%', '20%', '18%', '12%'], 6);
  try {
    const data = await apiRequest('getSemuaTransaksi', { method: 'GET' });
    cacheTransaksi(data);
    let html = '';
    data.forEach(t => {
      html += `
        <tr onclick="bukaDetailTransaksi('${t.id}')" class="hover:bg-slate-50 cursor-pointer">
          <td class="p-3 text-slate-500">${t.tanggal}</td>
          <td class="p-3 font-bold text-slate-800">${t.nama}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${t.jenis === 'Bayar' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'}">${t.jenis}</span></td>
          <td class="p-3 text-right font-bold text-rose-600">${formatRp(t.total)}</td>
          <td class="p-3 text-right font-bold text-emerald-600">${formatRp(t.bayar)}</td>
          <td class="p-3 text-center"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">${t.status}</span></td>
        </tr>
      `;
    });
    document.getElementById('tblLaporan').innerHTML = html;
  } catch (err) {
    document.getElementById('tblLaporan').innerHTML = '<tr><td colspan="6" class="p-6 text-center text-rose-500">Gagal memuat rekap transaksi.</td></tr>';
  }
}

// --- DETAIL TRANSAKSI (dipakai bersama: riwayat pelanggan, aktivitas admin, laporan admin) ---
let transaksiCache = {};

function cacheTransaksi(list) {
  (list || []).forEach(t => { transaksiCache[t.id] = t; });
}

function bukaDetailTransaksi(id) {
  const t = transaksiCache[id];
  if (!t) return;

  const isBayar = t.jenis === 'Bayar';
  const isLunas = t.status === 'Sudah Lunas';

  const header = document.getElementById('detailTransaksiHeader');
  header.className = 'p-4 text-white flex items-center justify-between shrink-0 ' + (isBayar ? 'bg-blue-600' : 'bg-emerald-700');
  document.getElementById('detailTransaksiIcon').innerText = isBayar ? 'price_check' : 'add_shopping_cart';

  const jenisBadge = document.getElementById('detailTransaksiJenisBadge');
  jenisBadge.innerText = t.jenis;
  jenisBadge.className = 'px-2.5 py-1 rounded-lg text-xs font-bold ' + (isBayar ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800');

  const statusBadge = document.getElementById('detailTransaksiStatusBadge');
  statusBadge.innerText = t.status;
  statusBadge.className = 'px-2.5 py-1 rounded-full text-[11px] font-bold ' + (isLunas ? 'bg-emerald-100 text-emerald-700' : (isBayar ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'));

  const nominalEl = document.getElementById('detailTransaksiNominal');
  nominalEl.innerText = formatRp(isBayar ? t.bayar : t.total);
  nominalEl.className = 'text-3xl font-black mt-0.5 ' + (isBayar ? 'text-emerald-600' : 'text-rose-600');

  document.getElementById('detailTransaksiTanggal').innerText = t.tanggal || '-';
  document.getElementById('detailTransaksiJam').innerText = t.jam || '-';
  document.getElementById('detailTransaksiNama').innerText = t.nama || '-';
  document.getElementById('detailTransaksiAdmin').innerText = t.adminInput || '-';
  document.getElementById('detailTransaksiDetail').innerText = t.detailBersih || t.detail || '-';

  const rowMetode = document.getElementById('rowDetailMetode');
  if (isBayar) {
    rowMetode.classList.remove('hidden');
    document.getElementById('detailTransaksiMetode').innerText = t.metode || '-';
  } else {
    rowMetode.classList.add('hidden');
  }

  const blokCatatan = document.getElementById('blokCatatanAdmin');
  if (t.catatan) {
    blokCatatan.classList.remove('hidden');
    document.getElementById('detailTransaksiCatatan').innerText = t.catatan;
  } else {
    blokCatatan.classList.add('hidden');
  }

  bukaModal('modalDetailTransaksi');
}
