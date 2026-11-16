/**
 * The public submission form: the forum's rich text editor, rebuilt without
 * React so the archive ships one self-contained script.
 *
 * The document it produces uses exactly the markup the forum's sanitiser
 * keeps (named colours and sizes, never CSS), so what a submitter sees here is
 * what a reviewer opens there.
 *
 * Nothing leaves the browser until 提交 is pressed: pictures stay local, are
 * uploaded then, and the whole exchange happens under one human check.
 *
 * Bundled to static/js/submission.js by `npm run build:submission`.
 */
import { Editor, Mark } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { imageSelectionError, isImageSelection, prepareImage } from './images.mjs';
import { serializeSubmission, withoutPictures } from './document.mjs';

const TEXT_COLORS = { red: '红色', orange: '橙色', green: '绿色', blue: '蓝色', purple: '紫色', gray: '灰色' };
const HIGHLIGHT_COLORS = { yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色', purple: '紫色' };
const SIZE_LADDER = ['sm', null, 'lg', 'xl'];
const DRAFT_KEY = 'archive-submission-draft-v1';

const ICONS = {
  paragraph: '<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
  list: '<path d="M9 6h12"/><path d="M9 12h12"/><path d="M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  numbered: '<path d="M9 5h12"/><path d="M5 7V3L3.5 4.5"/><path d="M5.5 14h-2l1.9-2.96c.06-.1.1-.21.07-.32C5.42 10.46 5.22 10 4.5 10c-1 0-1 .89-1 .89v.22"/><path d="M4 19h.5a1 1 0 1 1 0 2h-1"/><path d="M3.5 17h2L4 19"/><path d="M9 12h12"/><path d="M9 19h12"/>',
  quote: '<path d="M7 7H4v6h3l-1.5 4"/><path d="M17 7h-3v6h3l-1.5 4"/>',
  rule: '<path d="M5 12h14"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11 4.93"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L13 19.07"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const ForumHighlight = Mark.create({
  name: 'forumHighlight',
  addAttributes() {
    return { color: { default: null, parseHTML: element => element.getAttribute('data-color'), renderHTML: attributes => (attributes.color in HIGHLIGHT_COLORS ? { 'data-color': attributes.color } : {}) } };
  },
  parseHTML() { return [{ tag: 'mark' }]; },
  renderHTML({ HTMLAttributes }) { return ['mark', HTMLAttributes, 0]; },
});

const ForumTextStyle = Mark.create({
  name: 'forumTextStyle',
  addAttributes() {
    return {
      color: { default: null, parseHTML: element => element.getAttribute('data-color'), renderHTML: attributes => (attributes.color in TEXT_COLORS ? { 'data-color': attributes.color } : {}) },
      size: { default: null, parseHTML: element => element.getAttribute('data-size'), renderHTML: attributes => (SIZE_LADDER.includes(attributes.size) && attributes.size ? { 'data-size': attributes.size } : {}) },
    };
  },
  parseHTML() { return [{ tag: 'span[data-color]' }, { tag: 'span[data-size]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', HTMLAttributes, 0]; },
});

/** A picture is a local preview until the form is sent. `localId` names the
 *  file kept in memory for it; the address is a blob only this page can read. */
const LocalImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      localId: { default: null, parseHTML: element => element.getAttribute('data-local-id'), renderHTML: attributes => (attributes.localId ? { 'data-local-id': attributes.localId } : {}) },
    };
  },
});

function element(tag, attributes = {}, html = '') {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === false || value === null || value === undefined) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  if (html) node.innerHTML = html;
  return node;
}

let turnstileLoading;
function loadTurnstile() {
  if (window.turnstile?.render) return Promise.resolve(window.turnstile);
  turnstileLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => { clearTimeout(timer); script.remove(); turnstileLoading = undefined; reject(new Error('人机验证加载失败，请检查网络后重试。')); };
    const timer = setTimeout(fail, 20_000);
    window.archiveSubmissionTurnstile = () => { clearTimeout(timer); resolve(window.turnstile); };
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=archiveSubmissionTurnstile';
    script.async = true;
    script.onerror = fail;
    document.head.append(script);
  });
  return turnstileLoading;
}

async function humanToken(sitekey, host) {
  // A preview build has no widget; the real receiver refuses its placeholder.
  if (!sitekey) return 'preview';
  const api = await loadTurnstile();
  host.replaceChildren();
  return new Promise((resolve, reject) => {
    let widget, settled = false;
    const finish = (token, error) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (widget !== undefined) api.remove(widget);
      host.replaceChildren();
      if (error) reject(new Error(error)); else resolve(token);
    };
    const timer = setTimeout(() => finish(null, '人机验证超时，请重试。'), 120_000);
    try {
      widget = api.render(host, { sitekey, action: 'submission', retry: 'never',
        callback: token => finish(token),
        'error-callback': () => { finish(null, '人机验证未通过，请重试。'); return true; },
        'expired-callback': () => finish(null, '人机验证已过期，请重试。') });
    } catch { finish(null, '人机验证初始化失败，请重试。'); }
  });
}

class Rejected extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data ?? {}; }
}

async function request(endpoint, path, options = {}) {
  let response;
  try { response = await fetch(`${endpoint}${path}`, { ...options, mode: 'cors', credentials: 'omit', cache: 'no-store' }); }
  catch { throw new Rejected('无法连接投稿服务，请检查网络后重试。', 0); }
  let data = {};
  try { data = await response.json(); } catch { /* An empty body is reported by status. */ }
  if (!response.ok) throw new Rejected(data.error || `投稿服务返回了 ${response.status} 错误，请稍后重试。`, response.status, data);
  return data;
}

function mount(root) {
  const endpoint = root.dataset.endpoint.replace(/\/+$/u, '');
  const sitekey = root.dataset.turnstileKey ?? '';
  const files = new Map();
  let limits = { textChars: 200_000, htmlChars: 400_000, images: 30, imageBytes: 4 * 1024 * 1024, imagePixels: 40_000_000 };
  let mode = 'open', imagesAllowed = true, busy = false, highlightColor = 'yellow', textColor = 'red', panel = null;

  const form = root.querySelector('[data-submission-form]');
  const status = root.querySelector('[data-submission-status]');
  const closedNotice = root.querySelector('[data-submission-closed]');
  const done = root.querySelector('[data-submission-done]');
  const codeField = root.querySelector('[data-submission-code-field]');
  const codeToggle = root.querySelector('[data-submission-code-toggle]');
  const submitButton = form.querySelector('[type="submit"]');
  const counter = root.querySelector('[data-submission-count]');
  const verification = root.querySelector('[data-submission-verification]');
  const shell = root.querySelector('[data-submission-editor]');
  const input = name => form.elements.namedItem(name);

  const toolbar = element('div', { class: 'rich-editor-toolbar', role: 'toolbar', 'aria-label': '文字格式工具栏' });
  const stylePanel = element('div', { class: 'rich-style-picker', hidden: true });
  const linkPanel = element('div', { class: 'rich-link-editor', hidden: true });
  const surface = element('div', { class: 'rich-editor-surface' });
  const picker = element('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif', multiple: true, hidden: true, 'aria-label': '选择图片' });
  shell.replaceChildren(toolbar, stylePanel, linkPanel, surface, picker);

  const editor = new Editor({
    element: surface,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https', protocols: ['http', 'https', 'mailto'], HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' } }),
      LocalImage.configure({ allowBase64: false, HTMLAttributes: { class: 'post-image' } }),
      ForumHighlight,
      ForumTextStyle,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'rich-editor-content', role: 'textbox', 'aria-multiline': 'true', 'aria-label': '投稿正文' },
      handlePaste(_view, event) {
        const pasted = [...(event.clipboardData?.files ?? [])].filter(isImageSelection);
        if (!pasted.length) return false;
        event.preventDefault();
        void addPictures(pasted);
        return true;
      },
      handleDrop(_view, event) {
        const dropped = [...(event.dataTransfer?.files ?? [])].filter(isImageSelection);
        if (!dropped.length) return false;
        event.preventDefault();
        void addPictures(dropped);
        return true;
      },
      // Pasted markup may carry pictures from other sites. Only pictures chosen
      // on this page are sent, so the rest are dropped where they arrive.
      transformPastedHTML: html => withoutPictures(html),
    },
    onUpdate: () => { refresh(); scheduleDraft(); },
    onSelectionUpdate: () => refresh(),
  });

  const buttons = [];
  function tool(label, symbol, { run, active, enabled, className = '', symbolClass = '' }) {
    const button = element('button', { type: 'button', 'aria-label': label, 'data-tooltip': label, class: className || null },
      symbol.startsWith('<svg') ? symbol : `<span aria-hidden="true" class="toolbar-icon ${symbolClass}">${symbol}</span>`);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => { if (!busy) run(button); });
    buttons.push({ button, active, enabled, symbolClass });
    return button;
  }
  const chain = () => editor.chain().focus();

  function applyTextStyle(patch) {
    const current = editor.getAttributes('forumTextStyle');
    const color = patch.color !== undefined ? patch.color : (current.color in TEXT_COLORS ? current.color : null);
    const size = patch.size !== undefined ? patch.size : (SIZE_LADDER.includes(current.size) ? current.size : null);
    if (!color && !size) chain().unsetMark('forumTextStyle').run();
    else chain().setMark('forumTextStyle', { color, size }).run();
  }
  function stepSize(direction) {
    const current = editor.getAttributes('forumTextStyle').size;
    const index = SIZE_LADDER.indexOf(SIZE_LADDER.includes(current) ? current : null);
    applyTextStyle({ size: SIZE_LADDER[Math.min(SIZE_LADDER.length - 1, Math.max(0, index + direction))] });
  }
  function openPanel(next) {
    panel = panel === next ? null : next;
    stylePanel.hidden = panel !== 'highlight' && panel !== 'color';
    linkPanel.hidden = panel !== 'link';
    if (panel === 'highlight' || panel === 'color') renderStylePanel();
    if (panel === 'link') renderLinkPanel();
  }
  function renderStylePanel() {
    const highlight = panel === 'highlight';
    const names = highlight ? HIGHLIGHT_COLORS : TEXT_COLORS;
    const active = highlight ? editor.getAttributes('forumHighlight').color : editor.getAttributes('forumTextStyle').color;
    stylePanel.replaceChildren(element('span', {}, highlight ? '高亮颜色' : '文字颜色'));
    for (const [name, label] of Object.entries(names)) {
      const swatch = element('button', { type: 'button', class: `rich-style-swatch rich-style-swatch-${highlight ? 'highlight' : 'color'}-${name}${active === name ? ' is-active' : ''}`, 'aria-label': label, title: label });
      swatch.addEventListener('mousedown', event => event.preventDefault());
      swatch.addEventListener('click', () => {
        if (highlight) { highlightColor = name; chain().setMark('forumHighlight', { color: name }).run(); }
        else { textColor = name; applyTextStyle({ color: name }); }
        openPanel(null);
      });
      stylePanel.append(swatch);
    }
    const clear = element('button', { type: 'button', class: 'rich-style-clear' }, highlight ? '取消高亮' : '恢复默认颜色');
    clear.addEventListener('mousedown', event => event.preventDefault());
    clear.addEventListener('click', () => { if (highlight) chain().unsetMark('forumHighlight').run(); else applyTextStyle({ color: null }); openPanel(null); });
    stylePanel.append(clear);
  }
  function renderLinkPanel() {
    const current = editor.getAttributes('link').href ?? '';
    const field = element('input', { type: 'url', placeholder: 'https://', value: current, 'aria-label': '链接地址' });
    const confirm = element('button', { type: 'button' }, '确定');
    const remove = element('button', { type: 'button' }, '移除链接');
    const apply = () => {
      const typed = field.value.trim();
      if (!typed) { chain().extendMarkRange('link').unsetLink().run(); openPanel(null); return; }
      const href = /^[a-z][a-z0-9+.-]*:/iu.test(typed) ? typed : `https://${typed}`;
      if (!/^(?:https?:\/\/|mailto:)/iu.test(href)) { say('链接只支持 http、https 和 mailto。', true); return; }
      if (editor.state.selection.empty && !editor.isActive('link')) chain().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
      else chain().extendMarkRange('link').setLink({ href }).run();
      openPanel(null);
    };
    field.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } });
    confirm.addEventListener('click', apply);
    remove.addEventListener('click', () => { chain().extendMarkRange('link').unsetLink().run(); openPanel(null); });
    linkPanel.replaceChildren(field, confirm, ...(current ? [remove] : []));
    field.focus();
  }

  const split = (...children) => { const group = element('span', { class: 'toolbar-split' }); group.append(...children); return group; };
  const caret = (label, target) => {
    const button = element('button', { type: 'button', class: 'toolbar-caret', 'aria-label': label }, '▾');
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => openPanel(target));
    return button;
  };
  const highlightButton = tool('高亮', 'A', { symbolClass: 'toolbar-icon-highlight', active: () => editor.isActive('forumHighlight'),
    run: () => (editor.isActive('forumHighlight') ? chain().unsetMark('forumHighlight').run() : chain().setMark('forumHighlight', { color: highlightColor }).run()) });
  const colorButton = tool('文字颜色', 'A', { symbolClass: 'toolbar-icon-color', active: () => editor.getAttributes('forumTextStyle').color in TEXT_COLORS,
    run: () => applyTextStyle({ color: editor.getAttributes('forumTextStyle').color in TEXT_COLORS ? null : textColor }) });
  const imageButton = tool('插入图片', icon('image'), { run: () => picker.click(), enabled: () => imagesAllowed });
  toolbar.append(
    tool('正文', icon('paragraph'), { run: () => chain().setParagraph().run(), active: () => editor.isActive('paragraph') }),
    ...[1, 2, 3].map(level => tool(`${'一二三'[level - 1]}级标题`, `H${level}`, { symbolClass: 'toolbar-icon-heading', run: () => chain().toggleHeading({ level }).run(), active: () => editor.isActive('heading', { level }) })),
    tool('加粗', 'B', { symbolClass: 'toolbar-icon-bold', run: () => chain().toggleBold().run(), active: () => editor.isActive('bold') }),
    tool('斜体', 'I', { symbolClass: 'toolbar-icon-italic', run: () => chain().toggleItalic().run(), active: () => editor.isActive('italic') }),
    tool('下划线', 'U', { symbolClass: 'toolbar-icon-underline', run: () => chain().toggleUnderline().run(), active: () => editor.isActive('underline') }),
    tool('删除线', 'S', { symbolClass: 'toolbar-icon-strike', run: () => chain().toggleStrike().run(), active: () => editor.isActive('strike') }),
    split(highlightButton, caret('选择高亮颜色', 'highlight')),
    split(colorButton, caret('选择文字颜色', 'color')),
    tool('增大字号', 'A', { symbolClass: 'toolbar-icon-size-up', run: () => stepSize(1) }),
    tool('减小字号', 'A', { symbolClass: 'toolbar-icon-size-down', run: () => stepSize(-1) }),
    tool('列表', icon('list'), { run: () => chain().toggleBulletList().run(), active: () => editor.isActive('bulletList') }),
    tool('编号', icon('numbered'), { run: () => chain().toggleOrderedList().run(), active: () => editor.isActive('orderedList') }),
    tool('引用', icon('quote'), { run: () => chain().toggleBlockquote().run(), active: () => editor.isActive('blockquote') }),
    tool('分隔线', icon('rule'), { run: () => chain().setHorizontalRule().run() }),
    tool('链接', icon('link'), { run: () => openPanel('link'), active: () => editor.isActive('link') }),
    imageButton,
    element('span', { class: 'toolbar-spacer', 'aria-hidden': 'true' }),
    tool('撤销', icon('undo'), { run: () => chain().undo().run(), enabled: () => editor.can().undo() }),
    tool('重做', icon('redo'), { run: () => chain().redo().run(), enabled: () => editor.can().redo() }),
  );

  function pictureCount() {
    let count = 0;
    editor.state.doc.descendants(node => { if (node.type.name === 'image') count += 1; });
    return count;
  }
  function refresh() {
    for (const { button, active, enabled } of buttons) {
      const on = Boolean(active?.());
      button.classList.toggle('is-active', on);
      if (active) button.setAttribute('aria-pressed', String(on));
      button.disabled = busy || (enabled ? !enabled() : false);
    }
    highlightButton.firstElementChild.className = `toolbar-icon toolbar-icon-highlight toolbar-swatch-highlight-${editor.getAttributes('forumHighlight').color ?? highlightColor}`;
    colorButton.firstElementChild.className = `toolbar-icon toolbar-icon-color toolbar-swatch-color-${editor.getAttributes('forumTextStyle').color ?? textColor}`;
    imageButton.hidden = !imagesAllowed;
    const characters = editor.getText().replace(/\s+/gu, '').length, pictures = pictureCount();
    counter.textContent = `${characters.toLocaleString('zh-CN')} 字${pictures ? ` · ${pictures} 张图片` : ''}`;
    counter.classList.toggle('is-over', characters > limits.textChars || pictures > limits.images);
  }

  function say(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
    status.hidden = !message;
  }

  async function addPictures(selected) {
    if (!imagesAllowed) { say('目前暂停接收图片，文字投稿不受影响。', true); return; }
    say('');
    for (const file of selected) {
      if (pictureCount() >= limits.images) { say(`一次投稿最多 ${limits.images} 张图片，其余的没有添加。`, true); break; }
      const problem = imageSelectionError(file, limits);
      if (problem) { say(problem, true); continue; }
      try {
        say(`正在处理“${file.name}”…`);
        const prepared = await prepareImage(file, limits);
        const localId = crypto.randomUUID();
        files.set(localId, { file: prepared, url: URL.createObjectURL(prepared) });
        chain().insertContent([{ type: 'image', attrs: { src: files.get(localId).url, alt: '', localId } }, { type: 'paragraph' }]).run();
        say('');
      } catch (error) { say(error.message || '这张图片无法处理，请换一张。', true); }
    }
  }
  picker.addEventListener('change', () => { const chosen = [...picker.files]; picker.value = ''; void addPictures(chosen); });

  /** Text only. A picture cannot outlive the page, so the draft says so
   *  instead of restoring a broken frame. */
  let draftTimer;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try {
        const html = withoutPictures(editor.getHTML());
        const fields = Object.fromEntries(['title', 'author', 'origin', 'note'].map(name => [name, input(name).value]));
        if (!editor.getText().trim() && !Object.values(fields).some(value => value.trim())) { localStorage.removeItem(DRAFT_KEY); return; }
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...fields, html: html.length <= 600_000 ? html : '', hadPictures: pictureCount() > 0 }));
      } catch { /* Private browsing or a full store: the page still works. */ }
    }, 1500);
  }
  function restoreDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null');
      if (!draft) return;
      for (const name of ['title', 'author', 'origin', 'note']) if (typeof draft[name] === 'string') input(name).value = draft[name];
      if (typeof draft.html === 'string' && draft.html) editor.commands.setContent(withoutPictures(draft.html));
      say(draft.hadPictures ? '已恢复上次没有提交的文字。图片不会保存在浏览器里，需要重新添加。' : '已恢复上次没有提交的内容。');
    } catch { /* A damaged draft is ignored. */ }
  }
  form.addEventListener('input', scheduleDraft);

  function setBusy(next) {
    busy = next;
    editor.setEditable(!next);
    for (const control of form.querySelectorAll('input, textarea, button')) control.disabled = next;
    submitButton.textContent = next ? '正在提交…' : '提交投稿';
    refresh();
  }

  function applyEntrance(config) {
    mode = config.mode; imagesAllowed = config.images !== false; limits = { ...limits, ...config.limits };
    closedNotice.hidden = mode !== 'closed';
    form.hidden = mode === 'closed';
    codeField.hidden = mode !== 'code' && !codeField.dataset.opened;
    codeToggle.hidden = mode === 'code';
    input('code').required = mode === 'code';
    root.querySelector('[data-submission-images-paused]').hidden = imagesAllowed;
    refresh();
  }
  codeToggle.addEventListener('click', () => { codeField.dataset.opened = 'true'; codeField.hidden = false; codeToggle.hidden = true; input('code').focus(); });

  async function send() {
    const title = input('title').value.trim();
    if (!title) { say('请填写标题。', true); input('title').focus(); return; }
    const pictures = pictureCount();
    const characters = editor.getText().replace(/\s+/gu, '').length;
    if (!characters && !pictures) { say('请填写正文或添加图片。', true); editor.commands.focus(); return; }
    if (characters > limits.textChars) { say(`正文不能超过 ${limits.textChars.toLocaleString('zh-CN')} 字。`, true); return; }
    if (pictures > limits.images) { say(`一次投稿最多 ${limits.images} 张图片。`, true); return; }
    if (mode === 'code' && !input('code').value.trim()) { say('目前需要投稿码才能投稿，请向小组索取。', true); input('code').focus(); return; }
    setBusy(true);
    try {
      // One retry with a fresh check, for a session that ran out mid-upload.
      for (let attempt = 0; ; attempt += 1) {
        try { await deliver(title); break; }
        catch (error) { if (!(error instanceof Rejected) || error.status !== 401 || attempt > 0) throw error; }
      }
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* Nothing was stored. */ }
      for (const { url } of files.values()) URL.revokeObjectURL(url);
      files.clear();
      form.hidden = true;
      done.hidden = false;
      done.focus();
      say('');
    } catch (error) {
      if (error instanceof Rejected && error.data.needsCode) { codeField.hidden = false; codeToggle.hidden = true; }
      say(error.message || '提交失败，请稍后重试。内容仍保留在本页。', true);
    } finally { setBusy(false); }
  }

  async function deliver(title) {
    say('正在进行人机验证…');
    const token = await humanToken(sitekey, verification);
    const code = input('code').value.trim();
    const session = await request(endpoint, '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...(code ? { code } : {}) }) });
    const authorization = { authorization: `Bearer ${session.session}` };
    const { localIds } = serializeSubmission(editor.getHTML());
    const uploaded = new Map();
    for (const [index, localId] of localIds.entries()) {
      const local = files.get(localId);
      if (!local) throw new Rejected('有一张图片已经失效，请删除后重新添加。', 400);
      say(`正在上传图片 ${index + 1}/${localIds.length}…`);
      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await request(endpoint, '/images', { method: 'POST', headers: { ...authorization, 'content-type': local.file.type }, body: local.file });
          uploaded.set(localId, result.id);
          break;
        } catch (error) {
          if (!(error instanceof Rejected) || error.status !== 0 || attempt >= 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }
    say('正在提交…');
    const result = await request(endpoint, '/submissions', { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: JSON.stringify({
      title, author: input('author').value, origin: input('origin').value, note: input('note').value, contact: input('contact').value,
      html: serializeSubmission(editor.getHTML(), uploaded).html,
    }) });
    done.querySelector('[data-submission-receipt]').textContent = result.receipt ?? '';
  }

  form.addEventListener('submit', event => { event.preventDefault(); if (!busy) void send(); });
  root.querySelector('[data-submission-again]').addEventListener('click', () => {
    form.reset(); editor.commands.clearContent(true); done.hidden = true; form.hidden = false; refresh(); input('title').focus();
  });

  restoreDraft();
  refresh();
  request(endpoint, '/config').then(applyEntrance).catch(error => {
    // An unreachable receiver must not look like an open form that then fails.
    if (error.status === 503 || error.status === 0) { closedNotice.hidden = false; form.hidden = true; }
  });
}

for (const root of document.querySelectorAll('[data-submission]')) {
  try { mount(root); }
  catch (error) { console.error(error); root.querySelector('[data-submission-closed]')?.removeAttribute('hidden'); }
}
