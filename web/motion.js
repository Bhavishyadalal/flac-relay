const navLinks = Array.from(document.querySelectorAll('.relay-nav a[href^="#"]'));
function syncNavigation() {
  const selected = navLinks.find(link => link.hash === location.hash) ?? navLinks[0];
  for (const link of navLinks) {
    if (link === selected) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}
window.addEventListener('hashchange', syncNavigation);
syncNavigation();

document.addEventListener('keydown', event => {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
  event.preventDefault();
  document.getElementById('search-query-input').focus();
});

if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const reveal = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        reveal.unobserve(entry.target);
      }
    }
  }, { threshold: .08 });
  for (const panel of document.querySelectorAll('.relay-tools, #addon-section, #hardware-lab')) {
    panel.classList.add('motion-ready');
    reveal.observe(panel);
  }
}
