// Reveals .reveal elements as they scroll into view. Respects prefers-reduced-motion by simply
// not bothering to observe at all (CSS's own reduced-motion override already neutralizes the
// transition, but skipping the observer avoids any layout-thrash for nothing).
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduceMotion && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const delay = Number(el.dataset.revealDelay || 0);
          window.setTimeout(() => el.classList.add('is-visible'), delay);
          observer.unobserve(el);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -60px 0px' }
  );

  document.querySelectorAll('.reveal').forEach((el, i) => {
    if (!el.dataset.revealDelay) {
      // Stagger siblings sharing a parent .reveal-group by DOM order.
      const group = el.closest('[data-reveal-group]');
      if (group) {
        const siblings = Array.from(group.querySelectorAll('.reveal'));
        el.dataset.revealDelay = String(siblings.indexOf(el) * 90);
      }
    }
    observer.observe(el);
  });

  // Safety net: content must never stay permanently invisible if the observer misses an
  // element for any reason (a fast/jank scroll, a backgrounded tab during load, a stagger
  // delay racing page unload). This does not fight the real reveal animation above — it just
  // guarantees everything is visible a few seconds after load no matter what.
  window.setTimeout(() => {
    document.querySelectorAll('.reveal:not(.is-visible)').forEach((el) => el.classList.add('is-visible'));
  }, 2500);
} else {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
}

// Nav background: transparent -> solid once scrolled.
const nav = document.querySelector('.nav');
if (nav) {
  const onScroll = () => {
    nav.classList.toggle('nav-solid', window.scrollY > 50);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}
