/*
 * Ardoise — bons de livraison et précommandes.
 *
 *  - Bon de livraison (BL) : saisi à la livraison, signé au doigt par le client,
 *    puis regroupé avec les autres BL du mois dans UNE facture récapitulative.
 *  - Précommande : commande à retirer à une date (Noël, fêtes, mariages), avec
 *    acompte éventuel, liste de préparation du jour, puis facture au retrait.
 *
 * Les données sont rangées à part (DB.deliveries, DB.orders) pour ne jamais
 * perturber les factures. Les montants utilisent les mêmes calculs (docTotals).
 */
'use strict';

window.ArdoiseLivraisons = (() => {
  const L = { delivery: 'Bon de livraison', order: 'Précommande' };
  const ORDER_STATUS = { pending: 'À préparer', ready: 'Prête', done: 'Retirée', cancelled: 'Annulée' };
  let edit = null; // objet en cours d'édition

  const list = (kind) => (kind === 'delivery' ? DB.deliveries : DB.orders);
  const byId = (kind, id) => list(kind).find((x) => x.id === id);
  const route = (kind) => (kind === 'delivery' ? 'livraison' : 'precommande');
  const totals = (o) => docTotals(o);
  const invoiceOf = (o) => (o.invoiceId ? docById(o.invoiceId) : null);

  function blank(kind) {
    const s = DB.settings;
    const o = {
      id: uid(), kind, number: null, date: today(), clientId: '', clientSnapshot: null, lines: [],
      priceMode: s.vatRegime === 'franchise' ? 'HT' : s.priceMode, franchise: s.vatRegime === 'franchise', notes: '', invoiceId: '',
    };
    if (kind === 'delivery') Object.assign(o, { status: 'delivered', signature: '', signedBy: '', signedAt: null });
    else Object.assign(o, { status: 'pending', pickupDate: addDays(today(), 1), pickupTime: '', deposit: 0, depositDate: today(), depositMethod: 'Espèces' });
    return o;
  }

  // Objet compatible avec docTotals / buildPdf
  function asDoc(o) {
    return {
      ...o, status: 'issued', operation: 'biens',
      dueDate: o.kind === 'order' ? o.pickupDate : o.date,
      subject: o.kind === 'order' ? `Retrait le ${fmtDate(o.pickupDate)}${o.pickupTime ? ' à ' + o.pickupTime : ''}` : '',
    };
  }

  /* ================= Listes ================= */
  function renderDeliveries() {
    const all = DB.deliveries.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.number || '').localeCompare(a.number || ''));
    const toBill = all.filter((o) => !o.invoiceId);
    $('#main').innerHTML = `
      <div class="page-head"><h1>Bons de livraison</h1>
        <div class="actions"><button class="btn success" data-act="bill" ${toBill.length ? '' : 'disabled'}>Facturer les livraisons du mois</button><a class="btn primary" href="#/livraison-edit/new">+ Nouveau bon de livraison</a></div></div>
      <div class="alert-box info">Faites signer le bon au client sur votre téléphone à la livraison, puis en fin de mois, regroupez tous ses bons dans <b>une seule facture</b> en un clic.</div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Numéro</th><th>Date</th><th>Client</th><th class="num">Total TTC</th><th>Signature</th><th>Facturation</th></tr></thead>
        <tbody>${all.length ? all.map((o) => {
          const inv = invoiceOf(o);
          return `<tr class="clickable" data-act="open" data-id="${esc(o.id)}"><td class="strong">${esc(o.number)}</td><td>${fmtDate(o.date)}</td><td>${esc(docClient(o).name)}</td>
            <td class="num">${money(totals(o).ttc)}</td><td>${o.signature ? '<span class="badge b-paid">Signé</span>' : '<span class="badge b-draft">Non signé</span>'}</td>
            <td>${inv ? `<span class="badge b-sent">${esc(inv.number || 'Facture brouillon')}</span>` : '<span class="badge b-partial">À facturer</span>'}</td></tr>`;
        }).join('') : '<tr><td colspan="6" class="empty">Aucun bon de livraison.</td></tr>'}</tbody></table></div></div>`;
    actions = { open: (el) => go('#/livraison/' + el.dataset.id), bill: () => openBillModal() };
  }

  function renderOrders(tab = 'upcoming') {
    const now = today();
    const active = (o) => ['pending', 'ready'].includes(o.status);
    const rows = DB.orders.filter((o) => (tab === 'upcoming' ? active(o) : !active(o)))
      .sort((a, b) => (tab === 'upcoming' ? 1 : -1) * ((a.pickupDate + a.pickupTime).localeCompare(b.pickupDate + b.pickupTime)));
    const days = {};
    for (const o of rows) (days[o.pickupDate] = days[o.pickupDate] || []).push(o);
    $('#main').innerHTML = `
      <div class="page-head"><h1>Précommandes</h1>
        <div class="actions"><a class="btn" href="#/preparation">📋 Liste de préparation</a><a class="btn primary" href="#/precommande-edit/new">+ Nouvelle précommande</a></div></div>
      <div class="tabs" style="margin-bottom:12px"><button class="tab ${tab === 'upcoming' ? 'active' : ''}" data-act="tab" data-t="upcoming">À venir</button><button class="tab ${tab !== 'upcoming' ? 'active' : ''}" data-act="tab" data-t="past">Retirées / annulées</button></div>
      ${rows.length ? Object.entries(days).map(([day, os]) => `
        <div class="card"><div class="card-head"><h2>${day < now && tab === 'upcoming' ? '⚠ ' : ''}${esc(dayLabel(day))}</h2>
          <span class="muted small">${os.length} commande${os.length > 1 ? 's' : ''} · ${money(os.reduce((s, o) => s + totals(o).ttc, 0))}${tab === 'upcoming' ? ` · <a href="#/preparation/${day}">liste de préparation</a>` : ''}</span></div>
          <div class="table-wrap"><table><tbody>${os.map((o) => `<tr class="clickable" data-act="open" data-id="${esc(o.id)}">
            <td class="nowrap">${esc(o.pickupTime || '—')}</td><td class="strong">${esc(docClient(o).name)}</td>
            <td class="muted small">${esc(o.lines.map((l) => `${fmtNum(l.qty)} ${l.designation}`).join(', ')).slice(0, 90)}</td>
            <td class="num">${money(totals(o).ttc)}</td><td class="num small">${num(o.deposit) ? `acompte ${money(o.deposit)}` : ''}</td>
            <td><span class="badge ${o.status === 'ready' ? 'b-paid' : o.status === 'pending' ? 'b-partial' : o.status === 'done' ? 'b-sent' : 'b-draft'}">${ORDER_STATUS[o.status]}</span></td></tr>`).join('')}</tbody></table></div></div>`).join('')
      : `<div class="card empty">${tab === 'upcoming' ? 'Aucune précommande à venir. Idéal pour Noël, les fêtes et les mariages !' : 'Rien pour le moment.'}</div>`}`;
    actions = { open: (el) => go('#/precommande/' + el.dataset.id), tab: (el) => renderOrders(el.dataset.t) };
  }

  function dayLabel(iso) {
    const d = new Date(iso + 'T12:00:00');
    const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const delta = daysBetween(today(), iso);
    return s.charAt(0).toUpperCase() + s.slice(1) + (delta === 0 ? ' (aujourd\'hui)' : delta === 1 ? ' (demain)' : '');
  }

  /* ================= Liste de préparation ================= */
  function renderPreparation(day) {
    const active = DB.orders.filter((o) => ['pending', 'ready'].includes(o.status));
    if (!day) {
      const next = active.map((o) => o.pickupDate).filter((d) => d >= today()).sort()[0];
      day = next || today();
    }
    const os = active.filter((o) => o.pickupDate === day).sort((a, b) => (a.pickupTime || '').localeCompare(b.pickupTime || ''));
    const agg = {};
    for (const o of os) for (const l of o.lines) {
      const k = (l.designation + '|' + l.unit).toLowerCase();
      agg[k] = agg[k] || { designation: l.designation, unit: l.unit, qty: 0, n: 0 };
      agg[k].qty = r4(agg[k].qty + num(l.qty)); agg[k].n++;
    }
    const items = Object.values(agg).sort((a, b) => a.designation.localeCompare(b.designation));
    $('#main').innerHTML = `
      <div class="page-head"><h1>Liste de préparation</h1>
        <div class="actions"><input type="date" id="prep-day" value="${esc(day)}" style="margin:0;width:auto"><button class="btn primary" data-act="print">⎙ Imprimer</button><a class="btn" href="#/precommandes">← Précommandes</a></div></div>
      <div class="card"><h2>${esc(dayLabel(day))} : ${os.length} commande${os.length > 1 ? 's' : ''}</h2>
        ${items.length ? `<div class="table-wrap"><table><thead><tr><th>À préparer</th><th class="num">Quantité totale</th><th class="num">Commandes</th></tr></thead>
          <tbody>${items.map((i) => `<tr><td class="strong">${esc(i.designation)}</td><td class="num strong">${fmtNum(i.qty)} ${esc(i.unit)}</td><td class="num">${i.n}</td></tr>`).join('')}</tbody></table></div>`
          : '<p class="muted">Aucune commande à retirer ce jour-là.</p>'}
      </div>
      ${os.map((o) => {
        const c = docClient(o), t = totals(o), rest = r2(t.ttc - num(o.deposit));
        return `<div class="card prep"><div class="card-head"><h2>${esc(o.pickupTime || '—')} · ${esc(c.name)}</h2>
          <span class="small">${esc(o.number)} · ${c.phone ? '📞 ' + esc(c.phone) + ' · ' : ''}<b>${rest > 0 ? 'Reste à payer ' + money(rest) : 'Réglée'}</b>${num(o.deposit) ? ` (acompte ${money(o.deposit)})` : ''}</span></div>
          <ul class="prep-list">${o.lines.map((l) => `<li><span class="box"></span>${fmtNum(l.qty)} ${esc(l.unit)} — ${esc(l.designation)}${l.description ? ` <span class="muted">(${esc(l.description)})</span>` : ''}</li>`).join('')}</ul>
          ${o.notes ? `<p class="small muted">📝 ${esc(o.notes)}</p>` : ''}
          <div class="actions no-print">${o.status === 'pending' ? `<button class="btn small" data-act="ready" data-id="${esc(o.id)}">✔ Marquer prête</button>` : '<span class="badge b-paid">Prête</span>'}
            <a class="btn small" href="#/precommande/${esc(o.id)}">Ouvrir</a></div></div>`;
      }).join('')}`;
    $('#prep-day').addEventListener('change', (e) => { if (e.target.value) go('#/preparation/' + e.target.value); });
    actions = {
      print: () => window.print(),
      ready: (el) => { const o = byId('order', el.dataset.id); o.status = 'ready'; save(); renderPreparation(day); },
    };
  }

  /* ================= Fiche (BL ou précommande) ================= */
  function renderView(kind, id) {
    const o = byId(kind, id);
    if (!o) { $('#main').innerHTML = '<div class="card empty">Introuvable.</div>'; return; }
    const c = docClient(o), t = totals(o), inv = invoiceOf(o);
    const isBL = kind === 'delivery';
    const locked = !!inv;
    $('#main').innerHTML = `
      <div class="page-head"><h1>${L[kind]} ${esc(o.number)} ${isBL ? (o.signature ? '<span class="badge b-paid">Signé</span>' : '<span class="badge b-draft">Non signé</span>') : `<span class="badge b-partial">${ORDER_STATUS[o.status]}</span>`}</h1>
        <div class="actions"><a class="btn" href="#/${isBL ? 'livraisons' : 'precommandes'}">← Retour</a>
          ${locked ? '' : `<a class="btn" href="#/${route(kind)}-edit/${esc(o.id)}">✎ Modifier</a>`}
          <button class="btn primary" data-act="pdf">⬇ PDF</button><button class="btn" data-act="share">📤 Partager</button></div></div>
      <div class="doc-layout">
        <div class="card">
          <ul class="drive-status" style="max-width:none">
            <li><span class="muted">Client</span><span class="strong">${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}</span></li>
            <li><span class="muted">${isBL ? 'Livré le' : 'Retrait'}</span><span>${isBL ? fmtDate(o.date) : esc(dayLabel(o.pickupDate)) + (o.pickupTime ? ' à ' + esc(o.pickupTime) : '')}</span></li>
            ${!isBL && num(o.deposit) ? `<li><span class="muted">Acompte versé</span><span>${money(o.deposit)} le ${fmtDate(o.depositDate)} (${esc(o.depositMethod)})</span></li>` : ''}
          </ul>
          <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Article</th><th class="num">Qté</th><th>Unité</th><th class="num">PU ${o.franchise ? '' : o.priceMode}</th><th class="num">Total</th></tr></thead>
            <tbody>${o.lines.map((l) => `<tr><td>${esc(l.designation)}${l.description ? `<div class="muted small">${esc(l.description)}</div>` : ''}</td><td class="num">${fmtNum(l.qty)}</td><td>${esc(l.unit)}</td><td class="num">${money(l.price)}</td><td class="num">${money(lineTotal(l))}</td></tr>`).join('')}</tbody></table></div>
          ${totalsHTML(o)}
          ${o.notes ? `<p class="small muted">📝 ${esc(o.notes)}</p>` : ''}
        </div>
        <div class="side">
          ${isBL ? `<div class="card"><h3>Signature du client</h3>
              ${o.signature ? `<img src="${o.signature}" alt="Signature" class="sig-img"><p class="small muted">Reçu par <b>${esc(o.signedBy || '—')}</b>${o.signedAt ? ' le ' + new Date(o.signedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</p>${locked ? '' : '<button class="btn small" data-act="sign">Refaire la signature</button>'}`
                : `<p class="small muted">Faites signer le client sur l'écran (doigt ou souris).</p><button class="btn success" data-act="sign">✍ Faire signer</button>`}</div>` : ''}
          <div class="card"><h3>Facturation</h3>
            ${inv ? `<p class="small">Facturé dans <a href="#/doc/${esc(inv.id)}">${esc(inv.number || 'la facture brouillon')}</a>.</p>`
              : isBL ? '<p class="small muted">Ce bon sera regroupé avec les autres bons du client dans la facture du mois.</p><button class="btn" data-act="bill">Facturer maintenant</button>'
              : `<p class="small muted">Au retrait, transformez la commande en facture : l'acompte y est déduit automatiquement.</p>
                 ${o.status === 'pending' ? '<button class="btn" data-act="ready">✔ Marquer prête</button>' : ''}
                 <button class="btn success" data-act="to-invoice">→ Retirée : créer la facture</button>`}
          </div>
          ${locked ? '' : `<div class="card"><h3>Autres actions</h3>${!isBL && o.status !== 'cancelled' ? '<button class="btn" data-act="cancel">Annuler la commande</button>' : ''}<button class="btn danger" data-act="delete">🗑 Supprimer</button></div>`}
        </div>
      </div>`;
    actions = {
      pdf: () => downloadPdf(asDoc(o)),
      share: () => sharePdf(asDoc(o)),
      sign: () => openSignature(o),
      bill: () => openBillModal(o.clientId),
      ready: () => { o.status = 'ready'; save(); renderView(kind, id); },
      cancel: () => { if (confirm('Annuler cette précommande ?')) { o.status = 'cancelled'; save(); renderView(kind, id); } },
      'to-invoice': () => orderToInvoice(o),
      delete: () => {
        if (!confirm(`Supprimer ${isBL ? 'ce bon de livraison' : 'cette précommande'} ?`)) return;
        if (isBL) DB.deliveries = DB.deliveries.filter((x) => x.id !== o.id); else DB.orders = DB.orders.filter((x) => x.id !== o.id);
        save(); toast('Supprimé'); go(isBL ? '#/livraisons' : '#/precommandes');
      },
    };
  }

  /* ================= Éditeur ================= */
  function startEdit(kind, id) {
    if (id === 'new') edit = blank(kind);
    else {
      const o = byId(kind, id);
      if (!o) return go(kind === 'delivery' ? '#/livraisons' : '#/precommandes');
      if (o.invoiceId) { toast('Déjà facturé : modification impossible.', 'error'); return go(`#/${route(kind)}/${id}`); }
      edit = clone(o);
    }
    renderEditor();
  }

  function renderEditor() {
    const o = edit, isBL = o.kind === 'delivery';
    const clients = DB.clients.slice().sort((a, b) => a.name.localeCompare(b.name));
    const mode = o.franchise ? '' : o.priceMode;
    $('#main').innerHTML = `
      <div class="page-head"><h1>${o.number ? L[o.kind] + ' ' + esc(o.number) : (isBL ? 'Nouveau bon de livraison' : 'Nouvelle précommande')}</h1>
        <div class="actions"><button class="btn" data-act="cancel">Annuler</button><button class="btn primary" data-act="save">Enregistrer</button></div></div>
      <div class="card"><div class="grid3">
        <label class="span2">Client <div class="row"><select id="e-client"><option value="">— Choisir un client —</option>
          ${clients.map((c) => `<option value="${esc(c.id)}" ${c.id === o.clientId ? 'selected' : ''}>${esc(c.name)}${c.type === 'pro' ? '' : ' (particulier)'}</option>`).join('')}</select>
          <button class="btn" type="button" data-act="new-client">+ Nouveau client</button></div></label>
        ${isBL ? `<label>Date de livraison <input id="e-date" type="date" value="${esc(o.date)}"></label>`
          : `<label>Date de retrait <input id="e-pdate" type="date" value="${esc(o.pickupDate)}"></label>
             <label>Heure de retrait <input id="e-ptime" type="time" value="${esc(o.pickupTime)}"></label>
             <label>Acompte versé (€) <input id="e-dep" type="number" step="0.01" min="0" value="${num(o.deposit) || ''}" placeholder="0"></label>
             <label>Mode de paiement de l'acompte <select id="e-depm">${PAYMENT_METHODS.map((m) => `<option ${m === o.depositMethod ? 'selected' : ''}>${m}</option>`).join('')}</select></label>`}
      </div>${!isBL ? '<p class="hint">Pour un client professionnel, un acompte doit faire l\'objet d\'une facture d\'acompte : utilisez plutôt une facture.</p>' : ''}</div>
      <div class="card"><div class="card-head"><h2>Articles</h2><span class="muted small">Prix ${mode ? 'en ' + mode : 'nets'}</span></div>
        <div class="table-wrap"><table class="lines"><thead><tr><th>Désignation</th><th class="col-qty">Qté</th><th class="col-unit">Unité</th><th class="col-price">PU ${mode}</th>${o.franchise ? '' : '<th class="col-vat">TVA</th>'}<th class="col-total num">Total</th><th class="col-del"></th></tr></thead>
        <tbody id="e-lines"></tbody></table></div>
        <div class="row" style="margin-top:10px"><label>Ajouter un article du catalogue <input id="e-add" list="e-products" placeholder="Tapez le nom de l'article…"></label><button class="btn" type="button" data-act="add-line">+ Ligne libre</button></div>
        <datalist id="e-products">${DB.products.map((p) => `<option value="${esc(p.name)}">`).join('')}</datalist>
        <div id="e-totals"></div></div>
      <div class="card"><label>${isBL ? 'Remarques (visibles sur le bon)' : 'Remarques (ex. : découpe, message sur le bouquet…)'} <textarea id="e-notes">${esc(o.notes)}</textarea></label></div>`;
    drawLines();
    $('#e-lines').addEventListener('input', (e) => {
      const f = e.target.dataset.f, tr = e.target.closest('tr');
      if (!f || !tr) return;
      const l = edit.lines[Number(tr.dataset.i)];
      l[f] = ['qty', 'price', 'vatRate'].includes(f) ? num(e.target.value) : e.target.value;
      tr.querySelector('[data-total]').textContent = money(lineTotal(l));
      $('#e-totals').innerHTML = totalsHTML(edit);
    });
    const add = $('#e-add');
    const tryAdd = () => {
      const p = DB.products.find((x) => x.name.toLowerCase() === add.value.trim().toLowerCase());
      if (!p) return;
      edit.lines.push({ designation: p.name, description: p.description || '', qty: 1, unit: p.unit || 'unité', price: productPriceFor(p, edit.priceMode, edit.franchise), vatRate: edit.franchise ? 0 : num(p.vatRate), discount: 0, cost: num(p.cost) });
      add.value = ''; drawLines();
    };
    add.addEventListener('change', tryAdd);
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(); } });
    actions = {
      cancel: () => { edit = null; history.length > 1 ? history.back() : go('#/tableau'); },
      'add-line': () => { edit.lines.push({ designation: '', description: '', qty: 1, unit: 'unité', price: 0, vatRate: edit.franchise ? 0 : num(DB.settings.defaultVat), discount: 0, cost: 0 }); drawLines(); },
      'del-line': (el) => { edit.lines.splice(Number(el.dataset.i), 1); drawLines(); },
      'new-client': () => { readForm(); openClientModal(null, (c) => { if (c) edit.clientId = c.id; renderEditor(); }); },
      save: () => saveEdit(),
    };
  }

  function drawLines() {
    const o = edit;
    $('#e-lines').innerHTML = o.lines.length ? o.lines.map((l, i) => `<tr data-i="${i}">
      <td><input data-f="designation" value="${esc(l.designation)}" placeholder="Désignation"><input class="desc-input" data-f="description" value="${esc(l.description)}" placeholder="Détail (optionnel)"></td>
      <td class="col-qty"><input data-f="qty" type="number" step="any" value="${num(l.qty)}"></td>
      <td class="col-unit"><input data-f="unit" value="${esc(l.unit)}" list="units-dl2"></td>
      <td class="col-price"><input data-f="price" type="number" step="0.01" value="${num(l.price)}"></td>
      ${o.franchise ? '' : `<td class="col-vat"><select data-f="vatRate">${VAT_RATES.map((r) => `<option value="${r}" ${num(l.vatRate) === r ? 'selected' : ''}>${fmtRate(r)}</option>`).join('')}</select></td>`}
      <td class="col-total num" data-total>${money(lineTotal(l))}</td>
      <td class="col-del"><button class="icon-btn" type="button" data-act="del-line" data-i="${i}">✕</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="empty">Ajoutez des articles du catalogue ou une ligne libre.</td></tr>';
    if (!$('#units-dl2')) document.body.insertAdjacentHTML('beforeend', `<datalist id="units-dl2">${UNITS.map((u) => `<option value="${u}">`).join('')}</datalist>`);
    $('#e-totals').innerHTML = totalsHTML(o);
  }

  function readForm() {
    const o = edit;
    o.clientId = $('#e-client').value;
    o.notes = $('#e-notes').value;
    if (o.kind === 'delivery') o.date = $('#e-date').value || today();
    else {
      o.pickupDate = $('#e-pdate').value || today();
      o.pickupTime = $('#e-ptime').value || '';
      o.deposit = r2(Math.max(0, num($('#e-dep').value)));
      o.depositMethod = $('#e-depm').value;
    }
  }

  function saveEdit() {
    readForm();
    const o = edit;
    o.lines = o.lines.filter((l) => String(l.designation).trim() || num(l.price));
    if (!o.clientId) { toast('Choisissez un client.', 'error'); return; }
    if (!o.lines.length) { toast('Ajoutez au moins un article.', 'error'); drawLines(); return; }
    if (o.kind === 'order' && num(o.deposit) > totals(o).ttc + 0.004) { toast("L'acompte dépasse le total de la commande.", 'error'); return; }
    const c = clientById(o.clientId);
    if (c) o.clientSnapshot = snapshotClient(c);
    if (!o.number) o.number = nextNumber(o.kind, o.kind === 'delivery' ? o.date : today());
    const arr = list(o.kind);
    const i = arr.findIndex((x) => x.id === o.id);
    if (i >= 0) arr[i] = clone(o); else arr.push(clone(o));
    save();
    toast('Enregistré');
    const id = o.id, kind = o.kind;
    edit = null;
    go(`#/${route(kind)}/${id}`);
  }

  /* ================= Signature au doigt ================= */
  function openSignature(o) {
    openModal('Signature du client', `
      <p class="small muted">Le client signe dans le cadre avec le doigt (téléphone, tablette) ou la souris.</p>
      <canvas id="sig" width="560" height="220" class="sig-pad"></canvas>
      <label style="margin-top:10px">Nom du signataire <input id="sig-name" value="${esc(o.signedBy || docClient(o).contact || '')}" placeholder="ex : M. Bertin"></label>
      <div class="modal-foot"><button class="btn" id="sig-clear">Effacer</button><button class="btn success" id="sig-ok">Valider la signature</button></div>`, (root) => {
      const cv = $('#sig', root), ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#15233f';
      let drawing = false, dirty = false;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
      cv.addEventListener('pointerdown', (e) => { drawing = true; dirty = true; cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke(); e.preventDefault(); });
      cv.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); });
      ['pointerup', 'pointercancel'].forEach((t) => cv.addEventListener(t, () => { drawing = false; }));
      $('#sig-clear', root).onclick = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); dirty = false; };
      $('#sig-ok', root).onclick = () => {
        if (!dirty) { toast('Le client doit signer dans le cadre.', 'error'); return; }
        o.signature = cv.toDataURL('image/png');
        o.signedBy = $('#sig-name', root).value.trim();
        o.signedAt = new Date().toISOString();
        save(); closeModal(); toast('Bon de livraison signé'); renderView('delivery', o.id);
      };
    });
  }

  /* ================= Facture récapitulative du mois ================= */
  function openBillModal(clientId) {
    const pending = DB.deliveries.filter((o) => !o.invoiceId);
    const clientIds = [...new Set(pending.map((o) => o.clientId))];
    if (!clientIds.length) { toast('Aucun bon de livraison à facturer.', 'error'); return; }
    const months = [...new Set(pending.map((o) => o.date.slice(0, 7)))].sort().reverse();
    const cid = clientId && clientIds.includes(clientId) ? clientId : clientIds[0];
    const monthLabel = (ym) => { const [y, m] = ym.split('-'); return `${MONTHS[Number(m) - 1]} ${y}`; };
    openModal('Facturer les livraisons', `
      <div class="grid2">
        <label>Client <select id="b-client">${clientIds.map((id) => { const o = pending.find((x) => x.clientId === id); return `<option value="${esc(id)}" ${id === cid ? 'selected' : ''}>${esc(docClient(o).name)}</option>`; }).join('')}</select></label>
        <label>Période <select id="b-month"><option value="">Tous les bons non facturés</option>${months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('')}</select></label>
      </div>
      <div id="b-list" style="margin-top:10px"></div>
      <div class="modal-foot"><button class="btn" data-close>Annuler</button><button class="btn success" id="b-go">Créer la facture récapitulative</button></div>`, (root) => {
      const draw = () => {
        const id = $('#b-client', root).value, m = $('#b-month', root).value;
        const bls = pending.filter((o) => o.clientId === id && (!m || o.date.startsWith(m))).sort((a, b) => a.date.localeCompare(b.date));
        $('#b-list', root).innerHTML = bls.length ? `<table><tbody>${bls.map((o) => `<tr><td><input type="checkbox" class="b-cb" value="${esc(o.id)}" checked></td><td>${esc(o.number)}</td><td>${fmtDate(o.date)}</td><td>${o.signature ? '✍ signé' : '<span class="muted">non signé</span>'}</td><td class="num">${money(totals(o).ttc)}</td></tr>`).join('')}</tbody></table>
          <p class="small" style="margin-top:8px">Total de la facture : <b>${money(totals({ priceMode: bls[0].priceMode, franchise: bls[0].franchise, lines: bls.flatMap((o) => o.lines) }).ttc)}</b> TTC pour ${bls.length} bon${bls.length > 1 ? 's' : ''}.</p>` : '<p class="muted small">Aucun bon pour cette période.</p>';
      };
      $('#b-client', root).onchange = draw; $('#b-month', root).onchange = draw; draw();
      $('#b-go', root).onclick = () => {
        const ids = $$('.b-cb', root).filter((x) => x.checked).map((x) => x.value);
        const bls = DB.deliveries.filter((o) => ids.includes(o.id)).sort((a, b) => a.date.localeCompare(b.date));
        if (!bls.length) { toast('Cochez au moins un bon de livraison.', 'error'); return; }
        const inv = newDoc('invoice');
        const mode = bls[0].priceMode;
        const convert = (l, from) => {
          if (from === mode || inv.franchise) return num(l.price);
          const k = 1 + num(l.vatRate) / 100;
          return mode === 'TTC' ? r2(num(l.price) * k) : r4(num(l.price) / k);
        };
        inv.priceMode = mode;
        inv.clientId = bls[0].clientId;
        inv.clientSnapshot = snapshotClient(clientById(inv.clientId)) || bls[0].clientSnapshot;
        inv.lines = bls.flatMap((o) => o.lines.map((l) => ({ ...clone(l), price: convert(l, o.priceMode), description: `BL ${o.number} du ${fmtDate(o.date)}${l.description ? ' · ' + l.description : ''}` })));
        const first = bls[0].date, last = bls[bls.length - 1].date;
        inv.subject = first.slice(0, 7) === last.slice(0, 7) ? `Livraisons de ${monthLabel(first.slice(0, 7))}` : `Livraisons du ${fmtDate(first)} au ${fmtDate(last)}`;
        inv.deliveryDate = last;
        inv.notes = `Facture récapitulative des bons de livraison n° ${bls.map((o) => `${o.number} (${fmtDate(o.date)})`).join(', ')}.`;
        DB.documents.push(inv);
        bls.forEach((o) => { o.invoiceId = inv.id; });
        save();
        closeModal();
        toast(`Facture créée à partir de ${bls.length} bon${bls.length > 1 ? 's' : ''} de livraison : vérifiez-la puis validez-la.`);
        go('#/modifier/' + inv.id);
      };
    });
  }

  /* ================= Précommande → facture ================= */
  function orderToInvoice(o) {
    const inv = newDoc('invoice');
    Object.assign(inv, {
      priceMode: o.priceMode, franchise: o.franchise, clientId: o.clientId,
      clientSnapshot: snapshotClient(clientById(o.clientId)) || o.clientSnapshot,
      lines: clone(o.lines), subject: `Commande ${o.number}`, notes: o.notes,
      date: today(), dueDate: today(), deliveryDate: o.pickupDate > today() ? '' : (o.pickupDate === today() ? '' : o.pickupDate),
    });
    if (num(o.deposit) > 0) inv.payments = [{ id: uid(), date: o.depositDate || today(), amount: r2(o.deposit), method: o.depositMethod || 'Autre' }];
    DB.documents.push(inv);
    o.invoiceId = inv.id; o.status = 'done';
    save();
    toast(num(o.deposit) ? `Facture créée, acompte de ${money(o.deposit)} déjà déduit.` : 'Facture créée.');
    go('#/modifier/' + inv.id);
  }

  /* Libère les bons et commandes quand une facture brouillon est supprimée */
  function releaseInvoice(invoiceId) {
    for (const o of DB.deliveries) if (o.invoiceId === invoiceId) o.invoiceId = '';
    for (const o of DB.orders) if (o.invoiceId === invoiceId) { o.invoiceId = ''; if (o.status === 'done') o.status = 'ready'; }
  }

  function routeTo(r, a) {
    switch (r) {
      case 'livraisons': return renderDeliveries();
      case 'livraison': return renderView('delivery', a);
      case 'livraison-edit': return startEdit('delivery', a || 'new');
      case 'precommandes': return renderOrders();
      case 'precommande': return renderView('order', a);
      case 'precommande-edit': return startEdit('order', a || 'new');
      case 'preparation': return renderPreparation(a && /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : '');
      default: return renderDeliveries();
    }
  }
  const ROUTES = ['livraisons', 'livraison', 'livraison-edit', 'precommandes', 'precommande', 'precommande-edit', 'preparation'];

  return { routeTo, ROUTES, releaseInvoice, asDoc };
})();
