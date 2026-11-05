export async function submitComment(url,options){
 if(document.body.dataset.notificationBridge!=='true')return fetch(url,options);
 const session=await fetch('/api/notifications?operation=session',{credentials:'same-origin',cache:'no-store'});
 if(!session.ok)throw Error('通知身份暂时无法建立，请稍后再试。');
 return fetch('/api/community',{...options,credentials:'same-origin',redirect:'error'});
}
