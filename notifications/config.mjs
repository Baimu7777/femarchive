import {S3Client} from '@aws-sdk/client-s3';
import {createNotificationStore} from './storage.mjs';
import {createNotificationService} from './service.mjs';
export function configuredNotifications(env=process.env){
 const required=['NOTIFICATIONS_SECRET','NOTIFICATIONS_EVENT_SECRET','NOTIFICATIONS_ORIGIN','NOTIFICATIONS_R2_ENDPOINT','NOTIFICATIONS_R2_BUCKET','NOTIFICATIONS_R2_ACCESS_KEY_ID','NOTIFICATIONS_R2_SECRET_ACCESS_KEY','NOTIFICATIONS_WALINE_ORIGIN'];
 if(env.NOTIFICATIONS_ENABLED!=='true'||required.some(k=>!env[k]?.trim()))return null;
 if(!/^[A-Za-z0-9_-]{32,256}$/.test(env.NOTIFICATIONS_SECRET)||!/^[A-Za-z0-9_-]{32,256}$/.test(env.NOTIFICATIONS_EVENT_SECRET)||env.NOTIFICATIONS_SECRET===env.NOTIFICATIONS_EVENT_SECRET||[env.NOTIFICATIONS_SECRET,env.NOTIFICATIONS_EVENT_SECRET].includes(env.WEBSITE_PUBLISHING_TOKEN)||env.NOTIFICATIONS_R2_BUCKET===env.WEBSITE_R2_BUCKET)throw Error('invalid notification isolation');
 const site=new URL(env.NOTIFICATIONS_ORIGIN);if(site.protocol!=='https:'||site.origin!==env.NOTIFICATIONS_ORIGIN)throw Error('invalid site origin');
 const endpoint=new URL(env.NOTIFICATIONS_R2_ENDPOINT);if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.r2.cloudflarestorage.com')||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw Error('invalid storage endpoint');
 const client=new S3Client({region:'auto',endpoint:endpoint.origin,credentials:{accessKeyId:env.NOTIFICATIONS_R2_ACCESS_KEY_ID,secretAccessKey:env.NOTIFICATIONS_R2_SECRET_ACCESS_KEY}});
 const store=createNotificationStore(client,env.NOTIFICATIONS_R2_BUCKET);const service=createNotificationService({store,secret:env.NOTIFICATIONS_SECRET,eventSecret:env.NOTIFICATIONS_EVENT_SECRET,origin:env.NOTIFICATIONS_ORIGIN});
 return {store,service,secret:env.NOTIFICATIONS_SECRET,origin:env.NOTIFICATIONS_ORIGIN,waline:env.NOTIFICATIONS_WALINE_ORIGIN};
}
// Vercel overwrites this header at its edge. A client-supplied
// x-forwarded-for is never trusted; other hosts need their own adapter.
export const trustedAddress=(req,env=process.env)=>env.VERCEL==='1'?req.headers['x-vercel-forwarded-for']?.split(',')[0].trim()||null:null;
export async function webRequest(req){let raw='';if(req.body!==undefined)raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);else{
 // Collected as bytes and decoded once: appending chunks as text split a
 // Chinese character that happened to fall across two chunks.
 const chunks=[];let size=0;for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>20000)throw Error('body limit');chunks.push(bytes);}raw=Buffer.concat(chunks).toString('utf8');}if(Buffer.byteLength(raw)>20000)throw Error('body limit');return new Request('https://'+req.headers.host+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:raw});}
export async function send(res,response){res.statusCode=response.status;for(const [k,v]of response.headers)res.setHeader(k,v);res.end(await response.text());}
