// Nav scroll
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 30);
}, { passive: true });

// Animated counter utility
function animateCount(el, target, suffix = '') {
  if (!el || target === 0) return;
  let start = null;
  const dur = 1600;
  const tick = ts => {
    if (!start) start = ts;
    const p = Math.min((ts - start) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 4);
    el.textContent = Math.floor(ease * target).toLocaleString('cs-CZ') + suffix;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Update manually as orders come in, or connect to Google Sheets
const BAGS = 13;
const KC = BAGS * 100;

const els = {
  counter:  document.getElementById('counter'),
  bagsSold: document.getElementById('bags-sold'),
  kcSent:   document.getElementById('kc-sent'),
};

// Set zero state text
if (els.counter)  els.counter.textContent  = '0 Kč';
if (els.bagsSold) els.bagsSold.textContent = '0';
if (els.kcSent)   els.kcSent.textContent   = '0 Kč';

// Trigger animation on scroll into view
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    const id = e.target.id;
    if (id === 'counter')   animateCount(els.counter,  KC,   ' Kč');
    if (id === 'bags-sold') animateCount(els.bagsSold, BAGS);
    if (id === 'kc-sent')   animateCount(els.kcSent,   KC,   ' Kč');
    io.unobserve(e.target);
  });
});
Object.values(els).forEach(el => { if (el) io.observe(el); });

// Duplicate ticker for seamless loop
const ticker = document.querySelector('.ticker-inner');
if (ticker) ticker.innerHTML += ticker.innerHTML;

// ─── Packeta API key ──────────────────────────────────────────────────────────
const PACKETA_API_KEY = '1e13f3ef06a99418';

// ─── Košík ────────────────────────────────────────────────────────────────────
const PRICES        = { etiopie: 340, costarica: 320, oba: 660 };
const NAMES_SHORT   = { etiopie: 'Ethiopia', costarica: 'Costa Rica', oba: 'Bundle' };
const SHIPPING_COST = { zasilkovna: 60, kuryr: 89 };

const cart = { etiopie: 0, costarica: 0, oba: 0 };

function changeQty(key, delta) {
  cart[key] = Math.max(0, (cart[key] || 0) + delta);
  const qtyEl = document.getElementById('qty-' + key);
  const inpEl = document.getElementById('inp-' + key);
  const subEl = document.getElementById('sub-' + key);
  const ciEl  = document.getElementById('ci-' + key);
  if (qtyEl) qtyEl.textContent = cart[key];
  if (inpEl) inpEl.value = cart[key];
  if (subEl) subEl.textContent = cart[key] > 0 ? (PRICES[key] * cart[key]) + ' Kč' : '';
  if (ciEl)  ciEl.classList.toggle('ci-active', cart[key] > 0);
  updateCart();
}

function updateCart() {
  const summary   = document.getElementById('order-summary');
  const emptyHint = document.getElementById('cart-empty-hint');
  const subtotal  = Object.entries(cart).reduce((s, [k, v]) => s + PRICES[k] * v, 0);
  // Počet balíčků pro dopravu zdarma (bundle = 2 balíčky)
  const totalBags = cart.etiopie + cart.costarica + cart.oba * 2;
  const donated   = (cart.etiopie + cart.costarica) * 100 + cart.oba * 200;
  const freeShip  = totalBags >= 2;
  const doprava   = document.getElementById('doprava')?.value || 'zasilkovna';
  const shipCost  = freeShip ? 0 : (SHIPPING_COST[doprava] || 60);
  const total     = subtotal + shipCost;
  const isEmpty   = subtotal === 0;

  if (emptyHint) emptyHint.style.display = 'none';
  if (!summary) return;
  summary.classList.toggle('active', !isEmpty);

  if (!isEmpty) {
    const lines = Object.entries(cart)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${NAMES_SHORT[k]} ${v}×`);
    document.getElementById('summary-product').textContent       = lines.join(', ');
    document.getElementById('summary-product-price').textContent = subtotal + ' Kč';
    document.getElementById('summary-shipping').textContent      = freeShip ? 'zdarma' : shipCost + ' Kč';
    document.getElementById('summary-total').textContent         = total + ' Kč';
    document.getElementById('summary-donation').textContent      = donated + ' Kč';
  }
}

// ─── Výběr způsobu platby ─────────────────────────────────────────────────────
function updatePaymentBtn() {
  const platba = document.querySelector('input[name="platba"]:checked')?.value;
  const btn = document.getElementById('submit-btn');
  if (btn) btn.textContent = platba === 'prevod' ? 'Odeslat objednávku →' : 'Zaplatit kartou →';
}

// ─── Zásilkovna toggle ────────────────────────────────────────────────────────
function togglePickup(val) {
  const pickupWrap   = document.getElementById('pickup-wrap');
  const addressWrap  = document.getElementById('address-wrap');
  const vydejnaInput = document.getElementById('vydejna-name');
  const adresaInput  = document.getElementById('adresa');

  if (val === 'zasilkovna') {
    pickupWrap.style.display  = '';
    addressWrap.style.display = 'none';
    vydejnaInput.required = true;
    if (adresaInput) adresaInput.required = false;
  } else {
    pickupWrap.style.display  = 'none';
    addressWrap.style.display = '';
    vydejnaInput.required = false;
    if (adresaInput) adresaInput.required = true;
  }
}

// ─── Zásilkovna widget - otevřít a zobrazit výsledek ─────────────────────────
function openPacketa() {
  const options = { country: 'cz', language: 'cs' };
  Packeta.Widget.pick(PACKETA_API_KEY, function(point) {
    if (!point) return;
    const label = point.name + ', ' + point.place;
    document.getElementById('vydejna-name').value = label;
    document.getElementById('vydejna-id').value   = point.id;
    // Zobrazit hint s potvrzením výběru
    const hint = document.getElementById('pickup-hint');
    const lbl  = document.getElementById('pickup-selected-label');
    if (hint && lbl) { lbl.textContent = label; hint.style.display = ''; }
  }, options);
}

// ─── Objednávkový formulář ────────────────────────────────────────────────────
const form = document.getElementById('order-form');
if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn  = document.getElementById('submit-btn');
    const orig = btn.textContent;
    btn.textContent = 'Odesílám...';
    btn.disabled = true;

    try {
      // Validace košíku
      const totalItems = cart.etiopie + cart.costarica + cart.oba;
      if (totalItems === 0) {
        const hint = document.getElementById('cart-empty-hint');
        if (hint) hint.style.display = '';
        btn.textContent = orig;
        btn.disabled = false;
        document.getElementById('ci-etiopie')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const fd   = new FormData(form);
      const data = Object.fromEntries(fd.entries());

      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data),
      });

      const json = await res.json().catch(() => null);
      const platbaVal = data.platba || 'karta';

      if (json?.paymentUrl) {
        // Přesměrovat na Comgate platební bránu
        window.location.href = json.paymentUrl;
      } else if (res.ok && platbaVal !== 'karta') {
        // Bankovní převod - instrukce přijdou emailem, zobraz QR blok na stránce
        btn.textContent       = '✓ Objednávka přijata - platební instrukce a QR kód dorazí na email.';
        btn.style.background  = '#1a6e35';
        btn.style.borderColor = '#1a6e35';
        if (json?.qrDataUrl) {
          const qrBlock = document.getElementById('qr-block');
          if (qrBlock) {
            document.getElementById('qr-img').src           = json.qrDataUrl;
            document.getElementById('qr-vs').textContent    = json.vs || '';
            document.getElementById('qr-total').textContent = json.total ? json.total + ' Kč' : '';
            qrBlock.style.display = '';
            qrBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }
        form.reset();
        document.getElementById('order-summary')?.classList.remove('active');
        const hint = document.getElementById('pickup-hint');
        if (hint) hint.style.display = 'none';
      } else if (!res.ok && json?.error === 'payment_gateway_error') {
        const detail = json.detail === 'missing_credentials' ? 'Platební brána není nakonfigurována.' : 'Platební brána vrátila chybu.';
        throw new Error(`${detail} Zkus bankovní převod nebo napiš na info@coffeeforua.cz`);
      } else {
        throw new Error('server error');
      }
    } catch (err) {
      btn.textContent = orig;
      btn.disabled    = false;
      const errEl = document.getElementById('form-error');
      if (errEl) {
        const customMsg = err?.message && !err.message.includes('server') ? err.message : null;
        if (customMsg) {
          errEl.innerHTML = customMsg;
        }
        errEl.style.display = '';
      }
    }
  });
}
