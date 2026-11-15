import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const vercel = JSON.parse(await read('vercel.json'));
const headers = new Map(vercel.headers.find(rule => rule.source === '/(.*)').headers.map(header => [header.key.toLowerCase(), header.value]));
const csp = new Map(headers.get('content-security-policy').split(';').map(part => part.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
const allows = (directive, url) => {
  const { origin, hostname } = new URL(url);
  return (csp.get(directive) ?? csp.get('default-src')).some(source => source === origin
    || (source.startsWith('https://*.') && hostname.endsWith(source.slice('https://*'.length))) || source === 'https:');
};

test('every page is served with the fixed security headers', () => {
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.match(headers.get('strict-transport-security'), /^max-age=\d{8,}/);
  // The comment login opens a window on the comment service and hears back
  // from it, so the opener policy must keep popups connected.
  assert.equal(headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.deepEqual(csp.get('object-src'), ["'none'"]);
  assert.deepEqual(csp.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(csp.get('base-uri'), ["'self'"]);
});

test('the policy lets the comment client reach everything the site configures for it', async () => {
  const config = await read('config/_default/hugo.toml');
  const server = /serverURL = "([^"]+)"/.exec(config)[1];
  assert.ok(allows('connect-src', server), 'comment service');
  // The comment client fetches <pack>/info.json for each emoji pack; a pack on
  // a host the policy does not name leaves the emoji panel empty.
  const emoji = /emoji = \[([^\]]*)\]/s.exec(config)[1].match(/https:\/\/[^"\s]+/g);
  assert.ok(emoji.length > 0);
  for (const pack of emoji) {
    assert.ok(allows('connect-src', pack), `emoji pack ${pack}`);
    assert.ok(allows('img-src', pack), `emoji images ${pack}`);
  }
  assert.ok(allows('script-src', 'https://challenges.cloudflare.com/turnstile/v0/api.js'));
  assert.ok(allows('frame-src', 'https://challenges.cloudflare.com/'));
});

test('no page loads script or style from a third-party package host', async () => {
  for (const directive of ['script-src', 'style-src']) {
    for (const source of csp.get(directive)) assert.doesNotMatch(source, /unpkg|jsdelivr/, `${directive} ${source}`);
  }
  // The comment client and its stylesheet are the vendored, pinned copies.
  const sources = await Promise.all(['layouts/partials/head.html', 'layouts/partials/waline.html', 'layouts/_default/baseof.html', 'static/js/site.js', 'static/js/lexicon.js'].map(read));
  for (const source of sources) assert.doesNotMatch(source, /(?:import\(|src=|href=)\s*['"]https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)/);
  const script = await read('static/vendor/waline.js'), style = await read('static/vendor/waline.css');
  assert.match(script, /`3\.16\.2`/);
  assert.match(style, /--waline-theme-color/);
  assert.match(style, /\.wl-comment/);
});

test('templates version scripts by content, never by build time', async () => {
  for (const path of ['layouts/_default/baseof.html', 'layouts/lexicon/list.html', 'layouts/partials/feedback-editor.html', 'layouts/partials/feedback-form.html', 'layouts/partials/head.html']) {
    assert.doesNotMatch(await read(path), /now\.Unix/, path);
  }
});

test('a hand-written link cannot carry a script scheme', async () => {
  const template = await read('layouts/_default/_markup/render-link.html');
  assert.match(template, /https\?\|mailto\|tel/);
  assert.doesNotMatch(template, /\.Destination \| safeURL/);
});

test('the notification hook installed in the comment service never throws', async () => {
  const { createRequire } = await import('node:module');
  const { notifyPublished } = createRequire(import.meta.url)('../deploy/waline-notifications/index.cjs');
  const saved = { ...process.env }, logged = [], error = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    process.env.ARCHIVE_NOTIFICATIONS_ENABLED = 'true';
    delete process.env.ARCHIVE_NOTIFICATIONS_ENDPOINT;
    const result = await notifyPublished({ status: 'approved', pid: '1', objectId: '2', url: '/posts/261041/', comment: '只属于评论的正文' });
    assert.deepEqual(result, { delivered: false });
    assert.equal(logged.length, 1);
    assert.ok(!logged[0].includes('只属于评论的正文'));
    process.env.ARCHIVE_NOTIFICATIONS_ENABLED = 'false';
    assert.equal((await notifyPublished({ status: 'approved', pid: '1', objectId: '2' })).delivered, false);
  } finally { console.error = error; process.env = saved; }
});
