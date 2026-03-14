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

      const applyFilter = () => {
        const keyword = input.value.trim().toLowerCase();
        const items = Array.from(target.querySelectorAll('[data-filter-item]'));
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
      document.addEventListener('content:updated', (event) => {
        if (event?.detail?.target === target) {
          applyFilter();
        }
      });

      applyFilter();
    });

    const mobileTocs = document.querySelectorAll('[data-mobile-toc]');

    mobileTocs.forEach((wrap) => {
      const toggle = wrap.querySelector('[data-mobile-toc-toggle]');
      const panel = wrap.querySelector('.mobile-toc__panel');
      const closers = wrap.querySelectorAll('[data-mobile-toc-close]');
      const tocLinks = wrap.querySelectorAll('.mobile-toc__nav a');

      if (!toggle || !panel) return;

      const syncState = (isOpen) => {
        wrap.classList.toggle('is-open', isOpen);
        document.body.classList.toggle('mobile-toc-open', isOpen);
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        toggle.setAttribute('aria-label', isOpen ? '关闭文章目录' : '打开文章目录');
        const overlay = wrap.querySelector('.mobile-toc__overlay');
        if (overlay) overlay.hidden = !isOpen;
      };

      const closePanel = () => syncState(false);
      const togglePanel = () => {
        const isOpen = wrap.classList.contains('is-open');
        syncState(!isOpen);
      };

      toggle.addEventListener('click', togglePanel);
      closers.forEach((item) => item.addEventListener('click', closePanel));
      tocLinks.forEach((link) => link.addEventListener('click', closePanel));

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && wrap.classList.contains('is-open')) {
          closePanel();
        }
      });

      window.addEventListener('resize', () => {
        if (window.innerWidth > 720 && wrap.classList.contains('is-open')) {
          closePanel();
        }
      });
    });

    const loadMoreButtons = document.querySelectorAll('[data-load-more-button]');

    loadMoreButtons.forEach((button) => {
      const note = button.parentElement?.querySelector('[data-load-more-note]') || null;

      const setBusy = (busy) => {
        button.disabled = busy;
        button.textContent = busy ? '加载中…' : '加载更多';
        if (note) note.hidden = !busy;
      };

      button.addEventListener('click', async () => {
        const nextUrl = button.dataset.nextUrl;
        const targetSelector = button.dataset.target;
        const itemSelector = button.dataset.itemSelector || '';
        const target = targetSelector ? document.querySelector(targetSelector) : null;

        if (!nextUrl || !target || !itemSelector) return;

        setBusy(true);

        try {
          const response = await fetch(nextUrl, {
            headers: {
              'X-Requested-With': 'fetch',
            },
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const incomingTarget = doc.querySelector(targetSelector);

          if (!incomingTarget) {
            throw new Error('Target not found in next page');
          }

          const items = Array.from(incomingTarget.querySelectorAll(itemSelector));
          const fragment = document.createDocumentFragment();
          items.forEach((item) => fragment.appendChild(item));
          target.appendChild(fragment);

          const incomingButton = doc.querySelector('[data-load-more-button]');
          const newNextUrl = incomingButton?.dataset?.nextUrl || '';

          if (newNextUrl) {
            button.dataset.nextUrl = newNextUrl;
            setBusy(false);
          } else {
            button.parentElement?.remove();
          }

          document.dispatchEvent(
            new CustomEvent('content:updated', {
              detail: { target },
            }),
          );
        } catch (error) {
          console.error(error);
          setBusy(false);
          button.textContent = '加载失败，重试';
          if (note) {
            note.hidden = false;
            note.textContent = '加载失败，请再点一次。';
          }
        }
      });
    });

    const backToTop = document.querySelector('[data-back-to-top]');

    if (backToTop) {
      const syncBackToTop = () => {
        const visible = (window.scrollY || document.documentElement.scrollTop || 0) > 320;
        backToTop.hidden = false;
        backToTop.classList.toggle('is-visible', visible);
      };

      backToTop.addEventListener('click', () => {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      });

      syncBackToTop();
      window.addEventListener('scroll', syncBackToTop, { passive: true });
      window.addEventListener('resize', syncBackToTop, { passive: true });
    }

    const homeHero = document.querySelector('[data-home-hero]');
    const homeContent = document.querySelector('[data-home-content]');

    if (homeHero && homeContent) {
      let heroDismissed = false;
      let isDismissing = false;

      const fadeDistanceRatio = 0.72;
      const maxLift = 96;

      const getScrollY = () =>
        window.scrollY ||
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        0;

      const setInstantScrollMode = (enabled) => {
        const root = document.documentElement;
        const body = document.body;

        if (enabled) {
          root.dataset.prevInlineScrollBehavior = root.style.scrollBehavior || '';
          body.dataset.prevInlineScrollBehavior = body.style.scrollBehavior || '';
          root.style.scrollBehavior = 'auto';
          body.style.scrollBehavior = 'auto';
        } else {
          root.style.scrollBehavior = root.dataset.prevInlineScrollBehavior || '';
          body.style.scrollBehavior = body.dataset.prevInlineScrollBehavior || '';
          delete root.dataset.prevInlineScrollBehavior;
          delete body.dataset.prevInlineScrollBehavior;
        }
      };

      const measureBaseOffset = () => {
        const currentScrollY = getScrollY();
        const contentTop = homeContent.getBoundingClientRect().top + currentScrollY;
        return Math.max(
          Math.round(contentTop),
          Math.round(window.innerHeight || document.documentElement.clientHeight || 0),
          1,
        );
      };

      const getCollapseBuffer = () => {
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        return Math.max(24, Math.min(72, Math.round(viewportHeight * 0.06)));
      };

      const collapseHero = () => {
        if (heroDismissed || isDismissing) return;

        isDismissing = true;

        const scrollY = getScrollY();
        const baseOffset = measureBaseOffset();
        const targetScrollTop = Math.max(Math.round(scrollY - baseOffset), 0);

        setInstantScrollMode(true);
        document.documentElement.classList.add('is-collapsing-home-hero');
        document.body.classList.add('home-hero-dismissed');
        homeHero.classList.add('is-faded');
        homeHero.setAttribute('aria-hidden', 'true');

        window.scrollTo({ top: targetScrollTop, left: 0, behavior: 'auto' });

        requestAnimationFrame(() => {
          heroDismissed = true;
          isDismissing = false;
          document.documentElement.classList.remove('is-collapsing-home-hero');
          setInstantScrollMode(false);
        });
      };

      const syncHeroWithScroll = () => {
        if (heroDismissed || isDismissing) return;

        const scrollY = getScrollY();
        const baseOffset = measureBaseOffset();
        const collapseOffset = baseOffset + getCollapseBuffer();
        const fadeDistance = Math.max(baseOffset * fadeDistanceRatio, 1);
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

        if (scrollY >= collapseOffset) {
          collapseHero();
        }
      };

      const handleResize = () => {
        if (heroDismissed || isDismissing) return;
        syncHeroWithScroll();
      };

      forceScrollTop();
      syncHeroWithScroll();

      window.addEventListener('scroll', syncHeroWithScroll, { passive: true });
      window.addEventListener('resize', handleResize, { passive: true });
    }
  });
})();
