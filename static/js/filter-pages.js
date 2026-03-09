(function () {
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }
  async function loadIndex() {
    const response = await fetch('/index.json');
    if (!response.ok) throw new Error('无法加载搜索索引');
    return response.json();
  }
  function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return { q: params.get('q') || '', category: params.get('category') || '', tag: params.get('tag') || '' };
  }
  function setQueryParams(data) {
    const params = new URLSearchParams();
    if (data.q) params.set('q', data.q);
    if (data.category) params.set('category', data.category);
    if (data.tag) params.set('tag', data.tag);
    const url = params.toString() ? window.location.pathname + '?' + params.toString() : window.location.pathname;
    window.history.replaceState({}, '', url);
  }
  function filterArticles(items, state) {
    const q = state.q.trim().toLowerCase();
    return items.filter(function (item) {
      const haystack = [item.title, item.description, item.content].concat(item.categories || []).concat(item.tags || []).concat(item.keywords || []).join(' ').toLowerCase();
      return (!state.category || (item.categories || []).includes(state.category))
        && (!state.tag || (item.tags || []).includes(state.tag))
        && (!q || haystack.includes(q));
    });
  }
  function articleCard(item) {
    const category = item.categories && item.categories[0] ? item.categories[0] : '';
    const tags = (item.tags || []).slice(0, 3).map(function (tag) { return '<span class="pill subtle">#' + escapeHtml(tag) + '</span>'; }).join('');
    return '<article class="article-card"><div class="pill-row">'
      + (category ? '<span class="pill">#' + escapeHtml(category) + '</span>' : '')
      + '<span class="pill subtle">' + escapeHtml(item.author || '编辑部') + '</span></div>'
      + '<h3><a class="post-title-link" href="' + escapeHtml(item.permalink) + '">' + escapeHtml(item.title) + '</a></h3>'
      + '<p>' + escapeHtml(item.description || '') + '</p>'
      + (tags ? '<div class="pill-row soft-tags">' + tags + '</div>' : '')
      + '<div class="card-footer"><span>' + escapeHtml(item.date.replace(/-/g, '.')) + ' · ' + escapeHtml(item.author || '编辑部') + '</span><a class="text-link" href="' + escapeHtml(item.permalink) + '">阅读全文 →</a></div></article>';
  }
  function searchCard(item) {
    const meta = [].concat(item.categories || []).concat(item.tags || []).join(' / ');
    return '<article class="category-card"><div class="pill-row">' + (meta ? '<span class="pill">' + escapeHtml(meta) + '</span>' : '') + '</div>'
      + '<h3><a class="post-title-link" href="' + escapeHtml(item.permalink) + '">' + escapeHtml(item.title) + '</a></h3>'
      + '<p>' + escapeHtml(item.description || '') + '</p>'
      + '<div class="card-footer"><span>' + escapeHtml(item.date.replace(/-/g, '.')) + ' · ' + escapeHtml(item.author || '编辑部') + '</span><a class="text-link" href="' + escapeHtml(item.permalink) + '">阅读全文 →</a></div></article>';
  }
  function fillSelect(select, values, selected) {
    values.forEach(function (value) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      if (selected === value) option.selected = true;
      select.appendChild(option);
    });
  }
  loadIndex().then(function (items) {
    const categories = Array.from(new Set(items.flatMap(function (item) { return item.categories || []; }))).sort();
    const tags = Array.from(new Set(items.flatMap(function (item) { return item.tags || []; }))).sort();
    const params = getQueryParams();
    const articleInput = document.getElementById('article-search');
    const articleCategory = document.getElementById('article-category');
    const articleTag = document.getElementById('article-tag');
    const articleList = document.getElementById('articles-list');
    if (articleInput && articleCategory && articleTag && articleList) {
      articleInput.value = params.q;
      fillSelect(articleCategory, categories, params.category);
      fillSelect(articleTag, tags, params.tag);
      const render = function () {
        const state = { q: articleInput.value, category: articleCategory.value, tag: articleTag.value };
        setQueryParams(state);
        const filtered = filterArticles(items, state);
        articleList.innerHTML = filtered.length ? '<div class="article-grid">' + filtered.map(articleCard).join('') + '</div>' : '<div class="empty">没有找到匹配结果。</div>';
      };
      articleInput.addEventListener('input', render);
      articleCategory.addEventListener('change', render);
      articleTag.addEventListener('change', render);
      render();
    }
    const searchInput = document.getElementById('search-input');
    const searchCategory = document.getElementById('search-category');
    const searchTag = document.getElementById('search-tag');
    const searchResults = document.getElementById('search-results');
    if (searchInput && searchCategory && searchTag && searchResults) {
      searchInput.value = params.q;
      fillSelect(searchCategory, categories, params.category);
      fillSelect(searchTag, tags, params.tag);
      const render = function () {
        const state = { q: searchInput.value, category: searchCategory.value, tag: searchTag.value };
        setQueryParams(state);
        const filtered = filterArticles(items, state);
        searchResults.innerHTML = filtered.length ? '<div class="grid-2">' + filtered.map(searchCard).join('') + '</div>' : '<div class="empty">没有找到匹配结果。</div>';
      };
      searchInput.addEventListener('input', render);
      searchCategory.addEventListener('change', render);
      searchTag.addEventListener('change', render);
      render();
    }
  }).catch(function (error) {
    [document.getElementById('articles-list'), document.getElementById('search-results')].filter(Boolean).forEach(function (target) {
      target.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
    });
  });
})();
