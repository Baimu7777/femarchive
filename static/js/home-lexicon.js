import { rankArticleCards } from './article-activity.js?v=2';
const list = document.querySelector('[data-home-lexicon-list]');
const data = document.querySelector('[data-home-lexicon-cards]');
if (list && data) {
  try {
    const cards = JSON.parse(data.textContent);
    const response = await fetch('/api/article-activity', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Activity unavailable');
    const times = await response.json();
    const ranked = rankArticleCards(cards, times).slice(0, 3);
    const template = document.createElement('template');
    // HTML comes only from the site's build; the comment service supplies timestamps.
    template.innerHTML = ranked.map(card => card.html).join('');
    list.replaceChildren(template.content);
  } catch {
    // The server-rendered list remains usable if activity cannot be read.
  }
}
