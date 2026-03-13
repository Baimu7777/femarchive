(() => {
  const isHomePage =
    document.documentElement.classList.contains('body-home') ||
    document.body?.classList.contains('body-home');

  const forceScrollTop = () => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, 0);
  };

  if (isHomePage) {
    try {
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }
    } catch (error) {
      // ignore
    }

    // 首页每次重新进入都从最顶端开始，先正常显示 slogan。
    forceScrollTop();
    window.addEventListener('pageshow', forceScrollTop, { once: true });
  }

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

      const fadeDistanceRatio = 0.72;
      const maxLift = 96;

      const getScrollY = () =>
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        0;

      const measureDismissOffset = () => {
        const currentScrollY = getScrollY();
        const contentTop = homeContent.getBoundingClientRect().top + currentScrollY;
        return Math.max(
          Math.round(contentTop),
          Math.round(window.innerHeight || document.documentElement.clientHeight || 0),
          1,
        );
      };

      const syncHeroWithScroll = () => {
        if (heroDismissed) return;

        const scrollY = getScrollY();
        const dismissOffset = measureDismissOffset();
        const fadeDistance = Math.max(dismissOffset * fadeDistanceRatio, 1);
        const progress = Math.min(Math.max(scrollY / fadeDistance, 0), 1);

        homeHero.style.opacity = String(1 - progress);
        homeHero.style.transform = `translate3d(0, ${(-maxLift * progress).toFixed(2)}px, 0)`;

        if (progress >= 0.999) {
          homeHero.classList.add('is-faded');
          homeHero.setAttribute('aria-hidden', 'true');
        } else {
          homeHero.classList.remove('is-faded');
          homeHero.removeAttribute('aria-hidden');
        }

        if (scrollY >= dismissOffset - 2) {
          heroDismissed = true;
          document.body.classList.add('home-hero-dismissed');
          homeHero.classList.add('is-faded');
          homeHero.setAttribute('aria-hidden', 'true');

          const targetScrollTop = Math.max(Math.round(scrollY - dismissOffset), 0);
          requestAnimationFrame(() => {
            window.scrollTo({ top: targetScrollTop, left: 0, behavior: 'auto' });
          });
        }
      };

      const handleResize = () => {
        if (heroDismissed) return;
        syncHeroWithScroll();
      };

      // 确保加载时先显示 slogan，而不是立刻被滚动恢复带走。
      forceScrollTop();
      syncHeroWithScroll();

      window.addEventListener('scroll', syncHeroWithScroll, { passive: true });
      window.addEventListener('resize', handleResize, { passive: true });
    }
  });
})();
