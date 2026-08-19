// Detects the visitor's OS to prioritize one download CTA, but the universal 3-card picker
// (#download) always shows all platforms regardless — detection only changes which button the
// header/hero CTA points at, never hides an option.
//
// Always live-detected from the current browser/device, every visit — no stored override. An
// earlier version remembered a platform in localStorage once a visitor clicked anywhere inside
// a platform card (including its own Download button), which permanently locked that browser
// to one platform on every future visit regardless of what device it actually was — e.g.
// clicking into the Android card once on a Mac, out of curiosity, made every later visit from
// that same Mac show "Download for Android" forever. Detection should just always match the
// real device.
function detectPlatform() {
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
      el.setAttribute('href', '/download');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const detected = detectPlatform();
  applyPlatform(detected);

  // Stamps data-platform on <html> so variables.css can switch to the real Windows Fluent
  // accent/radius (#0067c0, flatter panels) for Windows visitors — same idea as the app itself
  // looking different per platform, not a new invented behavior.
  if (detected) {
    document.documentElement.setAttribute('data-platform', detected);
  }
});
