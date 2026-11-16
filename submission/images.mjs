/**
 * Picture checks and shrinking before upload, the same rules the forum's own
 * editor applies. The receiver and the forum check the bytes again.
 */
const SELECTION_LIMIT = 20 * 1024 * 1024;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function imageType(file) {
  const type = (file.type || '').toLowerCase();
  if (TYPES.has(type)) return type;
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg';
  if (type && type !== 'application/octet-stream') return null;
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[extension ?? ''] ?? null;
}

export function isImageSelection(file) {
  return (file.type || '').startsWith('image/') || imageType(file) !== null;
}

export function imageSelectionError(file, limits) {
  const megabytes = Math.floor(limits.imageBytes / 1024 / 1024);
  const type = imageType(file);
  if (!type) return /heic|heif/iu.test(`${file.name} ${file.type}`)
    ? `“${file.name}”是 HEIC/HEIF 图片，请先导出为 JPEG 或 PNG。`
    : `“${file.name}”不是支持的 JPEG、PNG、WebP 或 GIF 图片。`;
  if (file.size > SELECTION_LIMIT) return `“${file.name}”超过 20 MB，没有添加。`;
  if (type === 'image/gif' && file.size > limits.imageBytes) return `“${file.name}”超过 ${megabytes} MB；GIF 不会自动压缩，以免丢失动图内容。`;
  return null;
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch { /* Older browsers need an image element for some formats. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('图片无法解码，请重新导出为 JPEG 或 PNG 后再试。'));
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => { image.src = ''; URL.revokeObjectURL(url); } };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function prepareImage(file, limits) {
  const type = imageType(file);
  const typed = file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
  if (file.size <= limits.imageBytes) return typed;
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const signature = String.fromCharCode(...header);
  if (signature.startsWith('GIF8')) throw new Error('GIF 过大；不会自动压缩，以免丢失动图内容。');
  if (signature.startsWith('RIFF') && signature.slice(8, 16) === 'WEBPVP8X' && (header[20] & 2)) throw new Error('WebP 动图过大，请缩小后再添加。');
  const image = await decode(typed);
  const canvas = document.createElement('canvas');
  try {
    if (!image.width || !image.height || image.width * image.height > limits.imagePixels) throw new Error('图片像素过大，请先缩小再添加。');
    const scale = Math.min(1, 2400 / image.width, 2400 / image.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理大图，请先缩小图片。');
    for (let step = 0; step < 4; step += 1) {
      canvas.width = Math.max(1, Math.round(image.width * scale * 0.8 ** step));
      canvas.height = Math.max(1, Math.round(image.height * scale * 0.8 ** step));
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.88, 0.76, 0.64]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.size > 0 && blob.size <= limits.imageBytes && TYPES.has(blob.type)) {
          return new File([blob], `${file.name.replace(/\.[^.]+$/u, '')}.${blob.type === 'image/webp' ? 'webp' : 'png'}`, { type: blob.type, lastModified: file.lastModified });
        }
      }
    }
    throw new Error('图片自动压缩后仍然过大，请缩小尺寸后再添加。');
  } finally { image.release(); canvas.width = 0; canvas.height = 0; }
}
