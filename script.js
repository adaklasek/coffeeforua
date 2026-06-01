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

// Packeta / Zásilkovna widget
// Po registraci na client.packeta.com vloz sem svuj API klic:
const PACKETA_API_KEY = '1e13f3ef06a99418';

function openPacketa() {
  const options = { country: 'cz', language: 'cs' };
  Packeta.Widget.pick(PACKETA_API_KEY, function(point) {
    if (!point) return;
    document.getElementById('vydejna-name').value = point.name + ', ' + point.place;
    document.getElementById('vydejna-id').value = point.id;
  }, options);
}

function togglePickup(val) {
  const pickupWrap = document.getElementById('pickup-wrap');
  const addressWrap = document.getElementById('address-wrap');
  const vydejnaInput = document.getElementById('vydejna-name');
  if (val === 'zasilkovna') {
    pickupWrap.style.display = '';
    addressWrap.style.display = 'none';
    vydejnaInput.required = true;
  } else {
    pickupWrap.style.display = 'none';
    addressWrap.style.display = '';
    vydejnaInput.required = false;
  }
}

// Order form
const form = document.querySelector('.order-form');
if (form) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.textContent = 'Odesílám...';
    btn.disabled = true;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' }
      });
      if (res.ok) {
        btn.textContent = '✓ Odesláno. Ozvu se do 24 h.';
        btn.style.background = '#1a6e35';
        btn.style.borderColor = '#1a6e35';
        form.reset();
      } else throw new Error();
    } catch {
      btn.textContent = orig;
      btn.disabled = false;
      alert('Nepodařilo se odeslat. Napiš přímo na adaklasek@gmail.com');
    }
  });
}
