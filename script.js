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

// Update these numbers as orders come in
const BAGS = 0;
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

// ─── Cenový kalkulátor ────────────────────────────────────────────────────────
const PRICES   = { etiopie: 340, costarica: 320, oba: 660 };
const NAMES    = { etiopie: 'Ethiopia', costarica: 'Costa Rica', oba: 'Bundle (Ethiopia + Costa Rica)' };
const SHIPPING_COST = { zasilkovna: 60, kuryr: 89 };

function updateOrder() {
  const kavaEl  = document.getElementById('kava');
  const pocetEl = document.getElementById('pocet');
  const qtyWrap = document.getElementById('qty-wrap');
  const summary = document.getElementById('order-summary');
  if (!kavaEl || !summary) return;

  const kava     = kavaEl.value;
  const isBundle = kava === 'oba';

  // Zobrazit/skryt počet (u bundlu skrýt)
  if (qtyWrap) {
    qtyWrap.style.display = isBundle ? 'none' : '';
    if (pocetEl) {
      pocetEl.required = !isBundle;
      if (isBundle) pocetEl.value = '1';
    }
  }

  if (!kava) { summary.classList.remove('active'); return; }

  const pocet        = isBundle ? 1 : (parseInt(pocetEl?.value) || 1);
  const pricePerUnit = PRICES[kava] || 0;
  const productTotal = pricePerUnit * pocet;
  const donated      = isBundle ? 200 : pocet * 100;
  const freeShip     = pocet >= 2 || isBundle;
  const doprava      = document.getElementById('doprava')?.value || 'zasilkovna';
  const shipCost     = freeShip ? 0 : (SHIPPING_COST[doprava] || 60);
  const total        = productTotal + shipCost;

  const pocetLabel = isBundle ? '1 bundle' : `${pocet} ks`;
  document.getElementById('summary-product').textContent      = `${NAMES[kava]} · ${pocetLabel}`;
  document.getElementById('summary-product-price').textContent = `${productTotal} Kč`;
  document.getElementById('summary-shipping').textContent      = freeShip ? 'zdarma' : `${shipCost} Kč`;
  document.getElementById('summary-total').textContent         = `${total} Kč`;
  document.getElementById('summary-donation').textContent      = `${donated} Kč`;
  summary.classList.add('active');
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
      const fd   = new FormData(form);
      const data = Object.fromEntries(fd.entries());

      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data),
      });

      const json = res.ok ? await res.json().catch(() => null) : null;

      if (json?.paymentUrl) {
        // Přesměrovat na Comgate platební bránu
        window.location.href = json.paymentUrl;
      } else if (res.ok) {
        // Fallback: platba převodem - platební instrukce přijdou emailem
        btn.textContent       = '✓ Odesláno - platební instrukce dorazí do emailu.';
        btn.style.background  = '#1a6e35';
        btn.style.borderColor = '#1a6e35';
        form.reset();
        document.getElementById('order-summary')?.classList.remove('active');
        const hint = document.getElementById('pickup-hint');
        if (hint) hint.style.display = 'none';
      } else {
        throw new Error('server error');
      }
    } catch {
      btn.textContent = orig;
      btn.disabled    = false;
      alert('Nepodařilo se odeslat. Napiš přímo na adaklasek@gmail.com');
    }
  });
}
