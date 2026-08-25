/**
 * BRAVE BREW - Order Function
 * Endpoint: /.netlify/functions/order
 *
 * Flow:
 *   1. Přijme JSON objednávku z formuláře (qty_etiopie, qty_costarica, qty_oba)
 *   2. Přepočítá total server-side (klient nemůže podvrhnout cenu)
 *   3. Odešle admin notifikaci emailem (Resend API)
 *   4. Vytvoří fakturu ve Fakturoid (pokud jsou credentials)
 *   5. Pokud jsou Comgate credentials → vytvoří platbu a vrátí paymentUrl
 *   6. Fallback → odešle platební instrukce zákazníkovi emailem
 *
 * Env vars (Netlify dashboard → Site settings → Environment variables):
 *   RESEND_API_KEY        from resend.com
 *   BANK_ACCOUNT          e.g. 276477600/0300
 *   COMGATE_MERCHANT      Comgate merchant ID
 *   COMGATE_SECRET        Comgate secret key
 *   COMGATE_TEST          "true" pro testovací prostředí
 *   FAKTUROID_SLUG        slug z fakturoid.cz
 *   FAKTUROID_EMAIL       adaklasek@gmail.com
 *   FAKTUROID_TOKEN       API token z fakturoid.cz
 */

const https = require('https');
const querystring = require('querystring');
const QRCode = require('qrcode');

// ─── Config ──────────────────────────────────────────────────────────────────
const PRICES = { etiopie: 340, costarica: 320, oba: 660 };
const NAMES  = {
  etiopie:   'Ethiopia Single Origin 250g',
  costarica: 'Costa Rica Single Origin 250g',
  oba:       'Bundle: Ethiopia + Costa Rica (2x 250g)',
};
const NAMES_SHORT = { etiopie: 'Ethiopia', costarica: 'Costa Rica', oba: 'Bundle' };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseBody(event) {
  const ct = event.headers['content-type'] || '';
  if (ct.includes('application/json')) return JSON.parse(event.body || '{}');
  return querystring.parse(event.body || '');
}

function calcOrder(d) {
  const qty = {
    etiopie:   Math.max(0, parseInt(d.qty_etiopie)   || 0),
    costarica: Math.max(0, parseInt(d.qty_costarica) || 0),
    oba:       Math.max(0, parseInt(d.qty_oba)        || 0),
  };

  const items = Object.entries(qty)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ kava: k, pocet: v, price: PRICES[k], name: NAMES[k] }));

  if (!items.length) throw new Error('Empty cart');

  const subtotal  = items.reduce((s, i) => s + i.price * i.pocet, 0);
  const totalBags = qty.etiopie + qty.costarica + qty.oba * 2;
  const freeShip  = totalBags >= 2;
  const doprava   = d.doprava || 'zasilkovna';
  const shipCost  = freeShip ? 0 : (doprava === 'zasilkovna' ? 60 : 89);
  const total     = subtotal + shipCost;
  const donated   = (qty.etiopie + qty.costarica) * 100 + qty.oba * 200;

  const now = new Date();
  const vs  = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(Math.floor(1000 + Math.random()*9000))}`;

  const nazevLines = items.map(i => `${NAMES_SHORT[i.kava]} ${i.pocet}×`);
  const nazev      = nazevLines.join(' + ');

  return {
    jmeno:    d.jmeno    || '',
    email:    d.email    || '',
    telefon:  d.telefon  || '',
    doprava,
    vydejna:  d.vydejna  || '',
    adresa:   d.adresa   || '',
    poznamka: d.poznamka || '',
    platba:   d.platba === 'prevod' ? 'prevod' : 'karta',
    items, qty, subtotal, shipCost, total, donated, vs, nazev,
    date: now.toLocaleDateString('cs-CZ'),
    time: now.toLocaleTimeString('cs-CZ'),
  };
}

// ─── IBAN + QR platba ────────────────────────────────────────────────────────
function bankToIBAN(account) {
  // "276477600/0300" → "CZ02030000000276477600"
  const [num, bank] = account.split('/');
  const bban = bank + '000000' + num.padStart(10, '0');
  const rearranged = bban + 'CZ00';
  const numeric = rearranged.replace(/[A-Z]/g, c => (c.charCodeAt(0) - 55).toString());
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + parseInt(d)) % 97;
  return 'CZ' + String(98 - rem).padStart(2, '0') + bban;
}

async function generatePaymentQR(iban, amount, vs) {
  const spd = [
    'SPD*1.0',
    `ACC:${iban}`,
    `AM:${amount}.00`,
    'CC:CZK',
    `X-VS:${vs}`,
    'MSG:BRAVE BREW',
  ].join('*');
  return QRCode.toDataURL(spd, { errorCorrectionLevel: 'M', width: 220, margin: 1 });
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────
function httpRequest(method, hostname, path, headers, body, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const reqHeaders = payload
      ? { ...headers, 'Content-Length': Buffer.byteLength(payload) }
      : headers;
    const req = https.request({ hostname, path, method, headers: reqHeaders }, res => {
      // 303 = See Other → follow as GET without body
      if (res.statusCode === 303 && res.headers.location && redirectCount < 3) {
        const url = new URL(res.headers.location);
        resolve(httpRequest('GET', url.hostname, url.pathname + url.search, {}, null, redirectCount + 1));
        return;
      }
      // Other redirects → repeat same method
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectCount < 3) {
        const url = new URL(res.headers.location);
        resolve(httpRequest(method, url.hostname, url.pathname + url.search, headers, body, redirectCount + 1));
        return;
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function httpPost(hostname, path, headers, body) {
  return httpRequest('POST', hostname, path, headers, body);
}

// ─── Email (Resend) ───────────────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('RESEND_API_KEY not set'); return; }
  return httpPost('api.resend.com', '/emails',
    { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    { from: 'BRAVE BREW <hello@coffeeforua.cz>', to, subject, html }
  );
}

function itemsTableRows(items) {
  return items.map(i =>
    `<tr style="background:#f5f5f5"><td style="padding:8px 12px">${i.name}</td><td style="padding:8px 12px;text-align:right">${i.pocet}× = ${i.price * i.pocet} Kč</td></tr>`
  ).join('');
}

function customerHtml(o, qrDataUrl) {
  const bank = process.env.BANK_ACCOUNT || '276477600/0300';
  const qrBlock = qrDataUrl ? `
<div style="text-align:center;margin:20px 0">
  <p style="font-size:13px;color:#444;margin-bottom:8px">Nebo zaplaťte QR kódem - naskenujte mobilní bankou:</p>
  <img src="${qrDataUrl}" width="180" height="180" alt="QR platba" style="border:1px solid #eee;border-radius:4px">
  <p style="font-size:11px;color:#999;margin-top:6px">Částka, účet i VS jsou předvyplněny</p>
</div>` : '';
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf8">
<div style="border-top:4px solid #0D0D0D;padding-top:20px;margin-bottom:20px">
  <h1 style="font-size:22px;margin:0 0 4px">Objednávka přijata ✓</h1>
  <p style="color:#666;margin:0;font-size:14px">BRAVE BREW · coffeeforua.cz</p>
</div>
<p>Ahoj ${o.jmeno},</p>
<p>máme to. Tady jsou platební instrukce:</p>
<div style="background:#fff;border:2px solid #FFD500;padding:16px 20px;margin:20px 0;border-radius:4px">
  <strong>Bankovní převod</strong><br><br>
  Číslo účtu: <strong>${bank}</strong><br>
  Variabilní symbol: <strong>${o.vs}</strong><br>
  Částka: <strong style="font-size:18px">${o.total} Kč</strong>
</div>
${qrBlock}
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
  ${itemsTableRows(o.items)}
  <tr><td style="padding:8px 12px">Doprava</td><td style="padding:8px 12px;text-align:right">${o.doprava === 'zasilkovna' ? 'Zásilkovna - výdejní místo' : 'Zásilkovna - kurýr'}${o.vydejna ? ` (${o.vydejna})` : ''} ${o.shipCost === 0 ? '· zdarma' : `· ${o.shipCost} Kč`}</td></tr>
  <tr style="background:#0D0D0D;color:#fff"><td style="padding:8px 12px"><strong>Celkem</strong></td><td style="padding:8px 12px;text-align:right"><strong>${o.total} Kč</strong></td></tr>
  <tr style="background:#005BBB;color:#fff"><td style="padding:8px 12px">Z toho na Koridor.ua</td><td style="padding:8px 12px;text-align:right"><strong>${o.donated} Kč</strong></td></tr>
</table>
<p style="font-size:14px">Jakmile platba dorazí, pražíme a odesíláme. Zásilkovna 1-3 pracovní dny.</p>
<p style="font-size:14px">Adam · BRAVE BREW · info@coffeeforua.cz</p>
<hr style="border:none;border-top:1px solid #eee;margin:20px 0">
<p style="font-size:12px;color:#999">VS: ${o.vs} · ${o.date} ${o.time}</p>
</body></html>`;
}

function adminHtml(o) {
  const itemLines = o.items.map(i => `  ${i.name}: ${i.pocet}× = ${i.price * i.pocet} Kc`).join('\n');
  return `<pre style="font-family:monospace;font-size:14px;line-height:1.8">
NOVA OBJEDNAVKA - ${o.total} Kc

Jmeno:    ${o.jmeno}
Email:    ${o.email}
Telefon:  ${o.telefon}

Polozky:
${itemLines}
Doprava:  ${o.doprava}${o.vydejna ? ` (${o.vydejna})` : ''}${o.adresa ? `\nAdresa:   ${o.adresa}` : ''}
Celkem:   ${o.total} Kc  (donace: ${o.donated} Kc)
VS:       ${o.vs}
Datum:    ${o.date} ${o.time}
${o.poznamka ? `\nPoznamka: ${o.poznamka}` : ''}
</pre><p>Platebni instrukce odeslany zakaznikovi automaticky.</p>`;
}

// ─── Comgate ─────────────────────────────────────────────────────────────────
async function createComgatePayment(o) {
  const merchant = process.env.COMGATE_MERCHANT;
  const secret   = process.env.COMGATE_SECRET;
  if (!merchant || !secret) return null;

  const isTest = process.env.COMGATE_TEST === 'true';
  const params = querystring.stringify({
    merchant, secret,
    price:     o.total * 100,
    curr:      'CZK',
    label:     o.nazev.substring(0, 16),
    refId:     o.vs,
    method:    'ALL',
    email:     o.email,
    name:      o.jmeno,
    test:      isTest ? 'true' : 'false',
    returnUrl: 'https://coffeeforua.cz/dekujeme.html',
    cancelUrl: 'https://coffeeforua.cz/#objednat',
    notifUrl:  'https://coffeeforua.cz/.netlify/functions/comgate-webhook',
  });

  const result = await httpPost(
    'payments.comgate.cz', '/v1.0/create',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    params
  );

  const parsed = result.status === 200 ? querystring.parse(result.body) : {};
  console.log('Comgate response:', result.status, result.body);
  if (parsed.code === '0' && parsed.transId) {
    return parsed.redirect || `https://payments.comgate.cz/client/instructions/index?id=${parsed.transId}`;
  }
  console.error('Comgate error code:', parsed.code, 'message:', parsed.message);
  return { error: true, code: parsed.code, message: parsed.message, httpStatus: result.status };
}

// ─── Fakturoid ────────────────────────────────────────────────────────────────
async function createInvoice(o) {
  const slug  = process.env.FAKTUROID_SLUG;
  const email = process.env.FAKTUROID_EMAIL;
  const token = process.env.FAKTUROID_TOKEN;
  if (!slug || !token) return;

  const lines = o.items.map(i => ({
    name: i.name, quantity: i.pocet, unit_price: i.price, vat_rate: 0,
  }));
  if (o.shipCost > 0) lines.push({ name: 'Doprava Zásilkovna', quantity: 1, unit_price: o.shipCost, vat_rate: 0 });

  const auth    = Buffer.from(`${email}:${token}`).toString('base64');
  const payload = JSON.stringify({
    custom_id: `BB-${o.vs}`,
    due: 7,
    issued_on: new Date().toISOString().split('T')[0],
    lines,
    note: `${o.jmeno} <${o.email}>`,
  });

  return httpPost('app.fakturoid.cz', `/api/v2/accounts/${slug}/invoices.json`,
    { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'User-Agent': 'BRAVE BREW (adaklasek@gmail.com)' },
    payload
  );
}

// ─── Google Sheets logging (via Apps Script web app) ─────────────────────────
// Setup: viz instrukce v README nebo v odpovědi od Clauda.
// Env var: GSHEET_WEBHOOK = URL vašeho deploynutého Apps Script web app
async function logToSheet(o) {
  const webhookUrl = process.env.GSHEET_WEBHOOK;
  if (!webhookUrl) return;
  try {
    const url = new URL(webhookUrl);
    const payload = JSON.stringify({
      datum:    o.date + ' ' + o.time,
      jmeno:    o.jmeno,
      email:    o.email,
      telefon:  o.telefon,
      produkty: o.items.map(i => `${NAMES_SHORT[i.kava]} ${i.pocet}x`).join(' + '),
      celkem:   o.total,
      platba:   o.platba,
      doruceni: o.doprava + (o.vydejna ? ` - ${o.vydejna}` : '') + (o.adresa ? ` - ${o.adresa}` : ''),
      vs:       o.vs,
      poznamka: o.poznamka,
    });
    await httpPost(url.hostname, url.pathname + url.search,
      { 'Content-Type': 'application/json' },
      payload
    );
  } catch (err) {
    console.warn('Sheet log failed:', err.message);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://coffeeforua.cz',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod === 'GET')     return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let o;
  try { o = calcOrder(parseBody(event)); } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad Request' }) };
  }

  if (!o.email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
  }

  console.log(`Order: ${o.jmeno} - ${o.nazev} - ${o.total} Kc`);

  // Generovat QR kód pro platbu
  const bank = process.env.BANK_ACCOUNT || '276477600/0300';
  let qrDataUrl = null;
  try {
    const iban = bankToIBAN(bank);
    qrDataUrl = await generatePaymentQR(iban, o.total, o.vs);
  } catch (err) {
    console.warn('QR generation failed:', err.message);
  }

  await Promise.allSettled([
    sendEmail('adaklasek@gmail.com', `Nova objednavka: ${o.jmeno} - ${o.total} Kc`, adminHtml(o)),
    createInvoice(o),
    logToSheet(o),
  ]);

  // Comgate pouze pokud zákazník zvolil kartu
  let paymentUrl = null;
  let comgateError = null;
  if (o.platba === 'karta') {
    const hasCreds = !!(process.env.COMGATE_MERCHANT && process.env.COMGATE_SECRET);
    if (!hasCreds) {
      comgateError = 'missing_credentials';
    } else {
      const cgResult = await createComgatePayment(o);
      if (typeof cgResult === 'string') {
        paymentUrl = cgResult;
      } else if (cgResult?.error) {
        comgateError = `api_error: code=${cgResult.code} msg=${cgResult.message} http=${cgResult.httpStatus}`;
      } else {
        comgateError = 'api_error';
      }
    }
  }

  if (paymentUrl) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, paymentUrl }) };
  }

  if (o.platba === 'karta' && comgateError) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'payment_gateway_error', detail: comgateError, merchant: process.env.COMGATE_MERCHANT?.slice(0,3) + '***' }) };
  }

  // Bankovní převod - odeslat email s instrukcemi a QR kódem
  await sendEmail(o.email, `Objednávka přijata - BRAVE BREW (${o.total} Kč)`, customerHtml(o, qrDataUrl));
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, paymentUrl: null, qrDataUrl, vs: o.vs, total: o.total }) };
};
