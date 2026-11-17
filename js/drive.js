/*
 * Ardoise — sauvegarde dans Google Drive.
 *
 * Fonctionnement :
 *  - connexion Google avec Google Identity Services (fenêtre « Se connecter avec Google ») ;
 *  - autorisation limitée « drive.file » : Ardoise ne voit QUE les fichiers qu'il a créés,
 *    jamais le reste du Drive du commerçant ;
 *  - un dossier « Ardoise - Sauvegardes » est créé dans son Drive, avec un fichier par jour
 *    (ardoise-sauvegarde-AAAA-MM-JJ.json), mis à jour automatiquement après chaque modification ;
 *  - aucun serveur : le navigateur parle directement à Google.
 *
 * Disponible uniquement sur la version en ligne (https) ou en local (http://localhost),
 * car Google refuse les connexions depuis un fichier ouvert directement sur l'ordinateur.
 */
'use strict';

window.ArdoiseDrive = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const FOLDER_NAME = 'Ardoise - Sauvegardes';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const AUTO_DELAY = 15000; // sauvegarde 15 s après la dernière modification

  let token = null;
  let tokenExp = 0;
  let gisPromise = null;
  let timer = null;
  let busy = false;
  let lastHash = null;

  class NeedAuth extends Error { constructor() { super('Connexion Google Drive expirée : reconnectez-vous.'); } }

  const clientId = () => ((window.ARDOISE_CONFIG || {}).googleClientId || '').trim();
  const secureOrigin = () => location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  const available = () => !!clientId() && secureOrigin();
  const conf = () => (DB.drive = DB.drive || { folderId: '', auto: true, last: null, connected: false });
  const hasToken = () => !!token && Date.now() < tokenExp - 60000;

  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    return h.toString(16) + ':' + str.length;
  }
  // Contenu à comparer : les données sans les dates de sauvegarde (évite les envois inutiles)
  const fingerprint = () => hash(JSON.stringify({ ...DB, lastBackup: null, drive: null }));

  /* ---------------- Connexion Google ---------------- */
  function loadGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gisPromise) {
      gisPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { gisPromise = null; reject(new Error('Impossible de joindre Google. Vérifiez votre connexion Internet.')); };
        document.head.appendChild(s);
      });
    }
    return gisPromise;
  }

  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId(),
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
          if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
            reject(new Error("L'accès à Google Drive n'a pas été autorisé (case à cocher dans la fenêtre Google)."));
            return;
          }
          token = resp.access_token;
          tokenExp = Date.now() + Number(resp.expires_in || 3600) * 1000;
          resolve(token);
        },
        error_callback: (err) => {
          const msg = err && err.type === 'popup_closed' ? 'Connexion annulée.'
            : err && err.type === 'popup_failed_to_open' ? "La fenêtre Google a été bloquée : autorisez les fenêtres pop-up pour ce site."
            : 'Connexion Google impossible.';
          reject(new Error(msg));
        },
      });
      client.requestAccessToken({ prompt });
    });
  }

  async function connect() {
    if (!available()) { toast("La sauvegarde Google Drive n'est pas disponible sur cette version.", 'error'); return false; }
    try {
      await loadGis();
      await requestToken(conf().connected ? '' : 'consent');
      const c = conf();
      c.connected = true;
      save();
      toast('Google Drive connecté');
      await backupNow({ silent: false });
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    } finally {
      refresh();
    }
  }

  function disconnect() {
    if (!confirm('Déconnecter Google Drive ?\n\nLes sauvegardes déjà présentes dans votre Drive sont conservées.')) return;
    try { if (token && window.google && google.accounts) google.accounts.oauth2.revoke(token, () => {}); } catch (e) { /* ignoré */ }
    token = null; tokenExp = 0;
    DB.drive = null;
    save();
    toast('Google Drive déconnecté');
    refresh();
  }

  /* ---------------- Appels à l'API Drive ---------------- */
  async function api(url, opts = {}) {
    if (!hasToken()) throw new NeedAuth();
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token } });
    if (r.status === 401) { token = null; throw new NeedAuth(); }
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.json()).error.message; } catch (e) { /* ignoré */ }
      throw new Error(`Google Drive : erreur ${r.status}${detail ? ' (' + detail + ')' : ''}`);
    }
    return r;
  }
  const q = (s) => encodeURIComponent(s);
  const lit = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

  async function ensureFolder() {
    const c = conf();
    if (c.folderId) {
      try {
        const f = await (await api(`${API}/files/${c.folderId}?fields=id,trashed`)).json();
        if (!f.trashed) return c.folderId;
      } catch (e) {
        if (e instanceof NeedAuth) throw e;
      }
    }
    const found = await (await api(`${API}/files?q=${q(`name=${lit(FOLDER_NAME)} and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)&spaces=drive`)).json();
    if (found.files && found.files.length) {
      c.folderId = found.files[0].id;
    } else {
      const created = await (await api(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      })).json();
      c.folderId = created.id;
    }
    return c.folderId;
  }

  async function backupNow({ silent = true } = {}) {
    if (busy) return false;
    busy = true;
    try {
      const folder = await ensureFolder();
      const now = new Date().toISOString();
      const c = conf();
      const prevLast = c.last, prevBackup = DB.lastBackup;
      c.last = now;
      DB.lastBackup = now;
      const content = JSON.stringify(DB, null, 1);
      const name = `${APP.name.toLowerCase()}-sauvegarde-${today()}.json`;
      try {
        const list = await (await api(`${API}/files?q=${q(`name=${lit(name)} and ${lit(folder)} in parents and trashed=false`)}&fields=files(id)`)).json();
        if (list.files && list.files.length) {
          await api(`${UPLOAD}/files/${list.files[0].id}?uploadType=media&fields=id`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content,
          });
        } else {
          const boundary = 'ardoise' + Date.now().toString(36);
          const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
            JSON.stringify({ name, parents: [folder], mimeType: 'application/json', description: `Sauvegarde ${APP.name}` }) +
            `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
          await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
            method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
          });
        }
      } catch (e) {
        c.last = prevLast; DB.lastBackup = prevBackup;
        throw e;
      }
      lastHash = fingerprint();
      saveLocalOnly();
      if (!silent) toast('Sauvegarde envoyée dans Google Drive');
      return true;
    } catch (e) {
      if (!silent || !(e instanceof NeedAuth)) toast(e.message, 'error');
      return false;
    } finally {
      busy = false;
      refresh();
    }
  }

  async function listBackups() {
    const folder = await ensureFolder();
    const r = await (await api(`${API}/files?q=${q(`${lit(folder)} in parents and trashed=false`)}&orderBy=modifiedTime desc&pageSize=60&fields=files(id,name,modifiedTime,size)`)).json();
    return r.files || [];
  }

  async function download(id) {
    return (await api(`${API}/files/${id}?alt=media`)).text();
  }

  /* ---------------- Sauvegarde automatique ---------------- */
  let savingLocal = false;
  function saveLocalOnly() { savingLocal = true; try { save(); } finally { savingLocal = false; } }

  function onLocalSave() {
    if (savingLocal || !DB.drive || !DB.drive.auto || !available()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!hasToken() || fingerprint() === lastHash) { refresh(); return; }
      backupNow({ silent: true });
    }, AUTO_DELAY);
  }

  // Données modifiées mais impossible d'envoyer (connexion expirée) : on le signale.
  function needsReconnect() {
    return available() && !!DB.drive && DB.drive.connected && !hasToken() &&
      (!DB.drive.last || (Date.now() - new Date(DB.drive.last).getTime()) > 24 * 3600 * 1000);
  }

  function refresh() {
    if (typeof renderBanner === 'function') renderBanner();
    const card = document.getElementById('drive-card');
    if (card) { card.outerHTML = cardHTML(); bindCard(); }
    const last = document.getElementById('last-backup');
    if (last && DB.lastBackup) last.textContent = fmtDate(DB.lastBackup.slice(0, 10));
  }

  /* ---------------- Interface (page Sauvegarde) ---------------- */
  function cardHTML() {
    const c = DB.drive;
    const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais';
    let body;
    if (!secureOrigin()) {
      body = `<p class="muted small">La sauvegarde automatique dans Google Drive est disponible dans la <b>version en ligne</b> d'${APP.name} (adresse en https). Avec cette version installée sur l'ordinateur, utilisez la sauvegarde fichier ci-dessous.</p>`;
    } else if (!clientId()) {
      body = `<p class="muted small">Service non activé : l'identifiant Google n'est pas encore configuré (fichier <code>js/config.js</code>, voir <code>docs/google-drive.md</code>).</p>`;
    } else if (!c || !c.connected) {
      body = `<p class="small">Connectez votre compte Google : vos données seront <b>sauvegardées automatiquement</b> dans votre Google Drive, dans un dossier « ${FOLDER_NAME} ».</p>
        <p class="muted small">🔒 ${APP.name} n'a accès qu'aux fichiers qu'il crée lui-même : il ne voit pas le reste de votre Drive.</p>
        <button class="btn primary" data-act="drive-connect">Se connecter à Google Drive</button>`;
    } else {
      const live = hasToken();
      body = `<ul class="drive-status">
          <li><span class="muted">État</span><span>${live ? '<span class="up">● Connecté</span>' : '<span style="color:var(--warn)">● Connexion à renouveler</span>'}</span></li>
          <li><span class="muted">Dernière sauvegarde Drive</span><span class="strong">${fmtDT(c.last)}</span></li>
          <li><span class="muted">Dossier</span><span>${FOLDER_NAME}</span></li>
        </ul>
        <label class="check" style="margin:12px 0"><input type="checkbox" id="drive-auto" ${c.auto ? 'checked' : ''}> Sauvegarde automatique après chaque modification</label>
        ${live ? '' : `<p class="small" style="color:var(--warn)">Par sécurité, Google demande de renouveler la connexion régulièrement. Un clic suffit.</p>`}
        <div class="actions">
          ${live ? '<button class="btn primary" data-act="drive-backup">Sauvegarder maintenant</button>' : '<button class="btn primary" data-act="drive-connect">Renouveler la connexion</button>'}
          <button class="btn" data-act="drive-restore">Restaurer depuis Drive</button>
          <button class="btn danger" data-act="drive-disconnect">Déconnecter</button>
        </div>`;
    }
    return `<div class="card" id="drive-card"><h2>☁️ Sauvegarde Google Drive</h2>${body}</div>`;
  }

  async function openRestore() {
    if (!hasToken()) { const ok = await connect(); if (!ok) return; }
    let files;
    try { files = await listBackups(); } catch (e) { toast(e.message, 'error'); return; }
    openModal('Restaurer depuis Google Drive', files.length
      ? `<p class="muted small">Choisissez la sauvegarde à restaurer. Les données actuelles de cet ordinateur seront remplacées.</p>
         <div class="table-wrap"><table><thead><tr><th>Sauvegarde</th><th>Modifiée le</th><th class="num">Taille</th><th></th></tr></thead><tbody>
         ${files.map((f) => `<tr><td>${esc(f.name)}</td><td>${new Date(f.modifiedTime).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
           <td class="num">${Math.max(1, Math.round(Number(f.size || 0) / 1024))} Ko</td><td class="right"><button class="btn small" data-file="${esc(f.id)}">Restaurer</button></td></tr>`).join('')}
         </tbody></table></div>`
      : '<p class="muted">Aucune sauvegarde trouvée dans votre Google Drive.</p>', (root) => {
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-file]');
        if (!b) return;
        b.disabled = true;
        try {
          const data = JSON.parse(await download(b.dataset.file));
          if (!data || !data.settings || !Array.isArray(data.documents)) throw new Error("Ce fichier n'est pas une sauvegarde valide.");
          if (!confirm(`Restaurer cette sauvegarde ?\n\n${data.documents.length} document(s), ${(data.clients || []).length} client(s).\nLes données actuelles seront remplacées.`)) { b.disabled = false; return; }
          const keep = DB.drive;
          DB = migrate(data);
          DB.drive = keep;
          lastHash = fingerprint();
          saveLocalOnly();
          closeModal();
          toast('Sauvegarde restaurée depuis Google Drive');
          go('#/tableau');
        } catch (err) {
          b.disabled = false;
          toast(err.message, 'error');
        }
      });
    });
  }

  function bindCard(root = document) {
    const auto = root.querySelector('#drive-auto');
    if (auto) auto.addEventListener('change', () => { conf().auto = auto.checked; saveLocalOnly(); toast(auto.checked ? 'Sauvegarde automatique activée' : 'Sauvegarde automatique désactivée'); });
    if (available()) loadGis().catch(() => {}); // préchargement : la fenêtre Google s'ouvrira sans être bloquée
  }

  const actions = {
    'drive-connect': () => connect(),
    'drive-backup': () => backupNow({ silent: false }),
    'drive-restore': () => openRestore(),
    'drive-disconnect': () => disconnect(),
  };

  // Retour du réseau : on relance la sauvegarde automatique si des modifications attendent
  window.addEventListener('online', () => { onLocalSave(); refresh(); });
  window.addEventListener('offline', () => refresh());

  return { available, connect, backupNow, onLocalSave, needsReconnect, cardHTML, bindCard, actions, hasToken, _state: () => ({ token, tokenExp, lastHash }) };
})();
