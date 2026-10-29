// 词条目录：字母与立场筛选、词语卡片、词条之间的自动互链与返回。
// 行为对齐论坛的词条页；数据由页面内嵌的 JSON 提供，无需额外请求。
// 自动互链与悬停预览在 lexicon-peek.js 里，和单独的词条页、文章共用。
(function () {
  var root = document.querySelector('.lexicon-directory');
  if (!root) return;
  var store = root.querySelector('[data-lexicon-data]');
  var dialog = root.querySelector('.lexicon-dialog');
  if (!store || !dialog || typeof dialog.showModal !== 'function') return;

  var entries;
  try { entries = JSON.parse(store.textContent || '[]'); } catch (e) { return; }
  if (!entries.length) return;

  var byUrl = Object.create(null);
  entries.forEach(function (entry) { byUrl[entry.url] = entry; });
  var titleNode = dialog.querySelector('[data-lexicon-title]');
  var markNode = dialog.querySelector('[data-lexicon-mark]');
  var contentNode = dialog.querySelector('[data-lexicon-content]');
  var aliasNode = dialog.querySelector('[data-lexicon-aliases]');
  var backButton = dialog.querySelector('[data-lexicon-back]');
  var closeButton = dialog.querySelector('[data-lexicon-close]');
  var stack = [];

  var EVENT_MARK = '<span class="lexicon-event" title="事件" aria-label="事件"><svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M4 14V3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4 3h7l-1.6 2.3L11 7.6H4z" fill="currentColor"/></svg></span>';

  function markFor(entry) {
    var html = '';
    if (entry.polarity === 'positive' || entry.polarity === 'negative') {
      var positive = entry.polarity === 'positive';
      var cls = positive ? 'lexicon-mark--positive' : 'lexicon-mark--negative';
      var label = positive ? '女权立场' : '反女权立场';
      html += '<span class="lexicon-mark ' + cls + '" title="' + label + '" aria-label="' + label + '">' + (positive ? '＋' : '－') + '</span>';
    }
    if (entry.event) html += EVENT_MARK;
    return html;
  }

  // Mentions of other entries become links that open their card; the shared
  // script also shows a preview when the pointer rests on one.
  function autoLink(container, selfUrl) {
    if (!window.LexiconPeek) return;
    window.LexiconPeek.load().then(function () {
      if (contentNode === container && titleNode.textContent === byUrl[selfUrl].title) window.LexiconPeek.autoLink(container, selfUrl);
    });
  }

  // Comments live on the entry's own path, so a card and the entry page share
  // one thread. The client is fetched on first open and then just re-pointed.
  var walineHost = dialog.querySelector('[data-lexicon-waline]');
  var waline = null, walineLoading = false, commentPath = '';
  function showComments(entry) {
    if (!walineHost) return;
    commentPath = entry.url;
    if (waline) { try { waline.update({ path: entry.url }); } catch (e) { /* keep the card usable */ } return; }
    if (walineLoading) return;
    walineLoading = true;
    import('https://unpkg.com/@waline/client@v3/dist/waline.js').then(function (mod) {
      waline = mod.init({
        el: walineHost,
        serverURL: walineHost.getAttribute('data-server'),
        lang: walineHost.getAttribute('data-lang') || 'zh-CN',
        turnstileKey: walineHost.getAttribute('data-turnstile') || undefined,
        path: commentPath,
        pageview: false,
        reaction: false,
        search: false,
      });
    }).catch(function () {
      walineHost.textContent = '评论组件暂时无法加载。';
    }).then(function () { walineLoading = false; });
  }

  function render(entry) {
    titleNode.textContent = entry.title;
    markNode.innerHTML = markFor(entry);
    // The other names this entry is written about under belong beside its
    // name, the same as on the entry's own page.
    if (aliasNode) {
      var aliases = (entry.aliases || []).filter(function (name) { return name && String(name).trim(); });
      aliasNode.textContent = aliases.length ? '又称：' + aliases.join('、') : '';
      aliasNode.hidden = !aliases.length;
    }
    contentNode.innerHTML = entry.html;
    contentNode.querySelectorAll('a[href]').forEach(function (link) {
      if (!byUrl[link.getAttribute('href')]) { link.target = '_blank'; link.rel = 'noopener noreferrer nofollow'; }
      else link.setAttribute('data-lexicon-entry', link.getAttribute('href'));
    });
    autoLink(contentNode, entry.url);
    backButton.hidden = stack.length < 2;
    if (window.LexiconPeek) window.LexiconPeek.hide();
    showComments(entry);
  }

  // A card that is still closed cannot be scrolled: the browser restores the
  // old offset when the dialog opens again, so the next entry would start
  // where the previous one was left. Reset both the body and the dialog
  // itself — an overflowing bar can leave the dialog its own offset — and do
  // it again after layout, because images and the comment client arrive late.
  var dialogBody = dialog.querySelector('.lexicon-dialog__body');
  function toTop() {
    if (dialogBody) dialogBody.scrollTop = 0;
    dialog.scrollTop = 0;
  }
  function toTopSoon() {
    toTop();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(toTop);
    setTimeout(toTop, 0);
  }

  function open(url, push) {
    var entry = byUrl[url];
    if (!entry) return false;
    if (push !== false) stack.push(url);
    render(entry);
    if (!dialog.open) dialog.showModal();
    toTop();
    titleNode.focus();
    toTopSoon();
    return true;
  }

  root.addEventListener('click', function (event) {
    var link = event.target.closest ? event.target.closest('[data-lexicon-entry]') : null;
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
    if (open(link.getAttribute('data-lexicon-entry'))) event.preventDefault();
  });
  backButton.addEventListener('click', function () { stack.pop(); open(stack[stack.length - 1], false); backButton.hidden = stack.length < 2; });
  closeButton.addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('close', function () { stack = []; backButton.hidden = true; });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });

  // Filters and paging. The directory is laid out in two columns, so a page
  // holds 30 words; filtering always drops back to the first page.
  var PAGE_SIZE = 30;
  var groups = Array.prototype.slice.call(root.querySelectorAll('.lexicon-group'));
  var empty = root.querySelector('[data-lexicon-empty]');
  var count = root.querySelector('[data-lexicon-count]');
  var pager = root.querySelector('.lexicon-pager');
  var pagerPages = root.querySelector('[data-lexicon-pages]');
  var prevButton = root.querySelector('[data-lexicon-prev]');
  var nextButton = root.querySelector('[data-lexicon-next]');
  var letter = '', polarity = '', page = 1;

  // Only the numbers around the current page are worth showing once the
  // directory grows; the gaps collapse into an ellipsis.
  function pageNumbers(pages) {
    var wanted = [1, pages, page - 1, page, page + 1];
    var kept = [];
    wanted.sort(function (a, b) { return a - b; }).forEach(function (value) {
      if (value >= 1 && value <= pages && kept[kept.length - 1] !== value) kept.push(value);
    });
    var out = [];
    kept.forEach(function (value, index) {
      if (index && value - kept[index - 1] > 1) out.push(null);
      out.push(value);
    });
    return out;
  }

  function renderPager(pages) {
    if (!pager) return;
    pager.hidden = pages < 2;
    if (prevButton) prevButton.disabled = page <= 1;
    if (nextButton) nextButton.disabled = page >= pages;
    if (!pagerPages) return;
    pagerPages.textContent = '';
    pageNumbers(pages).forEach(function (value) {
      if (value === null) {
        var gap = document.createElement('span');
        gap.className = 'lexicon-pager__gap';
        gap.textContent = '…';
        pagerPages.appendChild(gap);
        return;
      }
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(value);
      button.setAttribute('data-lexicon-page', String(value));
      button.setAttribute('aria-pressed', String(value === page));
      button.setAttribute('aria-label', '第 ' + value + ' 页');
      pagerPages.appendChild(button);
    });
  }

  function apply(keepPage) {
    if (!keepPage) page = 1;
    var matched = [];
    groups.forEach(function (group) {
      Array.prototype.slice.call(group.querySelectorAll('li')).forEach(function (item) {
        var link = item.querySelector('[data-lexicon-entry]');
        var ok = (!letter || group.getAttribute('data-letter') === letter)
          && (!polarity || (link && link.getAttribute('data-polarity') === polarity));
        item.hidden = true;
        if (ok) matched.push(item);
      });
    });
    var pages = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
    if (page > pages) page = pages;
    var start = (page - 1) * PAGE_SIZE;
    matched.slice(start, start + PAGE_SIZE).forEach(function (item) { item.hidden = false; });
    groups.forEach(function (group) { group.hidden = !group.querySelector('li:not([hidden])'); });
    if (empty) empty.hidden = matched.length !== 0;
    if (count) count.textContent = '共收录 ' + matched.length + ' 个词语';
    renderPager(pages);
  }

  function turnTo(value) {
    page = value;
    apply(true);
    var top = root.querySelector('.lexicon-letters') || root;
    if (top.getBoundingClientRect().top < 0) top.scrollIntoView();
  }

  if (pager) {
    pager.addEventListener('click', function (event) {
      var button = event.target.closest ? event.target.closest('button') : null;
      if (!button || button.disabled) return;
      if (button.hasAttribute('data-lexicon-prev')) turnTo(page - 1);
      else if (button.hasAttribute('data-lexicon-next')) turnTo(page + 1);
      else if (button.hasAttribute('data-lexicon-page')) turnTo(Number(button.getAttribute('data-lexicon-page')));
    });
  }

  function bind(selector, attribute, set) {
    var buttons = Array.prototype.slice.call(root.querySelectorAll(selector + ' button'));
    buttons.forEach(function (button) {
      button.addEventListener('click', function () {
        var value = button.getAttribute(attribute);
        set(set.current === value ? '' : value);
        buttons.forEach(function (other) { other.setAttribute('aria-pressed', String(other.getAttribute(attribute) === (set.current || ''))); });
        apply();
      });
    });
  }
  var setLetter = function (value) { letter = value; setLetter.current = value; };
  var setPolarity = function (value) { polarity = value; setPolarity.current = value; };
  setLetter.current = ''; setPolarity.current = '';
  bind('.lexicon-letters', 'data-letter', setLetter);
  bind('.lexicon-polarity', 'data-polarity', setPolarity);
  apply();
})();
