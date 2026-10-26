/* Supabase adapter for the existing purchasing UI. Remote business data stays in memory;
   localStorage keeps only the legacy local workspace and Supabase's login session. */
(() => {
  'use strict';
  const EMPTY = () => ({ suppliers: [], products: [], orders: [], activities: [] });
  const DEFAULT_WORKSPACE = '11111111-1111-4111-8111-111111111111';
  const originals = { render, profile, save, toast };
  let savedConfig = {};
  try { savedConfig = JSON.parse(localStorage.getItem('upu-cloud-config') || '{}'); } catch {}
  const config = Object.assign({}, savedConfig, window.UPU_CONFIG?.supabaseUrl ? window.UPU_CONFIG : {});
  const enabled = Boolean(config.supabaseUrl || config.supabaseKey);
  const state = { enabled, client: null, session: null, workspace: null, busy: false, loading: false,
    pending: null, error: '', capture: false, message: '', initialized: false };
  let loadingPromise;
  let authGeneration = 0;

  function validateConfig(value) {
    const url = new URL(value.supabaseUrl);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('URL proyek Supabase tidak valid.');
    const key = value.supabaseKey || '';
    if (!key.startsWith('sb_publishable_')) {
      let claims;
      try { claims = JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); } catch {}
      if (claims?.role !== 'anon') throw Error('Gunakan publishable key atau anon key. Secret/service_role key tidak boleh digunakan di aplikasi.');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.workspaceId || DEFAULT_WORKSPACE)) throw Error('ID workspace tidak valid.');
    return value;
  }
  function setStatus(text) {
    const label = document.querySelector('.local');
    if (label) label.textContent = text;
  }
  function screen(title, message, content = '') {
    $('#sidebar').innerHTML = '<div class="logo"><span class="logo-icon">🛒</span><b>Kedai UPU PO</b></div>';
    $('#bottom').innerHTML = '';
    $('#crumb').textContent = 'Akun';
    $('#main').innerHTML = `<section class="panel auth-panel"><span class="eyebrow">KEDAI UPU · TIM PURCHASING</span><h1>${esc(title)}</h1><p class="sub">${esc(message)}</p>${content}</section>`;
  }
  function authScreen() {
    setStatus('● Database bersama');
    screen('Masuk ke workspace', 'Gunakan akun email yang telah diberikan akses oleh pengelola toko.', `
      <form onsubmit="event.preventDefault();Cloud.login(this)">
        <div class="form-group"><label for="login-email">Email</label><input id="login-email" type="email" name="email" autocomplete="username" required></div>
        <div class="form-group"><label for="login-password">Kata sandi</label><input id="login-password" type="password" name="password" autocomplete="current-password" required></div>
        <p id="auth-error" class="form-error" role="alert"></p>
        <button type="submit" class="btn primary">Masuk</button>
      </form><p class="sub">Belum punya akun atau lupa kata sandi? Hubungi pengelola toko.</p>`);
  }
  render = function () {
    if (!enabled) return originals.render();
    if (!state.initialized) return screen('Menghubungkan…', 'Memeriksa sesi akun Anda.');
    if (!state.session) return authScreen();
    if (!state.workspace) return screen('Workspace belum dapat dibuka', state.error || 'Memuat data dari server…',
      `<div class="buttons" style="margin-top:20px"><button class="btn primary" onclick="Cloud.refresh()">Coba lagi</button><button class="btn" onclick="Cloud.logout()">Keluar</button></div>`);
    originals.render();
    setStatus(state.busy ? '● Menyimpan…' : state.pending ? '● Perubahan belum tersimpan' : '● Database bersama');
    const note = document.querySelector('.section-note');
    if (note) note.textContent = '● Data bersama · ' + state.workspace.name + ' · Diperbarui ' + new Date(state.workspace.updated_at).toLocaleString('id-ID');
  };
  profile = function () {
    originals.profile();
    if (!enabled) {
      const panel = document.querySelector('.profile');
      if (panel) panel.insertAdjacentHTML('beforeend','<button class="profile-row" onclick="Cloud.configure()">Hubungkan Supabase <span>›</span></button>');
      return;
    }
    $('#main').innerHTML = heading('Akun & Workspace', 'Data pembelian bersama untuk tim Anda.') + `
      <section class="panel profile">
        <div class="profile-row"><span><b>${esc(state.workspace.name)}</b><p class="sub">${esc(state.session.user.email)}</p></span><span class="badge Confirmed">Terhubung</span></div>
        <button class="profile-row" onclick="Cloud.refresh()">↻ Muat data terbaru <span>›</span></button>
        <button class="profile-row" onclick="backup()">↓ Unduh cadangan database <span>›</span></button>
        <button class="profile-row" onclick="$('#restore').click()">↑ Pulihkan cadangan ke database bersama <span>›</span></button>
        <input hidden type="file" id="restore" accept=".json" onchange="restoreData(this.files[0])">
        <button class="profile-row" onclick="Cloud.migrateLocal()">↑ Pindahkan data browser lama <span>›</span></button>
        ${state.pending ? '<button class="profile-row" onclick="Cloud.showPending()">Lihat perubahan yang belum tersimpan <span>›</span></button>' : ''}
        <button class="profile-row" onclick="Cloud.logout()">Keluar dari akun <span>›</span></button>
      </section><p class="sub">Perubahan disimpan ke database dan diperiksa berkala setiap 15 detik.<br>Data browser lama dipindahkan hanya setelah Anda menyetujui penggantiannya.</p>`;
  };
  save = function () { if (!enabled) originals.save(); };
  toast = function (message) {
    if (state.capture) state.message = message;
    else originals.toast(message);
  };
  function friendly(error) {
    if (error?.code === '40001') return 'Data telah berubah di perangkat lain. Muat data server, lalu ulangi perubahan Anda.';
    if (error?.code === '42501' || error?.code === 'PGRST116') return 'Akun ini belum diberi akses ke workspace. Hubungi pengelola toko.';
    if (error?.code === '22023' || error?.code === '23514') return 'Data belum valid. Periksa kode, relasi supplier/produk, tanggal, dan kuantitas.';
    if (error?.code === 'PGRST202' || error?.code === '42P01' || error?.code === 'PGRST205') return 'Database belum disiapkan. Jalankan migrasi Supabase terlebih dahulu.';
    return 'Tidak dapat menghubungi database. Periksa koneksi dan akses akun, lalu coba lagi.';
  }
  async function readWorkspace() {
    const { data, error } = await state.client.from('purchasing_workspaces').select('id,name,data,version,updated_at')
      .eq('id', config.workspaceId || DEFAULT_WORKSPACE).single();
    if (error) throw error;
    return data;
  }
  function accept(workspace) {
    PurchasingData.validate(workspace.data);
    state.workspace = workspace;
    db = structuredClone(workspace.data);
    state.error = '';
  }
  async function refresh(options = {}) {
    if (!state.client || !state.session || state.busy) return;
    if (state.pending && !options.background && !window.confirm('Perubahan yang belum tersimpan akan dibuang. Sudah mengunduh salinannya dan ingin memuat data server?')) return;
    if (state.pending && options.background) return;
    if (loadingPromise) return loadingPromise;
    state.loading = true;
    const generation = authGeneration;
    loadingPromise = (async () => {
      try {
        const workspace = await readWorkspace();
        // A logout must never repopulate the screen with a completed stale request.
        if (!state.session || generation !== authGeneration) return;
        const changed = !state.workspace || state.workspace.version !== workspace.version;
        accept(workspace);
        if (!options.background) state.pending = null;
        if (changed || !options.background) render();
      } catch (error) {
        if (!state.session || generation !== authGeneration) return;
        state.error = friendly(error);
        if (!options.background) { render(); toast(state.error); }
        else setStatus('● Koneksi terputus');
      } finally { state.loading = false; loadingPromise = null; }
    })();
    return loadingPromise;
  }
  async function mutate(action) {
    if (!enabled) return action();
    if (!state.session || !state.workspace) return toast('Masuk dan buka workspace terlebih dahulu.');
    if (state.busy || state.loading) return toast('Tunggu proses data selesai.');
    if (state.pending) return showPending();
    const before = structuredClone(db);
    const version = state.workspace.version;
    const generation = authGeneration;
    state.busy = true;
    state.capture = true;
    state.message = '';
    document.body.classList.add('cloud-busy');
    setStatus('● Menyimpan…');
    let draft;
    try {
      // Existing UI mutations are synchronous. A single RPC commits the entire action,
      // including multi-supplier imports and activity entries.
      action();
      state.capture = false;
      if (JSON.stringify(before) === JSON.stringify(db)) {
        if (state.message) originals.toast(state.message);
        return;
      }
      PurchasingData.validate(db);
      draft = structuredClone(db);
      const { data, error } = await state.client.rpc('purchasing_save', {
        target_workspace: config.workspaceId || DEFAULT_WORKSPACE, expected_version: version, new_data: draft
      });
      if (!state.session || generation !== authGeneration) return;
      if (error) throw error;
      accept(data);
      render();
      originals.toast(state.message || 'Perubahan tersimpan di database.');
    } catch (error) {
      if (!state.session || generation !== authGeneration) return;
      db = before;
      state.pending = draft ? { data: draft, message: friendly(error) } : null;
      render();
      if (state.pending) showPending();
      else originals.toast('Perubahan belum disimpan. Muat ulang data dan coba lagi.');
    } finally {
      state.capture = false;
      state.busy = false;
      document.body.classList.remove('cloud-busy');
      setStatus(state.pending ? '● Perubahan belum tersimpan' : '● Database bersama');
    }
  }
  function showPending() {
    if (!state.pending) return;
    if ($('#modal').open) closeModal();
    show(`<h2>Perubahan belum tersimpan</h2><p class="sub">${esc(state.pending.message)} Salinan perubahan Anda tersedia untuk diunduh sebelum memuat ulang data server.</p>
      <div class="modal-actions"><button class="btn" onclick="Cloud.downloadPending()">Unduh perubahan</button><button class="btn primary" onclick="closeModal();Cloud.refresh()">Muat data server</button></div>`);
  }
  function downloadPending() {
    if (state.pending) download('kedai-upu-perubahan-belum-tersimpan.json', JSON.stringify(state.pending.data,null,2),'application/json');
  }
  async function login(form) {
    const submit = form.querySelector('button[type=submit]');
    const errorNode = $('#auth-error');
    submit.disabled = true;
    errorNode.textContent = '';
    try {
      const { data, error } = await state.client.auth.signInWithPassword({ email: form.elements.email.value.trim(), password: form.elements.password.value });
      if (error) throw error;
      form.reset();
      state.session = data.session;
      await refresh();
    } catch { errorNode.textContent = 'Login gagal. Periksa email, kata sandi, dan koneksi Anda.'; }
    finally { submit.disabled = false; }
  }
  async function logout() {
    if (state.busy) return toast('Tunggu penyimpanan selesai.');
    if (state.pending && !window.confirm('Perubahan belum tersimpan akan dibuang saat keluar. Lanjutkan?')) return;
    const { error } = await state.client.auth.signOut();
    if (error) return toast('Belum dapat keluar. Periksa koneksi Anda.');
    state.session = null;
    state.workspace = null;
    state.pending = null;
    db = EMPTY();
    if ($('#modal').open) closeModal();
    render();
  }
  function configure() {
    show(`<h2>Hubungkan Supabase</h2><p class="sub">Gunakan URL proyek dan publishable/anon key dari proyek milik Anda.</p>
      <form onsubmit="event.preventDefault();Cloud.saveConfig(this)">
      <div class="form-group"><label>Project URL</label><input name="url" type="url" placeholder="https://nama-proyek.supabase.co" required></div>
      <div class="form-group"><label>Publishable / anon key</label><input name="key" autocomplete="off" required></div>
      <div class="form-group"><label>Workspace ID</label><input name="workspace" value="${DEFAULT_WORKSPACE}" required></div>
      <p id="config-error" class="form-error" role="alert"></p>${actions('Hubungkan')}</form>`);
  }
  function saveConfig(form) {
    try {
      const value = validateConfig({supabaseUrl:form.elements.url.value.trim().replace(/\/$/,''),supabaseKey:form.elements.key.value.trim(),workspaceId:form.elements.workspace.value.trim()});
      localStorage.setItem('upu-cloud-config',JSON.stringify(value));
      window.location.reload();
    } catch(error) { $('#config-error').textContent = error.message; }
  }
  function migrateLocal() {
    let data;
    try { data = JSON.parse(localStorage.getItem('upu-po-v1') || 'null'); } catch {}
    if (!data) return toast('Tidak ada data browser lama yang tersimpan.');
    try { PurchasingData.validate(data); } catch(error) { return toast(error.message); }
    show(`<h2>Pindahkan data browser?</h2><p class="sub">Data bersama akan diganti dengan ${esc(data.orders?.length || 0)} PO dari browser ini. Seluruh anggota tim akan melihat hasilnya. Unduh cadangan database saat ini sebelum melanjutkan.</p>
      <div class="modal-actions"><button class="btn" onclick="backup()">Unduh cadangan</button><button class="btn" onclick="closeModal()">Batal</button><button class="btn primary" id="confirm-migrate">Ganti data bersama</button></div>`);
    $('#confirm-migrate').onclick = () => mutate(() => { db=data; closeModal(); toast('Data browser berhasil dipindahkan.'); });
  }
  for (const name of ['saveOrder','saveStatus','saveMaster','commitImport']) {
    const original = window[name];
    window[name] = (...args) => mutate(() => original(...args));
  }
  window.Cloud = { state, config, validateConfig, mutate, refresh, login, logout, configure, saveConfig, migrateLocal, showPending, downloadPending };
  if (enabled) {
    db = EMPTY();
    render();
    window.addEventListener('beforeunload', event => { if (state.busy || state.pending) { event.preventDefault(); event.returnValue = ''; } });
    window.addEventListener('online', () => refresh({background:true}));
    window.addEventListener('focus', () => { if (!$('#modal').open) refresh({background:true}); });
    window.Cloud.ready = (async () => {
      try {
        validateConfig(config);
        if (!window.supabase?.createClient) throw Error('SDK Supabase tidak dapat dimuat.');
        state.client = window.supabase.createClient(config.supabaseUrl,config.supabaseKey, {
          auth: { persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'upu-auth-'+new URL(config.supabaseUrl).hostname }
        });
        state.client.auth.onAuthStateChange((event,session) => {
          const previousUser = state.session?.user.id;
          if (event === 'SIGNED_OUT' || (event === 'SIGNED_IN' && previousUser !== session?.user.id)) authGeneration++;
          state.session = session;
          if (event === 'SIGNED_OUT') {
            state.workspace = null; state.pending = null; db = EMPTY();
            if ($('#modal').open) closeModal(); render();
          } else if (event === 'SIGNED_IN' && previousUser !== session?.user.id && state.initialized) {
            state.workspace = null; db = EMPTY();
            setTimeout(() => refresh(),0);
          }
        });
        const { data, error } = await state.client.auth.getSession();
        if (error) throw error;
        state.session = data.session;
        state.initialized = true;
        if (state.session) await refresh(); else render();
        setInterval(() => { if (!document.hidden && !$('#modal').open) refresh({background:true}); },15000);
      } catch(error) {
        state.initialized = true;
        screen('Koneksi belum siap',error.message,'<button class="btn" style="margin-top:20px" onclick="Cloud.configure()">Pengaturan koneksi</button>');
      }
    })();
  } else {
    window.Cloud.ready = Promise.resolve();
    render();
  }
})();