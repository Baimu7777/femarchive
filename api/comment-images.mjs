import {configuredNotifications, send} from '../notifications/config.mjs';
import {createImageUpload, imageConfig, IMAGE_BODY_LIMIT} from '../notifications/comment-images.mjs';
export const config = {api:{bodyParser:false}};
const unavailable = (error, status = 503) => Response.json({error},{status,headers:{'cache-control':'no-store'}});
export default async function handler(req,res) {
  try {
    const settings = imageConfig(), notifications = settings && configuredNotifications();
    if (!settings || !notifications) return send(res,unavailable('图片上传暂未开放。'));
    const chunks = []; let size = 0;
    const input = req.body === undefined ? req : [Buffer.isBuffer(req.body) ? req.body : typeof req.body === 'string' ? req.body : JSON.stringify(req.body)];
    for await (const chunk of input) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > IMAGE_BODY_LIMIT) return send(res,unavailable('图片不能超过 2MB。',413));
      chunks.push(bytes);
    }
    const request = new Request(notifications.origin+'/api/comment-images',{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
    // Vercel overwrites this header at its edge. Do not fall back to client-
    // supplied x-forwarded-for; alternative hosts need a trusted IP adapter.
    const ip = process.env.VERCEL === '1' ? req.headers['x-vercel-forwarded-for']?.split(',')[0].trim() : null;
    return send(res,await createImageUpload({...notifications,config:settings})(request,ip));
  } catch { return send(res,unavailable('图片上传暂不可用。')); }
}
