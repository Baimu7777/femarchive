(() => {
  const page = document.querySelector('[data-search-page]');
  if (!page) return;

  const form = document.getElementById('searchForm');
  const input = document.getElementById('searchQuery');
  const meta = document.getElementById('searchMeta');
  const results = document.getElementById('searchResults');
  const empty = document.getElementById('searchEmpty');
  const scopeButtons = Array.from(document.querySelectorAll('[data-search-scope]'));
  const indexUrl = page.dataset.indexUrl || '/index.json';

  const params = new URLSearchParams(window.location.search);
  let currentScope = params.get('scope') || 'all';
  input.value = params.get('q') || '';

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
    const categoryChips = (item.categories || [])
      .slice(0, 2)
      .map((tag) => `<span class="chip chip--category">${escapeHtml(tag)}</span>`);

    if (item.type) {
      categoryChips.push(`<span class="chip chip--category">${escapeHtml(item.type)}</span>`);
    }

    if (!categoryChips.length) return '';
    return `<div class="archive-chip-row">${categoryChips.join('')}</div>`;
  };

  const buildTagRow = (item) => {
    const tags = (item.tags || [])
      .slice(0, 3)
      .map((tag) => `<span class="chip chip--tag">#${escapeHtml(tag)}</span>`)
      .join('');

    return `<div class="archive-chip-row archive-chip-row--bottom">${tags}</div>`;
  };

  const renderCard = (item) => {
    const summary = item.description || item.summary || String(item.content || '').slice(0, 120);
    const author = item.author || item.type || '';

    return `
      <article class="archive-card archive-card--search">
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

  const setScopeUI = () => {
    scopeButtons.forEach((button) => {
      button.classList.toggle('is-active', button.dataset.searchScope === currentScope);
    });
  };

  const renderCards = (items, keyword) => {
    if (!items.length) {
      results.innerHTML = '';
      empty.hidden = false;
      meta.textContent = keyword ? `没有找到与“${keyword}”相关的内容。` : '输入关键词后开始检索。';
      return;
    }

    empty.hidden = true;
    meta.textContent = keyword ? `找到 ${items.length} 条与“${keyword}”相关的结果。` : `当前共载入 ${items.length} 条可搜索内容。`;

    results.innerHTML = items.map(renderCard).join('');

    if (typeof window.refreshWalineCommentCounts === 'function') {
      window.refreshWalineCommentCounts(results);
    }

    if (typeof window.refreshWalinePageviewCounts === 'function') {
      window.refreshWalinePageviewCounts(results);
    }
  };

  const runSearch = async () => {
    const keyword = input.value.trim();
    const lower = keyword.toLowerCase();

    const response = await fetch(indexUrl);
    const data = await response.json();

    const scoped = data.filter((item) => currentScope === 'all' || item.section === currentScope);
    const filtered = keyword
      ? scoped.filter((item) => {
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
          return haystack.includes(lower);
        })
      : scoped;

    renderCards(filtered, keyword);

    const next = new URLSearchParams();
    if (keyword) next.set('q', keyword);
    if (currentScope !== 'all') next.set('scope', currentScope);
    const nextUrl = `${window.location.pathname}${next.toString() ? `?${next.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch().catch(() => {
      meta.textContent = '搜索索引载入失败，请检查 index.json 是否已生成。';
    });
  });

  scopeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      currentScope = button.dataset.searchScope;
      setScopeUI();
      runSearch().catch(() => {
        meta.textContent = '搜索索引载入失败，请检查 index.json 是否已生成。';
      });
    });
  });

  setScopeUI();
  runSearch().catch(() => {
    meta.textContent = '搜索索引载入失败，请检查 index.json 是否已生成。';
  });
})();
