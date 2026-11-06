import {createHash, createHmac, randomUUID} from 'node:crypto';
import sharp from 'sharp';

export const IMAGE_BODY_LIMIT = 2900000;
const json = (data, status = 200) => Response.json(data, {status, headers:{'cache-control':'no-store'}});
export function imageConfig(env = process.env) {
  if (env.COMMENT_IMAGES_ENABLED !== 'true') return null;
  const keys = ['COMMENT_IMAGES_TURNSTILE_SECRET','COMMENT_IMAGES_CLOUD_NAME','COMMENT_IMAGES_API_KEY','COMMENT_IMAGES_API_SECRET'];
  if (keys.some(key => !env[key]?.trim())) return null;
  if (!/^[a-z0-9_-]+$/i.test(env.COMMENT_IMAGES_CLOUD_NAME)) return null;
  return {turnstileSecret:env.COMMENT_IMAGES_TURNSTILE_SECRET, cloud:env.COMMENT_IMAGES_CLOUD_NAME, apiKey:env.COMMENT_IMAGES_API_KEY, apiSecret:env.COMMENT_IMAGES_API_SECRET};
}
async function reserve(store, key, limit) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const record = await store.read(key);
    const count = record?.value.count || 0;
    if (count >= limit) return false;
    if (await store.write(key, {count:count + 1}, record?.etag ?? null)) return true;
  }
  return false;
}
export function createImageUpload({config, origin, store, fetch:transport = fetch, now = Date.now}) {
  return async (req, trustedIp) => {
    if (!config || !store) return json({error:'图片上传暂未开放。'},503);
    if (req.method === 'GET') return json({enabled:true});
    if (req.method !== 'POST') return json({error:'方法不支持。'},405);
    if (req.headers.get('origin') !== origin) return json({error:'请求来源无效。'},403);
    if (!trustedIp) return json({error:'无法验证上传来源。'},503);
    if (!req.headers.get('content-type')?.startsWith('application/json')) return json({error:'请求格式无效。'},415);
    try {
      const raw = await req.text();
      if (Buffer.byteLength(raw) > IMAGE_BODY_LIMIT) return json({error:'图片不能超过 2MB。'},413);
      const body = JSON.parse(raw);
      if (typeof body.token !== 'string' || !body.token || body.token.length > 2048 || typeof body.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) return json({error:'上传数据无效。'},400);
      const bytes = Buffer.from(body.data,'base64');
      if (!bytes.length || bytes.length > 2 * 1024 * 1024) return json({error:'图片不能超过 2MB。'},413);
      const ip = createHmac('sha256',config.apiSecret).update(trustedIp).digest('hex');
      // Atomic storage counters span all serverless instances. Count attempts,
      // including failed verification, and cap total upstream spending per day.
      if (!await reserve(store,`image-limits/ip/${ip}/${Math.floor(now()/3600000)}`,10) || !await reserve(store,`image-limits/day/${Math.floor(now()/86400000)}`,200)) return json({error:'图片上传次数已达限额，请稍后重试。'},429);
      const verification = await transport('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:config.turnstileSecret,response:body.token,remoteip:trustedIp}),signal:AbortSignal.timeout(10000)});
      const verified = await verification.json();
      if (!verification.ok || verified.success !== true || verified.action !== 'comment_image' || verified.hostname !== new URL(origin).hostname) return json({error:'图片上传验证未通过，请重试。'},403);
      let output;
      try {
        const image = sharp(bytes,{limitInputPixels:16000000,animated:false,failOn:'warning'});
        const meta = await image.metadata();
        if (!['jpeg','png','webp','gif'].includes(meta.format)) return json({error:'不支持的图片格式。'},415);
        // Decode and re-encode; strip metadata and flatten animations to one
        // frame. Never forward user-controlled filenames, SVG or raw files.
        output = await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();
      } catch { return json({error:'图片无效或尺寸过大。'},415); }
      const params = {overwrite:'false',public_id:`comment-attachments/${randomUUID()}`,timestamp:String(Math.floor(now()/1000))};
      const signature = createHash('sha1').update(Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('&')+config.apiSecret).digest('hex');
      const form = new FormData();
      for (const [key,value] of Object.entries(params)) form.append(key,value);
      form.append('api_key',config.apiKey); form.append('signature',signature);
      form.append('file',new Blob([output],{type:'image/webp'}),'comment.webp');
      const uploaded = await transport(`https://api.cloudinary.com/v1_1/${config.cloud}/image/upload`,{method:'POST',body:form,signal:AbortSignal.timeout(20000),redirect:'error'});
      const result = await uploaded.json();
      if (!uploaded.ok || typeof result.secure_url !== 'string') throw Error('upload failed');
      const url = new URL(result.secure_url);
      if (url.origin !== 'https://res.cloudinary.com' || !url.pathname.startsWith(`/${config.cloud}/image/upload/`) || /[()\s]/.test(url.href)) throw Error('invalid URL');
      return json({url:url.href});
    } catch { return json({error:'图片上传未完成，请稍后重试。'},503); }
  };
}
