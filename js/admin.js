  'use strict';
  /*
   * Espace administrateur Ardoise : création et suivi des licences.
   * Rien n'est envoyé sur Internet : la clé privée de signature est chiffrée
   * (AES-GCM, mot de passe dérivé par PBKDF2) et stockée dans ce navigateur.
   */
  const STORE = 'ardoise_admin_v1';
  const ITER = 600000;
  const MIN_PW = 12;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const d = new Date(), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
  const fmtDate = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : '');

  function toast(msg, type = '') {
const t = $('#toast'); t.textContent = msg; t.className = type; t.style.display = 'block';
clearTimeout(toast.h); toast.h = setTimeout(() => { t.style.display = 'none'; }, type === 'error' ? 6000 : 3200);
  }

  /* ---------- Encodage et cryptographie ---------- */
  function b64u(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }

  async function deriveKey(pw, salt, it = ITER) {
const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: it, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(obj, pw) {
const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(pw, salt), enc.encode(JSON.stringify(obj)));
return { it: ITER, salt: b64u(salt), iv: b64u(iv), data: b64u(new Uint8Array(ct)) };
  }
  async function unseal(box, pw) {
try {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(box.iv) }, await deriveKey(pw, unb64u(box.salt), box.it || ITER), unb64u(box.data));
  return JSON.parse(dec.decode(pt));
} catch (e) { throw new Error('Mot de passe incorrect.'); }
  }
  const pubOnly = (jwk) => ({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y });
  async function newSigningKey() {
const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
return { priv: await crypto.subtle.exportKey('jwk', k.privateKey), pub: pubOnly(await crypto.subtle.exportKey('jwk', k.publicKey)), created: new Date().toISOString() };
  }
  async function signLicence(secret, payload) {
const key = await crypto.subtle.importKey('jwk', secret.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
const p = 'ARD1.' + b64u(enc.encode(JSON.stringify(payload)));
const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(p)));
return p + '.' + b64u(sig);
  }
  async function fingerprint(pub) {
const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(pub.x + '.' + pub.y)));
return Array.from(h.slice(0, 6)).map((b) => b.toString(16).padStart(2, '0')).join(':').toUpperCase();
  }
  const pubConfigured = (pub) => ((window.ARDOISE_LICENCE || {}).publicKeys || []).some((k) => k && k.x === pub.x && k.y === pub.y);

  /* ---------- Stockage local ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(STORE)) || { accounts: [], history: [] }; } catch (e) { return { accounts: [], history: [] }; } }
  let store = load();
  function persist() { localStorage.setItem(STORE, JSON.stringify(store)); }
  let session = null; // { login, secret } — en mémoire uniquement

  function checkPw(pw, pw2) {
if (pw.length < MIN_PW) throw new Error(`Mot de passe trop court : ${MIN_PW} caractères minimum (une petite phrase, c'est l'idéal).`);
if (pw2 !== undefined && pw !== pw2) throw new Error('Les deux mots de passe ne sont pas identiques.');
  }
  function busy(btn, on, label) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Patientez…'; } else if (btn.dataset.l) btn.textContent = btn.dataset.l; }
  function download(name, content, type) {
const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name;
document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function copy(text) { navigator.clipboard.writeText(text).then(() => toast('Copié'), () => toast('Copie impossible : sélectionnez le texte.', 'error')); }

  /* ---------- Écrans ---------- */
  function render() {
$('#who').innerHTML = session ? `<span class="muted">Connecté : <b style="color:#fff">${esc(session.login)}</b></span> <button class="btn small" id="logout">Se déconnecter</button>` : '';
if (session) return renderDashboard();
if (!store.accounts.length) return renderSetup();
return renderLogin();
  }

  function renderSetup() {
$('#main').innerHTML = `
  <h1>Bienvenue dans l'espace administrateur</h1>
  <div class="note info">Ici, vous créez les <b>clés de licence</b> de vos clients. La clé de signature est chiffrée avec votre mot de passe et reste <b>dans ce navigateur</b> : rien n'est envoyé sur Internet.</div>
  <div class="grid2">
    <div class="card">
      <h2>① Première installation</h2>
      <p class="small muted">À faire une seule fois, par la première personne (par exemple Louis). Crée la clé de signature d'Ardoise et votre compte administrateur sur cet ordinateur.</p>
      <label>Identifiant <input id="s-login" placeholder="ex : louis" autocomplete="username"></label>
      <label>Mot de passe (${MIN_PW} caractères minimum) <input id="s-pw" type="password" autocomplete="new-password"></label>
      <label>Confirmer le mot de passe <input id="s-pw2" type="password" autocomplete="new-password"></label>
      <button class="btn primary" id="s-create">Créer la clé et mon compte</button>
    </div>
    <div class="card">
      <h2>② Rejoindre en tant qu'associé</h2>
      <p class="small muted">Votre associé vous a envoyé un <b>fichier administrateur</b> (.json) et vous a donné son <b>mot de passe de transfert</b> de vive voix.</p>
      <label>Fichier administrateur <input id="j-file" type="file" accept=".json,application/json"></label>
      <label>Mot de passe de transfert <input id="j-tpw" type="password" autocomplete="off"></label>
      <label>Votre identifiant <input id="j-login" placeholder="ex : thomas" autocomplete="username"></label>
      <label>Votre mot de passe (${MIN_PW} caractères minimum) <input id="j-pw" type="password" autocomplete="new-password"></label>
      <button class="btn" id="j-go">Importer et créer mon compte</button>
    </div>
  </div>`;
$('#s-create').onclick = async (e) => {
  const login = $('#s-login').value.trim(), pw = $('#s-pw').value;
  try {
    if (!login) throw new Error('Choisissez un identifiant.');
    checkPw(pw, $('#s-pw2').value);
    busy(e.target, true, 'Création de la clé…');
    const secret = await newSigningKey();
    store.accounts.push({ login, box: await seal(secret, pw) });
    store.publicKey = secret.pub;
    persist();
    session = { login, secret };
    toast('Clé créée et compte administrateur prêt');
    render();
  } catch (err) { toast(err.message, 'error'); } finally { busy(e.target, false); }
};
$('#j-go').onclick = (e) => joinFromFile(e.target);
  }

  async function joinFromFile(btn) {
const file = $('#j-file').files[0], login = $('#j-login').value.trim(), pw = $('#j-pw').value;
try {
  if (!file) throw new Error('Choisissez le fichier administrateur.');
  if (!login) throw new Error('Choisissez un identifiant.');
  if (store.accounts.some((a) => a.login.toLowerCase() === login.toLowerCase())) throw new Error('Cet identifiant existe déjà sur cet ordinateur.');
  checkPw(pw);
  busy(btn, true, 'Déchiffrement…');
  const pack = JSON.parse(await file.text());
  if (pack.type !== 'ardoise-admin' || !pack.box) throw new Error("Ce fichier n'est pas un fichier administrateur Ardoise.");
  const secret = await unseal(pack.box, $('#j-tpw').value);
  if (store.publicKey && (store.publicKey.x !== secret.pub.x)) throw new Error('Ce fichier contient une autre clé de signature que celle déjà présente sur cet ordinateur.');
  store.accounts.push({ login, box: await seal(secret, pw) });
  store.publicKey = secret.pub;
  if (Array.isArray(pack.history)) mergeHistory(pack.history);
  persist();
  session = { login, secret };
  toast('Compte administrateur créé');
  render();
} catch (err) { toast(err.message === 'Mot de passe incorrect.' ? 'Mot de passe de transfert incorrect.' : err.message, 'error'); } finally { busy(btn, false); }
  }

  function renderLogin() {
$('#main').innerHTML = `
  <h1>Connexion</h1>
  <div class="grid2">
    <div class="card">
      <h2>Se connecter</h2>
      <label>Identifiant <select id="l-login">${store.accounts.map((a) => `<option>${esc(a.login)}</option>`).join('')}</select></label>
      <label>Mot de passe <input id="l-pw" type="password" autocomplete="current-password"></label>
      <button class="btn primary" id="l-go">Se connecter</button>
    </div>
    <div class="card">
      <h2>Ajouter un associé sur cet ordinateur</h2>
      <p class="small muted">Si votre associé utilise le même ordinateur : importez le fichier administrateur qu'il a reçu, puis il choisit son propre mot de passe.</p>
      <label>Fichier administrateur <input id="j-file" type="file" accept=".json,application/json"></label>
      <label>Mot de passe de transfert <input id="j-tpw" type="password" autocomplete="off"></label>
      <label>Identifiant de l'associé <input id="j-login"></label>
      <label>Son mot de passe (${MIN_PW} caractères minimum) <input id="j-pw" type="password" autocomplete="new-password"></label>
      <button class="btn" id="j-go">Importer</button>
    </div>
  </div>`;
const go = async (e) => {
  const acc = store.accounts.find((a) => a.login === $('#l-login').value);
  try {
    busy($('#l-go'), true, 'Vérification…');
    session = { login: acc.login, secret: await unseal(acc.box, $('#l-pw').value) };
    render();
  } catch (err) { toast(err.message, 'error'); } finally { busy($('#l-go'), false); }
};
$('#l-go').onclick = go;
$('#l-pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
$('#j-go').onclick = (e) => joinFromFile(e.target);
$('#l-pw').focus();
  }

  function mergeHistory(list) {
const ids = new Set(store.history.map((h) => h.id));
let n = 0;
const str = (v, max = 500) => (v == null ? '' : String(v)).slice(0, max);
for (const raw of list) {
  if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string' || !/^ARD1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.key)) continue;
  const h = { id: str(raw.id, 40), date: fmtDate(raw.date) ? str(raw.date, 40) : '', name: str(raw.name), siren: str(raw.siren, 9).replace(/\D/g, ''), siret: str(raw.siret, 14).replace(/\D/g, ''),
    email: str(raw.email, 200), offer: str(raw.offer, 100), note: str(raw.note), by: str(raw.by, 60), key: raw.key };
  if (h.id && !ids.has(h.id)) { store.history.push(h); ids.add(h.id); n++; }
}
store.history.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
return n;
  }

  async function renderDashboard() {
const pub = session.secret.pub;
const ok = pubConfigured(pub);
const fp = await fingerprint(pub);
const pubText = JSON.stringify(pub);
$('#main').innerHTML = `
  <h1>Licences</h1>
  ${ok
    ? `<div class="note ok">✔ Votre clé de signature est bien installée dans Ardoise (empreinte ${fp}). Les licences créées ici fonctionneront chez vos clients.</div>`
    : `<div class="card" style="border-color:rgba(255,152,0,.5)">
         <h2 class="warnc">⚠ Dernière étape : installer la clé publique dans Ardoise</h2>
         <p class="small">Tant que cette étape n'est pas faite, les licences ne seront pas reconnues par le logiciel. Copiez le texte ci-dessous et <b>envoyez-le à Claude dans la conversation</b> : il l'ajoutera au logiciel (fichier <code>js/licence-config.js</code>). Ce texte est une clé <b>publique</b> : il ne permet pas de créer de licences, vous pouvez l'envoyer sans risque.</p>
         <div class="keybox mono" id="pubkey">${esc(pubText)}</div>
         <div class="actions"><button class="btn primary" id="copy-pub">Copier la clé publique</button></div>
         <p class="small muted" style="margin-top:8px">Empreinte de la clé : <span class="mono">${fp}</span></p>
       </div>`}

  <div class="grid2">
    <div class="card">
      <h2>Créer une licence</h2>
      <label>Nom du commerce <input id="g-name" placeholder="ex : Cidrerie du Verger"></label>
      <label>SIRET ou SIREN du client <input id="g-siret" placeholder="14 ou 9 chiffres" inputmode="numeric"></label>
      <label>E-mail du client (pour lui envoyer la clé) <input id="g-email" type="email" placeholder="facultatif"></label>
      <label>Offre <select id="g-offer"><option>Licence Ardoise</option><option>Licence Ardoise + Option Sérénité</option><option>Licence Ardoise + Pack 2027</option><option>Licence offerte (test / partenaire)</option></select></label>
      <label>Note interne <input id="g-note" placeholder="ex : payé par chèque le 17/11, installé sur place"></label>
      <button class="btn success" id="g-go">Générer la clé de licence</button>
    </div>
    <div class="card" id="result">
      <h2>Clé générée</h2>
      <p class="muted small">La clé apparaîtra ici. Le client la colle dans Ardoise : menu <b>Mon entreprise</b> → carte <b>Licence</b> → <b>Activer</b>. Elle ne fonctionne que pour son SIREN.</p>
    </div>
  </div>

  <div class="card">
    <h2>Licences délivrées <span class="muted small">(${store.history.length})</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Commerce</th><th>SIREN</th><th>Offre</th><th>Par</th><th>N°</th><th></th></tr></thead>
      <tbody>${store.history.length ? store.history.map((h, i) => `<tr>
        <td>${fmtDate(h.date)}</td><td><b style="color:#fff">${esc(h.name)}</b>${h.note ? `<div class="muted small">${esc(h.note)}</div>` : ''}</td>
        <td>${esc(h.siren)}</td><td>${esc(h.offer)}</td><td>${esc(h.by)}</td><td class="mono">${esc(h.id)}</td>
        <td><button class="btn small" data-copy="${i}">Copier la clé</button> ${h.email ? `<button class="btn small" data-mail="${i}">E-mail</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="7" class="empty">Aucune licence pour le moment.</td></tr>'}</tbody>
    </table></div>
    <div class="actions" style="margin-top:12px">
      <button class="btn small" id="h-csv">Exporter (Excel / CSV)</button>
      <button class="btn small" id="h-json">Exporter pour mon associé</button>
      <label class="btn small" style="margin:0">Importer la liste de mon associé<input id="h-import" type="file" accept=".json" hidden></label>
    </div>
    <p class="small muted" style="margin-top:8px">La liste est enregistrée dans ce navigateur. Pour avoir la même liste à deux, échangez-vous le fichier « Exporter pour mon associé » de temps en temps : l'import ajoute les licences manquantes sans créer de doublon.</p>
  </div>

  <div class="grid2">
    <div class="card">
      <h2>Donner l'accès à un associé</h2>
      <p class="small muted">Crée un <b>fichier administrateur</b> protégé par un mot de passe de transfert. Envoyez le fichier (e-mail, clé USB…) et donnez le mot de passe <b>de vive voix ou par SMS</b>, jamais dans le même message.</p>
      <label>Mot de passe de transfert (${MIN_PW} caractères minimum) <input id="x-pw" type="password" autocomplete="new-password"></label>
      <label>Confirmer <input id="x-pw2" type="password" autocomplete="new-password"></label>
      <button class="btn" id="x-go">Créer le fichier administrateur</button>
    </div>
    <div class="card">
      <h2>Mon compte</h2>
      <label>Nouveau mot de passe <input id="c-pw" type="password" autocomplete="new-password"></label>
      <label>Confirmer <input id="c-pw2" type="password" autocomplete="new-password"></label>
      <div class="actions"><button class="btn" id="c-go">Changer mon mot de passe</button></div>
      <details style="margin-top:14px"><summary>Comptes sur cet ordinateur (${store.accounts.length})</summary>
        <ul class="small">${store.accounts.map((a) => `<li>${esc(a.login)}</li>`).join('')}</ul>
        <p class="small muted">Sauvegarde de secours : gardez une copie du fichier administrateur (bloc de gauche) dans un endroit sûr. Si tous les mots de passe sont perdus, il n'est plus possible de créer de licences avec cette clé.</p>
      </details>
    </div>
  </div>`;

$('#logout').onclick = () => { session = null; render(); };
const cp = $('#copy-pub'); if (cp) cp.onclick = () => copy(pubText);
$('#g-go').onclick = generate;
document.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => copy(store.history[+b.dataset.copy].key); });
document.querySelectorAll('[data-mail]').forEach((b) => { b.onclick = () => mailClient(store.history[+b.dataset.mail]); });
$('#h-csv').onclick = exportCsv;
$('#h-json').onclick = () => download(`ardoise-licences-${today()}.json`, JSON.stringify({ type: 'ardoise-licences', history: store.history }, null, 1), 'application/json');
$('#h-import').onchange = async (e) => {
  try {
    const f = e.target.files[0]; if (!f) return;
    const data = JSON.parse(await f.text());
    const n = mergeHistory(data.history || []);
    persist(); toast(`${n} licence(s) ajoutée(s)`); render();
  } catch (err) { toast("Fichier de licences invalide.", 'error'); }
};
$('#x-go').onclick = async (e) => {
  try {
    const pw = $('#x-pw').value; checkPw(pw, $('#x-pw2').value);
    busy(e.target, true, 'Chiffrement…');
    const pack = { type: 'ardoise-admin', v: 1, created: new Date().toISOString(), by: session.login, box: await seal(session.secret, pw), history: store.history };
    download(`ardoise-fichier-administrateur-${today()}.json`, JSON.stringify(pack), 'application/json');
    toast('Fichier administrateur téléchargé');
    $('#x-pw').value = $('#x-pw2').value = '';
  } catch (err) { toast(err.message, 'error'); } finally { busy(e.target, false); }
};
$('#c-go').onclick = async (e) => {
  try {
    const pw = $('#c-pw').value; checkPw(pw, $('#c-pw2').value);
    busy(e.target, true, 'Chiffrement…');
    const acc = store.accounts.find((a) => a.login === session.login);
    acc.box = await seal(session.secret, pw); persist();
    toast('Mot de passe modifié'); $('#c-pw').value = $('#c-pw2').value = '';
  } catch (err) { toast(err.message, 'error'); } finally { busy(e.target, false); }
};
  }

  async function generate() {
const name = $('#g-name').value.trim();
const digits = $('#g-siret').value.replace(/\s/g, '');
try {
  if (!name) throw new Error('Indiquez le nom du commerce.');
  if (!/^\d{9}(\d{5})?$/.test(digits)) throw new Error('Le SIRET doit avoir 14 chiffres (ou le SIREN 9 chiffres).');
  const siren = digits.slice(0, 9);
  const id = `L-${today().slice(0, 4)}-${b64u(crypto.getRandomValues(new Uint8Array(3))).toUpperCase().replace(/[-_]/g, 'X')}`;
  const payload = { v: 1, id, n: name, s: siren, d: today(), o: $('#g-offer').value };
  const key = await signLicence(session.secret, payload);
  const entry = { id, date: new Date().toISOString(), name, siren, siret: digits.length === 14 ? digits : '', email: $('#g-email').value.trim(), offer: payload.o, note: $('#g-note').value.trim(), by: session.login, key };
  store.history.unshift(entry); persist();
  $('#result').innerHTML = `
    <h2 class="up">✔ Licence ${esc(id)}</h2>
    <p class="small">Pour <b style="color:#fff">${esc(name)}</b> — SIREN ${esc(siren)}</p>
    <div class="keybox mono" id="the-key">${esc(key)}</div>
    <div class="actions"><button class="btn primary" id="r-copy">Copier la clé</button><button class="btn" id="r-mail">Préparer l'e-mail au client</button></div>
    <p class="small muted" style="margin-top:8px">Dans Ardoise : <b>Mon entreprise</b> → <b>Licence</b> → coller la clé → <b>Activer</b>.</p>`;
  $('#r-copy').onclick = () => copy(key);
  $('#r-mail').onclick = () => mailClient(entry);
  toast('Licence créée');
  // met à jour la liste sans effacer le résultat
  const res = $('#result').outerHTML; await renderDashboard(); $('#result').outerHTML = res;
  $('#r-copy').onclick = () => copy(key); $('#r-mail').onclick = () => mailClient(entry);
} catch (err) { toast(err.message, 'error'); }
  }

  function mailClient(h) {
const body = `Bonjour,\n\nMerci pour votre confiance ! Voici votre clé de licence Ardoise :\n\n${h.key}\n\nPour l'activer :\n1. Ouvrez Ardoise.\n2. Menu « Mon entreprise » : vérifiez que votre SIRET est bien renseigné${h.siret ? ` (${h.siret})` : ''}.\n3. Dans la carte « Licence », collez la clé ci-dessus puis cliquez sur « Activer la licence ».\n\nLa mention « DÉMONSTRATION » disparaît alors de vos documents et vos factures sont générées au format Factur-X.\n\nN° de licence : ${h.id}\n\nÀ bientôt,\n${session ? session.login : ''}`;
location.href = `mailto:${encodeURIComponent(h.email || '')}?subject=${encodeURIComponent('Votre licence Ardoise')}&body=${encodeURIComponent(body)}`;
  }

  function exportCsv() {
const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const rows = [['Date', 'Commerce', 'SIREN', 'SIRET', 'E-mail', 'Offre', 'Note', 'Créée par', 'N° de licence', 'Clé']]
  .concat(store.history.map((h) => [fmtDate(h.date), h.name, h.siren, h.siret, h.email, h.offer, h.note, h.by, h.id, h.key]));
download(`ardoise-licences-${today()}.csv`, '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n'), 'text/csv');
  }

  document.addEventListener('click', (e) => { if (e.target.id === 'logout') { session = null; render(); } });
  if (!(window.crypto && crypto.subtle)) {
$('#main').innerHTML = '<div class="note warn">Cette page doit être ouverte en https (sur le site) ou avec un navigateur récent (Chrome, Edge, Firefox).</div>';
  } else {
render();
  }
