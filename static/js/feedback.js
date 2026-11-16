import {groupReports, reportFloors} from './report-threads.js?v=3';
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
function mountEditor(root, { onSubmitted } = {}) {
  const form=root.querySelector('form'), detail=form.elements.detail, status=root.querySelector('[data-report-status]'), button=form.querySelector('button');
  let token='', widget, initialized=false, sending=false, disposed=false;
  const page=root.dataset.page, replyId=root.dataset.replyId;
  const key=()=>`archive-report-draft:${replyId ? JSON.stringify([page, replyId]) : page || 'website'}`;
  const save=()=>{try{sessionStorage.setItem(key(),detail.value);}catch{}};
  const load=()=>{try{detail.value=sessionStorage.getItem(key())||'';}catch{detail.value='';}};
  load(); detail.addEventListener('input',save);
  async function start(){
    if(initialized)return;initialized=true;
    if(!root.dataset.key){status.textContent='申报验证尚未配置，请联系网站维护者。';button.disabled=true;return;}
    button.disabled=true;status.textContent='正在加载提交验证…';
    try{await captchaReady();if(disposed)return;widget=window.turnstile.render(root.querySelector('[data-report-captcha]'),{
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
    const snapshot=detail.value;
    sending=true;button.disabled=true;status.textContent='正在提交…';
    try{
      const id=prepareAnonymousIdentity(localStorage,root.dataset.server,()=>crypto.randomUUID());
      await request(root.dataset.server,'?lang=zh-CN',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nick:form.elements.nick.value.trim()||`匿名·${id||crypto.randomUUID().slice(0,12)}`,comment:text,url:reportPath(page),ua:navigator.userAgent,turnstile:token,...(replyId?{pid:replyId,rid:root.dataset.rootId||replyId}:{})})});
      if(detail.value===snapshot){
        detail.value='';
        try{sessionStorage.removeItem(key());}catch{}
      }
      try{localStorage.removeItem(cacheKey(root.dataset.server));}catch{}
      status.textContent='申报已提交；如开启审核，将在审核后公开显示。';
      if(onSubmitted)onSubmitted();
      document.dispatchEvent(new Event('feedback-submitted'));
    }catch(error){status.textContent=`提交未确认：${error.name==='TimeoutError'?'网络超时':error.message}。文字已保留，请先查看主页是否收到，再决定是否重试。`;}
    finally{sending=false;token='';if(!disposed&&widget!=null)window.turnstile?.reset(widget);button.disabled=true;}
  });
  return {
    isSending:()=>sending,
    dispose(){
      disposed=true;
      if(widget!=null)window.turnstile?.remove(widget);
    },
  };
}
async function mountHome(root){
  const catalog=JSON.parse(root.querySelector('[data-report-catalog]').textContent), list=root.querySelector('[data-report-list]'), status=root.querySelector('[data-report-list-status]'), more=root.querySelector('[data-report-more]');
  let sources=[], records=[], loading=false, pendingRefresh=false, sequence=0, expanded=false;
  const key=cacheKey(root.dataset.server);
  const editorTemplate=root.querySelector('[data-feedback-editor]')?.cloneNode(true);
  let activeReply=null;
  let redrawPending=false;
  const closeReply=(restoreFocus=false)=>{
    if(!activeReply)return;
    const {host,button,controller}=activeReply;
    activeReply=null;
    controller.dispose();
    host.remove();
    button.setAttribute('aria-expanded','false');
    if(redrawPending)draw();
    if(restoreFocus){
      const replacement=Array.from(list.querySelectorAll('[data-report-reply]'))
        .find(candidate=>candidate.dataset.reportReply===button.dataset.reportReply);
      (button.isConnected?button:replacement)?.focus({preventScroll:true});
    }
  };
  function openReply(item,button,source,node){
    if(activeReply?.controller.isSending())return;
    if(activeReply?.button===button){closeReply(true);return;}
    // Keep this card attached while switching between reply boxes.
    const pending=redrawPending;
    redrawPending=false;
    closeReply();
    redrawPending=pending;
    const host=document.createElement('div');
    host.className='report-item__editor';
    const editor=editorTemplate.cloneNode(true);
    editor.dataset.page=source.path;
    editor.dataset.replyId=node.id;
    editor.dataset.rootId=String(node.rootId||node.id);
    const cancel=document.createElement('button');
    cancel.type='button';
    cancel.className='report-item__reply-action';
    cancel.textContent='取消回应';
    cancel.addEventListener('click',()=>{if(!activeReply?.controller.isSending())closeReply(true);});
    const targetLabel=document.createElement('p');
    targetLabel.className='report-item__editor-target';
    targetLabel.textContent='回复 '+item.querySelector('.report-item__reply-context > span').textContent;
    host.append(targetLabel,editor,cancel);
    item.querySelector(':scope > .report-item__meta').after(host);
    const controller=mountEditor(editor,{onSubmitted:()=>{
      closeReply(true);
      status.textContent='回应已提交；如开启审核，将在审核后公开显示。';
    }});
    activeReply={host,button,controller};
    button.setAttribute('aria-expanded','true');
    editor.querySelector('textarea').focus({preventScroll:true});
  }
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
  function renderItem(node,source,target=list,isReply=false,floors=reportFloors(node)){
    const {comment}=node;
    const item=document.createElement('article');item.className='report-item'+(isReply?' report-item--reply':'');item.dataset.time=String(new Date(comment.time).getTime());
    const floor=floors.get(node);
    item.id=`report-${encodeURIComponent(JSON.stringify([node.path,node.id]))}`;
    const author=value=>value?.nick?.startsWith('匿名·')?'匿名':value?.nick||'匿名';
    const plain=value=>typeof value?.orig==='string'
      ? value.orig
      : new DOMParser().parseFromString(value?.comment||'','text/html').body.textContent;
    if(!isReply){
      const heading=document.createElement('a');heading.textContent=source.title;heading.href=source.path||'/#feedback';item.append(heading);
    }
    const context=document.createElement('div');context.className='report-item__reply-context';
    const label=document.createElement('span');
    const floorName=floor===0?'主楼':floor!=null?`${floor} 楼`:'回应';
    label.textContent=`${floorName} · ${author(comment)}`;context.append(label);
    if(node.parentId||node.rootId){
      const parentFloor=floors.get(node.parent);
      if(parentFloor!=null){
        const targetLink=document.createElement('a');
        targetLink.href=`#report-${encodeURIComponent(JSON.stringify([node.parent.path,node.parent.id]))}`;
        targetLink.textContent=`回复 ${parentFloor===0?'主楼':`${parentFloor} 楼`}`;
        context.append(targetLink);
      }else{
        const missing=document.createElement('small');missing.textContent='回复对象暂不可见';context.append(missing);
      }
    }
    item.append(context);
    if(isReply&&node.parent){
      const excerpt=document.createElement('blockquote');excerpt.className='report-item__quote';
      const original=plain(node.parent.comment).replace(/\s+/gu,' ').trim();
      excerpt.textContent=original.length>36?original.slice(0,36)+'…':original;
      if(original)item.append(excerpt);
    }
    const text=document.createElement('p');text.className='report-item__text';text.id=`report-text-${++sequence}`;
    text.textContent=plain(comment);item.append(text);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='report-item__expand';toggle.textContent='展开全文';toggle.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',text.id);
    toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));text.classList.toggle('is-expanded',open);toggle.textContent=open?'收起':'展开全文';});item.append(toggle);
    const footer=document.createElement('div');
    footer.className='report-item__meta';
    item.append(footer);
    const meta=document.createElement('small');
    meta.textContent=new Date(comment.time).toLocaleDateString('zh-CN');
    footer.append(meta);
    if(editorTemplate&&comment.objectId){
      const reply=document.createElement('button');
      reply.type='button';
      reply.className='report-item__reply-action';
      reply.textContent='回应';
      reply.dataset.reportReply=JSON.stringify([source.path,node.id]);
      reply.setAttribute('aria-expanded','false');
      reply.addEventListener('click',()=>openReply(item,reply,source,node));
      footer.append(reply);
    }
    target.append(item);
    requestAnimationFrame(()=>{toggle.hidden=text.scrollHeight<=text.clientHeight+1;});
    if(node.replies.length){const replies=document.createElement('section');replies.className='report-replies';replies.setAttribute('aria-label','申报回应');item.append(replies);for(const child of node.replies)renderItem(child,source,replies,true,floors);}
  }
  function draw(){
    if(activeReply){redrawPending=true;return;}
    redrawPending=false;
    list.replaceChildren();
    groupReports(records).forEach(node=>renderItem(node,lookup.get(node.path)));
    updateVisibility();
    if(!records.length)status.textContent='暂时没有公开申报。';
    else if(status.textContent==='正在读取申报…')status.textContent='';
  }
  function saveCache(){
    try{localStorage.setItem(key,JSON.stringify({version:1,time:Date.now(),catalog:JSON.stringify(catalog),sources,records}));}catch{}
  }
  if(cached){sources=cached.sources.map(x=>({...lookup.get(x.path),page:x.page,total:x.total}));records=cached.records;draw();}
  async function load(reset=false){
    if(loading){if(reset)pendingRefresh=true;return;}
    loading=true;more.disabled=true;
    if(!records.length)status.textContent='正在读取申报…';
    else if(status.textContent.endsWith('暂时无法读取。'))status.textContent='';
    try{
      let failed=false;
      const previousSources=new Map(sources.map(source=>[source.path,source]));
      const nextSources=reset?[]:sources.map(source=>({...source}));
      let nextRecords=reset?[]:[...records];
      const keepPrevious=path=>{
        nextRecords.push(...records.filter(record=>record.path===path));
      };
      if(reset){
        for(let offset=0;offset<catalog.length;offset+=20){
          const batch=catalog.slice(offset,offset+20);
          try{
            const query='?type=count&url='+encodeURIComponent(batch.map(source=>reportPath(source.path)).join(','))+'&lang=zh-CN';
            const counts=await request(root.dataset.server,query);
            if(!Array.isArray(counts)||counts.length!==batch.length)throw Error('Incomplete report counts');
            batch.forEach((source,i)=>{
              if(Number(counts[i])>0)nextSources.push({...source,page:1,total:1});
            });
          }catch{
            failed=true;
            for(const source of batch){
              keepPrevious(source.path);
              const previous=previousSources.get(source.path);
              if(previous)nextSources.push({...previous});
            }
          }
        }
      }
      const pending=nextSources.filter(source=>source.page<=source.total);
      for(let offset=0;offset<pending.length;offset+=4){
        await Promise.all(pending.slice(offset,offset+4).map(async source=>{
          try{
            const query='?path='+encodeURIComponent(reportPath(source.path))+
              '&pageSize=10&page='+source.page+'&sortBy=insertedAt_desc&lang=zh-CN';
            const data=await request(root.dataset.server,query);
            if(!Array.isArray(data?.data))throw Error('Incomplete report page');
            const entries=data.data.map(comment=>({comment,path:source.path}));
            source.total=data.totalPages;
            if(reset&&source.page===1)nextRecords=nextRecords.filter(record=>record.path!==source.path);
            source.page++;
            nextRecords.push(...entries);
          }catch{
            failed=true;
            if(reset&&source.page===1&&!nextRecords.some(record=>record.path===source.path)){
              keepPrevious(source.path);
            }
          }
        }));
      }
      sources=nextSources;records=nextRecords;draw();
      if(failed)status.textContent=records.length?'部分申报暂时无法读取。':'申报暂时无法读取，请稍后再来。';
      else saveCache();
    }catch{
      status.textContent='申报暂时无法读取，请稍后再来。';
    }
    finally{loading=false;more.disabled=false;if(pendingRefresh){pendingRefresh=false;load(true);}}
  }
  more.addEventListener('click',()=>load(false));document.addEventListener('feedback-submitted',()=>load(true));
  if(!cached?.fresh){
    if(location.hash==='#feedback'||!('IntersectionObserver' in window)){
      load(true);
    }else{
      const observer=new IntersectionObserver(entries=>{
        if(entries.some(entry=>entry.isIntersecting)){
          observer.disconnect();
          load(true);
        }
      },{rootMargin:'200px'});
      observer.observe(root);
    }
  }

}
if(typeof document!=='undefined'){
 document.querySelectorAll('[data-feedback-home]').forEach(mountHome);
 document.querySelectorAll('[data-feedback-editor]').forEach(root=>mountEditor(root));
}
