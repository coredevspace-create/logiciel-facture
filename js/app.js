/*
 * Ardoise — logiciel de devis et factures 100 % local.
 * Aucune dépendance, aucun serveur : les données sont enregistrées
 * dans le navigateur (localStorage) et peuvent être sauvegardées en fichier.
 */
'use strict';

/* =====================================================================
   Constantes
   ===================================================================== */
// Pour renommer le logiciel, il suffit de modifier la ligne APP (et le logo dans index.html).
const APP = { name: 'Ardoise', tagline: 'Devis & factures des commerces de proximité' };
const STORE_KEY = 'ardoise_v1';
const OLD_STORE_KEYS = ['factulocal_v1'];
const VAT_RATES = [20, 10, 5.5, 2.1, 0];
const UNITS = ['unité', 'pièce', 'kg', 'g', 'litre', 'bouteille', 'carton', 'lot', 'botte', 'bouquet', 'composition', 'heure', 'jour', 'forfait'];
const PAYMENT_METHODS = ['Virement', 'Chèque', 'Espèces', 'Carte bancaire', 'Prélèvement', 'Autre'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const KIND_LABEL = { quote: 'Devis', invoice: 'Facture', credit: 'Avoir' };
const OPERATION_LABEL = { biens: 'Livraison de biens', services: 'Prestation de services', mixte: 'Livraison de biens et prestation de services' };

/* =====================================================================
   Données
   ===================================================================== */
function defaultData() {
  return {
    version: 1,
    settings: {
      name: '', legalForm: '', capital: '', address: '', zip: '', city: '',
      siret: '', registre: '', tvaIntra: '', email: '', phone: '', website: '',
      iban: '', bic: '', paymentMethods: 'Virement, chèque, espèces, carte bancaire',
      logo: '',
      vatRegime: 'normal',          // 'normal' | 'franchise'
      vatOnDebits: false,
      priceMode: 'TTC',             // saisie des prix : 'HT' | 'TTC'
      defaultVat: 20,
      paymentDays: 30,
      quoteValidityDays: 30,
      latePenalty: "En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal.",
      footerNote: '',
      invoicePrefix: 'F', quotePrefix: 'D', creditPrefix: 'A',
    },
    counters: {},
    clients: [],
    products: [],
    documents: [],
    lastBackup: null,
  };
}

let DB = defaultData();
let storageBroken = false;

function migrate(d) {
  const base = defaultData();
  return {
    ...base, ...d,
    settings: { ...base.settings, ...(d.settings || {}) },
    counters: d.counters || {},
    clients: Array.isArray(d.clients) ? d.clients : [],
    products: Array.isArray(d.products) ? d.products : [],
    documents: Array.isArray(d.documents) ? d.documents : [],
  };
}

function load() {
  try {
    let raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      // reprise des données d'une version précédente
      const old = OLD_STORE_KEYS.map((k) => localStorage.getItem(k)).find(Boolean);
      if (old) { raw = old; localStorage.setItem(STORE_KEY, old); }
    }
    DB = raw ? migrate(JSON.parse(raw)) : defaultData();
  } catch (e) {
    storageBroken = true;
    DB = defaultData();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(DB));
    return true;
  } catch (e) {
    toast("Impossible d'enregistrer (stockage plein ou bloqué). Faites une sauvegarde fichier.", 'error');
    return false;
  }
}

/* =====================================================================
   Utilitaires
   ===================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const r4 = (x) => Math.round((Number(x) + Number.EPSILON) * 10000) / 10000;
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

const moneyFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const money = (x) => moneyFmt.format(r2(x || 0));
const fmtRate = (r) => String(r).replace('.', ',') + ' %';
const fmtNum = (x) => String(r4(x)).replace('.', ',');

function compactMoney(v) {
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k€';
  return Math.round(v).toLocaleString('fr-FR') + ' €';
}

function isoDate(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
const today = () => isoDate(new Date());
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + Number(n || 0));
  return isoDate(d);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3200);
}

function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* =====================================================================
   Calculs
   ===================================================================== */
const lineTotal = (l) => r2(num(l.qty) * num(l.price) * (1 - num(l.discount) / 100));

function docTotals(doc) {
  const byRate = {};
  for (const l of doc.lines || []) {
    const rate = doc.franchise ? 0 : num(l.vatRate);
    byRate[rate] = (byRate[rate] || 0) + lineTotal(l);
  }
  let ht = 0, tva = 0, ttc = 0;
  const vat = [];
  for (const [k, v] of Object.entries(byRate)) {
    const rate = Number(k);
    let bHT, bTVA, bTTC;
    if (doc.priceMode === 'TTC' && !doc.franchise) {
      bTTC = r2(v);
      bHT = r2(bTTC / (1 + rate / 100));
      bTVA = r2(bTTC - bHT);
    } else {
      bHT = r2(v);
      bTVA = r2(bHT * rate / 100);
      bTTC = r2(bHT + bTVA);
    }
    vat.push({ rate, base: bHT, tva: bTVA });
    ht += bHT; tva += bTVA; ttc += bTTC;
  }
  vat.sort((a, b) => b.rate - a.rate);
  return { ht: r2(ht), tva: r2(tva), ttc: r2(ttc), vat };
}

const paidAmount = (d) => r2((d.payments || []).reduce((s, p) => s + num(p.amount), 0));
function creditedAmount(inv) {
  return r2(DB.documents
    .filter((c) => c.kind === 'credit' && c.status === 'issued' && c.invoiceRef === inv.id)
    .reduce((s, c) => s + docTotals(c).ttc, 0));
}
const remaining = (inv) => r2(docTotals(inv).ttc - paidAmount(inv) - creditedAmount(inv));

function statusInfo(d) {
  const now = today();
  if (d.kind === 'quote') {
    if (['draft', 'sent'].includes(d.status) && d.dueDate && d.dueDate < now) return { key: 'late', label: 'Expiré' };
    return ({
      draft: { key: 'draft', label: 'Brouillon' },
      sent: { key: 'sent', label: 'Envoyé' },
      accepted: { key: 'accepted', label: 'Accepté' },
      refused: { key: 'refused', label: 'Refusé' },
      invoiced: { key: 'paid', label: 'Facturé' },
    })[d.status] || { key: 'draft', label: d.status };
  }
  if (d.status === 'draft') return { key: 'draft', label: 'Brouillon' };
  if (d.kind === 'credit') return { key: 'credit', label: 'Avoir émis' };
  const rem = remaining(d);
  if (rem <= 0.004) return { key: 'paid', label: 'Payée' };
  if (d.dueDate && d.dueDate < now) return { key: 'late', label: 'En retard' };
  if (paidAmount(d) > 0) return { key: 'partial', label: 'Partiel' };
  return { key: 'sent', label: 'À encaisser' };
}
const badge = (d) => { const s = statusInfo(d); return `<span class="badge b-${s.key}">${esc(s.label)}</span>`; };

function nextNumber(kind, dateISO) {
  const y = (dateISO || today()).slice(0, 4);
  const s = DB.settings;
  const prefix = { quote: s.quotePrefix, invoice: s.invoicePrefix, credit: s.creditPrefix }[kind] || 'X';
  DB.counters[kind] = DB.counters[kind] || {};
  const n = (DB.counters[kind][y] || 0) + 1;
  DB.counters[kind][y] = n;
  return `${prefix}-${y}-${String(n).padStart(4, '0')}`;
}

const clientById = (id) => DB.clients.find((c) => c.id === id);
const docById = (id) => DB.documents.find((d) => d.id === id);
const docClient = (d) => d.clientSnapshot || clientById(d.clientId) || { name: '(client supprimé)' };
function snapshotClient(c) {
  if (!c) return null;
  const { id, type, name, contact, address, zip, city, email, phone, siren, tvaIntra } = c;
  return { id, type, name, contact, address, zip, city, email, phone, siren, tvaIntra };
}
function sellerSnapshot() {
  const s = clone(DB.settings);
  delete s.logo; // le logo reste celui des paramètres (évite de dupliquer l'image)
  return s;
}

function productPriceFor(p, mode, franchise) {
  if (franchise || p.priceMode === mode) return num(p.price);
  const k = 1 + num(p.vatRate) / 100;
  return mode === 'TTC' ? r2(num(p.price) * k) : r4(num(p.price) / k);
}

function sortDocs(list) {
  return list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.number || '').localeCompare(a.number || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function stats() {
  const now = today();
  const ym = now.slice(0, 7);
  let monthHT = 0, toCollect = 0, late = 0, lateCount = 0, collectedMonth = 0;
  for (const d of DB.documents) {
    if (d.kind === 'quote' || d.status !== 'issued') continue;
    const t = docTotals(d);
    const sign = d.kind === 'credit' ? -1 : 1;
    if (d.date.slice(0, 7) === ym) monthHT += sign * t.ht;
    if (d.kind === 'invoice') {
      const rem = remaining(d);
      if (rem > 0.004) {
        toCollect += rem;
        if (d.dueDate && d.dueDate < now) { late += rem; lateCount++; }
      }
      for (const p of d.payments || []) if ((p.date || '').slice(0, 7) === ym) collectedMonth += num(p.amount);
    }
  }
  const pendingQuotes = DB.documents.filter((d) => d.kind === 'quote' && ['draft', 'sent'].includes(d.status) && !(d.dueDate && d.dueDate < now));
  const pendingQuotesHT = pendingQuotes.reduce((s, d) => s + docTotals(d).ht, 0);
  return { monthHT: r2(monthHT), toCollect: r2(toCollect), late: r2(late), lateCount, collectedMonth: r2(collectedMonth), pendingQuotes: pendingQuotes.length, pendingQuotesHT: r2(pendingQuotesHT) };
}

function monthlySeries(nMonths = 12) {
  const now = new Date();
  const series = [];
  for (let i = nMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = isoDate(d).slice(0, 7);
    series.push({ key, label: MONTHS[d.getMonth()], year: d.getFullYear(), v: 0 });
  }
  const idx = Object.fromEntries(series.map((s, i) => [s.key, i]));
  for (const d of DB.documents) {
    if (d.kind === 'quote' || d.status !== 'issued') continue;
    const i = idx[d.date.slice(0, 7)];
    if (i === undefined) continue;
    series[i].v += (d.kind === 'credit' ? -1 : 1) * docTotals(d).ht;
  }
  series.forEach((s) => { s.v = r2(s.v); });
  return series;
}

/* =====================================================================
   Modale
   ===================================================================== */
function openModal(title, html, onMount) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
  if (onMount) onMount($('#modal-body'));
  const first = $('#modal-body input, #modal-body select, #modal-body textarea');
  if (first) first.focus();
}
function closeModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }

/* =====================================================================
   Routeur & actions
   ===================================================================== */
let actions = {};
let draft = null; // document en cours d'édition

function go(hash) {
  if (location.hash === hash) router();
  else location.hash = hash;
}

function router() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const [route, a, b] = parts;
  closeModal();
  actions = {};
  $$('#nav a').forEach((el) => {
    const r = el.dataset.route;
    const active = r === route || (route === '' && r === 'tableau') ||
      (r === 'factures' && ['doc', 'modifier', 'nouveau'].includes(route) && currentKindIs(['invoice', 'credit'], route, a)) ||
      (r === 'devis' && ['doc', 'modifier', 'nouveau'].includes(route) && currentKindIs(['quote'], route, a));
    el.classList.toggle('active', !!active);
  });
  renderTicker();
  renderBanner();
  switch (route) {
    case 'devis': renderList('quote'); break;
    case 'factures': renderList('invoice', a); break;
    case 'clients': renderClients(); break;
    case 'catalogue': renderCatalogue(); break;
    case 'parametres': renderSettings(); break;
    case 'sauvegarde': renderBackup(); break;
    case 'nouveau': startNew(a, b); break;
    case 'modifier': startEdit(a); break;
    case 'doc': renderView(a); break;
    case 'brouillon': if (draft) renderEditor(!docById(draft.id)); else renderDashboard(); break;
    default: renderDashboard();
  }
  window.scrollTo(0, 0);
}

function currentKindIs(kinds, route, a) {
  if (route === 'nouveau') return kinds.includes(a);
  const d = docById(a);
  return d && kinds.includes(d.kind);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === $('#modal')) { closeModal(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.closest('#modal')) return;
  const fn = actions[el.dataset.act] || globalActions[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

const globalActions = {
  'backup-now': () => exportBackup(),
};

/* =====================================================================
   Bandeau de chiffres & alertes
   ===================================================================== */
function renderTicker() {
  const s = stats();
  const item = (label, val, cls = '') => `<div class="t-item"><span class="t-label">${label}</span><span class="t-val ${cls}">${val}</span></div>`;
  const d = new Date();
  $('#ticker').innerHTML = [
    item('Facturé ce mois (HT)', money(s.monthHT)),
    item('Encaissé ce mois', money(s.collectedMonth), 'up'),
    item('À encaisser', money(s.toCollect)),
    item('En retard', `${money(s.late)}${s.lateCount ? ` · ${s.lateCount}` : ''}`, s.late > 0 ? 'down' : ''),
    item('Devis en attente', `${s.pendingQuotes} · ${money(s.pendingQuotesHT)} HT`),
    item(d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), ''),
  ].join('');
}

function renderBanner() {
  const el = $('#banner');
  if (storageBroken) {
    el.innerHTML = `<div class="banner error">⚠ Le navigateur bloque l'enregistrement des données. Utilisez Chrome, Edge ou Firefox en mode normal (pas en navigation privée).</div>`;
    return;
  }
  const hasDocs = DB.documents.length > 0;
  const old = !DB.lastBackup || daysBetween(DB.lastBackup.slice(0, 10), today()) >= 7;
  if (hasDocs && old) {
    const since = DB.lastBackup ? `Dernière sauvegarde le ${fmtDate(DB.lastBackup.slice(0, 10))}.` : 'Aucune sauvegarde fichier pour le moment.';
    el.innerHTML = `<div class="banner warn">💾 ${since} Pensez à sauvegarder vos données sur une clé USB ou un disque. <button class="btn small" data-act="backup-now">Sauvegarder maintenant</button></div>`;
  } else {
    el.innerHTML = '';
  }
}

/* =====================================================================
   Tableau de bord
   ===================================================================== */
function renderDashboard() {
  const s = stats();
  const series = monthlySeries(12);
  const total12 = r2(series.reduce((a, b) => a + b.v, 0));
  const cur = series[series.length - 1].v;
  const prev = series[series.length - 2].v;
  const change = prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
  const now = today();
  const setupMissing = !DB.settings.name || !DB.settings.siret;

  const lateList = DB.documents
    .filter((d) => d.kind === 'invoice' && d.status === 'issued' && remaining(d) > 0.004)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .slice(0, 8);

  const byClient = {};
  for (const d of DB.documents) {
    if (d.kind === 'quote' || d.status !== 'issued') continue;
    if (daysBetween(d.date, now) > 365) continue;
    const k = d.clientId;
    byClient[k] = byClient[k] || { name: docClient(d).name, v: 0 };
    byClient[k].v += (d.kind === 'credit' ? -1 : 1) * docTotals(d).ht;
  }
  const top = Object.values(byClient).sort((a, b) => b.v - a.v).slice(0, 5);

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>Tableau de bord</h1>
      <div class="actions">
        <a class="btn primary" href="#/nouveau/invoice">+ Nouvelle facture</a>
        <a class="btn" href="#/nouveau/quote">+ Nouveau devis</a>
      </div>
    </div>

    ${setupMissing ? `<div class="alert-box warn">Première utilisation ? Commencez par renseigner <a href="#/parametres">votre entreprise</a> (nom, adresse, SIRET, logo). Ces informations apparaissent sur vos devis et factures.${DB.documents.length === 0 ? ` Vous pouvez aussi <a href="#" data-act="demo">charger un exemple de démonstration</a>.` : ''}</div>` : ''}

    <div class="kpis">
      <div class="kpi"><div class="label">Chiffre d'affaires du mois (HT)</div><div class="value">${money(s.monthHT)}</div>
        <div class="sub">${change === null ? '—' : `<span class="${change >= 0 ? 'up' : 'down'}">${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</span> vs mois précédent`}</div></div>
      <div class="kpi good"><div class="label">Encaissé ce mois</div><div class="value">${money(s.collectedMonth)}</div><div class="sub">paiements enregistrés</div></div>
      <div class="kpi"><div class="label">Reste à encaisser</div><div class="value">${money(s.toCollect)}</div><div class="sub">factures émises non soldées</div></div>
      <div class="kpi ${s.late > 0 ? 'alert' : ''}"><div class="label">En retard de paiement</div><div class="value">${money(s.late)}</div><div class="sub">${s.lateCount} facture(s) à relancer</div></div>
    </div>

    <div class="dash-grid">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="muted small">Chiffre d'affaires HT · 12 derniers mois</div>
            <div><span class="big-price">${money(total12)}</span></div>
          </div>
          <div class="muted small">${series[0].label} ${series[0].year} → ${series[11].label} ${series[11].year}</div>
        </div>
        <div class="chart-wrap" id="chart"><div class="chart-tip" id="chart-tip"></div></div>
      </div>

      <div>
        <div class="card watch">
          <div class="card-head"><h2>Factures à encaisser</h2><a class="small" href="#/factures/impayees">Tout voir</a></div>
          ${lateList.length ? `<ul>${lateList.map((d) => {
            const late = d.dueDate && d.dueDate < now ? daysBetween(d.dueDate, now) : 0;
            return `<li data-act="open" data-id="${d.id}">
              <div><div class="w-name">${esc(docClient(d).name)}</div><div class="w-sub">${esc(d.number)} · ${late ? `<span class="down">${late} j de retard</span>` : `échéance ${fmtDate(d.dueDate)}`}</div></div>
              <div class="right"><div class="${late ? 'down' : 'strong'}">${money(remaining(d))}</div></div>
            </li>`;
          }).join('')}</ul>` : '<div class="empty">Aucune facture en attente 🎉</div>'}
        </div>
        <div class="card watch">
          <div class="card-head"><h2>Meilleurs clients (12 mois)</h2></div>
          ${top.length ? `<ul>${top.map((c, i) => `<li><div><span class="muted">${i + 1}.</span> <span class="w-name">${esc(c.name)}</span></div><div class="strong">${money(c.v)}</div></li>`).join('')}</ul>` : '<div class="empty">Pas encore de données</div>'}
        </div>
      </div>
    </div>`;

  actions = {
    open: (el) => go('#/doc/' + el.dataset.id),
    demo: () => loadDemo(),
  };
  drawChart(series);
}

function drawChart(series) {
  const box = $('#chart');
  if (!box) return;
  CHART.W = Math.max(300, Math.round(box.clientWidth));
  const old = $('svg', box);
  if (old) old.remove();
  box.insertAdjacentHTML('afterbegin', chartSVG(series));
  bindChart(series);
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if ($('#chart')) drawChart(monthlySeries(12)); }, 150);
});

function niceCeil(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const CHART = { W: 800, H: 260, padL: 22, padR: 72, padT: 16, padB: 28 };

function chartGeom(series) {
  const { W, H, padL, padR, padT, padB } = CHART;
  const vals = series.map((s) => s.v);
  const max = niceCeil(Math.max(...vals, 0) * 1.08);
  const min = Math.min(0, ...vals);
  const iw = W - padL - padR, ih = H - padT - padB;
  const x = (i) => padL + (series.length === 1 ? iw / 2 : (i * iw) / (series.length - 1));
  const y = (v) => padT + ih * (1 - (v - min) / (max - min || 1));
  return { W, H, padL, padR, padT, padB, iw, ih, max, min, x, y };
}

function chartSVG(series) {
  const g = chartGeom(series);
  const pts = series.map((s, i) => [g.x(i), g.y(s.v)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const base = g.y(Math.max(g.min, 0));
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${base} L${pts[0][0].toFixed(1)},${base} Z`;
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const v = g.min + ((g.max - g.min) * i) / 4;
    const yy = g.y(v);
    grid += `<line x1="${g.padL}" x2="${g.W - g.padR}" y1="${yy}" y2="${yy}" stroke="#2a2e39" stroke-width="1"/>`;
    grid += `<text x="${g.W - g.padR + 8}" y="${yy + 4}" fill="#787b86" font-size="11">${compactMoney(v)}</text>`;
  }
  const step = g.iw / series.length < 38 ? 2 : 1;
  const xl = series.map((s, i) => ((series.length - 1 - i) % step ? '' : `<text x="${g.x(i)}" y="${g.H - 8}" fill="#787b86" font-size="11" text-anchor="middle">${s.label}</text>`)).join('');
  const last = pts[pts.length - 1];
  const lastV = series[series.length - 1].v;
  return `<svg viewBox="0 0 ${g.W} ${g.H}" width="${g.W}" height="${g.H}" role="img" aria-label="Chiffre d'affaires mensuel">
    <defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="#2962ff" stop-opacity=".35"/><stop offset="100%" stop-color="#2962ff" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <line x1="${g.W - g.padR}" x2="${g.W - g.padR}" y1="${g.padT}" y2="${g.H - g.padB}" stroke="#2a2e39"/>
    <path d="${area}" fill="url(#ga)"/>
    <path d="${line}" fill="none" stroke="#2962ff" stroke-width="2" vector-effect="non-scaling-stroke"/>
    ${xl}
    <line id="ch-x" x1="0" x2="0" y1="${g.padT}" y2="${g.H - g.padB}" stroke="#9598a1" stroke-dasharray="4 4" visibility="hidden"/>
    <line id="ch-y" x1="${g.padL}" x2="${g.W - g.padR}" y1="0" y2="0" stroke="#9598a1" stroke-dasharray="4 4" visibility="hidden"/>
    <circle id="ch-dot" r="4" fill="#2962ff" stroke="#fff" stroke-width="1.5" visibility="hidden"/>
    <rect x="${g.W - g.padR + 1}" y="${last[1] - 10}" width="${g.padR - 2}" height="20" rx="2" fill="#2962ff"/>
    <text x="${g.W - g.padR + 8}" y="${last[1] + 4}" fill="#fff" font-size="11" font-weight="600">${compactMoney(lastV)}</text>
    <rect id="ch-hit" x="${g.padL}" y="0" width="${g.iw}" height="${g.H}" fill="transparent"/>
  </svg>`;
}

function bindChart(series) {
  const svg = $('#chart svg');
  if (!svg) return;
  const g = chartGeom(series);
  const tip = $('#chart-tip');
  const hide = () => { ['#ch-x', '#ch-y', '#ch-dot'].forEach((s) => $(s, svg).setAttribute('visibility', 'hidden')); tip.style.display = 'none'; };
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * g.W;
    let i = Math.round(((vx - g.padL) / g.iw) * (series.length - 1));
    i = Math.max(0, Math.min(series.length - 1, i));
    const px = g.x(i), py = g.y(series[i].v);
    $('#ch-x', svg).setAttribute('x1', px); $('#ch-x', svg).setAttribute('x2', px);
    $('#ch-y', svg).setAttribute('y1', py); $('#ch-y', svg).setAttribute('y2', py);
    $('#ch-dot', svg).setAttribute('cx', px); $('#ch-dot', svg).setAttribute('cy', py);
    ['#ch-x', '#ch-y', '#ch-dot'].forEach((s) => $(s, svg).setAttribute('visibility', 'visible'));
    tip.innerHTML = `${series[i].label} ${series[i].year} · <b>${money(series[i].v)}</b> HT`;
    tip.style.display = 'block';
    const left = (px / g.W) * rect.width;
    tip.style.left = Math.min(rect.width - tip.offsetWidth, Math.max(0, left - tip.offsetWidth / 2)) + 'px';
    tip.style.top = Math.max(0, (py / g.H) * rect.height - 40) + 'px';
  });
}

/* =====================================================================
   Listes de devis / factures
   ===================================================================== */
let listFilter = { quote: 'all', invoice: 'all' };
let listSearch = '';

function renderList(kind, preset) {
  const isQuote = kind === 'quote';
  if (preset === 'impayees') listFilter.invoice = 'unpaid';
  const all = DB.documents.filter((d) => (isQuote ? d.kind === 'quote' : d.kind !== 'quote'));
  const filters = isQuote
    ? [['all', 'Tous'], ['draft', 'Brouillons'], ['sent', 'Envoyés'], ['accepted', 'Acceptés'], ['refused', 'Refusés'], ['late', 'Expirés']]
    : [['all', 'Toutes'], ['draft', 'Brouillons'], ['unpaid', 'À encaisser'], ['late', 'En retard'], ['paid', 'Payées'], ['credit', 'Avoirs']];
  const match = (d, f) => {
    if (f === 'all') return true;
    const s = statusInfo(d).key;
    if (isQuote) return f === 'late' ? s === 'late' : d.status === f && s !== 'late';
    if (f === 'credit') return d.kind === 'credit';
    if (d.kind === 'credit') return f === 'draft' && d.status === 'draft';
    if (f === 'unpaid') return ['sent', 'partial', 'late'].includes(s);
    return s === f;
  };
  const f = listFilter[kind];
  const q = listSearch.trim().toLowerCase();
  const rows = sortDocs(all.filter((d) => match(d, f)).filter((d) => !q || `${d.number || ''} ${docClient(d).name} ${d.subject || ''}`.toLowerCase().includes(q)));

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>${isQuote ? 'Devis' : 'Factures & avoirs'}</h1>
      <div class="actions"><a class="btn primary" href="#/nouveau/${kind}">+ ${isQuote ? 'Nouveau devis' : 'Nouvelle facture'}</a></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <div class="tabs">${filters.map(([k, l]) => `<button class="tab ${f === k ? 'active' : ''}" data-act="filter" data-f="${k}">${l}<span class="count">${all.filter((d) => match(d, k)).length}</span></button>`).join('')}</div>
        <input id="search" type="search" placeholder="Rechercher (numéro, client…)" value="${esc(listSearch)}">
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Numéro</th><th>Date</th><th>Client</th><th>Objet</th><th class="num">Total HT</th><th class="num">Total TTC</th>${isQuote ? '' : '<th class="num">Reste dû</th>'}<th>Statut</th></tr></thead>
        <tbody>${rows.length ? rows.map((d) => {
          const t = docTotals(d);
          const sign = d.kind === 'credit' ? -1 : 1;
          const rem = d.kind === 'invoice' && d.status === 'issued' ? remaining(d) : 0;
          return `<tr class="clickable" data-act="open" data-id="${d.id}">
            <td class="strong nowrap">${d.kind === 'credit' ? '↩ ' : ''}${esc(d.number || '— brouillon —')}</td>
            <td class="nowrap">${fmtDate(d.date)}</td>
            <td>${esc(docClient(d).name)}</td>
            <td class="muted">${esc(d.subject || '')}</td>
            <td class="num">${money(sign * t.ht)}</td>
            <td class="num strong">${money(sign * t.ttc)}</td>
            ${isQuote ? '' : `<td class="num ${rem > 0 && statusInfo(d).key === 'late' ? 'down' : ''}">${rem > 0 ? money(rem) : '—'}</td>`}
            <td>${badge(d)}</td></tr>`;
        }).join('') : `<tr><td colspan="8" class="empty">Aucun document${q ? ' pour cette recherche' : ''}.</td></tr>`}</tbody>
      </table></div>
    </div>`;

  actions = {
    filter: (el) => { listFilter[kind] = el.dataset.f; renderList(kind); },
    open: (el) => go('#/doc/' + el.dataset.id),
  };
  const s = $('#search');
  s.addEventListener('input', () => {
    listSearch = s.value;
    const pos = s.selectionStart;
    renderList(kind);
    const ns = $('#search'); ns.focus(); ns.setSelectionRange(pos, pos);
  });
}

/* =====================================================================
   Création / édition d'un document
   ===================================================================== */
function newDoc(kind) {
  const s = DB.settings;
  const date = today();
  return {
    id: uid(), kind, number: null, status: 'draft', date,
    dueDate: kind === 'quote' ? addDays(date, s.quoteValidityDays) : addDays(date, s.paymentDays),
    clientId: '', clientSnapshot: null, subject: '', operation: 'biens', deliveryAddress: '',
    priceMode: s.vatRegime === 'franchise' ? 'HT' : s.priceMode,
    franchise: s.vatRegime === 'franchise',
    lines: [], notes: '', payments: [], reminders: [], createdAt: new Date().toISOString(),
  };
}

function startNew(kind, clientId) {
  if (!['quote', 'invoice'].includes(kind)) return go('#/tableau');
  draft = newDoc(kind);
  if (clientId && clientById(clientId)) draft.clientId = clientId;
  renderEditor(true);
}

function isEditable(d) {
  if (d.kind === 'quote') return ['draft', 'sent', 'accepted', 'refused'].includes(d.status);
  return d.status === 'draft';
}

function startEdit(id) {
  const d = docById(id);
  if (!d) return go('#/tableau');
  if (!isEditable(d)) { toast('Ce document est validé : il ne peut plus être modifié. Faites un avoir pour le corriger.', 'error'); return go('#/doc/' + id); }
  draft = clone(d);
  renderEditor(false);
}

function renderEditor(isNew) {
  const d = draft;
  const isQuote = d.kind === 'quote';
  const label = KIND_LABEL[d.kind];
  const ttc = d.priceMode === 'TTC';
  const clients = DB.clients.slice().sort((a, b) => a.name.localeCompare(b.name));
  const title = isNew ? `Nouveau ${label.toLowerCase()}` : `${label} ${d.number || '(brouillon)'}`;
  const invRef = d.invoiceRef ? docById(d.invoiceRef) : null;

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>${esc(isNew && d.kind === 'invoice' ? 'Nouvelle facture' : title)}</h1>
      <div class="actions">
        <button class="btn" data-act="cancel">Annuler</button>
        ${isQuote
          ? `<button class="btn primary" data-act="save">Enregistrer le devis</button>`
          : `<button class="btn" data-act="save">Enregistrer le brouillon</button>
             <button class="btn success" data-act="validate">Valider ${d.kind === 'credit' ? "l'avoir" : 'la facture'}</button>`}
      </div>
    </div>

    ${!isQuote ? `<div class="alert-box info">Tant qu'elle est en <b>brouillon</b>, vous pouvez modifier la ${d.kind === 'credit' ? 'note' : 'facture'}. Une fois <b>validée</b>, elle reçoit un numéro définitif et ne peut plus être modifiée (obligation légale). Pour corriger une facture validée, on fait un avoir.</div>` : ''}
    ${invRef ? `<div class="alert-box warn">Avoir sur la facture <b>${esc(invRef.number)}</b> du ${fmtDate(invRef.date)}. Gardez uniquement les lignes à rembourser ou annuler.</div>` : ''}

    <div class="card">
      <div class="grid3">
        <label class="span2">Client
          <div class="row">
            <select id="f-client" ${invRef ? 'disabled' : ''}>
              <option value="">— Choisir un client —</option>
              ${clients.map((c) => `<option value="${c.id}" ${c.id === d.clientId ? 'selected' : ''}>${esc(c.name)}${c.type === 'pro' ? '' : ' (particulier)'}</option>`).join('')}
            </select>
            ${invRef ? '' : '<button class="btn" data-act="new-client" type="button">+ Nouveau client</button>'}
          </div>
        </label>
        <label>Objet / référence <input id="f-subject" value="${esc(d.subject)}" placeholder="ex : Commande mariage 14/06"></label>
        <label>Date ${isQuote ? 'du devis' : (d.kind === 'credit' ? "de l'avoir" : 'de facture')} <input id="f-date" type="date" value="${d.date}"></label>
        <label>${isQuote ? "Valable jusqu'au" : "Date d'échéance"} <input id="f-due" type="date" value="${d.dueDate || ''}">
          ${isQuote ? '' : '<div class="hint">Même date que la facture = paiement à réception.</div>'}</label>
        ${isQuote ? '' : `<label>Date de livraison / prestation <input id="f-delivery-date" type="date" value="${d.deliveryDate || d.date}">
          <div class="hint">Si différente de la date ${d.kind === 'credit' ? "de l'avoir" : 'de facture'}.</div></label>`}
        <label>Nature de l'opération
          <select id="f-op">${Object.entries(OPERATION_LABEL).map(([k, l]) => `<option value="${k}" ${d.operation === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </label>
        <label class="span-all">Adresse de livraison (si différente de l'adresse du client)
          <input id="f-delivery" value="${esc(d.deliveryAddress)}" placeholder="Laisser vide si identique">
        </label>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Lignes</h2>
        <span class="muted small">Prix saisis en <b>${d.franchise ? 'net (pas de TVA)' : ttc ? 'TTC' : 'HT'}</b></span>
      </div>
      <div class="table-wrap"><table class="lines">
        <thead><tr><th>Désignation</th><th class="col-qty">Qté</th><th class="col-unit">Unité</th>
          <th class="col-price">PU ${d.franchise ? '' : ttc ? 'TTC' : 'HT'}</th>${d.franchise ? '' : '<th class="col-vat">TVA</th>'}
          <th class="col-disc">Remise %</th><th class="col-total num">Total ${d.franchise ? '' : ttc ? 'TTC' : 'HT'}</th><th class="col-del"></th></tr></thead>
        <tbody id="lines"></tbody>
      </table></div>
      <div class="row" style="margin-top:10px">
        <label>Ajouter un article du catalogue
          <input id="add-product" list="products-dl" placeholder="${DB.products.length ? 'Tapez le nom de l\'article…' : 'Catalogue vide — ajoutez des articles dans « Catalogue »'}">
        </label>
        <button class="btn" data-act="add-line" type="button">+ Ligne libre</button>
      </div>
      <datalist id="products-dl">${DB.products.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
      <datalist id="units-dl">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>
      <div id="totals"></div>
    </div>

    <div class="card">
      <label>Notes (affichées sur le document)
        <textarea id="f-notes" placeholder="ex : Merci pour votre confiance !">${esc(d.notes)}</textarea>
      </label>
    </div>`;

  drawLines();

  $('#lines').addEventListener('input', (e) => {
    const f = e.target.dataset.f;
    const tr = e.target.closest('tr');
    if (!f || !tr) return;
    const l = draft.lines[Number(tr.dataset.i)];
    l[f] = ['qty', 'price', 'discount', 'vatRate'].includes(f) ? num(e.target.value) : e.target.value;
    $('[data-total]', tr).textContent = money(lineTotal(l));
    $('#totals').innerHTML = totalsHTML(draft);
  });

  const addP = $('#add-product');
  const tryAdd = () => {
    const p = DB.products.find((x) => x.name.toLowerCase() === addP.value.trim().toLowerCase());
    if (!p) return;
    draft.lines.push({
      designation: p.name, description: p.description || '', qty: 1, unit: p.unit || 'unité',
      price: productPriceFor(p, draft.priceMode, draft.franchise), vatRate: draft.franchise ? 0 : num(p.vatRate), discount: 0,
    });
    addP.value = '';
    drawLines();
  };
  addP.addEventListener('change', tryAdd);
  addP.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(); } });

  actions = {
    cancel: () => { draft = null; history.length > 1 ? history.back() : go('#/tableau'); },
    'add-line': () => {
      draft.lines.push({ designation: '', description: '', qty: 1, unit: 'unité', price: 0, vatRate: draft.franchise ? 0 : num(DB.settings.defaultVat), discount: 0 });
      drawLines();
      const inputs = $$('#lines input[data-f="designation"]');
      inputs[inputs.length - 1].focus();
    },
    'del-line': (el) => { draft.lines.splice(Number(el.dataset.i), 1); drawLines(); },
    'new-client': () => {
      readHeader();
      openClientModal(null, (c) => { draft.clientId = c.id; renderEditor(isNew); });
    },
    save: () => { if (persistDraft()) { toast('Enregistré'); go('#/doc/' + draft.id); } },
    validate: () => validateDraft(),
  };
}

function drawLines() {
  const d = draft;
  $('#lines').innerHTML = d.lines.length ? d.lines.map((l, i) => `
    <tr data-i="${i}">
      <td><input data-f="designation" value="${esc(l.designation)}" placeholder="Désignation">
          <input class="desc-input" data-f="description" value="${esc(l.description)}" placeholder="Détail (optionnel)"></td>
      <td class="col-qty"><input data-f="qty" type="number" step="any" value="${l.qty}"></td>
      <td class="col-unit"><input data-f="unit" value="${esc(l.unit)}" list="units-dl"></td>
      <td class="col-price"><input data-f="price" type="number" step="0.01" value="${l.price}"></td>
      ${d.franchise ? '' : `<td class="col-vat"><select data-f="vatRate">${VAT_RATES.map((r) => `<option value="${r}" ${num(l.vatRate) === r ? 'selected' : ''}>${fmtRate(r)}</option>`).join('')}</select></td>`}
      <td class="col-disc"><input data-f="discount" type="number" step="any" min="0" max="100" value="${l.discount || ''}" placeholder="0"></td>
      <td class="col-total num" data-total>${money(lineTotal(l))}</td>
      <td class="col-del"><button class="icon-btn" data-act="del-line" data-i="${i}" title="Supprimer la ligne" type="button">✕</button></td>
    </tr>`).join('') : `<tr><td colspan="8" class="empty">Ajoutez un article du catalogue ou une ligne libre.</td></tr>`;
  $('#totals').innerHTML = totalsHTML(d);
}

function totalsHTML(doc) {
  const t = docTotals(doc);
  if (doc.franchise) {
    return `<div class="totals"><div class="grand"><span>Net à payer</span><span>${money(t.ttc)}</span></div></div>`;
  }
  return `<div class="totals">
    <div><span>Total HT</span><span>${money(t.ht)}</span></div>
    ${t.vat.map((v) => `<div><span>TVA ${fmtRate(v.rate)} <span class="muted small">sur ${money(v.base)}</span></span><span>${money(v.tva)}</span></div>`).join('')}
    <div class="grand"><span>Total TTC</span><span>${money(t.ttc)}</span></div>
  </div>`;
}

function readHeader() {
  const d = draft;
  const c = $('#f-client');
  if (c && !c.disabled) d.clientId = c.value;
  d.subject = $('#f-subject').value.trim();
  d.date = $('#f-date').value || today();
  d.dueDate = $('#f-due').value || d.date;
  d.operation = $('#f-op').value;
  d.deliveryAddress = $('#f-delivery').value.trim();
  const dd = $('#f-delivery-date');
  d.deliveryDate = dd && dd.value && dd.value !== d.date ? dd.value : '';
  d.notes = $('#f-notes').value;
}

function persistDraft() {
  readHeader();
  const d = draft;
  d.lines = d.lines.filter((l) => String(l.designation).trim() || num(l.price));
  if (!d.clientId) { toast('Choisissez un client.', 'error'); return false; }
  if (!d.lines.length) { toast('Ajoutez au moins une ligne.', 'error'); drawLines(); return false; }
  if (d.lines.some((l) => !String(l.designation).trim())) { toast('Chaque ligne doit avoir une désignation.', 'error'); drawLines(); return false; }
  const client = clientById(d.clientId);
  if (client) d.clientSnapshot = snapshotClient(client);
  if (d.kind === 'quote' && !d.number) d.number = nextNumber('quote', d.date);
  d.updatedAt = new Date().toISOString();
  const i = DB.documents.findIndex((x) => x.id === d.id);
  if (i >= 0) DB.documents[i] = clone(d); else DB.documents.push(clone(d));
  return save();
}

function validateDraft() {
  const s = DB.settings;
  if (!s.name || !s.address || !s.siret) {
    toast("Complétez d'abord « Mon entreprise » (nom, adresse, SIRET) : ces mentions sont obligatoires sur une facture.", 'error');
    return;
  }
  if (s.vatRegime !== 'franchise' && !s.tvaIntra) {
    toast("Renseignez votre numéro de TVA intracommunautaire dans « Mon entreprise » : il est obligatoire sur vos factures.", 'error');
    return;
  }
  readHeader();
  const d = draft;
  const cl = clientById(d.clientId);
  if (cl && cl.type === 'pro' && !/^\d{9}$/.test(cl.siren || '') &&
      !confirm(`Le SIREN du client « ${cl.name} » n'est pas renseigné.\n\nIl est obligatoire sur les factures entre professionnels et indispensable pour la facture électronique (Factur-X).\n\nValider quand même ?`)) return;
  const last = DB.documents
    .filter((x) => x.kind === d.kind && x.status === 'issued' && x.id !== d.id)
    .reduce((m, x) => (x.date > m ? x.date : m), '');
  if (last && d.date < last) {
    toast(`La date doit être au ${fmtDate(last)} ou après (les numéros doivent suivre l'ordre chronologique).`, 'error');
    return;
  }
  const t = docTotals(d);
  if (t.ttc <= 0) { toast('Le montant total doit être supérieur à zéro.', 'error'); return; }
  const what = d.kind === 'credit' ? "l'avoir" : 'la facture';
  if (!confirm(`Valider ${what} de ${money(t.ttc)} ?\n\nElle recevra un numéro définitif et ne pourra plus être modifiée.`)) return;
  if (!persistDraft()) return;
  const stored = docById(d.id);
  stored.number = nextNumber(d.kind, d.date);
  stored.status = 'issued';
  stored.validatedAt = new Date().toISOString();
  stored.sellerSnapshot = sellerSnapshot();
  stored.clientSnapshot = snapshotClient(clientById(stored.clientId)) || stored.clientSnapshot;
  save();
  toast(`${KIND_LABEL[d.kind]} ${stored.number} validée`);
  draft = null;
  go('#/doc/' + stored.id);
}

/* =====================================================================
   Visualisation d'un document
   ===================================================================== */
function renderView(id) {
  const d = docById(id);
  if (!d) { $('#main').innerHTML = '<div class="card empty">Document introuvable.</div>'; return; }
  const isQuote = d.kind === 'quote';
  const isInv = d.kind === 'invoice';
  const issued = d.status === 'issued';
  const c = docClient(d);
  const rem = isInv && issued ? remaining(d) : 0;
  const t = docTotals(d);
  const credits = DB.documents.filter((x) => x.kind === 'credit' && x.invoiceRef === d.id);
  const ref = d.invoiceRef ? docById(d.invoiceRef) : null;
  const fromQuote = d.sourceId ? docById(d.sourceId) : null;
  const toInvoice = d.invoiceId ? docById(d.invoiceId) : null;

  $('#main').innerHTML = `
    <div class="page-head">
      <h1>${KIND_LABEL[d.kind]} ${esc(d.number || '(brouillon)')} ${badge(d)}</h1>
      <div class="actions">
        <a class="btn" href="#/${isQuote ? 'devis' : 'factures'}">← Retour</a>
        ${isEditable(d) ? `<a class="btn" href="#/modifier/${d.id}">✎ Modifier</a>` : ''}
        <button class="btn primary" data-act="pdf">⬇ ${isFacturX(d) ? 'PDF Factur-X' : 'Télécharger le PDF'}</button>
        <button class="btn" data-act="print">⎙ Imprimer</button>
        <button class="btn" data-act="email">✉ Envoyer par e-mail</button>
      </div>
    </div>
    <div class="doc-layout">
      <div>${renderPaper(d)}</div>
      <div class="side">
        <div class="card">
          <h3>Résumé</h3>
          <ul>
            <li><span class="muted">Client</span><span class="strong">${esc(c.name)}</span></li>
            <li><span class="muted">Total TTC</span><span class="strong">${money(t.ttc)}</span></li>
            ${isInv && issued ? `<li><span class="muted">Payé</span><span class="up">${money(paidAmount(d))}</span></li>
              ${creditedAmount(d) ? `<li><span class="muted">Avoirs</span><span>${money(creditedAmount(d))}</span></li>` : ''}
              <li><span class="muted">Reste dû</span><span class="${rem > 0 ? 'down' : 'up'} strong">${money(Math.max(0, rem))}</span></li>` : ''}
          </ul>
        </div>

        ${isFacturX(d) ? facturxCard(d) : ''}

        ${isQuote ? `<div class="card"><h3>Suivi du devis</h3>
          ${toInvoice ? `<p class="small">Transformé en <a href="#/doc/${toInvoice.id}">${esc(toInvoice.number || 'facture brouillon')}</a>.</p>` : ''}
          ${d.status !== 'invoiced' ? `
            <button class="btn success" data-act="to-invoice">→ Transformer en facture</button>
            ${d.status !== 'sent' ? '<button class="btn" data-act="q-status" data-s="sent">Marquer « envoyé »</button>' : ''}
            ${d.status !== 'accepted' ? '<button class="btn" data-act="q-status" data-s="accepted">Marquer « accepté »</button>' : ''}
            ${d.status !== 'refused' ? '<button class="btn" data-act="q-status" data-s="refused">Marquer « refusé »</button>' : ''}` : ''}
        </div>` : ''}

        ${isInv && issued ? `<div class="card"><h3>Paiements</h3>
          ${(d.payments || []).length ? `<ul>${d.payments.map((p) => `<li><span>${fmtDate(p.date)} · ${esc(p.method)}</span><span class="up">${money(p.amount)} <button class="icon-btn" data-act="del-pay" data-p="${p.id}" title="Supprimer">✕</button></span></li>`).join('')}</ul>` : '<p class="muted small">Aucun paiement enregistré.</p>'}
          ${rem > 0.004 ? `<button class="btn success" data-act="pay">+ Enregistrer un paiement</button>
          <button class="btn" data-act="remind">🔔 Relancer le client</button>` : ''}
          ${(d.reminders || []).length ? `<p class="muted small" style="margin-top:10px">Relances : ${d.reminders.map((r) => fmtDate(r.date)).join(', ')}</p>` : ''}
        </div>` : ''}

        ${(isInv && issued) || credits.length || ref || fromQuote ? `<div class="card"><h3>Liens</h3><ul>
          ${fromQuote ? `<li><span class="muted">Devis d'origine</span><a href="#/doc/${fromQuote.id}">${esc(fromQuote.number)}</a></li>` : ''}
          ${ref ? `<li><span class="muted">Facture</span><a href="#/doc/${ref.id}">${esc(ref.number)}</a></li>` : ''}
          ${credits.map((x) => `<li><span class="muted">Avoir</span><a href="#/doc/${x.id}">${esc(x.number || 'brouillon')}</a></li>`).join('')}
        </ul>${isInv && issued ? '<button class="btn" data-act="credit">↩ Créer un avoir</button>' : ''}</div>` : ''}

        <div class="card"><h3>Autres actions</h3>
          ${d.kind !== 'credit' ? '<button class="btn" data-act="duplicate">⧉ Dupliquer</button>' : ''}
          ${isQuote || d.status === 'draft' ? '<button class="btn danger" data-act="delete">🗑 Supprimer</button>' : '<p class="muted small">Document validé : il doit être conservé 10 ans et ne peut pas être supprimé.</p>'}
        </div>
      </div>
    </div>`;

  actions = {
    pdf: () => downloadPdf(d),
    xml: () => downloadXml(d),
    print: () => printDoc(d),
    email: () => emailDoc(d),
    'to-invoice': () => quoteToInvoice(d),
    'q-status': (el) => { d.status = el.dataset.s; save(); renderView(d.id); renderTicker(); },
    pay: () => openPaymentModal(d),
    'del-pay': (el) => {
      if (!confirm('Supprimer ce paiement ?')) return;
      d.payments = d.payments.filter((p) => p.id !== el.dataset.p);
      save(); renderView(d.id); renderTicker();
    },
    remind: () => openReminderModal(d),
    credit: () => createCredit(d),
    duplicate: () => {
      const n = newDoc(d.kind);
      Object.assign(n, { clientId: d.clientId, subject: d.subject, operation: d.operation, deliveryAddress: d.deliveryAddress, notes: d.notes, priceMode: d.priceMode, franchise: d.franchise, lines: clone(d.lines) });
      draft = n;
      go('#/brouillon');
    },
    delete: () => {
      if (!confirm(`Supprimer définitivement ${d.kind === 'quote' ? 'ce devis' : 'ce brouillon'} ?`)) return;
      DB.documents = DB.documents.filter((x) => x.id !== d.id);
      DB.documents.forEach((x) => { if (x.invoiceId === d.id) { delete x.invoiceId; if (x.status === 'invoiced') x.status = 'accepted'; } });
      save();
      toast('Supprimé');
      go(isQuote ? '#/devis' : '#/factures');
    },
  };
}

function facturxCard(d) {
  const issues = facturxIssues(d);
  return `<div class="card"><h3>Facture électronique</h3>
    ${issues.length
      ? `<p class="small" style="color:var(--warn)">⚠ Informations à compléter pour la plateforme agréée :</p><ul>${issues.map((i) => `<li class="small" style="display:block">• ${esc(i)}</li>`).join('')}</ul>`
      : '<p class="small"><span class="up">✔ Format Factur-X (EN 16931)</span><br><span class="muted">Le PDF contient les données structurées de la facture : il peut être déposé tel quel sur votre plateforme agréée.</span></p>'}
    <button class="btn" data-act="pdf">⬇ PDF Factur-X</button>
    <button class="btn" data-act="xml">⬇ XML seul (CII)</button>
  </div>`;
}

function renderPaper(d) {
  const S = d.sellerSnapshot || DB.settings;
  const logo = DB.settings.logo;
  const c = docClient(d);
  const t = docTotals(d);
  const isQuote = d.kind === 'quote';
  const isPro = c.type === 'pro';
  const mode = d.franchise ? '' : d.priceMode === 'TTC' ? 'TTC' : 'HT';
  const ref = d.invoiceRef ? docById(d.invoiceRef) : null;
  const title = { quote: 'DEVIS', invoice: 'FACTURE', credit: 'AVOIR' }[d.kind];
  const addr = (o) => [o.address, [o.zip, o.city].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');
  const paid = d.kind === 'invoice' && d.status === 'issued' ? paidAmount(d) : 0;

  const mentions = [];
  if (d.franchise) mentions.push('TVA non applicable, art. 293 B du CGI.');
  if (d.kind === 'invoice' && S.vatOnDebits && !d.franchise) mentions.push("Option pour le paiement de la taxe d'après les débits.");
  if (d.kind === 'invoice') {
    if (S.latePenalty) mentions.push(esc(S.latePenalty));
    if (isPro) {
      mentions.push('Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €.');
      mentions.push("Pas d'escompte pour paiement anticipé.");
    }
  }
  if (isQuote) mentions.push(`Devis gratuit, valable jusqu'au ${fmtDate(d.dueDate)}.`);

  const legal = [
    esc(S.name),
    S.legalForm ? esc(S.legalForm) + (S.capital ? ` au capital de ${esc(S.capital)} €` : '') : '',
    S.siret ? 'SIRET ' + esc(S.siret) : '',
    S.registre ? esc(S.registre) : '',
    S.tvaIntra && !d.franchise ? 'TVA intracom. ' + esc(S.tvaIntra) : '',
  ].filter(Boolean).join(' · ');

  return `<div class="paper" id="paper">
    ${d.status === 'draft' && !isQuote ? '<div class="watermark">BROUILLON</div>' : ''}
    <div class="p-head">
      <div class="p-seller">
        ${logo ? `<img class="p-logo" src="${logo}" alt="">` : ''}
        <strong>${esc(S.name) || '<span style="color:#c00">Nom de votre entreprise</span>'}</strong><br>
        ${addr(S)}
        ${S.phone ? '<br>Tél. ' + esc(S.phone) : ''}${S.email ? '<br>' + esc(S.email) : ''}${S.website ? '<br>' + esc(S.website) : ''}
      </div>
      <div class="p-title">
        <h1>${title}</h1>
        <div>N° <b>${esc(d.number || 'brouillon')}</b></div>
        <div>Date : ${fmtDate(d.date)}</div>
        ${d.kind === 'invoice' ? `<div>Échéance : ${d.dueDate && d.dueDate !== d.date ? fmtDate(d.dueDate) : 'à réception'}</div>` : ''}
        ${isQuote ? `<div>Valable jusqu'au : ${fmtDate(d.dueDate)}</div>` : ''}
      </div>
    </div>

    <div class="p-client">
      <div style="font-size:11px;color:#777;margin-bottom:4px">${isQuote ? 'Devis pour' : d.kind === 'credit' ? 'Avoir pour' : 'Facturé à'}</div>
      <strong>${esc(c.name)}</strong>${c.contact ? '<br>' + esc(c.contact) : ''}<br>
      ${addr(c)}
      ${isPro && c.siren ? '<br>SIREN : ' + esc(c.siren) : ''}
      ${isPro && c.tvaIntra ? '<br>TVA : ' + esc(c.tvaIntra) : ''}
    </div>

    <div class="p-meta">
      ${ref ? `<div><b>Avoir sur la facture n° ${esc(ref.number)} du ${fmtDate(ref.date)}</b></div>` : ''}
      ${d.subject ? `<div>Objet : <b>${esc(d.subject)}</b></div>` : ''}
      <div>Opération : ${OPERATION_LABEL[d.operation] || OPERATION_LABEL.biens}</div>
      ${d.deliveryDate && d.deliveryDate !== d.date ? `<div>Date de livraison / prestation : ${fmtDate(d.deliveryDate)}</div>` : ''}
      ${d.deliveryAddress ? `<div>Adresse de livraison : ${esc(d.deliveryAddress)}</div>` : ''}
    </div>

    <table>
      <thead><tr><th>Désignation</th><th class="num">Qté</th><th>Unité</th><th class="num">PU ${mode}</th>${d.franchise ? '' : '<th class="num">TVA</th>'}<th class="num">Total ${mode}</th></tr></thead>
      <tbody>${d.lines.map((l) => `<tr>
        <td>${esc(l.designation)}${l.description ? `<div class="p-desc">${esc(l.description)}</div>` : ''}${num(l.discount) ? `<div class="p-desc">Remise ${fmtNum(l.discount)} %</div>` : ''}</td>
        <td class="num">${fmtNum(l.qty)}</td><td>${esc(l.unit)}</td>
        <td class="num">${money(l.price)}</td>${d.franchise ? '' : `<td class="num">${fmtRate(num(l.vatRate))}</td>`}
        <td class="num">${money(lineTotal(l))}</td></tr>`).join('')}</tbody>
    </table>

    <div class="p-totals">
      <div class="p-vat">${d.franchise ? '' : `<table><thead><tr><th>Taux TVA</th><th class="num">Base HT</th><th class="num">Montant TVA</th></tr></thead>
        <tbody>${t.vat.map((v) => `<tr><td>${fmtRate(v.rate)}</td><td class="num">${money(v.base)}</td><td class="num">${money(v.tva)}</td></tr>`).join('')}</tbody></table>`}</div>
      <div class="totals">
        ${d.franchise ? '' : `<div><span>Total HT</span><span>${money(t.ht)}</span></div><div><span>Total TVA</span><span>${money(t.tva)}</span></div>`}
        <div class="grand"><span>${d.franchise ? 'Net à payer' : d.kind === 'credit' ? 'Total avoir TTC' : 'Total TTC'}</span><span>${money(t.ttc)}</span></div>
        ${paid > 0 ? `<div><span>Déjà réglé</span><span>− ${money(paid)}</span></div><div><span><b>Reste à payer</b></span><span><b>${money(Math.max(0, remaining(d)))}</b></span></div>` : ''}
      </div>
    </div>

    ${d.notes ? `<div class="p-notes">${esc(d.notes)}</div>` : ''}

    ${d.kind === 'invoice' ? `<div class="p-pay">
      ${S.paymentMethods ? `<div>Moyens de paiement acceptés : ${esc(S.paymentMethods)}</div>` : ''}
      ${S.iban ? `<div>IBAN : <b>${esc(S.iban)}</b>${S.bic ? ' · BIC : ' + esc(S.bic) : ''}</div>` : ''}
    </div>` : ''}

    ${isQuote ? `<div class="p-sign"><div>Bon pour accord<br>Date, signature et cachet :</div></div>` : ''}

    ${mentions.length ? `<div class="p-mentions">${mentions.map((m) => `<p>${m}</p>`).join('')}</div>` : ''}
    <div class="p-foot">${legal}${S.footerNote ? '<br>' + esc(S.footerNote) : ''}</div>
  </div>`;
}

function printDoc(d) {
  const old = document.title;
  const c = docClient(d);
  document.title = `${KIND_LABEL[d.kind]} ${d.number || 'brouillon'} - ${c.name}`.replace(/[\\/:*?"<>|]/g, '-');
  window.print();
  setTimeout(() => { document.title = old; }, 500);
}

function emailDoc(d) {
  const c = docClient(d);
  const S = DB.settings;
  const t = docTotals(d);
  const label = KIND_LABEL[d.kind].toLowerCase();
  const subject = `${KIND_LABEL[d.kind]} ${d.number || ''} - ${S.name}`.trim();
  const body = `Bonjour${c.contact ? ' ' + c.contact : ''},\n\nVeuillez trouver ci-joint ${d.kind === 'invoice' ? 'notre facture' : d.kind === 'quote' ? 'notre devis' : 'notre avoir'} n° ${d.number || ''} d'un montant de ${money(t.ttc)}${d.kind === 'invoice' && d.dueDate && d.dueDate !== d.date ? `, à régler avant le ${fmtDate(d.dueDate)}` : ''}.\n\n${d.kind === 'quote' ? "N'hésitez pas à revenir vers nous pour toute question.\n\n" : ''}Cordialement,\n${S.name}${S.phone ? '\n' + S.phone : ''}`;
  openModal(`Envoyer le ${label} par e-mail`, `
    <div class="alert-box info"><b>Étape 1 :</b> cliquez sur « Télécharger le PDF » (il arrive dans votre dossier Téléchargements).<br>
    <b>Étape 2 :</b> cliquez sur « Ouvrir ma messagerie » puis <b>joignez le PDF</b> au message.</div>
    <label>Destinataire <input id="m-to" value="${esc(c.email || '')}" placeholder="adresse e-mail du client"></label>
    <label style="margin-top:10px">Objet <input id="m-subject" value="${esc(subject)}"></label>
    <label style="margin-top:10px">Message <textarea id="m-body" rows="8">${esc(body)}</textarea></label>
    <div class="modal-foot">
      <button class="btn" id="m-pdf">⎙ Télécharger le PDF</button>
      <button class="btn" id="m-copy">Copier le message</button>
      <button class="btn primary" id="m-open">✉ Ouvrir ma messagerie</button>
    </div>`, (root) => {
    $('#m-pdf', root).onclick = () => (pdfReady() ? downloadPdf(d) : printDoc(d));
    $('#m-copy', root).onclick = () => copyText($('#m-body', root).value);
    $('#m-open', root).onclick = () => {
      const href = `mailto:${$('#m-to', root).value.trim()}?subject=${encodeURIComponent($('#m-subject', root).value)}&body=${encodeURIComponent($('#m-body', root).value)}`;
      window.location.href = href;
      if (d.kind === 'quote' && d.status === 'draft') { d.status = 'sent'; save(); }
      closeModal();
      if (d.kind === 'quote') renderView(d.id);
    };
  });
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast('Texte copié'), () => fallbackCopy(text));
  } else fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Texte copié'); } catch (e) { toast('Copie impossible', 'error'); }
  ta.remove();
}

function quoteToInvoice(q) {
  if (q.invoiceId && docById(q.invoiceId)) { go('#/doc/' + q.invoiceId); return; }
  const inv = newDoc('invoice');
  Object.assign(inv, {
    clientId: q.clientId, subject: q.subject, operation: q.operation, deliveryAddress: q.deliveryAddress,
    notes: q.notes, priceMode: q.priceMode, franchise: q.franchise, lines: clone(q.lines), sourceId: q.id,
  });
  inv.clientSnapshot = snapshotClient(clientById(q.clientId)) || q.clientSnapshot;
  DB.documents.push(inv);
  q.status = 'invoiced';
  q.invoiceId = inv.id;
  save();
  toast('Facture brouillon créée à partir du devis');
  go('#/modifier/' + inv.id);
}

function createCredit(inv) {
  const c = newDoc('credit');
  Object.assign(c, {
    clientId: inv.clientId, clientSnapshot: inv.clientSnapshot, subject: inv.subject, operation: inv.operation,
    priceMode: inv.priceMode, franchise: inv.franchise, lines: clone(inv.lines), invoiceRef: inv.id, dueDate: today(),
  });
  draft = c;
  go('#/brouillon');
}

function openPaymentModal(d) {
  const rem = remaining(d);
  openModal('Enregistrer un paiement', `
    <div class="grid3">
      <label>Date <input id="p-date" type="date" value="${today()}"></label>
      <label>Montant (€) <input id="p-amount" type="number" step="0.01" value="${rem}"></label>
      <label>Mode <select id="p-method">${PAYMENT_METHODS.map((m) => `<option>${m}</option>`).join('')}</select></label>
    </div>
    <p class="muted small">Reste dû : ${money(rem)}</p>
    <div class="modal-foot"><button class="btn" data-close>Annuler</button><button class="btn success" id="p-ok">Enregistrer</button></div>`, (root) => {
    $('#p-ok', root).onclick = () => {
      const amount = r2(num($('#p-amount', root).value));
      if (amount <= 0) { toast('Montant invalide', 'error'); return; }
      if (amount > rem + 0.004 && !confirm(`Le montant dépasse le reste dû (${money(rem)}). Continuer ?`)) return;
      d.payments = d.payments || [];
      d.payments.push({ id: uid(), date: $('#p-date', root).value || today(), amount, method: $('#p-method', root).value });
      save();
      closeModal();
      toast('Paiement enregistré');
      renderView(d.id);
      renderTicker();
    };
  });
}

function reminderText(d, level) {
  const c = docClient(d);
  const S = DB.settings;
  const rem = money(remaining(d));
  const hello = `Bonjour${c.contact ? ' ' + c.contact : ''},`;
  const sign = `\n\nCordialement,\n${S.name}${S.phone ? '\n' + S.phone : ''}`;
  const ref = `la facture n° ${d.number} du ${fmtDate(d.date)}`;
  const pay = S.iban ? `\n\nPour rappel, vous pouvez régler par virement : IBAN ${S.iban}.` : '';
  if (level === 1) return `${hello}\n\nSauf erreur de notre part, ${ref} d'un montant de ${rem} arrivait à échéance le ${fmtDate(d.dueDate)} et n'a pas encore été réglée.\n\nIl s'agit peut-être d'un simple oubli : pourriez-vous procéder au règlement dans les meilleurs délais ?${pay}\n\nSi le paiement a déjà été effectué, merci de ne pas tenir compte de ce message.${sign}`;
  if (level === 2) return `${hello}\n\nMalgré notre précédent rappel, ${ref} d'un montant de ${rem}, échue le ${fmtDate(d.dueDate)}, reste impayée à ce jour.\n\nNous vous remercions de bien vouloir procéder à son règlement sous 8 jours.${pay}${sign}`;
  return `${hello}\n\nNous constatons que ${ref} d'un montant de ${rem}, échue le ${fmtDate(d.dueDate)}, demeure impayée malgré nos relances.\n\nSans règlement de votre part sous 8 jours, nous serons contraints d'appliquer les pénalités de retard prévues${c.type === 'pro' ? " ainsi que l'indemnité forfaitaire de 40 € pour frais de recouvrement" : ''}, et d'engager une procédure de recouvrement.${pay}${sign}`;
}

function openReminderModal(d) {
  const c = docClient(d);
  const late = d.dueDate && d.dueDate < today() ? daysBetween(d.dueDate, today()) : 0;
  const prev = (d.reminders || []).length;
  let level = prev >= 2 || late > 30 ? 3 : prev >= 1 || late > 15 ? 2 : 1;
  const names = { 1: 'Rappel aimable', 2: 'Relance ferme', 3: 'Dernière relance avant poursuites' };
  openModal('Relancer le client', `
    <p class="small muted">${late ? `${late} jour(s) de retard` : 'Pas encore en retard'} · ${prev} relance(s) déjà envoyée(s)</p>
    <div class="tabs" id="r-levels">${[1, 2, 3].map((l) => `<button class="tab ${l === level ? 'active' : ''}" data-l="${l}">${names[l]}</button>`).join('')}</div>
    <label style="margin-top:10px">Destinataire <input id="r-to" value="${esc(c.email || '')}"></label>
    <label style="margin-top:10px">Message <textarea id="r-body" rows="12">${esc(reminderText(d, level))}</textarea></label>
    <div class="modal-foot"><button class="btn" id="r-copy">Copier le texte</button><button class="btn primary" id="r-open">✉ Ouvrir ma messagerie</button></div>`, (root) => {
    $('#r-levels', root).onclick = (e) => {
      const b = e.target.closest('[data-l]'); if (!b) return;
      level = Number(b.dataset.l);
      $$('#r-levels .tab', root).forEach((x) => x.classList.toggle('active', x === b));
      $('#r-body', root).value = reminderText(d, level);
    };
    const record = () => { d.reminders = d.reminders || []; d.reminders.push({ date: today(), level }); save(); };
    $('#r-copy', root).onclick = () => { copyText($('#r-body', root).value); record(); };
    $('#r-open', root).onclick = () => {
      const subject = `${level === 3 ? 'Dernière relance' : 'Relance'} - Facture ${d.number}`;
      window.location.href = `mailto:${$('#r-to', root).value.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent($('#r-body', root).value)}`;
      record();
      closeModal();
      renderView(d.id);
    };
  });
}

/* =====================================================================
   Clients
   ===================================================================== */
let clientSearch = '';

function renderClients() {
  const q = clientSearch.trim().toLowerCase();
  const list = DB.clients.slice().sort((a, b) => a.name.localeCompare(b.name))
    .filter((c) => !q || `${c.name} ${c.contact || ''} ${c.city || ''} ${c.email || ''}`.toLowerCase().includes(q));
  const ca = {}, due = {};
  for (const d of DB.documents) {
    if (d.kind === 'quote' || d.status !== 'issued') continue;
    ca[d.clientId] = (ca[d.clientId] || 0) + (d.kind === 'credit' ? -1 : 1) * docTotals(d).ht;
    if (d.kind === 'invoice') due[d.clientId] = (due[d.clientId] || 0) + Math.max(0, remaining(d));
  }
  $('#main').innerHTML = `
    <div class="page-head"><h1>Clients</h1><div class="actions"><button class="btn primary" data-act="add">+ Nouveau client</button></div></div>
    <div class="card">
      <div class="toolbar"><span class="muted small">${DB.clients.length} client(s)</span><input id="search" type="search" placeholder="Rechercher…" value="${esc(clientSearch)}"></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nom</th><th>Type</th><th>Ville</th><th>Contact</th><th class="num">CA total HT</th><th class="num">Reste dû</th><th></th></tr></thead>
        <tbody>${list.length ? list.map((c) => `<tr class="clickable" data-act="edit" data-id="${c.id}">
          <td class="strong">${esc(c.name)}</td>
          <td>${c.type === 'pro' ? '<span class="badge b-sent">Professionnel</span>' : '<span class="badge b-draft">Particulier</span>'}</td>
          <td>${esc(c.city || '')}</td>
          <td class="muted">${esc([c.email, c.phone].filter(Boolean).join(' · '))}</td>
          <td class="num">${money(ca[c.id] || 0)}</td>
          <td class="num ${(due[c.id] || 0) > 0 ? 'down' : ''}">${(due[c.id] || 0) > 0 ? money(due[c.id]) : '—'}</td>
          <td class="nowrap right"><a class="btn small" href="#/nouveau/invoice/${c.id}" data-stop>+ Facture</a> <a class="btn small" href="#/nouveau/quote/${c.id}" data-stop>+ Devis</a></td>
        </tr>`).join('') : `<tr><td colspan="7" class="empty">${q ? 'Aucun résultat.' : 'Aucun client pour le moment.'}</td></tr>`}</tbody>
      </table></div>
    </div>`;
  actions = {
    add: () => openClientModal(null, () => renderClients()),
    edit: (el, e) => { if (e.target.closest('[data-stop]')) { location.hash = e.target.closest('a').getAttribute('href'); return; } openClientModal(clientById(el.dataset.id), () => renderClients()); },
  };
  const s = $('#search');
  s.addEventListener('input', () => { clientSearch = s.value; const p = s.selectionStart; renderClients(); const n = $('#search'); n.focus(); n.setSelectionRange(p, p); });
}

function openClientModal(client, onSaved) {
  const c = client || { type: 'pro' };
  const used = client && DB.documents.some((d) => d.clientId === client.id);
  openModal(client ? 'Modifier le client' : 'Nouveau client', `
    <div class="grid2">
      <label>Type de client
        <select id="c-type"><option value="pro" ${c.type === 'pro' ? 'selected' : ''}>Professionnel (entreprise, association…)</option><option value="particulier" ${c.type === 'particulier' ? 'selected' : ''}>Particulier</option></select>
      </label>
      <label><span id="c-name-label">Raison sociale</span> * <input id="c-name" value="${esc(c.name)}"></label>
      <label>Nom du contact <input id="c-contact" value="${esc(c.contact)}" placeholder="ex : M. Martin"></label>
      <label>E-mail <input id="c-email" type="email" value="${esc(c.email)}"></label>
      <label class="span2">Adresse <input id="c-address" value="${esc(c.address)}"></label>
      <label>Code postal <input id="c-zip" value="${esc(c.zip)}"></label>
      <label>Ville <input id="c-city" value="${esc(c.city)}"></label>
      <label>Téléphone <input id="c-phone" value="${esc(c.phone)}"></label>
      <label class="pro-only">SIREN <input id="c-siren" value="${esc(c.siren)}" placeholder="9 chiffres">
        <div class="hint">Obligatoire sur les factures entre professionnels avec la réforme de la facture électronique.</div></label>
      <label class="pro-only">N° TVA intracommunautaire <input id="c-tva" value="${esc(c.tvaIntra)}"></label>
      <label class="span2">Notes internes <textarea id="c-notes" rows="2">${esc(c.notes)}</textarea></label>
    </div>
    <div class="modal-foot">
      ${client && !used ? '<button class="btn danger" id="c-del" style="margin-right:auto">Supprimer</button>' : ''}
      <button class="btn" data-close>Annuler</button><button class="btn primary" id="c-ok">Enregistrer</button>
    </div>`, (root) => {
    const toggle = () => {
      const pro = $('#c-type', root).value === 'pro';
      $$('.pro-only', root).forEach((el) => { el.style.display = pro ? '' : 'none'; });
      $('#c-name-label', root).textContent = pro ? 'Raison sociale' : 'Nom et prénom';
    };
    $('#c-type', root).onchange = toggle;
    toggle();
    $('#c-ok', root).onclick = () => {
      const name = $('#c-name', root).value.trim();
      if (!name) { toast('Le nom est obligatoire.', 'error'); return; }
      const siren = $('#c-siren', root).value.replace(/\s/g, '');
      if ($('#c-type', root).value === 'pro' && siren && !/^\d{9}$/.test(siren)) { toast('Le SIREN doit comporter 9 chiffres.', 'error'); return; }
      const data = {
        type: $('#c-type', root).value, name, contact: $('#c-contact', root).value.trim(), email: $('#c-email', root).value.trim(),
        address: $('#c-address', root).value.trim(), zip: $('#c-zip', root).value.trim(), city: $('#c-city', root).value.trim(),
        phone: $('#c-phone', root).value.trim(), siren, tvaIntra: $('#c-tva', root).value.trim(), notes: $('#c-notes', root).value,
      };
      let saved;
      if (client) { Object.assign(client, data); saved = client; } else { saved = { id: uid(), ...data }; DB.clients.push(saved); }
      save();
      closeModal();
      toast('Client enregistré');
      onSaved && onSaved(saved);
    };
    const del = $('#c-del', root);
    if (del) del.onclick = () => {
      if (!confirm(`Supprimer le client « ${client.name} » ?`)) return;
      DB.clients = DB.clients.filter((x) => x.id !== client.id);
      save(); closeModal(); toast('Client supprimé'); onSaved && onSaved(null);
    };
  });
}

/* =====================================================================
   Catalogue
   ===================================================================== */
let productSearch = '';

function renderCatalogue() {
  const q = productSearch.trim().toLowerCase();
  const list = DB.products.slice().sort((a, b) => a.name.localeCompare(b.name)).filter((p) => !q || p.name.toLowerCase().includes(q));
  $('#main').innerHTML = `
    <div class="page-head"><h1>Catalogue</h1><div class="actions"><button class="btn primary" data-act="add">+ Nouvel article</button></div></div>
    <div class="alert-box info">Taux de TVA courants (à confirmer avec votre comptable) : <b>viande, boucherie, charcuterie, jus de fruits</b> 5,5 % · <b>fleurs coupées, plantes</b> 10 % · <b>cidre, pommeau, calvados et autres boissons alcoolisées</b> 20 % · <b>prestations de décoration, livraison facturée à part</b> 20 %.</div>
    <div class="card">
      <div class="toolbar"><span class="muted small">${DB.products.length} article(s)</span><input id="search" type="search" placeholder="Rechercher…" value="${esc(productSearch)}"></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Article</th><th>Unité</th><th class="num">Prix HT</th><th class="num">TVA</th><th class="num">Prix TTC</th></tr></thead>
        <tbody>${list.length ? list.map((p) => `<tr class="clickable" data-act="edit" data-id="${p.id}">
          <td><span class="strong">${esc(p.name)}</span>${p.description ? `<div class="muted small">${esc(p.description)}</div>` : ''}</td>
          <td>${esc(p.unit)}</td>
          <td class="num">${money(productPriceFor(p, 'HT'))}</td>
          <td class="num">${fmtRate(num(p.vatRate))}</td>
          <td class="num strong">${money(productPriceFor(p, 'TTC'))}</td>
        </tr>`).join('') : `<tr><td colspan="5" class="empty">${q ? 'Aucun résultat.' : 'Ajoutez vos produits et prestations pour les retrouver en un clic dans vos devis et factures.'}</td></tr>`}</tbody>
      </table></div>
    </div>`;
  actions = {
    add: () => openProductModal(null),
    edit: (el) => openProductModal(DB.products.find((p) => p.id === el.dataset.id)),
  };
  const s = $('#search');
  s.addEventListener('input', () => { productSearch = s.value; const p = s.selectionStart; renderCatalogue(); const n = $('#search'); n.focus(); n.setSelectionRange(p, p); });
}

function openProductModal(product) {
  const p = product || { unit: 'unité', vatRate: DB.settings.defaultVat, priceMode: DB.settings.priceMode, price: '' };
  openModal(product ? "Modifier l'article" : 'Nouvel article', `
    <div class="grid2">
      <label class="span2">Nom de l'article * <input id="pr-name" value="${esc(p.name)}" placeholder="ex : Cidre brut fermier 75 cl"></label>
      <label class="span2">Description (optionnelle) <input id="pr-desc" value="${esc(p.description)}"></label>
      <label>Unité <input id="pr-unit" list="pr-units" value="${esc(p.unit)}"><datalist id="pr-units">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist></label>
      <label>Taux de TVA <select id="pr-vat">${VAT_RATES.map((r) => `<option value="${r}" ${num(p.vatRate) === r ? 'selected' : ''}>${fmtRate(r)}</option>`).join('')}</select></label>
      <label>Prix <input id="pr-price" type="number" step="0.01" value="${p.price}"></label>
      <label>Ce prix est <select id="pr-mode"><option value="TTC" ${p.priceMode === 'TTC' ? 'selected' : ''}>TTC (prix affiché en boutique)</option><option value="HT" ${p.priceMode === 'HT' ? 'selected' : ''}>HT</option></select></label>
      <div class="span2 muted small" id="pr-conv"></div>
    </div>
    <div class="modal-foot">
      ${product ? '<button class="btn danger" id="pr-del" style="margin-right:auto">Supprimer</button>' : ''}
      <button class="btn" data-close>Annuler</button><button class="btn primary" id="pr-ok">Enregistrer</button>
    </div>`, (root) => {
    const read = () => ({ name: $('#pr-name', root).value.trim(), description: $('#pr-desc', root).value.trim(), unit: $('#pr-unit', root).value.trim() || 'unité', vatRate: num($('#pr-vat', root).value), price: num($('#pr-price', root).value), priceMode: $('#pr-mode', root).value });
    const conv = () => { const x = read(); $('#pr-conv', root).textContent = `Soit ${money(productPriceFor(x, 'HT'))} HT · ${money(productPriceFor(x, 'TTC'))} TTC`; };
    ['#pr-price', '#pr-vat', '#pr-mode'].forEach((s) => $(s, root).addEventListener('input', conv));
    conv();
    $('#pr-ok', root).onclick = () => {
      const data = read();
      if (!data.name) { toast('Le nom est obligatoire.', 'error'); return; }
      if (product) Object.assign(product, data); else DB.products.push({ id: uid(), ...data });
      save(); closeModal(); toast('Article enregistré'); renderCatalogue();
    };
    const del = $('#pr-del', root);
    if (del) del.onclick = () => {
      if (!confirm(`Supprimer « ${product.name} » du catalogue ?`)) return;
      DB.products = DB.products.filter((x) => x.id !== product.id);
      save(); closeModal(); renderCatalogue();
    };
  });
}

/* =====================================================================
   Paramètres de l'entreprise
   ===================================================================== */
function renderSettings() {
  const s = DB.settings;
  const f = (id, label, opts = {}) => `<label class="${opts.cls || ''}">${label}<input id="s-${id}" value="${esc(s[id])}" ${opts.type ? `type="${opts.type}"` : ''} placeholder="${esc(opts.ph || '')}">${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}</label>`;
  $('#main').innerHTML = `
    <div class="page-head"><h1>Mon entreprise</h1><div class="actions"><button class="btn primary" data-act="save">Enregistrer</button></div></div>

    <div class="card"><h2>Identité</h2>
      <div class="grid3">
        ${f('name', "Nom de l'entreprise *", { cls: 'span2', ph: 'ex : Cidrerie du Verger' })}
        ${f('legalForm', 'Forme juridique', { ph: 'EI, EURL, SARL, SAS, EARL…' })}
        ${f('address', 'Adresse *', { cls: 'span2' })}
        ${f('capital', 'Capital social (€)', { ph: 'si société' })}
        ${f('zip', 'Code postal')}
        ${f('city', 'Ville')}
        ${f('phone', 'Téléphone')}
        ${f('siret', 'SIRET *', { ph: '14 chiffres' })}
        ${f('registre', 'Immatriculation', { ph: 'ex : RCS Caen ou RM 14', hint: 'RCS pour les commerçants, RM pour les artisans.' })}
        ${f('tvaIntra', 'N° TVA intracommunautaire', { ph: 'FR…' })}
        ${f('email', 'E-mail', { type: 'email' })}
        ${f('website', 'Site web')}
      </div>
    </div>

    <div class="card"><h2>Logo</h2>
      <input id="s-logo" type="file" accept="image/*">
      ${s.logo ? `<img class="logo-preview" src="${s.logo}" alt="Logo"><button class="btn small danger" data-act="del-logo" style="margin-top:8px">Retirer le logo</button>` : '<div class="hint">PNG ou JPG. Il apparaîtra en haut de vos devis et factures.</div>'}
    </div>

    <div class="card"><h2>TVA et prix</h2>
      <div class="grid3">
        <label>Régime de TVA
          <select id="s-vatRegime">
            <option value="normal" ${s.vatRegime === 'normal' ? 'selected' : ''}>Assujetti à la TVA</option>
            <option value="franchise" ${s.vatRegime === 'franchise' ? 'selected' : ''}>Franchise en base (micro-entreprise, pas de TVA)</option>
          </select>
        </label>
        <label>Saisie des prix dans les factures
          <select id="s-priceMode">
            <option value="TTC" ${s.priceMode === 'TTC' ? 'selected' : ''}>TTC (conseillé pour les commerces)</option>
            <option value="HT" ${s.priceMode === 'HT' ? 'selected' : ''}>HT</option>
          </select>
        </label>
        <label>Taux de TVA par défaut
          <select id="s-defaultVat">${VAT_RATES.map((r) => `<option value="${r}" ${num(s.defaultVat) === r ? 'selected' : ''}>${fmtRate(r)}</option>`).join('')}</select>
        </label>
        <label class="check span-all"><input id="s-vatOnDebits" type="checkbox" ${s.vatOnDebits ? 'checked' : ''}> J'ai opté pour le paiement de la TVA d'après les débits (prestations de services) — la mention sera ajoutée</label>
      </div>
    </div>

    <div class="card"><h2>Paiement et conditions</h2>
      <div class="grid3">
        <label>Délai de paiement (jours) <input id="s-paymentDays" type="number" min="0" value="${esc(s.paymentDays)}"><div class="hint">0 = paiement à réception. Maximum légal : 60 jours.</div></label>
        <label>Validité des devis (jours) <input id="s-quoteValidityDays" type="number" min="1" value="${esc(s.quoteValidityDays)}"></label>
        ${f('paymentMethods', 'Moyens de paiement acceptés')}
        ${f('iban', 'IBAN', { cls: 'span2' })}
        ${f('bic', 'BIC')}
        <label class="span-all">Pénalités de retard (mention obligatoire) <input id="s-latePenalty" value="${esc(s.latePenalty)}"></label>
        ${f('footerNote', 'Texte libre en bas de page', { cls: 'span-all', ph: 'ex : Membre d\'une association agréée, règlement par chèque accepté' })}
      </div>
    </div>

    <div class="card"><h2>Numérotation</h2>
      <div class="grid3">
        ${f('invoicePrefix', 'Préfixe factures', { hint: 'ex : F → F-2026-0001' })}
        ${f('quotePrefix', 'Préfixe devis')}
        ${f('creditPrefix', 'Préfixe avoirs')}
      </div>
      <p class="hint">La numérotation est continue et chronologique, sans trou, comme l'exige la loi. Elle repart à 1 chaque année.</p>
    </div>

    <div class="card"><h2>Démonstration</h2>
      <p class="muted small">Pour présenter le logiciel à un client, chargez un exemple complet (cidrerie fictive). Cela remplace toutes les données actuelles.</p>
      <button class="btn" data-act="demo">Charger l'exemple de démonstration</button>
      <button class="btn danger" data-act="reset">Tout effacer</button>
    </div>`;

  $('#s-logo').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    resizeImage(file, 400, 180).then((dataUrl) => {
      saveSettingsForm();
      DB.settings.logo = dataUrl;
      save(); toast('Logo enregistré'); renderSettings();
    }).catch(() => toast("Impossible de lire cette image.", 'error'));
  });

  actions = {
    save: () => { saveSettingsForm(); save(); toast('Paramètres enregistrés'); renderTicker(); },
    'del-logo': () => { saveSettingsForm(); DB.settings.logo = ''; save(); renderSettings(); },
    demo: () => loadDemo(),
    reset: () => {
      if (!confirm('Effacer TOUTES les données (clients, factures, paramètres) ?\n\nFaites une sauvegarde avant si besoin.')) return;
      if (!confirm('Vraiment tout effacer ? Cette action est irréversible.')) return;
      DB = defaultData(); save(); toast('Données effacées'); go('#/tableau');
    },
  };
}

function saveSettingsForm() {
  const s = DB.settings;
  const text = ['name', 'legalForm', 'capital', 'address', 'zip', 'city', 'siret', 'registre', 'tvaIntra', 'email', 'phone', 'website', 'iban', 'bic', 'paymentMethods', 'latePenalty', 'footerNote', 'invoicePrefix', 'quotePrefix', 'creditPrefix'];
  for (const k of text) { const el = $('#s-' + k); if (el) s[k] = el.value.trim(); }
  s.siret = s.siret.replace(/\s/g, '');
  s.invoicePrefix = s.invoicePrefix || 'F'; s.quotePrefix = s.quotePrefix || 'D'; s.creditPrefix = s.creditPrefix || 'A';
  s.vatRegime = $('#s-vatRegime').value;
  s.priceMode = $('#s-priceMode').value;
  s.defaultVat = num($('#s-defaultVat').value);
  s.vatOnDebits = $('#s-vatOnDebits').checked;
  s.paymentDays = Math.max(0, Math.round(num($('#s-paymentDays').value)));
  s.quoteValidityDays = Math.max(1, Math.round(num($('#s-quoteValidityDays').value)) || 30);
}

function resizeImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const k = Math.min(1, maxW / img.width, maxH / img.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* =====================================================================
   Sauvegarde & exports
   ===================================================================== */
function renderBackup() {
  const years = Array.from(new Set(DB.documents.filter((d) => d.date).map((d) => d.date.slice(0, 4)))).sort().reverse();
  if (!years.includes(today().slice(0, 4))) years.unshift(today().slice(0, 4));
  $('#main').innerHTML = `
    <div class="page-head"><h1>Sauvegarde & export</h1></div>

    <div class="card"><h2>💾 Sauvegarder mes données</h2>
      <p class="muted small">Vos données sont enregistrées <b>dans ce navigateur, sur cet ordinateur</b>. Si l'ordinateur tombe en panne ou si l'historique du navigateur est effacé, elles peuvent être perdues. Téléchargez une sauvegarde chaque semaine et copiez-la sur une clé USB ou un disque externe.<br>
      Les factures doivent être conservées <b>10 ans</b>.</p>
      <p class="small">Dernière sauvegarde : <b>${DB.lastBackup ? fmtDate(DB.lastBackup.slice(0, 10)) : 'jamais'}</b></p>
      <button class="btn primary" data-act="backup">Télécharger une sauvegarde</button>
    </div>

    <div class="card"><h2>♻ Restaurer une sauvegarde</h2>
      <p class="muted small">Pour récupérer vos données ou les transférer sur un autre ordinateur. Les données actuelles seront remplacées.</p>
      <input id="restore-file" type="file" accept=".json,application/json">
    </div>

    <div class="card"><h2>📤 Export pour le comptable</h2>
      <div class="grid3">
        <label>Année <select id="exp-year">${years.map((y) => `<option>${y}</option>`).join('')}</select></label>
        <label>Mois <select id="exp-month"><option value="">Toute l'année</option>${MONTHS.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}">${m}</option>`).join('')}</select></label>
      </div>
      <div class="actions" style="margin-top:12px">
        <button class="btn" data-act="exp-sales">Journal des ventes (CSV)</button>
        <button class="btn" data-act="exp-pay">Encaissements (CSV)</button>
        <button class="btn" data-act="exp-clients">Liste des clients (CSV)</button>
      </div>
      <p class="hint">Les fichiers CSV s'ouvrent dans Excel ou LibreOffice. Les avoirs apparaissent en négatif.</p>
    </div>`;

  $('#restore-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !data.settings || !Array.isArray(data.documents)) throw new Error('format');
        if (!confirm(`Restaurer cette sauvegarde ?\n\n${(data.documents || []).length} document(s), ${(data.clients || []).length} client(s).\nLes données actuelles seront remplacées.`)) return;
        DB = migrate(data);
        save();
        toast('Sauvegarde restaurée');
        go('#/tableau');
      } catch (err) {
        toast("Ce fichier n'est pas une sauvegarde valide.", 'error');
      }
    };
    reader.readAsText(file);
  });

  const period = () => $('#exp-year').value + ($('#exp-month').value ? '-' + $('#exp-month').value : '');
  actions = {
    backup: () => { exportBackup(); renderBackup(); },
    'exp-sales': () => exportSales(period()),
    'exp-pay': () => exportPayments(period()),
    'exp-clients': () => exportClients(),
  };
}

function exportBackup() {
  DB.lastBackup = new Date().toISOString();
  save();
  download(`${APP.name.toLowerCase()}-sauvegarde-${today()}.json`, JSON.stringify(DB, null, 1), 'application/json');
  toast('Sauvegarde téléchargée. Copiez-la sur une clé USB !');
  renderBanner();
}

const csvNum = (x) => r2(x).toFixed(2).replace('.', ',');
const csvCell = (v) => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCSV(rows) { return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n'); }

function exportSales(period) {
  const docs = sortDocs(DB.documents.filter((d) => d.kind !== 'quote' && d.status === 'issued' && d.date.startsWith(period))).reverse();
  const rates = [20, 10, 5.5, 2.1, 0];
  const rows = [['Date', 'Type', 'Numéro', 'Client', 'SIREN client', ...rates.flatMap((r) => [`Base HT ${fmtRate(r)}`, `TVA ${fmtRate(r)}`]), 'Total HT', 'Total TVA', 'Total TTC', 'Payé', 'Reste dû', 'Statut']];
  for (const d of docs) {
    const t = docTotals(d);
    const sign = d.kind === 'credit' ? -1 : 1;
    const byRate = Object.fromEntries(t.vat.map((v) => [v.rate, v]));
    const c = docClient(d);
    rows.push([
      fmtDate(d.date), KIND_LABEL[d.kind], d.number, c.name, c.siren || '',
      ...rates.flatMap((r) => [csvNum(sign * (byRate[r]?.base || 0)), csvNum(sign * (byRate[r]?.tva || 0))]),
      csvNum(sign * t.ht), csvNum(sign * t.tva), csvNum(sign * t.ttc),
      d.kind === 'invoice' ? csvNum(paidAmount(d)) : '', d.kind === 'invoice' ? csvNum(Math.max(0, remaining(d))) : '', statusInfo(d).label,
    ]);
  }
  if (rows.length === 1) { toast('Aucune facture sur cette période.', 'error'); return; }
  download(`journal-ventes-${period}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
}

function exportPayments(period) {
  const rows = [['Date', 'Facture', 'Client', 'Montant', 'Mode']];
  const list = [];
  for (const d of DB.documents) {
    if (d.kind !== 'invoice') continue;
    for (const p of d.payments || []) if ((p.date || '').startsWith(period)) list.push([p.date, d, p]);
  }
  list.sort((a, b) => a[0].localeCompare(b[0]));
  for (const [, d, p] of list) rows.push([fmtDate(p.date), d.number, docClient(d).name, csvNum(p.amount), p.method]);
  if (rows.length === 1) { toast('Aucun encaissement sur cette période.', 'error'); return; }
  download(`encaissements-${period}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
}

function exportClients() {
  const rows = [['Nom', 'Type', 'Contact', 'Adresse', 'Code postal', 'Ville', 'E-mail', 'Téléphone', 'SIREN', 'TVA intracom.']];
  for (const c of DB.clients) rows.push([c.name, c.type === 'pro' ? 'Professionnel' : 'Particulier', c.contact, c.address, c.zip, c.city, c.email, c.phone, c.siren, c.tvaIntra]);
  download(`clients-${today()}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
}

/* =====================================================================
   Données de démonstration
   ===================================================================== */
function loadDemo() {
  if ((DB.documents.length || DB.clients.length) && !confirm("Charger l'exemple remplacera toutes les données actuelles. Continuer ?")) return;
  DB = defaultData();
  Object.assign(DB.settings, {
    name: 'Cidrerie du Verger', legalForm: 'EARL', capital: '7 500', address: '12 chemin des Pommiers', zip: '14340', city: 'Cambremer',
    siret: '12345678900012', registre: 'RCS Lisieux 123 456 789', tvaIntra: 'FR12123456789', email: 'contact@cidrerie-du-verger.fr',
    phone: '02 31 00 00 00', iban: 'FR76 1234 5678 9012 3456 7890 123', bic: 'AGRIFRPP', priceMode: 'HT', paymentDays: 30,
  });
  const P = (name, unit, price, vatRate, description = '') => ({ id: uid(), name, unit, price, vatRate, priceMode: 'HT', description });
  DB.products = [
    P('Cidre brut fermier 75 cl', 'bouteille', 3.9, 20),
    P('Cidre doux fermier 75 cl', 'bouteille', 3.9, 20),
    P('Pommeau de Normandie 70 cl', 'bouteille', 12.5, 20),
    P('Calvados Pays d\'Auge 3 ans 70 cl', 'bouteille', 24, 20),
    P('Jus de pomme artisanal 1 L', 'bouteille', 2.6, 5.5),
    P('Carton 6 bouteilles cidre brut', 'carton', 21.6, 20),
    P('Coffret découverte (cidre, pommeau, jus)', 'unité', 22.5, 20, '1 cidre brut, 1 pommeau, 1 jus de pomme'),
    P('Livraison', 'forfait', 15, 20),
  ];
  const C = (type, name, contact, address, zip, city, email, siren = '') => ({ id: uid(), type, name, contact, address, zip, city, email, phone: '', siren, tvaIntra: '', notes: '' });
  DB.clients = [
    C('pro', 'Épicerie Fine Le Panier Normand', 'Mme Leroy', '3 place du Marché', '14100', 'Lisieux', 'contact@lepaniernormand.fr', '552100554'),
    C('pro', 'Restaurant La Marmite', 'M. Bertin', '8 rue de la Paix', '14000', 'Caen', 'lamarmite@example.fr', '443061841'),
    C('pro', 'Comité d\'entreprise Méca-Norm', 'Service CSE', 'ZA du Mont', '14200', 'Hérouville', 'cse@example.fr', '784671695'),
    C('particulier', 'Mme Claire Dupont', '', '21 avenue des Tilleuls', '14000', 'Caen', 'claire.dupont@example.fr'),
  ];
  const [epicerie, resto, cse, dupont] = DB.clients;
  const line = (p, qty) => ({ designation: p.name, description: p.description, qty, unit: p.unit, price: p.price, vatRate: p.vatRate, discount: 0 });
  const pr = DB.products;
  const base = new Date();
  const ago = (days) => { const d = new Date(base); d.setDate(d.getDate() - days); return isoDate(d); };
  const mk = (kind, client, daysAgo, lines, extra = {}) => {
    const d = newDoc(kind);
    d.priceMode = 'HT';
    d.franchise = false;
    d.clientId = client.id;
    d.clientSnapshot = snapshotClient(client);
    d.date = ago(daysAgo);
    d.dueDate = kind === 'quote' ? addDays(d.date, 30) : addDays(d.date, client.type === 'pro' ? 30 : 0);
    d.lines = lines;
    Object.assign(d, extra);
    if (kind !== 'quote' && d.status === 'issued') { d.number = nextNumber(kind, d.date); d.sellerSnapshot = sellerSnapshot(); d.validatedAt = new Date().toISOString(); }
    if (kind === 'quote') d.number = nextNumber('quote', d.date);
    DB.documents.push(d);
    return d;
  };
  // Historique sur l'année, dans l'ordre chronologique
  const hist = [330, 300, 270, 240, 210, 185, 150, 120, 95, 70];
  hist.forEach((days, i) => {
    const client = [epicerie, resto, epicerie, cse, resto][i % 5];
    const inv = mk('invoice', client, days, [line(pr[5], 4 + (i % 4) * 2), line(pr[4], 12 + i * 2), line(pr[2], 3 + (i % 3))], { status: 'issued' });
    inv.payments = [{ id: uid(), date: addDays(inv.date, 20), amount: docTotals(inv).ttc, method: 'Virement' }];
  });
  const i1 = mk('invoice', cse, 45, [line(pr[6], 40), line(pr[7], 1)], { status: 'issued', subject: 'Colis de fin d\'année CSE' });
  i1.payments = [{ id: uid(), date: ago(10), amount: 400, method: 'Virement' }];
  mk('invoice', resto, 40, [line(pr[0], 36), line(pr[3], 2), line(pr[7], 1)], { status: 'issued', subject: 'Commande mensuelle' });
  const i3 = mk('invoice', dupont, 12, [line(pr[6], 2), line(pr[3], 1)], { status: 'issued', subject: 'Cadeaux' });
  i3.payments = [{ id: uid(), date: i3.date, amount: docTotals(i3).ttc, method: 'Carte bancaire' }];
  const i4 = mk('invoice', epicerie, 6, [line(pr[5], 10), line(pr[2], 6), line(pr[4], 24)], { status: 'issued', subject: 'Réassort boutique' });
  mk('quote', cse, 4, [line(pr[6], 60), line(pr[7], 1)], { status: 'sent', subject: 'Colis de Noël 2026' });
  mk('quote', resto, 2, [line(pr[0], 48), line(pr[1], 24), line(pr[3], 3)], { status: 'draft', subject: 'Carte des boissons' });
  mk('invoice', resto, 0, [line(pr[0], 12)], { status: 'draft' });
  void i4;
  save();
  toast('Exemple de démonstration chargé');
  go('#/tableau');
}

/* =====================================================================
   Démarrage
   ===================================================================== */
load();
document.title = `${APP.name} — ${APP.tagline}`;
$$('.brand-name').forEach((el) => { el.textContent = APP.name; });
window.addEventListener('hashchange', router);
window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) { load(); router(); } });
router();
