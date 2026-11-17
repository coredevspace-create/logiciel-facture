// Génère des Factur-X d'exemple (XML + PDF) depuis l'application réelle.
// Utilisation : node outils/generer-echantillons.js   (nécessite Playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'echantillons') + '/';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto('file://' + path.resolve(__dirname, '../app.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('[data-act="demo"]');
  await page.waitForTimeout(200);
  // Les Factur-X ne sont produites qu'avec une licence active : on la simule pour les tests.
  await page.evaluate(() => { window.licenceState = () => 'valid'; });

  const results = await page.evaluate(async () => {
    const out = [];
    const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
    const add = async (name, doc) => {
      const xml = buildCII(doc);
      const pdf = await buildPdf(doc);
      out.push({ name, xml, pdf: toB64(pdf), issues: facturxIssues(doc) });
    };
    // 1) Facture de démo (HT, 20 % + 5,5 %)
    const demo = DB.documents.find((d) => d.kind === 'invoice' && d.status === 'issued' && d.subject === 'Réassort boutique');
    await add('01-demo-ht', demo);

    // 2) Boucherie : prix TTC, 5,5 % + 20 %, remise, quantités décimales
    const boucher = clone(demo);
    Object.assign(boucher, { id: uid(), number: 'F-2026-0101', priceMode: 'TTC', subject: 'Commande traiteur', lines: [
      { designation: 'Entrecôte maturée', description: 'Origine France', qty: 3.475, unit: 'kg', price: 38.9, vatRate: 5.5, discount: 0 },
      { designation: 'Saucisses de Toulouse', description: '', qty: 2.2, unit: 'kg', price: 14.95, vatRate: 5.5, discount: 10 },
      { designation: 'Plateau de charcuterie (10 pers.)', description: '', qty: 2, unit: 'pièce', price: 49.9, vatRate: 5.5, discount: 0 },
      { designation: 'Bouteille de vin rouge', description: '', qty: 6, unit: 'bouteille', price: 12.9, vatRate: 20, discount: 0 },
      { designation: 'Livraison', description: '', qty: 1, unit: 'forfait', price: 9.99, vatRate: 20, discount: 0 },
    ] });
    await add('02-boucher-ttc', boucher);

    // 3) Fleuriste en micro-entreprise (franchise), client particulier
    const fr = clone(demo);
    const part = DB.clients.find((c) => c.type === 'particulier');
    Object.assign(fr, { id: uid(), number: 'F-2026-0102', franchise: true, priceMode: 'HT', clientId: part.id, clientSnapshot: snapshotClient(part), operation: 'mixte',
      sellerSnapshot: { ...demo.sellerSnapshot, name: 'Les Fleurs de Lili', legalForm: 'EI', capital: '', tvaIntra: '', vatRegime: 'franchise', iban: '' },
      lines: [
        { designation: 'Bouquet de mariée', description: 'Roses blanches et pivoines', qty: 1, unit: 'bouquet', price: 120, vatRate: 0, discount: 0 },
        { designation: 'Décoration de salle', description: '', qty: 1, unit: 'forfait', price: 350, vatRate: 0, discount: 0 },
      ] });
    await add('03-fleuriste-franchise', fr);

    // 4) Avoir sur la facture de démo
    const credit = clone(demo);
    Object.assign(credit, { id: uid(), kind: 'credit', number: 'A-2026-0001', invoiceRef: demo.id, lines: [clone(demo.lines[0])], dueDate: demo.date });
    credit.lines[0].qty = 2;
    await add('04-avoir', credit);

    // 5) Prestations de services, TVA sur les débits, adresse de livraison, 10 %
    const svc = clone(demo);
    Object.assign(svc, { id: uid(), number: 'F-2026-0103', operation: 'services', deliveryDate: '2026-10-28', deliveryAddress: 'Salle des fêtes, 1 rue du Stade, 14000 Caen',
      sellerSnapshot: { ...demo.sellerSnapshot, vatOnDebits: true }, notes: 'Merci pour votre confiance & à bientôt <3',
      lines: [
        { designation: 'Composition florale de table', description: 'Centre de table', qty: 12, unit: 'composition', price: 35, vatRate: 10, discount: 0 },
        { designation: 'Installation sur place', description: '', qty: 3, unit: 'heure', price: 40, vatRate: 20, discount: 0 },
      ] });
    await add('05-services-debits', svc);

    // 6) Devis (PDF simple, sans XML) et brouillon (filigrane)
    const quote = DB.documents.find((d) => d.kind === 'quote');
    out.push({ name: '06-devis', pdf: toB64(await buildPdf(quote)) });
    const draftDoc = DB.documents.find((d) => d.kind === 'invoice' && d.status === 'draft');
    out.push({ name: '07-brouillon', pdf: toB64(await buildPdf(draftDoc)) });
    // Totaux affichés (pour comparaison avec le XML)
    out.forEach((o) => { o.totals = null; });
    out[1].totals = docTotals(boucher);
    return out;
  });

  for (const r of results) {
    if (r.xml) fs.writeFileSync(OUT + r.name + '.xml', r.xml);
    fs.writeFileSync(OUT + r.name + '.pdf', Buffer.from(r.pdf, 'base64'));
    console.log(r.name, r.issues ? `issues=${JSON.stringify(r.issues)}` : '', r.totals ? JSON.stringify(r.totals) : '');
  }
  console.log('ERRORS', errors);
  await browser.close();
})();
