// 词条悬停预览与自动互链：鼠标移到指向词条的链接上，就地显示这个词条的开头，
// 和论坛词条页的预览一样。词条目录页用页面内嵌的数据，其它页面在第一次需要时
// 读取 /lexicon/index.json。单独的词条页也会把正文里提到的其它词条链接起来。
(function () {
  var script = document.currentScript;
  var indexUrl = (script && script.getAttribute('data-lexicon-index')) || '/lexicon/index.json';
  var entries = null, byUrl = Object.create(null), names = [], loading = null;

  function use(list) {
    entries = Array.isArray(list) ? list : [];
    byUrl = Object.create(null);
    names = [];
    entries.forEach(function (entry) {
      byUrl[entry.url] = entry;
      // Every name an entry answers to, its aliases included, longest first so
      // a name containing another is linked as a whole.
      [entry.title].concat(entry.aliases || []).forEach(function (name) {
        if (name && String(name).trim()) names.push({ name: String(name), entry: entry });
      });
    });
    names.sort(function (a, b) { return b.name.length - a.name.length; });
    return entries;
  }

  function load() {
    if (entries) return Promise.resolve(entries);
    var inline = document.querySelector('[data-lexicon-data]');
    if (inline) {
      try { return Promise.resolve(use(JSON.parse(inline.textContent || '[]'))); } catch (e) { return Promise.resolve(use([])); }
    }
    if (!loading) {
      loading = fetch(indexUrl, { credentials: 'same-origin' })
        .then(function (response) { return response.ok ? response.json() : []; })
        .catch(function () { return []; })
        .then(use);
    }
    return loading;
  }

  function entryPath(link) {
    var marked = link.getAttribute('data-lexicon-entry');
    if (marked) return marked;
    var url;
    try { url = new URL(link.getAttribute('href') || '', window.location.href); } catch (e) { return null; }
    if (url.origin !== window.location.origin || !/^\/lexicon\/[^/]+\/$/.test(url.pathname)) return null;
    return url.pathname;
  }

  // Turn mentions of entries into links. Only text nodes are touched, never
  // inside an existing link, code or a heading, and never the entry itself.
  function autoLink(container, selfUrl) {
    if (!container || !names.length) return;
    var skip = { A: 1, H1: 1, H2: 1, H3: 1, H4: 1, CODE: 1, PRE: 1, SCRIPT: 1, STYLE: 1, BUTTON: 1 };
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
        // Latin names may adjoin Chinese prose, but not another Latin word or number.
        if ((/^[a-z0-9_]/i.test(hit) && /[a-z0-9_]$/i.test(value.slice(0, at))) ||
          (/[a-z0-9_]$/i.test(hit) && /^[a-z0-9_]/i.test(value.slice(at + hit.length)))) {
          if (at > index) pieces.push(document.createTextNode(value.slice(index, at)));
          pieces.push(document.createTextNode(hit));
          index = at + hit.length;
          continue;
        }
        if (at > index) pieces.push(document.createTextNode(value.slice(index, at)));
        var link = document.createElement('a');
        link.href = entry.url;
        link.className = 'lexicon-reference';
        link.setAttribute('data-lexicon-entry', entry.url);
        link.textContent = hit;
        pieces.push(link);
        index = at + hit.length;
      }
      if (!pieces.some(function (piece) { return piece.nodeType === 1; })) return;
      if (index < value.length) pieces.push(document.createTextNode(value.slice(index)));
      var fragment = document.createDocumentFragment();
      pieces.forEach(function (piece) { fragment.appendChild(piece); });
      text.parentNode.replaceChild(fragment, text);
    });
  }

  var EVENT_MARK = '<span class="lexicon-event" title="事件" aria-label="事件"><svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M4 14V3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4 3h7l-1.6 2.3L11 7.6H4z" fill="currentColor"/></svg></span>';

  function markFor(entry) {
    var html = '';
    if (entry.polarity === 'positive' || entry.polarity === 'negative') {
      var positive = entry.polarity === 'positive';
      var label = positive ? '女权立场' : '反女权立场';
      html += '<span class="lexicon-mark ' + (positive ? 'lexicon-mark--positive' : 'lexicon-mark--negative') + '" title="' + label + '" aria-label="' + label + '">' + (positive ? '＋' : '－') + '</span>';
    }
    if (entry.event) html += EVENT_MARK;
    return html;
  }

  var peek = document.createElement('aside');
  peek.id = 'lexicon-peek';
  peek.className = 'lexicon-peek';
  peek.setAttribute('role', 'tooltip');
  peek.hidden = true;
  var heading = document.createElement('div');
  heading.className = 'lexicon-peek__heading';
  var title = document.createElement('strong');
  var marks = document.createElement('span');
  heading.appendChild(title);
  heading.appendChild(marks);
  var body = document.createElement('p');
  var hint = document.createElement('span');
  hint.className = 'lexicon-peek__hint';
  peek.appendChild(heading);
  peek.appendChild(body);
  peek.appendChild(hint);

  var anchor = null, hideTimer = null, token = 0;

  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    token++;
    peek.hidden = true;
    if (anchor) anchor.removeAttribute('aria-describedby');
    anchor = null;
  }
  function hideSoon() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 160);
  }

  function show(link) {
    var path = entryPath(link);
    if (!path) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (anchor === link && !peek.hidden) return;
    var mine = ++token;
    load().then(function () {
      if (mine !== token) return;
      var entry = byUrl[path];
      // A modal dialog sits in the top layer; the preview has to live inside it
      // to appear above the card.
      var host = link.closest('dialog[open]') || document.body;
      if (peek.parentNode !== host) host.appendChild(peek);
      if (anchor && anchor !== link) anchor.removeAttribute('aria-describedby');
      anchor = link;
      link.setAttribute('aria-describedby', peek.id);
      title.textContent = entry ? entry.title : '词条不可用';
      marks.innerHTML = entry ? markFor(entry) : '';
      body.textContent = entry ? (entry.text || '此词条包含图片，可点击查看。') : '这个词条已删除或不存在。';
      hint.textContent = entry ? '点击词名查看完整词条' : '';
      hint.hidden = !entry;
      peek.hidden = false;
      peek.scrollTop = 0;
      var rect = link.getBoundingClientRect();
      var width = Math.min(360, window.innerWidth - 32);
      var height = Math.min(peek.offsetHeight || 250, 250);
      var top = rect.bottom + height + 16 < window.innerHeight ? rect.bottom + 8 : Math.max(16, rect.top - height - 8);
      peek.style.width = width + 'px';
      peek.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)) + 'px';
      peek.style.top = top + 'px';
    });
  }

  function linkFrom(target) {
    var link = target && target.closest ? target.closest('a[href]') : null;
    // The directory's own list of names already says what each one is.
    if (!link || link.closest('.lexicon-list') || peek.contains(link)) return null;
    return entryPath(link) ? link : null;
  }

  var canHover = window.matchMedia ? window.matchMedia('(hover: hover)') : { matches: true };
  document.addEventListener('mouseover', function (event) {
    if (!canHover.matches) return;
    if (peek.contains(event.target)) { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } return; }
    var link = linkFrom(event.target);
    if (link) show(link);
  });
  document.addEventListener('mouseout', function (event) {
    if (linkFrom(event.target) || peek.contains(event.target)) hideSoon();
  });
  document.addEventListener('focusin', function (event) { var link = linkFrom(event.target); if (link) show(link); });
  document.addEventListener('focusout', function (event) { if (linkFrom(event.target)) hideSoon(); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !peek.hidden) { event.stopPropagation(); event.preventDefault(); hide(); } }, true);
  document.addEventListener('click', hide);
  window.addEventListener('scroll', function (event) { if (event.target !== peek) hide(); }, true);
  window.addEventListener('resize', hide);

  // Article bodies link the entries they mention; an entry page links the
  // other entries it mentions, never itself.
  var own = document.querySelector('[data-lexicon-self]');
  if (own) load().then(function () { autoLink(own, own.getAttribute('data-lexicon-self')); });

  // Arriving at an entry from somewhere else on the site, offer the way back.
  var ret = document.querySelector('[data-lexicon-return]');
  if (ret) {
    var from = null;
    try { from = document.referrer ? new URL(document.referrer) : null; } catch (e) { from = null; }
    if (from && from.origin === window.location.origin && from.pathname !== window.location.pathname) {
      ret.hidden = false;
      ret.querySelector('button').addEventListener('click', function () { window.history.back(); });
    }
  }

  window.LexiconPeek = { load: load, autoLink: autoLink, hide: hide };
})();
