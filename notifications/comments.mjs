import {validPath} from './service.mjs';
export function createCommentBridge({service,store,origin,waline,fetch:transport=fetch,now=Date.now}){
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'private, no-store'}});
 return async req=>{
  if(req.method!=='POST')return json({errno:1,errmsg:'方法不支持。'},405);
  if(req.headers.get('origin')!==origin)return json({errno:1,errmsg:'请求来源无效。'},403);
  const cookie=req.headers.get('cookie'),owner=service.identity(cookie);if(!owner)return json({errno:1,errmsg:'通知身份失效，请刷新页面后重试。'},401);
  if(!req.headers.get('content-type')?.startsWith('application/json'))return json({errno:1,errmsg:'请求格式无效。'},415);
  try{
   const target=new URL(waline);if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||target.pathname!=='/'||target.port)return json({errno:1,errmsg:'评论服务配置无效。'},503);
   const raw=await req.text();if(raw.length>16000)return json({errno:1,errmsg:'评论内容过长。'},413);const body=JSON.parse(raw);
   if(!validPath(body.url)||typeof body.comment!=='string'||body.comment.length>10000)return json({errno:1,errmsg:'评论格式无效。'},400);
   const rateKey=`limits/${owner}/${Math.floor(now()/60000)}`;let allowed=false;
   for(let i=0;i<5;i++){const record=await store.read(rateKey),count=record?.value.count||0;if(count>=20)return json({errno:1,errmsg:'发送过于频繁，请稍后重试。'},429);if(await store.write(rateKey,{count:count+1},record?.etag??null)){allowed=true;break;}}
   if(!allowed)return json({errno:1,errmsg:'暂时无法发送。'},503);
   const headers={'content-type':'application/json'};const auth=req.headers.get('authorization');if(auth){if(!/^Bearer [a-zA-Z0-9._~-]{1,4096}$/.test(auth))return json({errno:1,errmsg:'登录信息无效。'},400);headers.authorization=auth;}
   const upstream=await transport(target.origin+'/api/comment?lang=zh-CN',{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});
   const text=await upstream.text();if(text.length>100000)throw Error('response too large');const result=JSON.parse(text);
   if(!upstream.ok||result.errno)return json(result,upstream.status);
   const id=String(result.data?.objectId??'');
   try{
    await service.bind(cookie,{id,path:body.url});
    if(body.pid&&result.data?.status==='approved')await service.event({id:'reply-'+id,commentId:id,parentId:String(body.pid),path:body.url,text:body.comment});
   }catch{result.notificationWarning='评论已成功提交，但通知关联尚未确认。请勿重复发送评论。';}
   return json(result);
  }catch(e){return json({errno:1,errmsg:e instanceof SyntaxError?'请求格式无效。':'发送结果未确认，请先查看评论是否出现。'},e instanceof SyntaxError?400:503);}
 };
}
