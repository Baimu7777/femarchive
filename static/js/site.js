(() => {
  const isHomePage = document.documentElement.classList.contains('body-home') || document.body?.classList.contains('body-home');

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

    // 首页 slogan 每次重新进入都应从最顶端开始显示，
    // 不让浏览器把上一次的滚动位置恢复回来直接跳过它。
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
      let touchStartY = null;

      const getSpacerHeight = () => {
        const marginTop = parseFloat(window.getComputedStyle(homeContent).marginTop || '0');
        return Number.isFinite(marginTop) ? marginTop : window.innerHeight;
      };

      const removeHeroListeners = () => {
        window.removeEventListener('scroll', handleScrollFallback, passiveOptions);
        window.removeEventListener('wheel', handleWheel, passiveOptions);
        window.removeEventListener('touchstart', handleTouchStart, passiveOptions);
        window.removeEventListener('touchmove', handleTouchMove, passiveOptions);
        window.removeEventListener('keydown', handleKeyDown);
      };

      const dismissHero = () => {
        if (heroDismissed) return;
        heroDismissed = true;

        const currentScrollY = window.scrollY || window.pageYOffset || 0;
        const spacerHeight = getSpacerHeight();

        document.body.classList.add('home-hero-dismissed');
        homeHero.classList.add('is-dismissed');
        homeHero.style.opacity = '0';
        homeHero.style.transform = 'translate3d(0, -120px, 0)';

        removeHeroListeners();

        const nextScrollY = Math.max(currentScrollY - spacerHeight, 0);
        window.scrollTo({ top: nextScrollY, left: 0, behavior: 'auto' });
        requestAnimationFrame(() => {
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        });
      };

      const handleScrollFallback = () => {
        // 兜底：处理拖动滚动条等情况。
        const scrollY = window.scrollY || window.pageYOffset || 0;
        if (scrollY > 20) {
          dismissHero();
        }
      };

      const handleWheel = (event) => {
        if (event.deltaY > 6) {
          dismissHero();
        }
      };

      const handleTouchStart = (event) => {
        touchStartY = event.touches?.[0]?.clientY ?? null;
      };

      const handleTouchMove = (event) => {
        if (touchStartY === null) return;
        const currentY = event.touches?.[0]?.clientY ?? touchStartY;
        if (touchStartY - currentY > 10) {
          dismissHero();
        }
      };

      const handleKeyDown = (event) => {
        const triggerKeys = ['ArrowDown', 'PageDown', ' ', 'Spacebar'];
        if (triggerKeys.includes(event.key)) {
          dismissHero();
        }
      };

      const passiveOptions = { passive: true };

      // 初始化时强制回到最顶端，让 slogan 先出现；
      // 不再像之前那样一进页面就根据已有 scrollY 立即收起。
      forceScrollTop();

      window.addEventListener('scroll', handleScrollFallback, passiveOptions);
      window.addEventListener('wheel', handleWheel, passiveOptions);
      window.addEventListener('touchstart', handleTouchStart, passiveOptions);
      window.addEventListener('touchmove', handleTouchMove, passiveOptions);
      window.addEventListener('keydown', handleKeyDown);
    }
  });
})();
