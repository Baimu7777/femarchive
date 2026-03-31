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
    const walineServerURL = document.body?.dataset.walineServerUrl || '';
    let walineCommentAbort = null;
    let walineCommentModulePromise = null;
    let walinePageviewAbort = null;
    let walinePageviewModulePromise = null;

    const refreshWalineCommentCounts = async (root = document) => {
      if (!walineServerURL) return;

      const selector = '.waline-comment-count';
      const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
      const targets = Array.from(scope.querySelectorAll(selector)).filter((item) => item.dataset.path);
      if (!targets.length) return;

      try {
        walineCommentModulePromise ||= import('https://unpkg.com/@waline/client@v3/dist/comment.js');
        const { commentCount } = await walineCommentModulePromise;

        if (typeof walineCommentAbort === 'function') {
          walineCommentAbort('refresh');
        }

        walineCommentAbort = commentCount({
          serverURL: walineServerURL,
          selector,
        });
      } catch (error) {
        console.error('Waline comment count failed to initialize:', error);
      }
    };

    const refreshWalinePageviewCounts = async (root = document) => {
      if (!walineServerURL) return;

      const selector = '.waline-pageview-count';
      const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
      const targets = Array.from(scope.querySelectorAll(selector)).filter((item) => item.dataset.path);
      if (!targets.length) return;

      try {
        walinePageviewModulePromise ||= import('https://unpkg.com/@waline/client@v3/dist/pageview.js');
        const { pageviewCount } = await walinePageviewModulePromise;

        if (typeof walinePageviewAbort === 'function') {
          walinePageviewAbort('refresh');
        }

        walinePageviewAbort = pageviewCount({
          serverURL: walineServerURL,
          path: window.location.pathname,
          selector,
          update: false,
        });
      } catch (error) {
        console.error('Waline pageview count failed to initialize:', error);
      }
    };

    window.refreshWalineCommentCounts = refreshWalineCommentCounts;
    window.refreshWalinePageviewCounts = refreshWalinePageviewCounts;
    refreshWalineCommentCounts();
    refreshWalinePageviewCounts();

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

    const mobileTocs = document.querySelectorAll('[data-mobile-toc]');

    mobileTocs.forEach((wrap) => {
      const toggle = wrap.querySelector('[data-mobile-toc-toggle]');
      const panel = wrap.querySelector('.mobile-toc__panel');
      const closers = wrap.querySelectorAll('[data-mobile-toc-close]');
      const tocLinks = wrap.querySelectorAll('.mobile-toc__nav a');

      if (!toggle || !panel) return;

      const overlay = wrap.querySelector('.mobile-toc__overlay');
      if (overlay) overlay.hidden = false;

      const syncState = (isOpen) => {
        wrap.classList.toggle('is-open', isOpen);
        document.body.classList.toggle('mobile-toc-open', isOpen);
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        toggle.setAttribute('aria-label', isOpen ? '关闭文章目录' : '打开文章目录');
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


    const desktopSidebar = document.querySelector('.article-layout .sidebar-stack');

    if (desktopSidebar) {
      const desktopSidebarMedia = window.matchMedia('(min-width: 1101px)');

      const sidebarHasOverflow = () =>
        desktopSidebar.scrollHeight > desktopSidebar.clientHeight + 2;

      const syncSidebarScrollState = () => {
        const canScroll = desktopSidebarMedia.matches && sidebarHasOverflow();
        desktopSidebar.classList.toggle('is-scroll-ready', canScroll);
        if (!canScroll) {
          desktopSidebar.classList.remove('is-scroll-active');
        }
      };

      const enableSidebarScroll = () => {
        if (!desktopSidebarMedia.matches) return;
        syncSidebarScrollState();
        if (sidebarHasOverflow()) {
          desktopSidebar.classList.add('is-scroll-active');
        }
      };

      const disableSidebarScroll = (event) => {
        const nextTarget = event?.relatedTarget;
        if (nextTarget && desktopSidebar.contains(nextTarget)) return;
        desktopSidebar.classList.remove('is-scroll-active');
      };

      desktopSidebar.addEventListener('mouseenter', enableSidebarScroll);
      desktopSidebar.addEventListener('mouseover', enableSidebarScroll);
      desktopSidebar.addEventListener('mouseleave', disableSidebarScroll);
      desktopSidebar.addEventListener('focusin', enableSidebarScroll);
      desktopSidebar.addEventListener('focusout', disableSidebarScroll);

      window.addEventListener('resize', syncSidebarScrollState, { passive: true });

      if (typeof ResizeObserver !== 'undefined') {
        const sidebarObserver = new ResizeObserver(syncSidebarScrollState);
        sidebarObserver.observe(desktopSidebar);
        Array.from(desktopSidebar.children).forEach((item) => sidebarObserver.observe(item));
      }

      syncSidebarScrollState();
    }

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
