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
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');

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

    results.innerHTML = items
      .map((item) => {
        const chips = (item.categories || [])
          .slice(0, 2)
          .map((tag) => `<span class="chip chip--filled">#${escapeHtml(tag)}</span>`)
          .join('');
        const tags = (item.tags || [])
          .slice(0, 3)
          .map((tag) => `<span class="chip">#${escapeHtml(tag)}</span>`)
          .join('');
        const desc = item.description || item.summary || String(item.content || '').slice(0, 120);

        return `
          <article class="archive-card">
            <div class="archive-card__head">
              <div class="archive-chip-row">${chips}<span class="chip">${escapeHtml(item.type)}</span></div>
              <div class="archive-card__meta"><span>${escapeHtml(item.date)}</span><span>${escapeHtml(item.type)}</span></div>
            </div>
            <h3 class="archive-card__title"><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h3>
            <p class="archive-card__summary">${escapeHtml(desc)}</p>
            <div class="archive-card__foot">
              <div class="archive-chip-row archive-chip-row--bottom">${tags}</div>
              <a class="archive-card__more" href="${escapeHtml(item.url)}">阅读全文 →</a>
            </div>
          </article>
        `;
      })
      .join('');
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