// Detects the visitor's OS to prioritize one download CTA, but the universal 3-card picker
// (#download) always shows all platforms regardless — detection only changes which button the
// header/hero CTA points at, never hides an option.
function detectPlatform() {
  const stored = localStorage.getItem('alliminate-platform');
  if (stored) return stored;

  const platform = navigator.platform || '';
  const ua = navigator.userAgent || '';

  if (/Android/.test(ua)) return 'android';
  if (/Mac|iPhone|iPad|iPod/.test(platform) || /Macintosh/.test(ua)) return 'mac';
  if (/Win/.test(platform)) return 'windows';
  return null;
}

const LABELS = { mac: 'macOS', windows: 'Windows', android: 'Android' };

function applyPlatform(id) {
  const targets = document.querySelectorAll('[data-primary-download]');
  const platforms = window.__ALLIMINATE_PLATFORMS__ || [];
  const match = platforms.find((p) => p.id === id);

  targets.forEach((el) => {
    if (match) {
      el.textContent = `Download for ${LABELS[id]}`;
      el.setAttribute('href', match.downloadHref);
    } else {
      el.textContent = 'Choose your platform';
      el.setAttribute('href', '#download');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const detected = detectPlatform();
  applyPlatform(detected);

  // Manual platform-card clicks override detection and persist across visits.
  document.querySelectorAll('[data-platform-choice]').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-platform-choice');
      if (id) {
        localStorage.setItem('alliminate-platform', id);
      }
    });
  });
});
