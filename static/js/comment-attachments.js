import {verifyTurnstile} from './turnstile-loader.js';

export function createAttachments(textarea, sitekey) {
  const items = [];
  let panel, pending = false, currentPath, generation = 0;
  function mount() {
    const editor = textarea();
    if (!editor) throw Error('评论编辑器尚未准备好。');
    if (!panel?.isConnected) {
      panel = document.createElement('div');
      panel.className = 'comment-attachments';
      panel.setAttribute('aria-label', '评论图片附件');
      editor.after(panel);
    }
    return panel;
  }
  function clear() { generation++; items.splice(0); panel?.replaceChildren(); }
  return {
    sync(path) { if (currentPath !== undefined && currentPath !== path) clear(); currentPath = path; },
    markdown() { return items.map(item => `\n\n![评论图片](${item.url})`).join(''); },
    clear,
    async add(file) {
      if (pending) throw Error('请等待当前图片上传完成。');
      if (items.length >= 3) throw Error('每条评论最多附加 3 张图片。');
      if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 2 * 1024 * 1024) throw Error('请选择不超过 2MB 的 JPG、PNG、WEBP 或 GIF 图片。');
      pending = true;
      const started = generation;
      const card = document.createElement('div'), status = document.createElement('span');
      card.className = 'comment-attachment'; status.setAttribute('role', 'status');
      status.textContent = '正在准备验证…'; card.append(status); mount().append(card);
      try {
        const availability = await fetch('/api/comment-images', {cache:'no-store'});
        if (!availability.ok) throw Error('图片上传暂未开放，请先发表文字评论。');
        const token = await verifyTurnstile(sitekey(), 'comment_image', card);
        if (started !== generation) return;
        status.textContent = '正在上传和处理图片…';
        const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
        const response = await fetch('/api/comment-images', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({token,data}), signal:AbortSignal.timeout(45000)});
        const result = await response.json();
        if (started !== generation) return;
        if (!response.ok) throw Error(result.error || '图片上传失败，请重试。');
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || /[()\s]/.test(url.href)) throw Error('图片地址无效。');
        const item = {url:url.href}; items.push(item);
        const img = document.createElement('img'); img.src = item.url; img.alt = '待发表的评论图片';
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '移除图片';
        remove.onclick = () => { const index = items.indexOf(item); if (index !== -1) items.splice(index,1); card.remove(); };
        status.textContent = '上传完成 · 发表后可见'; card.replaceChildren(img,status,remove);
      } catch (error) {
        status.textContent = error.message || '上传失败，请重新选择图片。';
        const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.textContent = '移除'; dismiss.onclick = () => card.remove(); card.append(dismiss);
      } finally { pending = false; }
    }
  };
}
