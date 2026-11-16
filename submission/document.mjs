/**
 * Turns the editor's markup into what is sent. These work on the submitter's
 * own document in her own browser; nothing here is a security boundary. The
 * receiver bounds the size and the forum sanitises the markup.
 */
const PICTURE = /<img\b[^>]*>/giu;
const attribute = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`, 'iu').exec(tag)?.[1] ?? '';

export function withoutPictures(html) {
  return String(html).replace(PICTURE, '');
}

/**
 * Lists the local pictures in document order. Given the identifiers the
 * receiver issued for them, also rewrites each picture to carry that
 * identifier and nothing else: the blob address only ever meant something on
 * this page.
 */
export function serializeSubmission(html, uploaded) {
  const localIds = [];
  const rewritten = String(html).replace(PICTURE, tag => {
    const localId = attribute(tag, 'data-local-id');
    if (!localId) return '';
    if (!localIds.includes(localId)) localIds.push(localId);
    if (!uploaded) return tag;
    const id = uploaded.get(localId);
    if (!id) return '';
    const alt = attribute(tag, 'alt');
    return `<img data-submission-image="${id}"${alt ? ` alt="${alt}"` : ''}>`;
  });
  return { html: rewritten, localIds };
}
