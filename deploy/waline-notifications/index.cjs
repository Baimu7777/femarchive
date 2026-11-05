// Install inside the existing Waline server. Call notifyPublished(comment)
// from postSave and the after-update hook when status changes to approved.
const {createHmac}=require('node:crypto');
function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
async function notifyPublished(comment){
 if(process.env.ARCHIVE_NOTIFICATIONS_ENABLED!=='true'||comment.status!=='approved'||!comment.pid)return;
 const endpoint=process.env.ARCHIVE_NOTIFICATIONS_ENDPOINT,secret=process.env.ARCHIVE_NOTIFICATIONS_EVENT_SECRET;
 if(!endpoint||!secret||secret.length<32)throw Error('Notification event integration is not configured');
 const url=new URL(endpoint);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Invalid notification endpoint');
 const payload={id:'reply-'+String(comment.objectId),commentId:String(comment.objectId),parentId:String(comment.pid),path:comment.url,text:String(comment.comment||'')};
 const time=String(Date.now()),signature=createHmac('sha256',secret).update(time+'.'+canonical(payload)).digest('hex');
 const response=await fetch(url,{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-notification-time':time,'x-notification-signature':signature},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Notification delivery unconfirmed');
}
module.exports={notifyPublished};
