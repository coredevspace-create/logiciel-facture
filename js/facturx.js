/*
 * Ardoise — génération des PDF et de la facture électronique Factur-X.
 *
 *  - buildCII(doc)      : XML CII (UN/CEFACT D16B) au profil Factur-X EN 16931,
 *                         avec les données attendues par la réforme française.
 *  - buildPdf(doc)      : PDF/A-3 dessiné avec pdf-lib ; pour une facture ou un avoir
 *                         validé, le XML y est intégré (factur-x.xml) : c'est une Factur-X.
 *
 * Dépend des fonctions de calcul d'app.js (docTotals, lineTotal, docClient, …)
 * et des bibliothèques locales js/vendor/ (pdf-lib, fontkit, assets).
 */
'use strict';

const FACTURX = {
  guideline: 'urn:cen.eu:en16931:2017',
  conformance: 'EN 16931',
  filename: 'factur-x.xml',
};

/* =====================================================================
   Données communes
   ===================================================================== */

// Unités → codes UN/ECE (recommandations 20 et 21)
const UNIT_CODES = {
  'kg': 'KGM', 'kilo': 'KGM', 'kilogramme': 'KGM', 'g': 'GRM', 'gramme': 'GRM',
  'litre': 'LTR', 'l': 'LTR', 'cl': 'CLT', 'heure': 'HUR', 'h': 'HUR', 'jour': 'DAY',
  'pièce': 'H87', 'piece': 'H87', 'bouteille': 'XBO', 'carton': 'XCT', 'm': 'MTR', 'm2': 'MTK', 'm²': 'MTK',
};
const unitCode = (u) => UNIT_CODES[String(u || '').trim().toLowerCase()] || 'C62';

const sirenOf = (siretOrSiren) => String(siretOrSiren || '').replace(/\s/g, '').slice(0, 9);

/** Montants HT par ligne, cohérents au centime près avec les bases de TVA de docTotals. */
function lineNetAmounts(doc) {
  const rateOf = (l) => (doc.franchise ? 0 : num(l.vatRate));
  const ttcMode = doc.priceMode === 'TTC' && !doc.franchise;
  const nets = doc.lines.map((l) => (ttcMode ? r2(lineTotal(l) / (1 + rateOf(l) / 100)) : lineTotal(l)));
  for (const v of docTotals(doc).vat) {
    const idx = doc.lines.map((l, i) => i).filter((i) => rateOf(doc.lines[i]) === v.rate);
    const diff = r2(v.base - idx.reduce((s, i) => s + nets[i], 0));
    if (diff && idx.length) nets[idx[idx.length - 1]] = r2(nets[idx[idx.length - 1]] + diff);
  }
  return nets;
}

/** Vérifie les données nécessaires à une Factur-X exploitable. Renvoie une liste de problèmes. */
function facturxIssues(doc) {
  const S = doc.sellerSnapshot || DB.settings;
  const c = docClient(doc);
  const issues = [];
  if (!/^\d{14}$/.test(String(S.siret || '').replace(/\s/g, ''))) issues.push('Votre SIRET (14 chiffres) est manquant ou incorrect.');
  if (!doc.franchise && !S.tvaIntra) issues.push('Votre numéro de TVA intracommunautaire est manquant.');
  if (!S.address || !S.zip || !S.city) issues.push('Votre adresse complète (rue, code postal, ville) est incomplète.');
  if (c.type === 'pro' && !/^\d{9}$/.test(String(c.siren || ''))) issues.push(`Le SIREN du client « ${c.name} » est manquant (obligatoire entre professionnels).`);
  if (!c.zip || !c.city) issues.push(`L'adresse du client « ${c.name} » est incomplète (code postal, ville).`);
  for (const l of doc.lines) if (num(l.price) < 0) { issues.push('Un prix unitaire est négatif : utilisez plutôt une quantité négative ou un avoir.'); break; }
  return issues;
}

/* =====================================================================
   XML CII — profil EN 16931
   ===================================================================== */
function buildCII(doc) {
  const S = doc.sellerSnapshot || DB.settings;
  const c = docClient(doc);
  const t = docTotals(doc);
  const nets = lineNetAmounts(doc);
  const x = (s) => esc(String(s ?? '').trim());
  const a2 = (v) => r2(v).toFixed(2);
  const d102 = (iso) => String(iso || today()).replace(/-/g, '');
  const isCredit = doc.kind === 'credit';
  const ref = isCredit && doc.invoiceRef ? docById(doc.invoiceRef) : null;
  const sellerSiren = sirenOf(S.siret);
  const buyerSiren = c.type === 'pro' ? sirenOf(c.siren) : '';
  const process = { biens: 'B1', services: 'S1', mixte: 'M1' }[doc.operation] || 'B1';

  const category = (rate) => (doc.franchise || rate === 0 ? 'E' : 'S');
  const exemption = (rate) => {
    if (doc.franchise) return { reason: 'TVA non applicable, art. 293 B du CGI', code: 'VATEX-FR-FRANCHISE' };
    if (rate === 0) return { reason: 'Exonération de TVA', code: '' };
    return null;
  };
  // Exigibilité de la TVA (prestations de services) : 5 = à la facturation (option débits), 72 = à l'encaissement
  const dueDateType = doc.operation === 'biens' || doc.franchise ? '' : (S.vatOnDebits ? '5' : '72');

  const address = (o) => `
        <ram:PostalTradeAddress>
          ${o.zip ? `<ram:PostcodeCode>${x(o.zip)}</ram:PostcodeCode>` : ''}
          ${o.address ? `<ram:LineOne>${x(o.address)}</ram:LineOne>` : ''}
          ${o.city ? `<ram:CityName>${x(o.city)}</ram:CityName>` : ''}
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>`;

  const notes = [];
  if (doc.subject) notes.push(['AAI', `Objet : ${doc.subject}`]);
  if (doc.notes) notes.push(['AAI', doc.notes]);
  notes.push(['PMD', S.latePenalty || "En cas de retard de paiement, pénalités au taux de 3 fois le taux d'intérêt légal."]);
  notes.push(['PMT', c.type === 'pro'
    ? 'Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €.'
    : 'Indemnité forfaitaire pour frais de recouvrement : non applicable (client non professionnel).']);
  notes.push(['AAB', "Pas d'escompte pour paiement anticipé."]);

  const lines = doc.lines.map((l, i) => {
    const rate = doc.franchise ? 0 : num(l.vatRate);
    const qty = num(l.qty) || 1;
    const net = nets[i];
    const price = Math.abs(r4(net / qty));
    return `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>${x(l.designation)}</ram:Name>
        ${l.description ? `<ram:Description>${x(l.description)}</ram:Description>` : ''}
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${price}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="${unitCode(l.unit)}">${r4(num(l.qty) || 1)}</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>${category(rate)}</ram:CategoryCode>
          <ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>${a2(net)}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`;
  }).join('');

  const taxes = t.vat.map((v) => {
    const ex = exemption(v.rate);
    return `
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${a2(v.tva)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        ${ex ? `<ram:ExemptionReason>${x(ex.reason)}</ram:ExemptionReason>` : ''}
        <ram:BasisAmount>${a2(v.base)}</ram:BasisAmount>
        <ram:CategoryCode>${category(v.rate)}</ram:CategoryCode>
        ${ex && ex.code ? `<ram:ExemptionReasonCode>${ex.code}</ram:ExemptionReasonCode>` : ''}
        ${dueDateType && category(v.rate) === 'S' ? `<ram:DueDateTypeCode>${dueDateType}</ram:DueDateTypeCode>` : ''}
        <ram:RateApplicablePercent>${v.rate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>`;
  }).join('');

  const iban = String(S.iban || '').replace(/\s/g, '').toUpperCase();
  const bic = String(S.bic || '').replace(/\s/g, '').toUpperCase();
  const due = doc.dueDate && doc.dueDate >= doc.date ? doc.dueDate : doc.date;
  const termsText = due === doc.date ? 'Paiement à réception' : `Paiement au plus tard le ${fmtDate(due)}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${process}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${FACTURX.guideline}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${x(doc.number)}</ram:ID>
    <ram:TypeCode>${isCredit ? '381' : '380'}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d102(doc.date)}</udt:DateTimeString></ram:IssueDateTime>
    ${notes.map(([code, content]) => `<ram:IncludedNote><ram:Content>${x(content)}</ram:Content><ram:SubjectCode>${code}</ram:SubjectCode></ram:IncludedNote>`).join('\n    ')}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${x(S.name)}</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${x(sellerSiren)}</ram:ID>${S.name ? `<ram:TradingBusinessName>${x(S.name)}</ram:TradingBusinessName>` : ''}</ram:SpecifiedLegalOrganization>
        ${S.email || S.phone ? `<ram:DefinedTradeContact>${S.phone ? `<ram:TelephoneUniversalCommunication><ram:CompleteNumber>${x(S.phone)}</ram:CompleteNumber></ram:TelephoneUniversalCommunication>` : ''}${S.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${x(S.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : ''}</ram:DefinedTradeContact>` : ''}${address(S)}
        <ram:URIUniversalCommunication><ram:URIID schemeID="0225">${x(sellerSiren)}</ram:URIID></ram:URIUniversalCommunication>
        ${S.tvaIntra
          ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(String(S.tvaIntra).replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>`
          : `<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${x(sellerSiren)}</ram:ID></ram:SpecifiedTaxRegistration>`}
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${x(c.name)}</ram:Name>
        ${buyerSiren ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${x(buyerSiren)}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        ${c.contact || c.email ? `<ram:DefinedTradeContact>${c.contact ? `<ram:PersonName>${x(c.contact)}</ram:PersonName>` : ''}${c.email ? `<ram:EmailURIUniversalCommunication><ram:URIID>${x(c.email)}</ram:URIID></ram:EmailURIUniversalCommunication>` : ''}</ram:DefinedTradeContact>` : ''}${address(c)}
        ${buyerSiren ? `<ram:URIUniversalCommunication><ram:URIID schemeID="0225">${x(buyerSiren)}</ram:URIID></ram:URIUniversalCommunication>` : (c.email ? `<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${x(c.email)}</ram:URIID></ram:URIUniversalCommunication>` : '')}
        ${c.type === 'pro' && c.tvaIntra ? `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${x(String(c.tvaIntra).replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration>` : ''}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>${doc.deliveryAddress ? `
      <ram:ShipToTradeParty>
        <ram:Name>${x(c.name)}</ram:Name>
        <ram:PostalTradeAddress><ram:LineOne>${x(doc.deliveryAddress)}</ram:LineOne><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>
      </ram:ShipToTradeParty>` : ''}
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${d102(doc.deliveryDate || doc.date)}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:PaymentReference>${x(doc.number)}</ram:PaymentReference>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>${iban ? `
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>58</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
        ${bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${x(bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}
      </ram:SpecifiedTradeSettlementPaymentMeans>` : ''}${taxes}
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>${x(termsText)}</ram:Description>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${d102(due)}</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${a2(t.ht)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${a2(t.ht)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${a2(t.tva)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${a2(t.ttc)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${a2(t.ttc)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>${ref ? `
      <ram:InvoiceReferencedDocument>
        <ram:IssuerAssignedID>${x(ref.number)}</ram:IssuerAssignedID>
        <ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d102(ref.date)}</qdt:DateTimeString></ram:FormattedIssueDateTime>
      </ram:InvoiceReferencedDocument>` : ''}
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
  // Supprime les lignes vides laissées par les blocs optionnels
  return xml.split('\n').filter((l) => l.trim()).join('\n') + '\n';
}

/* =====================================================================
   PDF (PDF/A-3b, Factur-X pour les factures et avoirs validés)
   ===================================================================== */
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function dataUrlToBytes(url) { return b64ToBytes(String(url).split(',')[1] || ''); }
const xmlText = (s) => String(s ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));

function pdfReady() {
  return !!(window.PDFLib && window.fontkit && window.ARDOISE_ASSETS);
}

// Sans licence active (mode démonstration), pas de Factur-X : seulement un PDF filigrané.
const licensed = () => typeof isLicensed === 'function' && isLicensed();
const isFacturX = (doc) => doc.kind !== 'quote' && doc.status === 'issued' && licensed();

async function buildPdf(doc) {
  const { PDFDocument, rgb, degrees, PDFName, PDFString, PDFHexString } = window.PDFLib;
  const A = window.ARDOISE_ASSETS;
  const S = doc.sellerSnapshot || DB.settings;
  const c = docClient(doc);
  const t = docTotals(doc);
  const isQuote = doc.kind === 'quote';
  const isPro = c.type === 'pro';
  const fx = isFacturX(doc);
  const draftMark = doc.status === 'draft' && !isQuote;
  const demoMark = !licensed();

  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.registerFontkit(window.fontkit);
  const F = await pdf.embedFont(b64ToBytes(A.fontRegular), { subset: true });
  const B = await pdf.embedFont(b64ToBytes(A.fontBold), { subset: true });
  const charset = new Set(F.getCharacterSet());

  const C = {
    text: rgb(0.13, 0.13, 0.13), muted: rgb(0.42, 0.42, 0.45), line: rgb(0.86, 0.87, 0.89),
    head: rgb(0.945, 0.953, 0.965), accent: rgb(0.16, 0.38, 1), mark: rgb(0.99, 0.89, 0.89),
  };
  const W = 595.28, H = 841.89, M = 42, BOTTOM = 72;
  let page, y;

  const clean = (s) => Array.from(String(s ?? '')
    .replace(/[   \t]/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/\r/g, ''))
    .map((ch) => (ch === '\n' || charset.has(ch.codePointAt(0)) ? ch : '?')).join('');
  const width = (s, font, size) => font.widthOfTextAtSize(clean(s), size);
  const text = (s, x, yy, o = {}) => {
    const font = o.font || F, size = o.size || 9.5;
    const str = clean(s);
    const w = font.widthOfTextAtSize(str, size);
    const xx = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    page.drawText(str, { x: xx, y: yy, size, font, color: o.color || C.text });
    return w;
  };
  const wrap = (s, font, size, maxW) => {
    const out = [];
    for (const para of clean(s).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const cand = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(cand, size) <= maxW) { line = cand; continue; }
        if (line) out.push(line);
        line = word;
        while (font.widthOfTextAtSize(line, size) > maxW && line.length > 1) {
          let k = line.length - 1;
          while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > maxW) k--;
          out.push(line.slice(0, k));
          line = line.slice(k);
        }
      }
      out.push(line);
    }
    return out;
  };
  const hline = (x1, x2, yy, color = C.line, th = 0.6) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color });

  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
    if (demoMark) {
      page.drawText('DÉMONSTRATION', { x: 78, y: 236, size: 66, font: B, color: C.mark, rotate: degrees(32) });
    } else if (draftMark) {
      page.drawText('BROUILLON', { x: 120, y: 300, size: 92, font: B, color: C.mark, rotate: degrees(32) });
    }
  };
  newPage();

  /* ---- En-tête ---- */
  let leftY = y;
  if (DB.settings.logo) {
    try {
      const img = await pdf.embedPng(dataUrlToBytes(DB.settings.logo));
      const k = Math.min(150 / img.width, 56 / img.height, 1);
      page.drawImage(img, { x: M, y: leftY - img.height * k, width: img.width * k, height: img.height * k });
      leftY -= img.height * k + 10;
    } catch (e) { /* logo illisible : ignoré */ }
  }
  text(S.name || 'Nom de votre entreprise', M, leftY - 12, { font: B, size: 12.5 });
  leftY -= 27;
  const sellerLines = [S.address, [S.zip, S.city].filter(Boolean).join(' '), S.phone ? 'Tél. ' + S.phone : '', S.email, S.website].filter(Boolean);
  for (const l of sellerLines) { text(l, M, leftY, { size: 9 }); leftY -= 12; }

  const titleWord = { quote: 'DEVIS', invoice: 'FACTURE', credit: 'AVOIR' }[doc.kind];
  let rightY = y - 20;
  text(titleWord, W - M, rightY, { font: B, size: 22, align: 'right' });
  rightY -= 20;
  const metaRight = [
    ['N° ', doc.number || 'brouillon'],
    ['Date : ', fmtDate(doc.date)],
  ];
  if (doc.kind === 'invoice') metaRight.push(['Échéance : ', doc.dueDate && doc.dueDate !== doc.date ? fmtDate(doc.dueDate) : 'à réception']);
  if (isQuote) metaRight.push(["Valable jusqu'au : ", fmtDate(doc.dueDate)]);
  for (const [k, v] of metaRight) {
    const wv = width(v, B, 9.5);
    text(v, W - M, rightY, { font: B, size: 9.5, align: 'right' });
    text(k, W - M - wv, rightY, { size: 9.5, align: 'right', color: C.muted });
    rightY -= 13;
  }
  y = Math.min(leftY, rightY) - 14;

  /* ---- Bloc client ---- */
  const boxX = W / 2 + 10, boxW = W - M - boxX;
  const clientLines = [];
  if (c.contact) clientLines.push(c.contact);
  if (c.address) clientLines.push(...wrap(c.address, F, 9.5, boxW - 24));
  const cityLine = [c.zip, c.city].filter(Boolean).join(' ');
  if (cityLine) clientLines.push(cityLine);
  if (isPro && c.siren) clientLines.push('SIREN : ' + c.siren);
  if (isPro && c.tvaIntra) clientLines.push('TVA : ' + c.tvaIntra);
  const nameLines = wrap(c.name, B, 10.5, boxW - 24);
  const boxH = 26 + nameLines.length * 13 + clientLines.length * 12.5;
  page.drawRectangle({ x: boxX, y: y - boxH, width: boxW, height: boxH, borderColor: C.line, borderWidth: 0.8, color: rgb(1, 1, 1) });
  let by = y - 15;
  text(isQuote ? 'Devis pour' : doc.kind === 'credit' ? 'Avoir pour' : 'Facturé à', boxX + 12, by, { size: 7.5, color: C.muted });
  by -= 14;
  for (const l of nameLines) { text(l, boxX + 12, by, { font: B, size: 10.5 }); by -= 13; }
  for (const l of clientLines) { text(l, boxX + 12, by, { size: 9.5 }); by -= 12.5; }
  y -= boxH + 16;

  /* ---- Informations ---- */
  const ref = doc.invoiceRef ? docById(doc.invoiceRef) : null;
  const meta = [];
  if (ref) meta.push([`Avoir sur la facture n° ${ref.number} du ${fmtDate(ref.date)}`, B]);
  if (doc.subject) meta.push(['Objet : ' + doc.subject, F]);
  meta.push(['Opération : ' + (OPERATION_LABEL[doc.operation] || OPERATION_LABEL.biens), F]);
  if (doc.deliveryDate && doc.deliveryDate !== doc.date) meta.push(['Date de livraison / prestation : ' + fmtDate(doc.deliveryDate), F]);
  if (doc.deliveryAddress) meta.push(['Adresse de livraison : ' + doc.deliveryAddress, F]);
  for (const [m, font] of meta) for (const l of wrap(m, font, 9.5, W - 2 * M)) { text(l, M, y, { font, size: 9.5 }); y -= 13; }
  y -= 6;

  /* ---- Tableau des lignes ---- */
  const mode = doc.franchise ? '' : doc.priceMode === 'TTC' ? ' TTC' : ' HT';
  const cols = doc.franchise
    ? [['Désignation', 0], ['Qté', 46], ['Unité', 64], ['PU', 76], ['Total', 82]]
    : [['Désignation', 0], ['Qté', 42], ['Unité', 60], ['PU' + mode, 72], ['TVA', 44], ['Total' + mode, 78]];
  const fixed = cols.slice(1).reduce((s, col) => s + col[1], 0);
  cols[0][1] = W - 2 * M - fixed;
  const colX = []; { let cx = M; for (const col of cols) { colX.push(cx); cx += col[1]; } }
  const tableHeader = () => {
    page.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 18, color: C.head });
    cols.forEach((col, i) => {
      const right = i === 1 || i >= 3;
      text(col[0], right ? colX[i] + col[1] - 5 : colX[i] + 5, y - 12.5, { font: B, size: 8, align: right ? 'right' : 'left', color: rgb(0.25, 0.25, 0.28) });
    });
    y -= 18;
  };
  tableHeader();
  for (const l of doc.lines) {
    const dl = wrap(l.designation, F, 9, cols[0][1] - 10);
    const sub = [];
    if (l.description) sub.push(...wrap(l.description, F, 8, cols[0][1] - 10));
    if (num(l.discount)) sub.push(`Remise ${fmtNum(l.discount)} %`);
    const rowH = 9 + dl.length * 11.5 + sub.length * 10;
    if (y - rowH < BOTTOM) { newPage(); tableHeader(); }
    let ry = y - 13;
    for (const s of dl) { text(s, colX[0] + 5, ry, { size: 9 }); ry -= 11.5; }
    for (const s of sub) { text(s, colX[0] + 5, ry + 1, { size: 8, color: C.muted }); ry -= 10; }
    const vals = doc.franchise
      ? [fmtNum(l.qty), l.unit, money(l.price), money(lineTotal(l))]
      : [fmtNum(l.qty), l.unit, money(l.price), fmtRate(num(l.vatRate)), money(lineTotal(l))];
    vals.forEach((v, j) => {
      const i = j + 1;
      const right = i === 1 || i >= 3;
      text(v, right ? colX[i] + cols[i][1] - 5 : colX[i] + 5, y - 13, { size: 9, align: right ? 'right' : 'left' });
    });
    y -= rowH;
    hline(M, W - M, y);
  }
  y -= 14;

  /* ---- Totaux ---- */
  const paid = doc.kind === 'invoice' && doc.status === 'issued' ? paidAmount(doc) : 0;
  const totRows = [];
  if (!doc.franchise) { totRows.push(['Total HT', money(t.ht)]); totRows.push(['Total TVA', money(t.tva)]); }
  const vatRows = doc.franchise ? 0 : t.vat.length + 1;
  const blockH = Math.max(vatRows * 15 + 4, totRows.length * 15 + 26 + (paid > 0 ? 30 : 0));
  if (y - blockH < BOTTOM) newPage();
  const top = y;
  if (!doc.franchise) {
    const vx = [M, M + 62, M + 140];
    page.drawRectangle({ x: M, y: y - 15, width: 210, height: 15, color: C.head });
    text('Taux TVA', vx[0] + 5, y - 10.5, { font: B, size: 7.5 });
    text('Base HT', vx[1] + 70, y - 10.5, { font: B, size: 7.5, align: 'right' });
    text('Montant TVA', M + 205, y - 10.5, { font: B, size: 7.5, align: 'right' });
    let vy = y - 15;
    for (const v of t.vat) {
      text(fmtRate(v.rate), vx[0] + 5, vy - 11, { size: 8.5 });
      text(money(v.base), vx[1] + 70, vy - 11, { size: 8.5, align: 'right' });
      text(money(v.tva), M + 205, vy - 11, { size: 8.5, align: 'right' });
      vy -= 15;
      hline(M, M + 210, vy);
    }
  }
  const tx1 = W - M - 220, tx2 = W - M;
  let ty = top - 11;
  for (const [k, v] of totRows) { text(k, tx1, ty, { size: 9.5 }); text(v, tx2, ty, { size: 9.5, align: 'right' }); ty -= 15; }
  hline(tx1, tx2, ty + 6, C.text, 1.2);
  ty -= 10;
  const grandLabel = doc.franchise ? 'Net à payer' : doc.kind === 'credit' ? 'Total avoir TTC' : 'Total TTC';
  text(grandLabel, tx1, ty, { font: B, size: 12 });
  text(money(t.ttc), tx2, ty, { font: B, size: 12, align: 'right' });
  ty -= 16;
  if (paid > 0) {
    text('Déjà réglé', tx1, ty, { size: 9 }); text('- ' + money(paid), tx2, ty, { size: 9, align: 'right' }); ty -= 14;
    text('Reste à payer', tx1, ty, { font: B, size: 9.5 }); text(money(Math.max(0, remaining(doc))), tx2, ty, { font: B, size: 9.5, align: 'right' }); ty -= 14;
  }
  y = Math.min(top - vatRows * 15, ty) - 16;

  /* ---- Notes, paiement, signature, mentions ---- */
  const para = (s, o = {}) => {
    const font = o.font || F, size = o.size || 9.5, lh = size * 1.32;
    for (const l of wrap(s, font, size, W - 2 * M)) {
      if (y - lh < BOTTOM) newPage();
      text(l, M, y, { font, size, color: o.color });
      y -= lh;
    }
  };
  if (doc.notes) { para(doc.notes); y -= 6; }
  if (doc.kind === 'invoice') {
    if (S.paymentMethods) para('Moyens de paiement acceptés : ' + S.paymentMethods, { size: 9 });
    if (S.iban) para(`IBAN : ${S.iban}${S.bic ? '   BIC : ' + S.bic : ''}`, { size: 9, font: B });
    y -= 6;
  }
  if (isQuote) {
    if (y - 90 < BOTTOM) newPage();
    page.drawRectangle({ x: W - M - 230, y: y - 80, width: 230, height: 80, borderColor: C.line, borderWidth: 0.8 });
    text('Bon pour accord', W - M - 222, y - 13, { size: 8.5, color: C.muted });
    text('Date, signature et cachet :', W - M - 222, y - 25, { size: 8.5, color: C.muted });
    y -= 94;
  }
  const mentions = [];
  if (doc.franchise) mentions.push('TVA non applicable, art. 293 B du CGI.');
  if (doc.kind === 'invoice' && S.vatOnDebits && !doc.franchise) mentions.push("Option pour le paiement de la taxe d'après les débits.");
  if (doc.kind === 'invoice') {
    if (S.latePenalty) mentions.push(S.latePenalty);
    if (isPro) {
      mentions.push('Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €.');
      mentions.push("Pas d'escompte pour paiement anticipé.");
    }
  }
  if (isQuote) mentions.push(`Devis gratuit, valable jusqu'au ${fmtDate(doc.dueDate)}.`);
  if (mentions.length) {
    if (y - 20 < BOTTOM) newPage();
    hline(M, W - M, y + 4);
    y -= 8;
    for (const m of mentions) para(m, { size: 7.5, color: C.muted });
  }

  /* ---- Pied de page sur chaque page ---- */
  const legal = [
    S.name,
    S.legalForm ? S.legalForm + (S.capital ? ` au capital de ${S.capital} €` : '') : '',
    S.siret ? 'SIRET ' + S.siret : '',
    S.registre || '',
    S.tvaIntra && !doc.franchise ? 'TVA intracom. ' + S.tvaIntra : '',
  ].filter(Boolean).join(' · ');
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    let fy = 38;
    const footLines = wrap(legal + (S.footerNote ? '\n' + S.footerNote : ''), F, 7, W - 2 * M - 60);
    for (const l of footLines) { text(l, W / 2, fy, { size: 7, color: C.muted, align: 'center' }); fy -= 9; }
    if (pages.length > 1) text(`Page ${i + 1} / ${pages.length}`, W - M, 20, { size: 7, color: C.muted, align: 'right' });
    if (fx && i === 0) text('Facture électronique Factur-X (EN 16931)', M, 20, { size: 6.5, color: C.muted });
    if (demoMark) text(`Document créé avec la version de démonstration d'${APP.name} : non valable comme facture.`, M, 20, { size: 7, font: B, color: rgb(0.85, 0.2, 0.25) });
  });

  /* ---- Métadonnées, PDF/A-3 et pièce jointe Factur-X ---- */
  const now = new Date();
  now.setMilliseconds(0);
  const isoNow = now.toISOString().replace('.000Z', 'Z');
  const label = KIND_LABEL[doc.kind];
  const title = `${label} ${doc.number || 'brouillon'}`;
  const author = S.name || APP.name;
  const subject = `${label} ${doc.number || ''} - ${c.name}`.replace(/\s+/g, ' ').trim();
  const keywords = fx ? 'Factur-X, facture électronique' : label;
  const producer = `${APP.name} (pdf-lib)`;
  pdf.setTitle(title);
  pdf.setAuthor(author);
  pdf.setSubject(subject);
  pdf.setKeywords([keywords]);
  pdf.setCreator(APP.name);
  pdf.setProducer(producer);
  pdf.setCreationDate(now);
  pdf.setModificationDate(now);

  const ctx = pdf.context;
  const catalog = pdf.catalog;
  catalog.set(PDFName.of('Lang'), PDFString.of('fr-FR'));
  catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: false }));

  // Profil couleur (OutputIntent) exigé par PDF/A
  const icc = ctx.flateStream(b64ToBytes(A.srgbIcc), { N: 3 });
  const outputIntent = ctx.obj({
    Type: 'OutputIntent', S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: ctx.register(icc),
  });
  catalog.set(PDFName.of('OutputIntents'), ctx.obj([ctx.register(outputIntent)]));

  // Pièce jointe factur-x.xml
  if (fx) {
    const xmlBytes = new TextEncoder().encode(buildCII(doc));
    const ef = ctx.flateStream(xmlBytes, {
      Type: 'EmbeddedFile', Subtype: 'text/xml',
      Params: { ModDate: PDFString.fromDate(now), CreationDate: PDFString.fromDate(now), Size: xmlBytes.length },
    });
    const efRef = ctx.register(ef);
    const fileSpec = ctx.obj({
      Type: 'Filespec', F: PDFString.of(FACTURX.filename), UF: PDFHexString.fromText(FACTURX.filename),
      EF: { F: efRef, UF: efRef }, Desc: PDFString.of('Factur-X invoice'), AFRelationship: 'Data',
    });
    const fsRef = ctx.register(fileSpec);
    catalog.set(PDFName.of('AF'), ctx.obj([fsRef]));
    catalog.set(PDFName.of('Names'), ctx.obj({ EmbeddedFiles: { Names: [PDFString.of(FACTURX.filename), fsRef] } }));
    catalog.set(PDFName.of('PageMode'), PDFName.of('UseAttachments'));
  }

  // Métadonnées XMP (PDF/A-3B + schéma d'extension Factur-X)
  const fxNs = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#';
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${xmlText(author)}</rdf:li></rdf:Seq></dc:creator>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xmlText(subject)}</rdf:li></rdf:Alt></dc:description>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${xmlText(producer)}</pdf:Producer>
   <pdf:Keywords>${xmlText(keywords)}</pdf:Keywords>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>${xmlText(APP.name)}</xmp:CreatorTool>
   <xmp:CreateDate>${isoNow}</xmp:CreateDate>
   <xmp:ModifyDate>${isoNow}</xmp:ModifyDate>
   <xmp:MetadataDate>${isoNow}</xmp:MetadataDate>
  </rdf:Description>${fx ? `
  <rdf:Description rdf:about="" xmlns:fx="${fxNs}">
   <fx:DocumentType>INVOICE</fx:DocumentType>
   <fx:DocumentFileName>${FACTURX.filename}</fx:DocumentFileName>
   <fx:Version>1.0</fx:Version>
   <fx:ConformanceLevel>${FACTURX.conformance}</fx:ConformanceLevel>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas>
    <rdf:Bag>
     <rdf:li rdf:parseType="Resource">
      <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
      <pdfaSchema:namespaceURI>${fxNs}</pdfaSchema:namespaceURI>
      <pdfaSchema:prefix>fx</pdfaSchema:prefix>
      <pdfaSchema:property>
       <rdf:Seq>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The type of the hybrid document in capital letters, e.g. INVOICE or ORDER</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the standard applying to the embedded XML document</pdfaProperty:description></rdf:li>
        <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded XML document</pdfaProperty:description></rdf:li>
       </rdf:Seq>
      </pdfaSchema:property>
     </rdf:li>
    </rdf:Bag>
   </pdfaExtension:schemas>
  </rdf:Description>` : ''}
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const xmpStream = ctx.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' });
  catalog.set(PDFName.of('Metadata'), ctx.register(xmpStream));

  // Identifiant de fichier (obligatoire en PDF/A)
  const idSeed = `${doc.id}-${doc.number}-${isoNow}`;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < idSeed.length; i++) { h1 = Math.imul(h1 ^ idSeed.charCodeAt(i), 16777619) >>> 0; h2 = Math.imul(h2 + idSeed.charCodeAt(i), 2654435761) >>> 0; }
  const hex = [h1, h2, (h1 ^ h2) >>> 0, (h1 + h2) >>> 0].map((n) => n.toString(16).padStart(8, '0')).join('').toUpperCase();
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);

  return pdf.save({ useObjectStreams: false });
}

function pdfFilename(doc, ext = 'pdf') {
  const c = docClient(doc);
  const base = `${KIND_LABEL[doc.kind]}_${doc.number || 'brouillon'}_${c.name}`;
  return base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 90) + '.' + ext;
}

async function downloadPdf(doc) {
  if (!pdfReady()) { toast('Module PDF indisponible : fichiers js/vendor manquants. Utilisez « Imprimer ».', 'error'); return false; }
  try {
    const bytes = await buildPdf(doc);
    download(pdfFilename(doc), new Blob([bytes], { type: 'application/pdf' }));
    toast(isFacturX(doc) ? 'PDF Factur-X téléchargé' : 'PDF téléchargé');
    return true;
  } catch (e) {
    console.error(e);
    toast('Erreur lors de la création du PDF : ' + e.message, 'error');
    return false;
  }
}

function downloadXml(doc) {
  if (!isFacturX(doc)) { toast('Activez votre licence (Mon entreprise) pour obtenir le XML Factur-X.', 'error'); return; }
  download(pdfFilename(doc, 'xml').replace(/\.xml$/, '_factur-x.xml'), buildCII(doc), 'application/xml');
  toast('XML Factur-X téléchargé');
}
