/**
 * BRAVE BREW - Comgate Payment Webhook
 * Endpoint: /.netlify/functions/comgate-webhook
 *
 * Comgate zavolá tento endpoint po každé změně stavu platby.
 * Dokumentace: https://apidoc.comgate.cz/#webhook
 */

const https   = require('https');
const qs      = require('querystring');

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
  if (!key) return;
  return httpPost('api.resend.com', '/emails',
    { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    { from: 'BRAVE BREW <hello@coffeeforua.cz>', to, subject, html }
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const params = qs.parse(event.body || '');
  const { transId, status, refId, price, email, fname } = params;

  console.log(`Comgate webhook: transId=${transId} status=${status} refId=${refId} price=${price}`);

  if (status === 'PAID') {
    const totalKc  = Math.round(parseInt(price || 0) / 100);
    const donated  = Math.round(totalKc / 3.4) * 100; // aproximace - přesná hodnota přijde z objednávky

    // Odeslat potvrzovací email zákazníkovi
    if (email) {
      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fafaf8">
<div style="border-top:4px solid #1a6e35;padding-top:20px;margin-bottom:20px">
  <h1 style="font-size:22px;margin:0 0 4px">Platba přijata ✓</h1>
  <p style="color:#666;margin:0;font-size:14px">BRAVE BREW · coffeeforua.cz</p>
</div>
<p>Ahoj${fname ? ` ${fname}` : ''},</p>
<p>platba <strong>${totalKc} Kč</strong> proběhla úspěšně. Káva je na řadě.</p>
<div style="background:#f0fff4;border:2px solid #1a6e35;padding:16px 20px;margin:20px 0;border-radius:4px">
  <strong>Co se děje dál:</strong><br>
  Zapražíme a odešleme Zásilkovnou do 3 pracovních dnů. Sledování zásilky dostaneš SMSkou od Zásilkovny.
</div>
<p style="background:#EBF2FF;padding:12px 16px;border-radius:4px;font-size:14px">
  🇺🇦 Z tvé objednávky jde <strong>${donated} Kč</strong> přímo organizaci Koridor.ua.
</p>
<p style="font-size:14px">Díky, Adam<br><span style="color:#666">BRAVE BREW · adaklasek@gmail.com</span></p>
</body></html>`;
      await sendEmail(email, 'Platba potvrzena - BRAVE BREW káva je na cestě', html);
    }

    // Notifikace Adamovi
    await sendEmail('adaklasek@gmail.com',
      `ZAPLACENO: refId ${refId} - ${totalKc} Kc`,
      `<pre>TransId: ${transId}\nRefId: ${refId}\nStatus: PAID\nCastka: ${totalKc} Kc\nEmail: ${email}</pre>`
    );
  }

  // Comgate očekává HTTP 200 s textem "OK"
  return { statusCode: 200, body: 'OK' };
};
