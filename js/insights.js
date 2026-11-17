/*
 * Ardoise — indicateurs : trésorerie (argent réellement disponible), plafonds,
 * score « Prêt pour 2027 », profil de paiement des clients, prévision
 * d'encaissements et marges. Uniquement des calculs locaux sur les données.
 */
'use strict';

// Taux indicatifs de cotisations sociales des micro-entrepreneurs (hors formation
// professionnelle et versement libératoire). À vérifier chaque année sur autoentrepreneur.urssaf.fr.
const SOCIAL_REGIMES = {
  none: { label: 'Pas d\'estimation', rate: 0 },
  'micro-vente': { label: 'Micro-entreprise : vente de marchandises (12,3 %)', rate: 12.3 },
  'micro-services': { label: 'Micro-entreprise : prestations commerciales ou artisanales (21,2 %)', rate: 21.2 },
  'micro-liberal': { label: 'Micro-entreprise : profession libérale (26,1 %)', rate: 26.1 },
  custom: { label: 'Autre : pourcentage libre (société, impôts…)', rate: null },
};
const setAsideRate = () => {
  const s = DB.settings;
  const r = SOCIAL_REGIMES[s.socialRegime] || SOCIAL_REGIMES.none;
  return r.rate === null ? Math.max(0, Math.min(90, num(s.setAsideRate))) : r.rate;
};

/* ---------------- Encaissements ---------------- */
// Chaque paiement est ventilé en HT / TVA au prorata de la facture.
function paymentsBetween(from, to) {
  const out = [];
  for (const d of DB.documents) {
    if (d.kind !== 'invoice' || d.status !== 'issued') continue;
    const t = docTotals(d);
    if (t.ttc <= 0) continue;
    for (const p of d.payments || []) {
      if (!p.date || p.date < from || p.date > to) continue;
      const amount = num(p.amount);
      const vat = r2(amount * (t.tva / t.ttc));
      out.push({ doc: d, date: p.date, amount, vat, ht: r2(amount - vat) });
    }
  }
  return out;
}

function monthBounds(offset = 0) {
  const n = new Date();
  const a = new Date(n.getFullYear(), n.getMonth() + offset, 1);
  const b = new Date(n.getFullYear(), n.getMonth() + offset + 1, 0);
  return [isoDate(a), isoDate(b), `${MONTHS[a.getMonth()]} ${a.getFullYear()}`];
}

function treasury(offset = 0) {
  const [from, to, label] = monthBounds(offset);
  const pays = paymentsBetween(from, to);
  const collected = r2(pays.reduce((s, p) => s + p.amount, 0));
  const vat = r2(pays.reduce((s, p) => s + p.vat, 0));
  const ht = r2(collected - vat);
  const rate = setAsideRate();
  const setAside = r2(ht * rate / 100);
  return { label, collected, vat, ht, rate, setAside, available: r2(collected - vat - setAside) };
}

function yearRevenue() {
  const y = today().slice(0, 4);
  return r2(paymentsBetween(`${y}-01-01`, `${y}-12-31`).reduce((s, p) => s + p.ht, 0));
}

function ceilings() {
  const s = DB.settings;
  const ca = yearRevenue();
  const out = [];
  if (s.vatRegime === 'franchise' && num(s.vatCeiling) > 0) out.push({ label: 'Franchise de TVA', value: ca, max: num(s.vatCeiling) });
  if (String(s.socialRegime).startsWith('micro') && num(s.caCeiling) > 0) out.push({ label: 'Plafond micro-entreprise', value: ca, max: num(s.caCeiling) });
  return out.map((c) => ({ ...c, pct: Math.round((c.value / c.max) * 100) }));
}

/* ---------------- Profils de paiement ---------------- */
function settledDate(d) {
  // date du paiement qui solde la facture
  const t = docTotals(d).ttc - creditedAmount(d);
  let sum = 0;
  for (const p of (d.payments || []).slice().sort((a, b) => a.date.localeCompare(b.date))) {
    sum += num(p.amount);
    if (sum >= t - 0.004) return p.date;
  }
  return null;
}

function paymentProfiles() {
  const now = today();
  const prof = {};
  for (const d of DB.documents) {
    if (d.kind !== 'invoice' || d.status !== 'issued') continue;
    const p = prof[d.clientId] = prof[d.clientId] || { paid: 0, daysSum: 0, lateSum: 0, lateCount: 0, open: 0, openLate: 0 };
    const due = d.dueDate || d.date;
    const settled = settledDate(d);
    if (settled) {
      p.paid++;
      p.daysSum += Math.max(0, daysBetween(d.date, settled));
      const late = daysBetween(due, settled);
      p.lateSum += Math.max(0, late);
      if (late > 0) p.lateCount++;
    } else if (remaining(d) > 0.004) {
      p.open++;
      if (due < now) { p.openLate++; p.lateCount++; }
    }
  }
  for (const p of Object.values(prof)) {
    p.avgDays = p.paid ? Math.round(p.daysSum / p.paid) : null;
    p.avgLate = p.paid ? Math.round(p.lateSum / p.paid) : 0;
    const total = p.paid + p.open;
    p.risk = total >= 2 && (p.avgLate > 15 || p.lateCount / total >= 0.4 || p.openLate >= 2);
  }
  return prof;
}

function profileText(p) {
  if (!p || (!p.paid && !p.open)) return '';
  const parts = [];
  if (p.avgDays !== null) parts.push(`paie en moyenne à ${p.avgDays} j`);
  if (p.lateCount) parts.push(`${p.lateCount} retard${p.lateCount > 1 ? 's' : ''} sur ${p.paid + p.open} facture${p.paid + p.open > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

/* ---------------- Prévision d'encaissements ---------------- */
function forecast() {
  const now = today();
  const prof = paymentProfiles();
  const buckets = [
    { label: 'En retard (probable)', to: null, amount: 0, n: 0, late: true },
    { label: 'Cette semaine', to: addDays(now, 7), amount: 0, n: 0 },
    { label: 'Semaine prochaine', to: addDays(now, 14), amount: 0, n: 0 },
    { label: 'Dans 15 à 30 jours', to: addDays(now, 30), amount: 0, n: 0 },
    { label: 'Plus tard', to: '9999-12-31', amount: 0, n: 0 },
  ];
  for (const d of DB.documents) {
    if (d.kind !== 'invoice' || d.status !== 'issued') continue;
    const rem = remaining(d);
    if (rem <= 0.004) continue;
    const p = prof[d.clientId];
    const expected = addDays(d.dueDate || d.date, p ? p.avgLate : 0);
    const b = expected < now ? buckets[0] : buckets.slice(1).find((x) => expected <= x.to);
    b.amount = r2(b.amount + rem); b.n++;
  }
  return buckets;
}

/* ---------------- Marges ---------------- */
function docMargin(d) {
  const nets = lineNetAmounts(d);
  let rev = 0, cost = 0, known = false;
  d.lines.forEach((l, i) => {
    if (num(l.cost) > 0) { known = true; rev += nets[i]; cost += num(l.qty) * num(l.cost); }
  });
  if (!known) return null;
  const margin = r2(rev - cost);
  return { margin, rate: rev ? Math.round((margin / rev) * 100) : 0, partial: d.lines.some((l) => !(num(l.cost) > 0)) };
}

function clientMargins() {
  const now = today();
  const by = {};
  for (const d of DB.documents) {
    if (d.kind === 'quote' || d.status !== 'issued' || daysBetween(d.date, now) > 365) continue;
    const m = docMargin(d);
    if (!m) continue;
    const k = d.clientId;
    by[k] = by[k] || { name: docClient(d).name, v: 0 };
    by[k].v += (d.kind === 'credit' ? -1 : 1) * m.margin;
  }
  return Object.values(by).map((x) => ({ ...x, v: r2(x.v) })).sort((a, b) => b.v - a.v);
}

/* ---------------- Score « Prêt pour 2027 » ---------------- */
function readiness() {
  const s = DB.settings;
  const pros = DB.clients.filter((c) => c.type === 'pro');
  const prosOk = pros.filter((c) => /^\d{9}$/.test(String(c.siren || '').replace(/\s/g, ''))).length;
  const backupOk = (DB.drive && DB.drive.connected && DB.drive.last && daysBetween(DB.drive.last.slice(0, 10), today()) < 7) ||
    (DB.lastBackup && daysBetween(DB.lastBackup.slice(0, 10), today()) < 7);
  const items = [
    { ok: !!(s.name && s.address && s.zip && s.city && /^\d{14}$/.test(String(s.siret).replace(/\s/g, ''))), label: 'Identité complète (nom, adresse, SIRET)', link: '#/parametres' },
    { ok: s.vatRegime === 'franchise' || !!s.tvaIntra, label: 'Numéro de TVA intracommunautaire', link: '#/parametres' },
    { ok: !!String(s.paName || '').trim(), label: 'Plateforme agréée choisie (obligatoire pour recevoir et émettre)', link: '#/parametres' },
    { ok: pros.length === 0 || prosOk === pros.length, label: `SIREN de vos clients professionnels (${prosOk}/${pros.length})`, link: '#/clients' },
    { ok: isLicensed(), label: 'Licence active (factures au format Factur-X)', link: '#/parametres' },
    { ok: !!s.iban, label: 'IBAN sur vos factures (paiement par virement)', link: '#/parametres' },
    { ok: !!backupOk, label: 'Sauvegarde de moins de 7 jours (fichier ou Google Drive)', link: '#/sauvegarde' },
  ];
  return { score: Math.round((items.filter((i) => i.ok).length / items.length) * 100), items };
}

/* ---------------- Cartes du tableau de bord ---------------- */
function insightsHTML() {
  const t = treasury(0);
  const prev = treasury(-1);
  const ceil = ceilings();
  const fc = forecast();
  const fcTotal = r2(fc.reduce((s, b) => s + b.amount, 0));
  const maxB = Math.max(1, ...fc.map((b) => b.amount));
  const rd = readiness();
  const ring = (pct, color) => `<svg viewBox="0 0 36 36" class="ring"><circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--border-2)" stroke-width="3.4"/><circle cx="18" cy="18" r="15.9" fill="none" stroke="${color}" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="${pct} 100" transform="rotate(-90 18 18)"/><text x="18" y="21.5" text-anchor="middle" font-size="9.5" font-weight="700" fill="var(--text-strong)">${pct}%</text></svg>`;
  const pctAvail = t.collected > 0 ? Math.max(0, Math.round((t.available / t.collected) * 100)) : 0;

  return `
    <div class="insights">
      <div class="card">
        <div class="card-head"><h2>💶 Ce que vous pouvez vraiment dépenser</h2><span class="muted small">${esc(t.label)}</span></div>
        <div class="avail"><span class="muted small">Disponible</span><span class="big-price up">${money(t.available)}</span></div>
        <div class="stack" title="Répartition des encaissements du mois">
          <span style="width:${t.collected ? (t.vat / t.collected) * 100 : 0}%;background:var(--warn)"></span>
          <span style="width:${t.collected ? (t.setAside / t.collected) * 100 : 0}%;background:#9c6ade"></span>
          <span style="width:${pctAvail}%;background:var(--up)"></span>
        </div>
        <ul class="kv">
          <li><span>Encaissé ce mois</span><span class="strong">${money(t.collected)}</span></li>
          <li><span><i class="dot" style="background:var(--warn)"></i>TVA contenue, à reverser</span><span>− ${money(t.vat)}</span></li>
          ${t.rate ? `<li><span><i class="dot" style="background:#9c6ade"></i>À mettre de côté (${String(t.rate).replace('.', ',')} % des recettes HT)</span><span>− ${money(t.setAside)}</span></li>`
            : `<li><span class="muted small">Cotisations non estimées · <a href="#/parametres">régler mon taux</a></span><span></span></li>`}
        </ul>
        <p class="muted small" style="margin:8px 0 0">Mois dernier : ${money(prev.collected)} encaissés, ${money(prev.available)} disponibles. Estimation indicative, à confirmer avec votre comptable.</p>
        ${ceil.map((c) => `<div class="ceil"><div class="small"><span>${esc(c.label)} : ${money(c.value)} / ${money(c.max)}</span><span class="${c.pct >= 90 ? 'down' : c.pct >= 75 ? 'warnc' : 'muted'}">${c.pct} %</span></div>
          <div class="bar-bg"><span style="width:${Math.min(100, c.pct)}%;background:${c.pct >= 90 ? 'var(--down)' : c.pct >= 75 ? 'var(--warn)' : 'var(--primary)'}"></span></div>
          ${c.pct >= 75 ? `<div class="small ${c.pct >= 90 ? 'down' : 'warnc'}">⚠ Vous approchez du seuil : parlez-en à votre comptable.</div>` : ''}</div>`).join('')}
      </div>

      <div class="card">
        <div class="card-head"><h2>📅 Encaissements à venir</h2><span class="muted small">${money(fcTotal)} attendus</span></div>
        <p class="muted small" style="margin-top:-4px">Prévision selon l'échéance de chaque facture et le retard habituel du client.</p>
        <ul class="fc">${fc.map((b) => `<li class="${b.late && b.amount ? 'down' : ''}"><span>${b.label}${b.n ? ` <span class="muted small">(${b.n})</span>` : ''}</span>
          <span class="fc-bar"><span style="width:${(b.amount / maxB) * 100}%;background:${b.late ? 'var(--down)' : 'var(--primary)'}"></span></span><span class="strong">${money(b.amount)}</span></li>`).join('')}</ul>
      </div>

      <div class="card">
        <div class="card-head"><h2>✅ Prêt pour la facture électronique</h2></div>
        <div class="ready">${ring(rd.score, rd.score === 100 ? 'var(--up)' : rd.score >= 60 ? 'var(--primary)' : 'var(--warn)')}
          <ul>${rd.items.map((i) => `<li class="${i.ok ? 'ok' : ''}">${i.ok ? '✔' : '○'} ${i.ok ? esc(i.label) : `<a href="${i.link}">${esc(i.label)}</a>`}</li>`).join('')}</ul>
        </div>
      </div>
    </div>`;
}
