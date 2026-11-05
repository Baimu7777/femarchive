import {updatePublicState,safeNoticeURL} from './notification-state.js';
const dialog=document.querySelector('[data-notice-dialog]');
if(dialog){
 const list=dialog.querySelector('[data-notice-list]'),status=dialog.querySelector('[data-notice-status]'),unread=dialog.querySelector('[data-notice-unread]'),all=dialog.querySelector('[data-notice-read-all]'),more=dialog.querySelector('[data-notice-more]');
 const publicKey='archive-notice-updates:v1';
 const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
 const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
 let updates=read(publicKey),personal={items:[],unread:0,through:0,nextCursor:null},tab='personal',error='',scope='',busy=false,lastCheck=0,nextCursor=null,expandedId=null,personalReady=false;
 const marking=new Set();
 if(updates&&(!Array.isArray(updates.items)||!Array.isArray(updates.known)))updates=null;
 const enabled=document.body.dataset.notificationBridge==='true';
 const publicUnread=()=>updates?.items?.filter(x=>!x.read).length||0;
 function badges(){const total=publicUnread()+(enabled?personal.unread:0);for(const badge of document.querySelectorAll('[data-notice-badge]')){badge.hidden=!total;badge.textContent=total>99?'99+':String(total);badge.parentElement.setAttribute('aria-label',total?`通知，${total} 条未读`:'打开通知');}}
 async function api(query='',options={}){const r=await fetch('/api/notifications'+query,{...options,credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});const data=await r.json();if(!r.ok)throw Error(data.error||'通知暂时无法读取。');return data;}
 function rows(){return tab==='updates'?(updates?.items||[]):personal.items;}
 async function mark(id){if(marking.has(id))return;if(tab==='updates'){updates.items=updates.items.map(x=>x.id===id?{...x,read:true}:x);write(publicKey,updates);render();return;}marking.add(id);try{await api('',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id})});const wasUnread=personal.items.some(x=>x.id===id&&!x.read);personal.items=personal.items.map(x=>x.id===id?{...x,read:true}:x);if(wasUnread)personal.unread=Math.max(0,personal.unread-1);if(scope)write('archive-notice-inbox:'+scope,personal);render();}catch(e){status.textContent=e.message;}finally{marking.delete(id);}}
 function render(){
  badges();const items=rows();list.replaceChildren();const count=tab==='updates'?publicUnread():personal.unread;unread.textContent=tab==='personal'?(!enabled?'互动通知尚未启用':!personalReady?'正在更新通知':`${count} 条未读`):`${count} 条未读`;all.disabled=!count||busy||(tab==='personal'&&!personalReady);more.hidden=tab!=='personal'||!nextCursor;
  status.textContent=tab==='personal'&&!enabled?'互动通知暂未启用。你可以在“文库更新”中查看新内容提醒。':error||(tab==='personal'&&!personalReady?'正在读取互动通知…':items.length?'':'暂时没有通知。');
  for(const item of items){const li=document.createElement('li');li.classList.toggle('is-unread',!item.read);const button=document.createElement('button');button.type='button';button.className='archive-notice-item';button.setAttribute('aria-expanded',String(expandedId===tab+':'+item.id));const title=document.createElement('strong');title.textContent=item.title;const time=document.createElement('time');time.textContent=new Date(item.time).toLocaleString('zh-CN');const message=document.createElement('span');message.className='archive-notice-message';message.textContent=item.message;button.append(title,time,message);li.append(button);const href=safeNoticeURL(item.href);if(href){const link=document.createElement('a');link.className='archive-notice-source';link.href=href;link.textContent='查看内容 →';link.hidden=expandedId!==tab+':'+item.id;link.addEventListener('click',()=>dialog.close());li.append(link);button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';expandedId=open?tab+':'+item.id:null;button.setAttribute('aria-expanded',String(open));link.hidden=!open;if(!item.read)mark(item.id);});}list.append(li);}
 }
 async function refresh(force=false,before=null){
  if(busy||document.visibilityState==='hidden'||(!force&&Date.now()-lastCheck<60000))return;busy=true;lastCheck=Date.now();
  try{
   if(!before&&(!updates||Date.now()-updates.checked>=60000)){const r=await fetch('/notifications.json',{cache:'no-cache',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('文库更新暂时无法读取。');const feed=await r.json();updates=updatePublicState(updates,feed.items);write(publicKey,updates);}
   if(enabled){if(!scope){const session=await api('?operation=session');scope=session.scope;if(scope){const saved=read('archive-notice-inbox:'+scope);if(saved){personal=saved;personalReady=true;}render();}}const data=await api(before?'?before='+before:'');personal={...data,items:before?[...personal.items,...data.items.filter(x=>!personal.items.some(y=>y.id===x.id))]:data.items};nextCursor=data.nextCursor;personalReady=true;if(scope)write('archive-notice-inbox:'+scope,personal);}
   error='';
  }catch(e){error=e.message;}finally{busy=false;render();}
 }
 for(const trigger of document.querySelectorAll('[data-notice-open]'))trigger.addEventListener('click',()=>{dialog.showModal();render();refresh();});
 dialog.querySelector('[data-notice-close]').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog){const rect=dialog.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();}});
 for(const button of dialog.querySelectorAll('[data-notice-tab]'))button.addEventListener('click',()=>{tab=button.dataset.noticeTab;for(const other of dialog.querySelectorAll('[data-notice-tab]'))other.setAttribute('aria-selected',String(other===button));dialog.querySelector('[role=tabpanel]').setAttribute('aria-labelledby',button.id);render();});
 all.addEventListener('click',async()=>{if(tab==='updates'){updates.items=updates.items.map(x=>({...x,read:true}));write(publicKey,updates);render();return;}if(busy)return;busy=true;const through=personal.through;try{await api('',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({through})});personal.items=personal.items.map(x=>x.id<=through?{...x,read:true}:x);personal=await api('');nextCursor=personal.nextCursor;write('archive-notice-inbox:'+scope,personal);}catch(e){error=e.message;}finally{busy=false;render();}});
 more.addEventListener('click',()=>refresh(true,nextCursor));
 const visible=()=>{if(document.visibilityState==='visible')refresh();};document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);window.addEventListener('storage',event=>{if(event.key===publicKey){updates=read(publicKey);render();}});setInterval(visible,60000);render();refresh();
}
