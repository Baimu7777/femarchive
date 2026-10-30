// Browser-local pseudonyms: no email, IP lookup or external avatar service.
export function prepareAnonymousIdentity(storage, server, uuid) {
  try {
    const key = `archive-anonymous:${server}`;
    let id = storage.getItem(key);
    if (!/^[a-f0-9]{12}$/.test(id || '')) {
      id = uuid().replace(/-/g, '').slice(0, 12);
      storage.setItem(key, id);
    }
    const meta = JSON.parse(storage.getItem('WALINE_USER_META') || '{}');
    if (!meta.nick?.trim() && !meta.mail?.trim()) {
      storage.setItem('WALINE_USER_META', JSON.stringify({ ...meta, nick: `匿名·${id}`, mail: '', link: meta.link || '' }));
    }
    return id;
  } catch { return null; }
}

export function avatarFor(key) {
  let hash = 2166136261;
  for (const ch of key) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
  const hue = hash % 360;
  const cells = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    const bit = (hash >>> ((y * 3 + x) % 32)) & 1;
    if (bit) {
      cells.push(`<rect x="${8 + x * 9}" y="${8 + y * 9}" width="9" height="9"/>`);
      if (x < 2) cells.push(`<rect x="${8 + (4 - x) * 9}" y="${8 + y * 9}" width="9" height="9"/>`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 61 61"><rect width="61" height="61" rx="15" fill="hsl(${hue} 35% 94%)"/><g fill="hsl(${hue} 40% 38%)">${cells.join('')}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function updateAnonymousAvatars(root) {
  for (const item of root.querySelectorAll('.wl-card-item')) {
    const nick = item.querySelector(':scope > .wl-card > .wl-head .wl-nick');
    const name = nick?.textContent.trim() || '';
    if (!/^(匿名|Anonymous)(?:·[a-f0-9]{12})?$/i.test(name)) continue;
    const user = item.querySelector(':scope > .wl-user');
    if (!user) continue;
    let image = user.querySelector('img');
    if (!image) { image = document.createElement('img'); image.className = 'wl-user-avatar'; image.alt = ''; user.prepend(image); }
    if (!image.dataset.originalAvatar) image.dataset.originalAvatar = image.getAttribute('src') || 'none';
    const meta = item.querySelector(':scope > .wl-card > .wl-meta')?.textContent.trim() || '';
    // Old records lack a browser-local pseudonym. Use their existing metadata;
    // when none exists, distinguish comments without claiming shared authorship.
    const key = name.includes('·') ? name : `${name}|${image.dataset.originalAvatar}|${meta || item.id}`;
    const src = avatarFor(key);
    if (image.getAttribute('src') !== src) image.setAttribute('src', src);
  }
}
