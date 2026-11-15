// Install inside the existing Waline server. Call notifyPublished(comment)
// from postSave and the after-update hook when status changes to approved.
const {createHmac}=require('node:crypto');
function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
async function notifyPublished(comment){
 // The comment is already saved when this runs. Nothing here may throw: an
 // exception in a Waline hook reaches the visitor as a failed submission, and
 // she posts the same comment again. A failed delivery is reported as a
 // return value and one log line carrying identifiers only, never the text.
 try{return await deliver(comment);}
 catch(error){console.error('[archive-notifications] delivery failed',JSON.stringify({commentId:String(comment?.objectId??''),parentId:String(comment?.pid??''),path:String(comment?.url??''),reason:String(error?.message||error).slice(0,120)}));return {delivered:false};}
}
async function deliver(comment){
 if(process.env.ARCHIVE_NOTIFICATIONS_ENABLED!=='true'||comment.status!=='approved'||!comment.pid)return {delivered:false,skipped:true};
 const endpoint=process.env.ARCHIVE_NOTIFICATIONS_ENDPOINT,secret=process.env.ARCHIVE_NOTIFICATIONS_EVENT_SECRET;
 if(!endpoint||!secret||secret.length<32)throw Error('Notification event integration is not configured');
 const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Invalid notification endpoint');
 const payload={id:'reply-'+String(comment.objectId),commentId:String(comment.objectId),parentId:String(comment.pid),path:comment.url,text:String(comment.comment||'')};
 const time=String(Date.now()),signature=createHmac('sha256',secret).update(time+'.'+canonical(payload)).digest('hex');
 const response=await fetch(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-notification-time':time,'x-notification-signature':signature},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Notification delivery unconfirmed: '+response.status);
 return {delivered:true};
}
module.exports={notifyPublished};
