/**
 * BRAVE BREW - Order Webhook Function
 * Endpoint: coffeeforua.cz/.netlify/functions/order
 *
 * Triggered by Formspree webhook on every new order.
 * Sends:
 *   1. Customer email with payment instructions
 *   2. Admin notification to Adam
 *
 * Required env vars (set in Netlify dashboard -> Site settings -> Env variables):
 *   GMAIL_USER          adaklasek@gmail.com
 *   GMAIL_APP_PASSWORD  Google App Password (not your regular password)
 *   FAKTUROID_SLUG      your-account-slug from fakturoid.cz
 *   FAKTUROID_EMAIL     adaklasek@gmail.com
 *   FAKTUROID_TOKEN     API token from fakturoid.cz settings
 *   BANK_ACCOUNT        e.g. 1234567890/0800
 */

const https = require('https');

// ─── Config ──────────────────────────────────────────────────────────────────
const PRICES = { etiopie: 340, costarica: 320, oba: 660 };
const NAMES  = {
  etiopie:   'Ethiopia Single Origin 250g',
  costarica: 'Costa Rica Single Origin 250g',
  oba:       'Ethiopia + Costa Rica Bundle 2x250g',
};
const SHIPPING = { zasilkovna: 60, kuryr: 89 };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseOrder(body) {
  const d       = typeof body === 'string' ? JSON.parse(body) : body;
  const kava    = d.kava    || '';
  const pocet   = parseInt(d.pocet) || 1;
  const doprava = d.doprava || 'zasilkovna';

  const pricePerBag = PRICES[kava] || 0;
  const freeShipping = pocet >= 2 || kava === 'oba';
  const shippingCost = freeShipping ? 0 : (SHIPPING[doprava] || 60);
  const total       = pricePerBag * pocet + shippingCost;
  const donated     = 100 * (kava === 'oba' ? 2 : pocet);

  return {
    jmeno:    d.jmeno    || d.name || '',
    email:    d.email    || '',
    telefon:  d.telefon  || '',
    kava,
    pocet,
    doprava,
    vydejna:  d.vydejna  || '',
    adresa:   d.adresa   || '',
    poznamka: d.poznamka || '',
    nazev:    NAMES[kava] || kava,
    pricePerBag,
    shippingCost,
    total,
    donated,
    vs: Date.now().toString().slice(-8),      // variabilní symbol
    date: new Date().toLocaleDateString('cs-CZ'),
    time: new Date().toLocaleTimeString('cs-CZ'),
  };
}

// ─── Email via Gmail SMTP (using nodemailer-style raw HTTPS to smtp2go or similar)
// Simple approach: use Formspree's own email OR call Gmail API
// For simplicity we use the Resend API (free 3000 emails/month, no SMTP config needed)
// Set env var RESEND_API_KEY from resend.com (free tier)
async function sendEmail({ to, subject, html, from = 'BRAVE BREW <hello@coffeeforua.cz>' }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set - email skipped');
    return { skipped: true };
  }

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ from, to, subject, html });
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Customer email ───────────────────────────────────────────────────────────
function customerEmailHtml(o) {
  const bankAccount = process.env.BANK_ACCOUNT || '[DOPLNIT UCET]';
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf8;color:#0d0d0d">
<div style="border-top:4px solid #0D0D0D;padding-top:20px;margin-bottom:20px">
  <h1 style="font-size:22px;margin:0 0 4px">Objednávka přijata ✓</h1>
  <p style="color:#666;margin:0;font-size:14px">BRAVE BREW · coffeeforua.cz</p>
</div>

<p>Ahoj ${o.jmeno},</p>
<p>máme to. Tady jsou platební instrukce:</p>

<div style="background:#fff;border:2px solid #FFD500;padding:16px 20px;margin:20px 0;border-radius:4px">
  <strong style="font-size:16px">Bankovní převod</strong><br><br>
  Číslo účtu: <strong>${bankAccount}</strong><br>
  Variabilní symbol: <strong>${o.vs}</strong><br>
  Částka: <strong style="font-size:18px">${o.total} Kč</strong>
</div>

<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
  <tr style="background:#f5f5f5"><td style="padding:8px 12px">Produkt</td><td style="padding:8px 12px"><strong>${o.nazev}</strong></td></tr>
  <tr><td style="padding:8px 12px">Počet</td><td style="padding:8px 12px">${o.pocet}x</td></tr>
  <tr style="background:#f5f5f5"><td style="padding:8px 12px">Doprava</td><td style="padding:8px 12px">${o.doprava === 'zasilkovna' ? 'Zásilkovna - výdejní místo' : 'Zásilkovna - kurýr'}${o.vydejna ? ` (${o.vydejna})` : ''} ${o.shippingCost === 0 ? '- ZDARMA' : `- ${o.shippingCost} Kč`}</td></tr>
  <tr><td style="padding:8px 12px"><strong>Celkem</strong></td><td style="padding:8px 12px"><strong>${o.total} Kč</strong></td></tr>
  <tr style="background:#005BBB;color:#fff"><td style="padding:8px 12px">Z toho na Ukrajinu</td><td style="padding:8px 12px"><strong>${o.donated} Kč</strong> → Koridor.ua</td></tr>
</table>

<p style="font-size:14px">Jakmile přijde platba, pražíme a posíláme. Zásilkovna 1-3 pracovní dny.</p>
<p style="font-size:14px">Díky za objednávku a za to, že pomáháš.</p>
<p style="font-size:14px">Adam<br><span style="color:#666">BRAVE BREW · adaklasek@gmail.com</span></p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0">
<p style="font-size:12px;color:#999">Objednávka přijata ${o.date} v ${o.time} · VS: ${o.vs}</p>
</body></html>`;
}

// ─── Admin notification email ─────────────────────────────────────────────────
function adminEmailHtml(o) {
  return `<!DOCTYPE html>
<html><body style="font-family:monospace;max-width:500px;margin:0 auto;padding:16px">
<h2 style="margin:0 0 16px">NOVA OBJEDNAVKA - ${o.total} Kc</h2>
<pre style="background:#f5f5f5;padding:16px;line-height:1.8">
Jmeno:    ${o.jmeno}
Email:    ${o.email}
Telefon:  ${o.telefon}

Produkt:  ${o.nazev}
Mnozstvi: ${o.pocet}x
Doprava:  ${o.doprava}${o.vydejna ? ` (${o.vydejna})` : ''}${o.adresa ? `\nAdresa:   ${o.adresa}` : ''}

Celkem:   ${o.total} Kc
Donace:   ${o.donated} Kc → Koridor.ua
VS:       ${o.vs}
Datum:    ${o.date} ${o.time}
${o.poznamka ? `\nPoznamka: ${o.poznamka}` : ''}
</pre>
<p>Platebni instrukce odeslany zakaznikovi automaticky.</p>
</body></html>`;
}

// ─── Fakturoid ────────────────────────────────────────────────────────────────
async function createFakturoidInvoice(o) {
  const slug  = process.env.FAKTUROID_SLUG;
  const email = process.env.FAKTUROID_EMAIL;
  const token = process.env.FAKTUROID_TOKEN;
  if (!slug || !token) {
    console.warn('Fakturoid env vars not set - skipping invoice');
    return { skipped: true };
  }

  const lines = [
    { name: `${o.nazev} x${o.pocet}`, quantity: o.pocet, unit_price: o.pricePerBag, vat_rate: 0 },
  ];
  if (o.shippingCost > 0) {
    lines.push({ name: 'Doprava Zásilkovna', quantity: 1, unit_price: o.shippingCost, vat_rate: 0 });
  }

  const payload = JSON.stringify({
    custom_id: `BB-${o.vs}`,
    due: 7,
    issued_on: new Date().toISOString().split('T')[0],
    lines,
    note: `Zákazník: ${o.jmeno} <${o.email}>`,
  });

  const auth = Buffer.from(`${email}:${token}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'app.fakturoid.cz',
      path: `/api/v2/accounts/${slug}/invoices.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'User-Agent': 'BRAVE BREW (adaklasek@gmail.com)',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Allow GET for health check
  if (event.httpMethod === 'GET') {
    return { statusCode: 200, body: JSON.stringify({ status: 'ok', service: 'BRAVE BREW order webhook' }) };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let order;
  try {
    order = parseOrder(event.body);
  } catch (e) {
    console.error('Parse error:', e);
    return { statusCode: 400, body: 'Bad Request' };
  }

  if (!order.email || !order.kava) {
    return { statusCode: 400, body: 'Missing required fields' };
  }

  console.log(`New order: ${order.jmeno} - ${order.nazev} x${order.pocet} - ${order.total} Kc`);

  // Run all async tasks in parallel
  const [customerResult, adminResult, fakturoidResult] = await Promise.allSettled([
    sendEmail({
      to: order.email,
      subject: `Objednávka přijata - BRAVE BREW (${order.total} Kč)`,
      html: customerEmailHtml(order),
    }),
    sendEmail({
      to: 'adaklasek@gmail.com',
      subject: `Nova objednavka: ${order.jmeno} - ${order.nazev} (${order.total} Kc)`,
      html: adminEmailHtml(order),
    }),
    createFakturoidInvoice(order),
  ]);

  const results = {
    order: { jmeno: order.jmeno, total: order.total, vs: order.vs },
    customerEmail: customerResult.status,
    adminEmail: adminResult.status,
    fakturoid: fakturoidResult.status,
  };

  console.log('Results:', JSON.stringify(results));
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, ...results }),
  };
};
