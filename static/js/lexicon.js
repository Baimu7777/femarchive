// 词条目录：字母与立场筛选、词语卡片、词条之间的自动互链与返回。
// 行为对齐论坛的词条页；数据由页面内嵌的 JSON 提供，无需额外请求。
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
  // Every name an entry answers to, its aliases included, longest first so a
  // name containing another is linked as a whole.
  var names = [];
  entries.forEach(function (entry) {
    [entry.title].concat(entry.aliases || []).forEach(function (name) {
      if (name && String(name).trim()) names.push({ name: String(name), entry: entry });
    });
  });
  names.sort(function (a, b) { return b.name.length - a.name.length; });

  var titleNode = dialog.querySelector('[data-lexicon-title]');
  var markNode = dialog.querySelector('[data-lexicon-mark]');
  var contentNode = dialog.querySelector('[data-lexicon-content]');
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

  // Turn mentions of other entries into links that open their card. Only text
  // nodes are touched, and never inside an existing link or a heading.
  function autoLink(container, selfUrl) {
    var skip = { A: 1, H1: 1, H2: 1, H3: 1, H4: 1, CODE: 1, PRE: 1 };
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var targets = [], node;
    while ((node = walker.nextNode())) {
      var parent = node.parentNode, blocked = false;
      while (parent && parent !== container) { if (skip[parent.nodeName]) { blocked = true; break; } parent = parent.parentNode; }
      if (!blocked && node.nodeValue && node.nodeValue.trim()) targets.push(node);
    }
    targets.forEach(function (text) {
      var value = text.nodeValue, pieces = [], index = 0;
      while (index < value.length) {
        var hit = null, at = -1, entry = null;
        for (var i = 0; i < names.length; i++) {
          if (names[i].entry.url === selfUrl) continue;
          var found = value.indexOf(names[i].name, index);
          if (found !== -1 && (at === -1 || found < at)) { at = found; hit = names[i].name; entry = names[i].entry; }
        }
        if (hit === null) break;
        if (!entry || entry.url === selfUrl) { index = at + hit.length; continue; }
        if (at > index) pieces.push(document.createTextNode(value.slice(index, at)));
        var link = document.createElement('a');
        link.href = entry.url;
        link.className = 'lexicon-reference';
        link.setAttribute('data-lexicon-entry', entry.url);
        link.textContent = hit;
        pieces.push(link);
        index = at + hit.length;
      }
      if (!pieces.length) return;
      if (index < value.length) pieces.push(document.createTextNode(value.slice(index)));
      var fragment = document.createDocumentFragment();
      pieces.forEach(function (piece) { fragment.appendChild(piece); });
      text.parentNode.replaceChild(fragment, text);
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
    contentNode.innerHTML = entry.html;
    contentNode.querySelectorAll('a[href]').forEach(function (link) {
      if (!byUrl[link.getAttribute('href')]) { link.target = '_blank'; link.rel = 'noopener noreferrer nofollow'; }
      else link.setAttribute('data-lexicon-entry', link.getAttribute('href'));
    });
    autoLink(contentNode, entry.url);
    backButton.hidden = stack.length < 2;
    showComments(entry);
    dialog.querySelector('.lexicon-dialog__body').scrollTop = 0;
    titleNode.focus();
  }

  function open(url, push) {
    var entry = byUrl[url];
    if (!entry) return false;
    if (push !== false) stack.push(url);
    render(entry);
    if (!dialog.open) dialog.showModal();
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

  // Filters
  var groups = Array.prototype.slice.call(root.querySelectorAll('.lexicon-group'));
  var empty = root.querySelector('[data-lexicon-empty]');
  var count = root.querySelector('[data-lexicon-count]');
  var letter = '', polarity = '';

  function apply() {
    var shown = 0;
    groups.forEach(function (group) {
      var items = Array.prototype.slice.call(group.querySelectorAll('li'));
      var visible = 0;
      items.forEach(function (item) {
        var link = item.querySelector('[data-lexicon-entry]');
        var ok = (!letter || group.getAttribute('data-letter') === letter)
          && (!polarity || (link && link.getAttribute('data-polarity') === polarity));
        item.hidden = !ok;
        if (ok) visible++;
      });
      group.hidden = visible === 0;
      shown += visible;
    });
    if (empty) empty.hidden = shown !== 0;
    if (count) count.textContent = '共收录 ' + shown + ' 个词语';
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
})();
