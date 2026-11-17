/* Ardoise — scripts du site (page d'accueil, confidentialité). Coordonnées : bloc CONTACT ci-dessous. */
'use strict';
// ===== VOS COORDONNÉES : à modifier ici =====
const CONTACT = {
  nom: 'Louis Bauquet-Lancea',
  telephone: '', // laisser vide pour ne pas afficher de téléphone
  email: 'louis.lanquet@gmail.com',
};
// ============================================
const mailto = 'mailto:' + CONTACT.email + '?subject=' + encodeURIComponent('Démonstration Ardoise') +
  '&body=' + encodeURIComponent("Bonjour,\n\nJe souhaiterais une démonstration d'Ardoise.\n\nMon commerce :\nMon téléphone :\n\nMerci !");
document.querySelectorAll('[data-contact-mail]').forEach((a) => { if (a.getAttribute('href') === '#') a.href = mailto; });
document.querySelectorAll('[data-contact-mail-text]').forEach((a) => { a.href = mailto; a.textContent = CONTACT.email; });
document.querySelectorAll('[data-contact-tel]').forEach((a) => {
  if (!CONTACT.telephone) { a.previousSibling && a.previousSibling.nodeType === 3 && (a.previousSibling.textContent = ' '); a.remove(); return; }
  a.href = 'tel:' + CONTACT.telephone.replace(/\s/g, ''); a.textContent = CONTACT.telephone;
});
document.querySelectorAll('[data-contact-name]').forEach((s) => { s.textContent = CONTACT.nom; });
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ===== Comparaison avant / après =====
(() => {
  const ba = document.getElementById('ba');
  if (!ba) return;
  const range = ba.querySelector('.ba-range');
  const tagBefore = ba.querySelector('.ba-tag.before');
  const tagAfter = ba.querySelector('.ba-tag.after');
  let introDone = false, raf = 0, dragging = false;

  const set = (v) => {
    v = Math.max(0, Math.min(100, v));
    ba.style.setProperty('--pos', v + '%');
    range.value = Math.round(v);
    range.setAttribute('aria-valuetext', `${Math.round(v)} % avant, ${100 - Math.round(v)} % avec Ardoise`);
    tagBefore.style.opacity = v < 14 ? 0 : 1;
    tagAfter.style.opacity = v > 86 ? 0 : 1;
  };
  const stopIntro = () => { introDone = true; cancelAnimationFrame(raf); };
  const fromX = (x) => { const r = ba.getBoundingClientRect(); return ((x - r.left) / r.width) * 100; };

  ba.addEventListener('pointerdown', (e) => {
    dragging = true; stopIntro(); ba.classList.add('dragging');
    ba.setPointerCapture(e.pointerId); set(fromX(e.clientX));
  });
  ba.addEventListener('pointermove', (e) => { if (dragging) set(fromX(e.clientX)); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => ba.addEventListener(t, () => { dragging = false; ba.classList.remove('dragging'); }));
  range.addEventListener('input', () => { stopIntro(); set(+range.value); });

  // Petit balayage d'introduction quand la comparaison apparaît à l'écran
  const intro = () => {
    if (introDone || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const keys = [[0, 50], [900, 80], [1900, 22], [2700, 50]];
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const t0 = performance.now();
    const step = (now) => {
      if (introDone) return;
      const t = now - t0;
      let i = keys.findIndex((k) => k[0] > t);
      if (i === -1) { set(50); introDone = true; return; }
      const [ta, va] = keys[i - 1], [tb, vb] = keys[i];
      set(va + (vb - va) * ease((t - ta) / (tb - ta)));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  set(50);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries, obs) => {
      if (entries[0].isIntersecting) { setTimeout(intro, 600); obs.disconnect(); }
    }, { threshold: 0.45 }).observe(ba);
  }
})();
