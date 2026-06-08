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


    const autoWrapBrIndent = () => {
      const paragraphs = document.querySelectorAll('.article-content p');

      paragraphs.forEach((p) => {
        if (!p.querySelector('br')) return;
        if (p.querySelector('.br-indent')) return;
        if (p.closest('.mycard, .footnotes, blockquote.quote, blockquote.quote-center')) return;

        const nodes = Array.from(p.childNodes);
        if (!nodes.length) return;

        const fragment = document.createDocumentFragment();
        let chunk = [];
        let shouldIndentChunk = false;

        const flushChunk = () => {
          if (!chunk.length) return;

          if (!shouldIndentChunk) {
            chunk.forEach((node) => fragment.appendChild(node));
            chunk = [];
            return;
          }

          while (
            chunk.length &&
            chunk[0].nodeType === Node.TEXT_NODE &&
            !chunk[0].textContent.trim()
          ) {
            chunk.shift();
          }

          while (
            chunk.length &&
            chunk[chunk.length - 1].nodeType === Node.TEXT_NODE &&
            !chunk[chunk.length - 1].textContent.trim()
          ) {
            chunk.pop();
          }

          if (!chunk.length) return;

          if (chunk[0].nodeType === Node.TEXT_NODE) {
            chunk[0].textContent = chunk[0].textContent.replace(/^\s+/, '');
          }

          const span = document.createElement('span');
          span.className = 'br-indent';
          chunk.forEach((node) => span.appendChild(node));
          fragment.appendChild(span);
          chunk = [];
        };

        nodes.forEach((node) => {
          if (node.nodeName === 'BR') {
            flushChunk();
            fragment.appendChild(node);
            shouldIndentChunk = true;
            return;
          }

          chunk.push(node);
        });

        flushChunk();
        p.replaceChildren(fragment);
      });
    };

    autoWrapBrIndent();

    const escapeHtml = (text = '') =>
      String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const renderCommentCount = (path) => `
      <span class="card-comment-count" aria-label="评论数">
        <svg class="card-comment-count__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 6.75A2.75 2.75 0 0 1 7.75 4h8.5A2.75 2.75 0 0 1 19 6.75v5.5A2.75 2.75 0 0 1 16.25 15H11.7l-3.78 3.2c-.72.61-1.82.1-1.82-.85V15.9A2.75 2.75 0 0 1 5 13.25z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.85"></path>
        </svg>
        <span class="waline-comment-count" data-path="${escapeHtml(path)}">0</span>
      </span>`;

    const renderPageviewCount = (path) => `
      <span class="card-pageview-count" aria-label="浏览量">
        <svg class="card-pageview-count__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M2.75 12s3.5-6 9.25-6 9.25 6 9.25 6-3.5 6-9.25 6-9.25-6-9.25-6Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.85"></path>
          <circle cx="12" cy="12" r="2.65" fill="none" stroke="currentColor" stroke-width="1.85"></circle>
        </svg>
        <span class="waline-pageview-count" data-path="${escapeHtml(path)}">0</span>
      </span>`;

    const buildChipRow = (item) => {
      const chips = (item.categories || [])
        .slice(0, 2)
        .map((tag) => `<span class="chip chip--category">${escapeHtml(tag)}</span>`);

      if (!chips.length) return '';
      return `<div class="archive-chip-row">${chips.join('')}</div>`;
    };

    const buildTagRow = (item) => {
      const tags = (item.tags || [])
        .slice(0, 3)
        .map((tag) => `<span class="chip chip--tag">#${escapeHtml(tag)}</span>`)
        .join('');

      return `<div class="archive-chip-row archive-chip-row--bottom">${tags}</div>`;
    };

    const renderArchiveCard = (item) => {
      const summary = item.description || item.summary || String(item.content || '').slice(0, 120);
      const author = item.author || '';

      return `
        <article class="archive-card" data-filter-item data-filter-text="${escapeHtml([
          item.title,
          item.description,
          item.summary,
          item.content,
          ...(item.categories || []),
          ...(item.tags || []),
        ].join(' '))}">
          <a class="archive-card__inner" href="${escapeHtml(item.url)}" aria-label="阅读：${escapeHtml(item.title)}">
            <div class="archive-card__head">
              ${buildChipRow(item)}
              <div class="archive-card__meta">
                <span>${escapeHtml(item.date || '')}</span>
                <span>${escapeHtml(author)}</span>
              </div>
            </div>
            <h3 class="archive-card__title">${escapeHtml(item.title)}</h3>
            <p class="archive-card__summary">${escapeHtml(summary)}</p>
            <div class="archive-card__foot">
              <div class="archive-card__foot-left">
                ${buildTagRow(item)}
              </div>
              <div class="archive-card__foot-right">
                ${renderCommentCount(item.url)}
                ${renderPageviewCount(item.url)}
                <span class="archive-card__more">阅读全文 →</span>
              </div>
            </div>
          </a>
        </article>
      `;
    };

    const filterForms = document.querySelectorAll('[data-local-filter]');

    filterForms.forEach((form) => {
      const input = form.querySelector('input[type="search"]');
      const clearButton = form.querySelector('[data-search-clear]');
      const targetSelector = form.dataset.target;
      const emptySelector = form.dataset.empty;
      const paginationSelector = form.dataset.pagination;
      const indexUrl = form.dataset.indexUrl || '';
      const sectionFilter = form.dataset.filterSection || '';
      const taxonomyFilter = form.dataset.filterTaxonomy || '';
      const termFilter = form.dataset.filterTerm || '';
      const target = targetSelector ? document.querySelector(targetSelector) : null;
      const empty = emptySelector ? document.querySelector(emptySelector) : null;
      const pagination = paginationSelector ? document.querySelector(paginationSelector) : null;
      const initialSearchLimit = Math.max(parseInt(form.dataset.searchLimit || '0', 10) || 0, 0);
      const searchStep = Math.max(parseInt(form.dataset.searchStep || String(initialSearchLimit || 0), 10) || initialSearchLimit || 0, 0);
      const searchMode = (form.dataset.searchMode || 'more').toLowerCase();
      const useSearchPagination = searchMode === 'paginate';
      let visibleSearchCount = initialSearchLimit;
      let currentSearchPage = 1;
      let currentSearchResults = [];

      if (!input || !target) return;

      let searchResultTools = null;
      let searchResultMeta = null;
      let searchLoadMoreButton = null;
      let searchPaginationControls = null;
      let searchPrevButton = null;
      let searchPageText = null;
      let searchNextButton = null;

      if (indexUrl && initialSearchLimit > 0) {
        searchResultTools = document.createElement('div');
        searchResultTools.className = 'search-result-tools';
        searchResultTools.hidden = true;

        searchResultMeta = document.createElement('p');
        searchResultMeta.className = 'search-result-meta';

        if (useSearchPagination) {
          searchPaginationControls = document.createElement('div');
          searchPaginationControls.className = 'search-result-pages';

          searchPrevButton = document.createElement('button');
          searchPrevButton.className = 'search-page-btn search-page-btn--prev';
          searchPrevButton.type = 'button';
          searchPrevButton.textContent = '上一页';

          searchPageText = document.createElement('span');
          searchPageText.className = 'search-page-current';

          searchNextButton = document.createElement('button');
          searchNextButton.className = 'search-page-btn search-page-btn--next';
          searchNextButton.type = 'button';
          searchNextButton.textContent = '下一页';

          searchPaginationControls.append(searchPrevButton, searchPageText, searchNextButton);
          searchResultTools.append(searchResultMeta, searchPaginationControls);
        } else {
          searchLoadMoreButton = document.createElement('button');
          searchLoadMoreButton.className = 'search-load-more';
          searchLoadMoreButton.type = 'button';
          searchLoadMoreButton.textContent = '显示更多';

          searchResultTools.append(searchResultMeta, searchLoadMoreButton);
        }

        target.insertAdjacentElement('afterend', searchResultTools);
      }

      const syncClearButton = () => {
        if (!clearButton) return;
        clearButton.hidden = input.value.length === 0;
      };

      const originalMarkup = target.innerHTML;
      const items = Array.from(target.querySelectorAll('[data-filter-item]'));
      let indexPromise = null;
      let latestRequest = 0;

      const refreshDynamicCounts = () => {
        if (typeof window.refreshWalineCommentCounts === 'function') {
          window.refreshWalineCommentCounts(target);
        }

        if (typeof window.refreshWalinePageviewCounts === 'function') {
          window.refreshWalinePageviewCounts(target);
        }
      };

      const setSearchingState = (isSearching) => {
        if (pagination) {
          pagination.hidden = isSearching;
        }
      };

      const hideSearchResultTools = () => {
        currentSearchResults = [];
        visibleSearchCount = initialSearchLimit;
        currentSearchPage = 1;
        if (!searchResultTools) return;
        searchResultTools.hidden = true;
        if (searchResultMeta) searchResultMeta.textContent = '';
        if (searchLoadMoreButton) searchLoadMoreButton.hidden = true;
        if (searchPaginationControls) searchPaginationControls.hidden = true;
      };

      const restoreOriginalList = () => {
        target.innerHTML = originalMarkup;
        setSearchingState(false);
        hideSearchResultTools();
        if (empty) empty.hidden = true;
        refreshDynamicCounts();
      };

      const getIndex = async () => {
        if (!indexUrl) return [];
        if (!indexPromise) {
          indexPromise = fetch(indexUrl).then((response) => {
            if (!response.ok) {
              throw new Error(`Search index request failed: ${response.status}`);
            }
            return response.json();
          });
        }
        return indexPromise;
      };

      const filterIndexedItems = (data, keyword) => {
        const lowerKeyword = keyword.toLowerCase();

        return data
          .filter((item) => {
            if (sectionFilter && item.section !== sectionFilter) return false;

            if (taxonomyFilter && termFilter) {
              const values = Array.isArray(item[taxonomyFilter]) ? item[taxonomyFilter] : [];
              if (!values.includes(termFilter)) return false;
            }

            if (!lowerKeyword) return true;

            const haystack = [
              item.title,
              item.description,
              item.summary,
              item.content,
              item.author,
              ...(item.categories || []),
              ...(item.tags || []),
            ]
              .join(' ')
              .toLowerCase();

            return haystack.includes(lowerKeyword);
          });
      };

      const applyLocalFilter = () => {
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

      const renderLimitedSearchResults = () => {
        const totalCount = currentSearchResults.length;
        const hasLimit = initialSearchLimit > 0;

        if (useSearchPagination && hasLimit) {
          const pageSize = initialSearchLimit;
          const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
          currentSearchPage = Math.min(Math.max(currentSearchPage, 1), totalPages);

          const startIndex = (currentSearchPage - 1) * pageSize;
          const visibleResults = currentSearchResults.slice(startIndex, startIndex + pageSize);

          target.innerHTML = visibleResults.map(renderArchiveCard).join('');

          if (empty) {
            empty.hidden = totalCount !== 0;
          }

          if (searchResultTools && searchResultMeta) {
            searchResultTools.hidden = totalCount === 0;
            searchResultMeta.textContent =
              totalCount > pageSize
                ? `找到 ${totalCount} 篇匹配文章，当前第 ${currentSearchPage} / ${totalPages} 页。`
                : `找到 ${totalCount} 篇匹配文章。`;

            if (searchPaginationControls) {
              searchPaginationControls.hidden = totalCount <= pageSize;
            }

            if (searchPageText) {
              searchPageText.textContent = `${currentSearchPage} / ${totalPages}`;
            }

            if (searchPrevButton) {
              searchPrevButton.disabled = currentSearchPage <= 1;
            }

            if (searchNextButton) {
              searchNextButton.disabled = currentSearchPage >= totalPages;
            }
          }

          refreshDynamicCounts();
          return;
        }

        const visibleCount = hasLimit
          ? Math.min(Math.max(visibleSearchCount, 0), totalCount)
          : totalCount;
        const visibleResults = currentSearchResults.slice(0, visibleCount);

        target.innerHTML = visibleResults.map(renderArchiveCard).join('');

        if (empty) {
          empty.hidden = totalCount !== 0;
        }

        if (searchResultTools && searchResultMeta) {
          searchResultTools.hidden = totalCount === 0;
          searchResultMeta.textContent =
            totalCount > visibleCount
              ? `找到 ${totalCount} 篇匹配文章，当前显示 ${visibleCount} 篇。`
              : `找到 ${totalCount} 篇匹配文章。`;

          if (searchLoadMoreButton) {
            searchLoadMoreButton.hidden = !hasLimit || visibleCount >= totalCount;
          }
        }

        refreshDynamicCounts();
      };

      const applyIndexedFilter = async () => {
        const requestId = latestRequest + 1;
        latestRequest = requestId;

        const keyword = input.value.trim();
        if (!keyword) {
          restoreOriginalList();
          return;
        }

        setSearchingState(true);

        try {
          const data = await getIndex();
          if (requestId !== latestRequest) return;

          currentSearchResults = filterIndexedItems(data, keyword);
          currentSearchPage = 1;
          visibleSearchCount = initialSearchLimit > 0
            ? Math.min(initialSearchLimit, currentSearchResults.length)
            : currentSearchResults.length;

          renderLimitedSearchResults();
        } catch (error) {
          console.error('Indexed archive search failed:', error);
          restoreOriginalList();
        }
      };

      const applyFilter = () => {
        if (indexUrl) {
          applyIndexedFilter();
          return;
        }

        applyLocalFilter();
      };

      const handleFilterInput = () => {
        syncClearButton();
        applyFilter();
      };

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        input.value = input.value.trim();
        handleFilterInput();
      });

      input.addEventListener('input', handleFilterInput);

      const scrollToSearchResults = () => {
        if (form && typeof form.scrollIntoView === 'function') {
          form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };

      if (searchLoadMoreButton) {
        searchLoadMoreButton.addEventListener('click', () => {
          visibleSearchCount += searchStep || initialSearchLimit || currentSearchResults.length;
          renderLimitedSearchResults();
        });
      }

      if (searchPrevButton) {
        searchPrevButton.addEventListener('click', () => {
          if (currentSearchPage <= 1) return;
          currentSearchPage -= 1;
          renderLimitedSearchResults();
          scrollToSearchResults();
        });
      }

      if (searchNextButton) {
        searchNextButton.addEventListener('click', () => {
          const totalPages = Math.max(Math.ceil(currentSearchResults.length / Math.max(initialSearchLimit, 1)), 1);
          if (currentSearchPage >= totalPages) return;
          currentSearchPage += 1;
          renderLimitedSearchResults();
          scrollToSearchResults();
        });
      }

      if (clearButton) {
        clearButton.addEventListener('click', () => {
          input.value = '';
          handleFilterInput();
          input.focus();
        });
      }

      syncClearButton();
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
      let lastTouchToggle = 0;

      toggle.addEventListener('touchstart', (event) => {
        lastTouchToggle = Date.now();
        event.preventDefault();
        togglePanel();
      }, { passive: false });
      toggle.addEventListener('click', (event) => {
        if (Date.now() - lastTouchToggle < 500) {
          event.preventDefault();
          return;
        }
        togglePanel();
      });
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
