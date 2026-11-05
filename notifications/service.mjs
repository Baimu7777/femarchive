import {createHmac,randomUUID,timingSafeEqual,createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(x).digest('hex');
const mac=(secret,text)=>createHmac('sha256',secret).update(text).digest('hex');
export function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
export const signEvent=(secret,time,payload)=>mac(secret,time+'.'+canonical(payload));
function equal(a,b){return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function validPath(path){return typeof path==='string'&&path.length<300&&!path.includes('..')&&/^\/(?:feedback\/(?:posts\/[a-zA-Z0-9-]+\/|news\/\d+\/|lexicon\/[a-f0-9-]+\/)?|posts\/[a-zA-Z0-9-]+\/|news\/\d+\/|lexicon\/[a-f0-9-]+\/)$/u.test(path);}
const safeId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const plain=(x,n)=>typeof x==='string'?x.replace(/<[^>]*>/g,'').slice(0,n):'';
export function createNotificationService({store,secret,eventSecret,origin,now=Date.now}){
 const configured=store&&secret?.length>=32&&eventSecret?.length>=32&&secret!==eventSecret&&/^https:\/\/[^/?#]+$/.test(origin||'');
 const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff',...headers}});
 function identity(cookie){const token=(cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('archive_notice='))?.slice(15);if(!token)return null;const [id,signature]=token.split('.');return /^[a-f0-9-]{36}$/.test(id||'')&&equal(mac(secret,id),signature)?digest(id):null;}
 async function mutate(key,fn){for(let i=0;i<8;i++){const record=await store.read(key);const next=fn(structuredClone(record?.value??null));if(next===null)return record?.value;if(await store.write(key,next,record?.etag??null))return next;}throw Error('conflict');}
 async function bind(cookie,{id,path}){if(!configured)throw Error('disabled');const owner=identity(cookie);if(!owner||!safeId(String(id))||!validPath(path))throw Error('invalid binding');const key='bindings/'+digest(String(id));await mutate(key,old=>{if(old&&(old.owner!==owner||old.path!==path))throw Error('binding conflict');return old||{owner,path};});}
 async function deliver(payload){
  if(!safeId(payload.id)||!safeId(String(payload.commentId))||!safeId(String(payload.parentId))||!validPath(payload.path))return json({error:'事件格式无效。'},400);
  const parent=await store.read('bindings/'+digest(String(payload.parentId)));
  if(!parent||parent.value.path!==payload.path)return json({ok:true,delivered:false});
  const child=await store.read('bindings/'+digest(String(payload.commentId)));
  if(child?.value.owner===parent.value.owner)return json({ok:true,delivered:false});
  const owner=parent.value.owner,eventId=digest(payload.id+'|'+payload.commentId+'|'+payload.parentId+'|'+payload.path),delivery='delivered/'+eventId;
  if(await store.read(delivery))return json({ok:true});
  await mutate('inboxes/'+owner,box=>{box||={seq:0,items:[]};if(box.items.some(x=>x.eventId===eventId))return null;
   if(box.items.length>=500){const readIndex=box.items.findIndex(x=>x.read);if(readIndex<0)throw Error('inbox full');box.items.splice(readIndex,1);}
   const report=payload.path.startsWith('/feedback/');const href=report?'/#feedback':payload.path+'#comments';
   box.items.push({id:++box.seq,eventId,kind:report?'report-reply':'comment-reply',title:report?'你的申报有新回应':'你的评论有新回复',message:plain(payload.text,600),href,time:now(),read:false});return box;});
  await store.write(delivery,{time:now()},null);return json({ok:true});
 }
 async function handler(req){
  if(!configured)return json({error:'互动通知尚未配置。'},503);
  try{
   const url=new URL(req.url),op=url.searchParams.get('operation');
   if(req.method!=='GET'&&req.method!=='POST'&&req.method!=='PATCH')return json({error:'方法不支持。'},405);
   if(req.method==='POST'&&op==='event'){
    const time=req.headers.get('x-notification-time'),raw=await req.text();if(raw.length>12000)return json({error:'请求过长。'},413);
    const payload=JSON.parse(raw);if(!/^\d{13}$/.test(time||'')||Math.abs(now()-Number(time))>300000||!equal(signEvent(eventSecret,time,payload),req.headers.get('x-notification-signature')))return json({error:'事件认证失败。'},401);
    return await deliver(payload);
   }
   if(new URL(req.url).origin!==origin)return json({error:'来源无效。'},403);
   if(req.method==='GET'&&op==='session'){
    if(identity(req.headers.get('cookie')))return json({ok:true,scope:identity(req.headers.get('cookie'))});const id=randomUUID();return json({ok:true,scope:digest(id)},200,{'set-cookie':`archive_notice=${id}.${mac(secret,id)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`});
   }
   const owner=identity(req.headers.get('cookie'));if(!owner)return json({error:'通知身份已失效。'},401);
   if(req.method==='GET'){
    const before=url.searchParams.get('before');if(before!==null&&!/^\d{1,12}$/.test(before))return json({error:'页码无效。'},400);
    const box=(await store.read('inboxes/'+owner))?.value||{seq:0,items:[]};const rows=box.items.filter(x=>!before||x.id<Number(before)).sort((a,b)=>b.id-a.id);const items=rows.slice(0,20).map(({eventId,...item})=>item);
    return json({items,unread:box.items.filter(x=>!x.read).length,through:box.seq,nextCursor:rows.length>20?items.at(-1).id:null});
   }
   if(req.method!=='PATCH')return json({error:'方法不支持。'},405);
   if(req.headers.get('origin')!==origin)return json({error:'来源无效。'},403);
   if(!req.headers.get('content-type')?.startsWith('application/json'))return json({error:'格式无效。'},415);
   const raw=await req.text();if(raw.length>512)return json({error:'请求过长。'},413);const data=JSON.parse(raw),value=data.id??data.through;
   if(!Number.isSafeInteger(value)||value<1||('id'in data&&'through'in data))return json({error:'编号无效。'},400);
   await mutate('inboxes/'+owner,box=>{if(!box)return null;for(const item of box.items)if(data.id?item.id===value:item.id<=value)item.read=true;return box;});return json({ok:true});
  }catch(error){return json({error:error instanceof SyntaxError?'格式无效。':'通知暂时无法更新。'},error instanceof SyntaxError?400:503);}
 }
 handler.bind=bind;handler.identity=identity;handler.event=deliver;return handler;
}
