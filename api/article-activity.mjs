import { latestArticleComments } from '../static/js/article-activity.js';

const publicOrigin = 'https://herarchive.feminism-nv.top';
const recentComments = 'https://waline.feminism-nv.top/api/comment?type=recent&count=0';

export async function getArticleActivity(request, fetchComments = fetch) {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  }

  try {
    const response = await fetchComments(recentComments, {
      headers: { Origin: publicOrigin },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Comment service unavailable');
    const { errno, data } = await response.json();
    if (errno || !Array.isArray(data)) throw new Error('Invalid comment feed');

    return Response.json(latestArticleComments(data), {
      headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' },
    });
  } catch {
    return Response.json({ error: '暂时无法读取文章回应时间。' }, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export default { fetch: request => getArticleActivity(request) };
