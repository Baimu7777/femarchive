import {groupReports} from './report-threads.js';
import {loadTurnstile as captchaReady} from './turnstile-loader.js';
import {submitComment} from './notification-transport.js';
import {prepareAnonymousIdentity} from './comment-avatars.js';
export const REPORT_CACHE_TTL = 5 * 60 * 1000;
const cacheKey = server => `archive-reports:v1:${server}`;
export function readReportCache(storage, key, catalog, now = Date.now()) {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > 2000000) return null;
    const data = JSON.parse(raw);
    if (data.version !== 1 || data.catalog !== JSON.stringify(catalog) || !Number.isFinite(data.time) || data.time > now || now - data.time > 86400000 || !Array.isArray(data.records) || !Array.isArray(data.sources)) return null;
    const paths = new Set(catalog.map(x => x.path));
    if (!data.records.every(x => paths.has(x.path) && x.comment && typeof x.comment === 'object') || !data.sources.every(x => paths.has(x.path) && Number.isInteger(x.page) && x.page >= 1 && Number.isInteger(x.total) && x.total >= 0)) return null;
    return {...data, fresh: now - data.time < REPORT_CACHE_TTL};
  } catch { return null; }
}
export const reportPath = page => '/feedback/' + (page || '').replace(/^\/+/, '');
async function request(server, query, options = {}) {
  const transport=options.method==='POST'?submitComment:fetch;
  const response = await transport(server.replace(/\/$/, '') + '/api/comment' + query, {...options, signal: AbortSignal.timeout(20000)});
  const data = await response.json();
  if (!response.ok || data.errno) throw new Error(data.errmsg || `请求失败（${response.status}）`);
  return data.data;
}
function mountEditor(root) {
  const form=root.querySelector('form'), detail=form.elements.detail, status=root.querySelector('[data-report-status]'), button=form.querySelector('button');
  let token='', widget, initialized=false, sending=false, activePage=root.dataset.page;
  const key=()=>`archive-report-draft:${activePage || 'website'}`;
  const save=()=>{try{sessionStorage.setItem(key(),detail.value);}catch{}};
  const load=()=>{try{detail.value=sessionStorage.getItem(key())||'';}catch{detail.value='';}};
  load(); detail.addEventListener('input',save);
  root.addEventListener('feedback-page-change',()=>{save();activePage=root.dataset.page;load();});
  async function start(){
    if(initialized)return;initialized=true;
    if(!root.dataset.key){status.textContent='申报验证尚未配置，请联系网站维护者。';button.disabled=true;return;}
    button.disabled=true;status.textContent='正在加载提交验证…';
    try{await captchaReady();widget=window.turnstile.render(root.querySelector('[data-report-captcha]'),{
      sitekey:root.dataset.key,
      callback:value=>{token=value;button.disabled=false;status.textContent='';},
      'expired-callback':()=>{token='';button.disabled=true;status.textContent='验证已过期，请重新验证。';},
      'retry':'never',
      'error-callback':code=>{token='';button.disabled=true;status.textContent=location.hostname==='127.0.0.1'||location.hostname==='localhost'?'本地预览未通过验证。需要在验证服务中允许此预览域名，或在已允许的网站域名上测试提交。':`提交验证失败（${code}），请刷新后重试。`;}
    });}catch(error){status.textContent=error.message;initialized=false;}
  }
  const fold=root.closest('details');if(fold){fold.addEventListener('toggle',()=>{if(fold.open)start();});if(fold.open)start();}else start();
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(sending)return;
    const text=detail.value.trim();if(!text){detail.focus();return;}
    if(!token){status.textContent='请先完成下方提交验证。';start();return;}
    const page=activePage;const snapshot=detail.value;
    sending=true;button.disabled=true;status.textContent='正在提交…';
    try{
      const id=prepareAnonymousIdentity(localStorage,root.dataset.server,()=>crypto.randomUUID());
      await request(root.dataset.server,'?lang=zh-CN',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nick:form.elements.nick.value.trim()||`匿名·${id||crypto.randomUUID().slice(0,12)}`,comment:text,url:reportPath(page),ua:navigator.userAgent,turnstile:token,...(root.dataset.replyId?{pid:root.dataset.replyId,rid:root.dataset.rootId||root.dataset.replyId}:{})})});
      try{sessionStorage.removeItem(`archive-report-draft:${page||'website'}`);}catch{}
      if(activePage===page&&detail.value===snapshot)detail.value='';
      try{localStorage.removeItem(cacheKey(root.dataset.server));}catch{}
      status.textContent='申报已提交；如开启审核，将在审核后公开显示。';if(root.dataset.replyId&&activePage===page){delete root.dataset.replyId;delete root.dataset.rootId;root.dataset.page='';root.dispatchEvent(new Event('feedback-page-change'));}document.dispatchEvent(new Event('feedback-submitted'));
    }catch(error){status.textContent=`提交未确认：${error.name==='TimeoutError'?'网络超时':error.message}。文字已保留，请先查看主页是否收到，再决定是否重试。`;}
    finally{sending=false;token='';window.turnstile?.reset(widget);button.disabled=true;}
  });
}
async function mountHome(root){
  const catalog=JSON.parse(root.querySelector('[data-report-catalog]').textContent), list=root.querySelector('[data-report-list]'), status=root.querySelector('[data-report-list-status]'), more=root.querySelector('[data-report-more]');
  let sources=[], records=[], loading=false, pendingRefresh=false, sequence=0, expanded=false;
  const key=cacheKey(root.dataset.server);
  const editor=root.querySelector('[data-feedback-editor]');const replyNotice=document.createElement('p');const cancelReply=document.createElement('button');cancelReply.type='button';cancelReply.textContent='取消回应';cancelReply.hidden=true;editor?.prepend(replyNotice,cancelReply);cancelReply.addEventListener('click',()=>{delete editor.dataset.replyId;delete editor.dataset.rootId;editor.dataset.page='';editor.dispatchEvent(new Event('feedback-page-change'));replyNotice.textContent='';cancelReply.hidden=true;});
  let storage;try{storage=localStorage;}catch{storage={getItem:()=>null};}
  const cached=readReportCache(storage,key,catalog);
  const expand=document.createElement('button');expand.type='button';expand.className='report-list__expand';expand.hidden=true;expand.setAttribute('aria-expanded','false');list.after(expand);
  function updateVisibility(){
    Array.from(list.children).forEach((item,index)=>{item.hidden=!expanded&&index>=3;});
    const pending=sources.some(x=>x.page<=x.total);
    expand.hidden=list.children.length<=3&&!pending;
    expand.textContent=expanded?'收起申报':'展开全部申报';expand.setAttribute('aria-expanded',String(expanded));
    more.hidden=!expanded||!pending;
    requestAnimationFrame(()=>{for(const item of list.querySelectorAll('.report-item')){if(item.closest('[hidden]'))continue;const text=item.querySelector('.report-item__text'),toggle=item.querySelector('.report-item__expand');if(toggle.getAttribute('aria-expanded')!=='true')toggle.hidden=text.scrollHeight<=text.clientHeight+1;}});
  }
  expand.addEventListener('click',()=>{expanded=!expanded;updateVisibility();});
  const lookup=new Map(catalog.map(source=>[source.path,source]));
  function renderItem(node,source,target=list,isReply=false){
    const {comment}=node;
    const item=document.createElement('article');item.className='report-item'+(isReply?' report-item--reply':'');item.dataset.time=String(new Date(comment.time).getTime());
    const author=value=>value?.nick?.startsWith('匿名·')?'匿名':value?.nick||'匿名';
    const plain=value=>typeof value?.orig==='string'?value.orig:new DOMParser().parseFromString(value?.comment||'','text/html').body.textContent;
    if(isReply||node.parentId||node.rootId){
      const label=document.createElement('p');label.className='report-item__reply-label';
      label.textContent=node.parent?`回应 ${author(node.parent.comment)}`:'回应（原申报暂未加载或不可见）';item.append(label);
      if(node.parent){const quote=document.createElement('blockquote');quote.className='report-item__reply-quote';quote.textContent=plain(node.parent.comment).slice(0,100);item.append(quote);}
    }else{const heading=document.createElement('a');heading.textContent=source.title;heading.href=source.path||'/#feedback';item.append(heading);}
    const text=document.createElement('p');text.className='report-item__text';text.id=`report-text-${++sequence}`;
    text.textContent=typeof comment.orig==='string'?comment.orig:new DOMParser().parseFromString(comment.comment||'','text/html').body.textContent;item.append(text);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='report-item__expand';toggle.textContent='展开全文';toggle.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',text.id);
    toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));text.classList.toggle('is-expanded',open);toggle.textContent=open?'收起':'展开全文';});item.append(toggle);
    const meta=document.createElement('small');meta.textContent=`${comment.nick?.startsWith('匿名·')?'匿名':comment.nick||'匿名'} · ${new Date(comment.time).toLocaleDateString('zh-CN')}`;item.append(meta);if(editor&&comment.objectId){const reply=document.createElement('button');reply.type='button';reply.className='report-item__expand';reply.textContent='回应';reply.addEventListener('click',()=>{editor.dataset.page=source.path;editor.dataset.replyId=String(comment.objectId);editor.dataset.rootId=String(node.rootId||comment.objectId);editor.dispatchEvent(new Event('feedback-page-change'));replyNotice.textContent=`正在回应 ${author(comment)}：${plain(comment).slice(0,80)}`;cancelReply.hidden=false;editor.closest('details').open=true;editor.scrollIntoView({behavior:'smooth',block:'center'});editor.querySelector('textarea').focus();});item.append(reply);}target.append(item);
    requestAnimationFrame(()=>{toggle.hidden=text.scrollHeight<=text.clientHeight+1;});
    if(node.replies.length){const replies=document.createElement('section');replies.className='report-replies';replies.setAttribute('aria-label','申报回应');const title=document.createElement('p');title.className='report-replies__title';title.textContent=`回应（${node.replies.length}）`;replies.append(title);item.append(replies);for(const child of node.replies)renderItem(child,source,replies,true);}
  }
  function draw(){
    list.replaceChildren();
    groupReports(records).forEach(node=>renderItem(node,lookup.get(node.path)));
    updateVisibility();
    status.textContent=records.length?'':'暂时没有公开申报。';
  }
  function saveCache(){
    try{localStorage.setItem(key,JSON.stringify({version:1,time:Date.now(),catalog:JSON.stringify(catalog),sources,records}));}catch{}
  }
  if(cached){sources=cached.sources.map(x=>({...lookup.get(x.path),page:x.page,total:x.total}));records=cached.records;draw();}
  async function load(reset=false){
    if(loading){if(reset)pendingRefresh=true;return;}
    loading=true;more.disabled=true;
    if(!cached&&!records.length)status.textContent='正在读取申报…';
    try{
      let nextSources=reset?[]:sources.map(x=>({...x}));
      const nextRecords=reset?[]:[...records];
      if(reset){
        for(let offset=0;offset<catalog.length;offset+=20){const batch=catalog.slice(offset,offset+20);const counts=await request(root.dataset.server,'?type=count&url='+encodeURIComponent(batch.map(x=>reportPath(x.path)).join(','))+'&lang=zh-CN');batch.forEach((source,i)=>{if(Number(counts[i])>0)nextSources.push({...source,page:1,total:1});});}
      }
      for(const source of nextSources.filter(x=>x.page<=x.total)){
        const data=await request(root.dataset.server,'?path='+encodeURIComponent(reportPath(source.path))+'&pageSize=10&page='+source.page+'&sortBy=insertedAt_desc&lang=zh-CN');
        source.total=data.totalPages;source.page++;for(const comment of data.data||[])nextRecords.push({comment,path:source.path});
      }
      sources=nextSources;records=nextRecords;draw();saveCache();
    }catch(error){if(!cached&&!records.length)status.textContent='申报暂时无法读取，请稍后再来。';}
    finally{loading=false;more.disabled=false;if(pendingRefresh){pendingRefresh=false;load(true);}}
  }
  more.addEventListener('click',()=>load(false));document.addEventListener('feedback-submitted',()=>{replyNotice.textContent='';cancelReply.hidden=true;load(true);});
  const observer=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting)){observer.disconnect();if(!cached?.fresh)load(true);}},{rootMargin:'200px'});observer.observe(root);

}
if(typeof document!=='undefined'){
 document.querySelectorAll('[data-feedback-editor]').forEach(mountEditor);
 document.querySelectorAll('[data-feedback-home]').forEach(mountHome);
}
