import test from 'node:test';
import assert from 'node:assert/strict';
import { latestArticleComments, rankArticleCards } from '../static/js/article-activity.js';

test('only public article comments and replies contribute to activity', () => {
  const now = Date.parse('2026-11-15T18:00:00Z');
  const path = '/posts/旧文章/';
  const results = latestArticleComments([
    { url: path, status: 'approved', time: now - 3000 },
    { url: encodeURI(path), status: 'approved', time: now - 2000, pid: 3 },
    { url: path, status: 'waiting', time: now - 1000 },
    { url: path, status: 'approved', time: now + 1000 },
    { url: '/feedback/posts/旧文章/', status: 'approved', time: now - 100 },
    { url: '/news/262001/', status: 'approved', time: now - 100 },
  ], now);
  assert.deepEqual(results, { [path]: now - 2000 });
});

test('pin stays first and replies use the original thread path across pages', () => {
  const cards = [
    { url: '/posts/recent/', updatedAt: 30 },
    { url: '/posts/second/', updatedAt: 25 },
    { url: '/posts/older/', commentPath: '/posts/legacy/', updatedAt: 10 },
    { url: '/posts/pin/', pinned: true, updatedAt: 1 },
    { url: '/posts/quiet/', updatedAt: 20 },
  ];
  const ranked = rankArticleCards(cards, { '/posts/legacy/': 40, '/posts/recent/': 4 });
  assert.deepEqual(ranked.slice(0, 2).map(x => x.url), ['/posts/pin/', '/posts/older/']);
  assert.deepEqual(ranked.slice(2).map(x => x.url), ['/posts/recent/', '/posts/second/', '/posts/quiet/']);
  assert.equal(cards[0].url, '/posts/recent/');
});

test('activity endpoint returns only timestamps and uses the configured public origin', async () => {
  const { getArticleActivity } = await import('../api/article-activity.mjs');
  const now = Date.now() - 10;
  const request = new Request('https://example.test/api/article-activity');
  const response = await getArticleActivity(request, async (url, options) => {
    assert.equal(new URL(url).searchParams.get('type'), 'recent');
    assert.equal(options.headers.Origin, 'https://herarchive.feminism-nv.top');
    return Response.json({
      errno: 0,
      data: [{ url: '/posts/261001/', time: now, status: 'approved', comment: '只用于上游响应' }],
    });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { '/posts/261001/': now });
  assert.match(response.headers.get('cache-control'), /s-maxage/);
});

test('upstream failure is reported without caching empty rankings', async () => {
  const { getArticleActivity } = await import('../api/article-activity.mjs');
  const response = await getArticleActivity(new Request('https://example.test/api/article-activity'),
    async () => Response.json({ errno: 1 }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('lexicon activity includes public replies and ranks across all entries',()=>{
  const now=Date.now();
  const times=latestArticleComments([
    {url:'/lexicon/old/',status:'approved',time:now-10,pid:'parent'},
    {url:'/lexicon/recent/',status:'waiting',time:now-1},
    {url:'/feedback/lexicon/recent/',status:'approved',time:now-1},
  ],now);
  assert.deepEqual(times,{'/lexicon/old/':now-10});
  const ranked=rankArticleCards([
    {url:'/lexicon/recent/',commentPath:'/lexicon/recent/',updatedAt:now-100},
    {url:'/lexicon/old/',commentPath:'/lexicon/old/',updatedAt:now-1000},
  ],times);
  assert.equal(ranked[0].url,'/lexicon/old/');
});
