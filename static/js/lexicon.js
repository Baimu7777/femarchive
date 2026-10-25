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
  // Longest title first so a term containing another is linked as a whole.
  var titles = entries.map(function (e) { return e.title; }).sort(function (a, b) { return b.length - a.length; });

  var titleNode = dialog.querySelector('[data-lexicon-title]');
  var markNode = dialog.querySelector('[data-lexicon-mark]');
  var contentNode = dialog.querySelector('[data-lexicon-content]');
  var backButton = dialog.querySelector('[data-lexicon-back]');
  var closeButton = dialog.querySelector('[data-lexicon-close]');
  var stack = [];

  function markFor(polarity) {
    if (polarity !== 'positive' && polarity !== 'negative') return '';
    var cls = polarity === 'positive' ? 'lexicon-mark--positive' : 'lexicon-mark--negative';
    var label = polarity === 'positive' ? '女权立场' : '反女权立场';
    var sign = polarity === 'positive' ? '＋' : '－';
    return '<span class="lexicon-mark ' + cls + '" title="' + label + '" aria-label="' + label + '">' + sign + '</span>';
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
        var hit = null, at = -1;
        for (var i = 0; i < titles.length; i++) {
          var found = value.indexOf(titles[i], index);
          if (found !== -1 && (at === -1 || found < at)) { at = found; hit = titles[i]; }
        }
        if (hit === null) break;
        var entry = entries.filter(function (e) { return e.title === hit; })[0];
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

  function render(entry) {
    titleNode.textContent = entry.title;
    markNode.innerHTML = markFor(entry.polarity);
    contentNode.innerHTML = entry.html;
    contentNode.querySelectorAll('a[href]').forEach(function (link) {
      if (!byUrl[link.getAttribute('href')]) { link.target = '_blank'; link.rel = 'noopener noreferrer nofollow'; }
      else link.setAttribute('data-lexicon-entry', link.getAttribute('href'));
    });
    autoLink(contentNode, entry.url);
    backButton.hidden = stack.length < 2;
    contentNode.scrollTop = 0;
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
