/**
 * BRAVE BREW - Order Function
 * Endpoint: /.netlify/functions/order
 *
 * Flow:
 *   1. Přijme JSON objednávku z formuláře
 *   2. Odešle admin notifikaci emailem (Resend API)
 *   3. Pokud jsou nastaveny Comgate credentials → vytvoří platbu a vrátí paymentUrl
 *   4. Pokud Comgate není nastaven → vrátí success + odešle platební instrukce emailem
 *
 * Env vars (Netlify dashboard → Site settings → Environment variables):
 *   RESEND_API_KEY        from resend.com (free tier 3000 emails/month)
 *   BANK_ACCOUNT          e.g. 1234567890/0800
 *   COMGATE_MERCHANT      Comgate merchant ID (po schválení od Comgate)
 *   COMGATE_SECRET        Comgate secret key
 *   COMGATE_TEST          "true" pro testovací prostředí
 *   FAKTUROID_SLUG        slug z fakturoid.cz
 *   FAKTUROID_EMAIL       adaklasek@gmail.com
 *   FAKTUROID_TOKEN       API token z fakturoid.cz
 */

const https = require('https');
const querystring = require('querystring');

// ─── Config ──────────────────────────────────────────────────────────────────
const PRICES = { etiopie: 340, costarica: 320, oba: 660 };
const NAMES  = {
  etiopie:   'Ethiopia Single Origin 250g',
  costarica: 'Costa Rica Single Origin 250g',
  oba:       'Bundle: Ethiopia + Costa Rica (2x 250g)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseBody(event) {
  const ct = event.headers['content-type'] || '';
  if (ct.includes('application/json')) {
    return JSON.parse(event.body || '{}');
  }
  return querystring.parse(event.body || '');
}

function calcOrder(d) {
  const kava      = d.kava || '';
  const isBundle  = kava === 'oba';
  const pocet     = isBundle ? 1 : (parseInt(d.pocet) || 1);
  const doprava   = d.doprava || 'zasilkovna';
  const price     = PRICES[kava] || 0;
  const subtotal  = price * pocet;
  const freeShip  = pocet >= 2 || isBundle;
  const shipCost  = freeShip ? 0 : (doprava === 'zasilkovna' ? 60 : 89);
  const total     = subtotal + shipCost;
  const donated   = isBundle ? 200 : pocet * 100;
  // VS format: YYMMDDXXXX - datum + 4 nahodne cislice (unikatni, datove dohledatelne)
  const now = new Date();
  const vs = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(Math.floor(1000 + Math.random()*9000))}`;
  return {
    jmeno:    d.jmeno || '',
    email:    d.email || '',
    telefon:  d.telefon || '',
    kava, pocet, doprava,
    vydejna:  d.vydejna  || '',
    adresa:   d.adresa   || '',
    poznamka: d.poznamka || '',
    nazev:    NAMES[kava] || kava,
    price, subtotal, shipCost, total, donated, vs,
    date: new Date().toLocaleDateString('cs-CZ'),
    time: new Date().toLocaleTimeString('cs-CZ'),
  };
}

// ─── Email (Resend) ───────────────────────────────────────────────────────────
function httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const req = https.request({ hostname, path, method: 'POST', headers: {
      ...headers, 'Content-Length': Buffer.byteLength(payload),
    }}, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.warn('RESEND_API_KEY not set'); return; }
  return httpPost('api.resend.com', '/emails',
    { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    { from: 'BRAVE BREW <hello@coffeeforua.cz>', to, subject, html }
  );
}

function customerHtml(o) {
  const bank = process.env.BANK_ACCOUNT || '276477600/0300';
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
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
  <tr style="background:#f5f5f5"><td style="padding:8px 12px">Produkt</td><td style="padding:8px 12px"><strong>${o.nazev}</strong></td></tr>
  <tr><td style="padding:8px 12px">Počet</td><td style="padding:8px 12px">${o.pocet}x</td></tr>
  <tr style="background:#f5f5f5"><td style="padding:8px 12px">Doprava</td><td style="padding:8px 12px">${o.doprava === 'zasilkovna' ? 'Zásilkovna - výdejní místo' : 'Zásilkovna - kurýr'}${o.vydejna ? ` (${o.vydejna})` : ''} ${o.shipCost === 0 ? '· zdarma' : `· ${o.shipCost} Kč`}</td></tr>
  <tr><td style="padding:8px 12px"><strong>Celkem</strong></td><td style="padding:8px 12px"><strong>${o.total} Kč</strong></td></tr>
  <tr style="background:#005BBB;color:#fff"><td style="padding:8px 12px">Z toho na Koridor.ua</td><td style="padding:8px 12px"><strong>${o.donated} Kč</strong></td></tr>
</table>
<p style="font-size:14px">Jakmile platba dorazí, pražíme a odesíláme. Zásilkovna 1-3 pracovní dny.</p>
<p style="font-size:14px">Adam · BRAVE BREW · adaklasek@gmail.com</p>
<hr style="border:none;border-top:1px solid #eee;margin:20px 0">
<p style="font-size:12px;color:#999">VS: ${o.vs} · ${o.date} ${o.time}</p>
</body></html>`;
}

function adminHtml(o) {
  return `<pre style="font-family:monospace;font-size:14px;line-height:1.8">
NOVA OBJEDNAVKA - ${o.total} Kc

Jmeno:    ${o.jmeno}
Email:    ${o.email}
Telefon:  ${o.telefon}
Produkt:  ${o.nazev} x${o.pocet}
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
  if (!merchant || !secret) return null; // Comgate není nastaven

  const isTest = process.env.COMGATE_TEST === 'true';
  const params = querystring.stringify({
    merchant,
    secret,
    price:       o.total * 100, // Comgate používá haléře (100 hal = 1 Kč)
    curr:        'CZK',
    label:       o.nazev.substring(0, 16),
    refId:       o.vs,
    method:      'ALL',
    email:       o.email,
    name:        o.jmeno,
    prepareOnly: 'true',
    test:        isTest ? 'true' : 'false',
    returnUrl:   'https://coffeeforua.cz/dekujeme.html',
    cancelUrl:   'https://coffeeforua.cz/objednat',
    notifUrl:    'https://coffeeforua.cz/.netlify/functions/comgate-webhook',
  });

  const result = await httpPost(
    'payments.comgate.cz',
    '/v1.0/create',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    params
  );

  if (result.status === 200) {
    const parsed = querystring.parse(result.body);
    if (parsed.code === '0' && parsed.redirect) {
      return parsed.redirect;
    }
  }
  console.error('Comgate error:', result);
  return null;
}

// ─── Fakturoid ────────────────────────────────────────────────────────────────
async function createInvoice(o) {
  const slug  = process.env.FAKTUROID_SLUG;
  const email = process.env.FAKTUROID_EMAIL;
  const token = process.env.FAKTUROID_TOKEN;
  if (!slug || !token) return;

  const lines = [{ name: `${o.nazev} x${o.pocet}`, quantity: o.pocet, unit_price: o.price, vat_rate: 0 }];
  if (o.shipCost > 0) lines.push({ name: 'Doprava Zásilkovna', quantity: 1, unit_price: o.shipCost, vat_rate: 0 });

  const auth    = Buffer.from(`${email}:${token}`).toString('base64');
  const payload = JSON.stringify({ custom_id: `BB-${o.vs}`, due: 7, issued_on: new Date().toISOString().split('T')[0], lines, note: `${o.jmeno} <${o.email}>` });

  return httpPost('app.fakturoid.cz', `/api/v2/accounts/${slug}/invoices.json`,
    { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json', 'User-Agent': 'BRAVE BREW (adaklasek@gmail.com)' },
    payload
  );
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

  if (!o.email || !o.kava) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing fields' }) };
  }

  console.log(`Order: ${o.jmeno} - ${o.nazev} x${o.pocet} - ${o.total} Kc`);

  // Paralelně: admin email + faktura
  await Promise.allSettled([
    sendEmail('adaklasek@gmail.com', `Nova objednavka: ${o.jmeno} - ${o.total} Kc`, adminHtml(o)),
    createInvoice(o),
  ]);

  // Pokusit se o Comgate platbu
  const paymentUrl = await createComgatePayment(o);

  if (paymentUrl) {
    // Comgate funguje - přesměrovat na platební bránu
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, paymentUrl }) };
  }

  // Comgate není nastaven - fallback: platba převodem + email zákazníkovi
  await sendEmail(o.email, `Objednávka přijata - BRAVE BREW (${o.total} Kč)`, customerHtml(o));
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, paymentUrl: null }) };
};
