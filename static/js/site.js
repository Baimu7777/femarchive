document.addEventListener('DOMContentLoaded', () => {
  const filterForms = document.querySelectorAll('[data-local-filter]');

  filterForms.forEach((form) => {
    const input = form.querySelector('input[type="search"]');
    const targetSelector = form.dataset.target;
    const emptySelector = form.dataset.empty;
    const target = targetSelector ? document.querySelector(targetSelector) : null;
    const empty = emptySelector ? document.querySelector(emptySelector) : null;

    if (!input || !target) return;

    const items = Array.from(target.querySelectorAll('[data-filter-item]'));

    const applyFilter = () => {
      const keyword = input.value.trim().toLowerCase();
      let visibleCount = 0;

      items.forEach((item) => {
        const haystack = (item.dataset.filterText || item.textContent || '').toLowerCase();
        const matched = !keyword || haystack.includes(keyword);
        item.hidden = !matched;
        if (matched) visibleCount += 1;
      });

      if (empty) {
        empty.hidden = visibleCount !== 0;
      }
    };

    input.addEventListener('input', applyFilter);
    applyFilter();
  });

  const homeHero = document.querySelector('[data-home-hero]');
  const homeContent = document.querySelector('[data-home-content]');

  if (homeHero && homeContent) {
    let heroDismissed = false;

    const getSpacerHeight = () => {
      const marginTop = parseFloat(window.getComputedStyle(homeContent).marginTop || '0');
      return Number.isFinite(marginTop) ? marginTop : window.innerHeight;
    };

    const dismissHero = () => {
      if (heroDismissed) return;
      heroDismissed = true;

      const scrollY = window.scrollY || window.pageYOffset || 0;
      const spacerHeight = getSpacerHeight();

      document.body.classList.add('home-hero-dismissed');
      homeHero.classList.add('is-dismissed');
      homeHero.style.opacity = '0';
      homeHero.style.transform = 'translate3d(0, -120px, 0)';

      const nextScrollY = Math.max(scrollY - spacerHeight, 0);
      window.scrollTo({ top: nextScrollY, left: 0, behavior: 'auto' });
      window.removeEventListener('scroll', handleFirstScroll);
      window.removeEventListener('wheel', handleFirstScroll, wheelListenerOptions);
      window.removeEventListener('touchmove', handleFirstScroll, touchListenerOptions);
    };

    const handleFirstScroll = () => {
      const scrollY = window.scrollY || window.pageYOffset || 0;
      if (scrollY > 12) {
        dismissHero();
      }
    };

    const wheelListenerOptions = { passive: true };
    const touchListenerOptions = { passive: true };

    window.addEventListener('scroll', handleFirstScroll, { passive: true });
    window.addEventListener('wheel', handleFirstScroll, wheelListenerOptions);
    window.addEventListener('touchmove', handleFirstScroll, touchListenerOptions);

    handleFirstScroll();
  }
});
