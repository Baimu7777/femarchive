function articlePath(value) {
  if (typeof value !== 'string' || !/^\/(posts|lexicon)\//.test(value)) return '';
  try {
    const path = decodeURI(value).replace(/\/+$/, '') + '/';
    return /^\/(posts|lexicon)\/[^/?#\\]+\/$/u.test(path) ? path : '';
  } catch {
    return '';
  }
}

export function latestArticleComments(comments, now = Date.now()) {
  const times = new Map();
  for (const comment of comments) {
    if (comment?.status !== 'approved') continue;
    const path = articlePath(comment.url);
    const time = comment.time;
    if (!path || !Number.isSafeInteger(time) || time <= 0 || time > now) continue;
    times.set(path, Math.max(times.get(path) ?? 0, time));
  }
  return Object.fromEntries(times);
}

export function rankArticleCards(cards, commentTimes) {
  const activity = card => Math.max(
    card.updatedAt,
    card.commentPath ? commentTimes[articlePath(card.commentPath)] ?? 0 : 0,
  );
  return [...cards].sort((a, b) =>
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || activity(b) - activity(a),
  );
}
