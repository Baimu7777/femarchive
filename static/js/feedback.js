import {prepareAnonymousIdentity} from './comment-avatars.js';
export const reportPath = page => '/feedback/' + (page || '').replace(/^\/+/, '');
async function request(server, query, options = {}) {
  const response = await fetch(server.replace(/\/$/, '') + '/api/comment' + query, {...options, signal: AbortSignal.timeout(20000)});
  const data = await response.json();
  if (!response.ok || data.errno) throw new Error(data.errmsg || `请求失败（${response.status}）`);
  return data.data;
}
let captchaScript;
function captchaReady() {
  if (window.turnstile) return Promise.resolve();
  return captchaScript ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = resolve; script.onerror = () => {captchaScript = null; reject(new Error('验证服务加载失败，请检查网络后重试。'));};
    document.head.append(script);
  });
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
      await request(root.dataset.server,'?lang=zh-CN',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nick:form.elements.nick.value.trim()||`匿名·${id||crypto.randomUUID().slice(0,12)}`,comment:text,url:reportPath(page),ua:navigator.userAgent,turnstile:token})});
      try{sessionStorage.removeItem(`archive-report-draft:${page||'website'}`);}catch{}
      if(activePage===page&&detail.value===snapshot)detail.value='';
      status.textContent='申报已提交；如开启审核，将在审核后公开显示。';document.dispatchEvent(new Event('feedback-submitted'));
    }catch(error){status.textContent=`提交未确认：${error.name==='TimeoutError'?'网络超时':error.message}。文字已保留，请先查看主页是否收到，再决定是否重试。`;}
    finally{sending=false;token='';window.turnstile?.reset(widget);button.disabled=true;}
  });
}
async function mountHome(root){
  const catalog=JSON.parse(root.querySelector('[data-report-catalog]').textContent), list=root.querySelector('[data-report-list]'), status=root.querySelector('[data-report-list-status]'), more=root.querySelector('[data-report-more]');
  let sources=[], loading=false;
  function renderItem(comment,source,depth=0){
    const item=document.createElement('article');item.className='report-item';item.dataset.time=String(new Date(comment.time).getTime());
    const heading=document.createElement('a');heading.textContent=source.title;heading.href=source.path||'/#feedback';item.append(heading);
    const text=document.createElement('p');text.textContent=typeof comment.orig==='string'?comment.orig: new DOMParser().parseFromString(comment.comment||'','text/html').body.textContent;item.append(text);
    const meta=document.createElement('small');meta.textContent=`${comment.nick?.startsWith('匿名·')?'匿名':comment.nick||'匿名'} · ${new Date(comment.time).toLocaleDateString('zh-CN')}`;item.append(meta);list.append(item);
    for(const child of comment.children||[])renderItem(child,source,depth+1);
  }
  async function load(reset=false){
    if(loading)return;loading=true;more.disabled=true;status.textContent='正在读取申报…';
    try{
      if(reset){list.replaceChildren();sources=[];const discovered=[];
        for(let offset=0;offset<catalog.length;offset+=20){const batch=catalog.slice(offset,offset+20);const counts=await request(root.dataset.server,'?type=count&url='+encodeURIComponent(batch.map(x=>reportPath(x.path)).join(','))+'&lang=zh-CN');batch.forEach((source,i)=>{if(Number(counts[i])>0)discovered.push({...source,page:1,total:1});});}
        sources=discovered;
      }
      for(const source of sources.filter(x=>x.page<=x.total)){
        const data=await request(root.dataset.server,'?path='+encodeURIComponent(reportPath(source.path))+'&pageSize=10&page='+source.page+'&sortBy=insertedAt_desc&lang=zh-CN');
        source.total=data.totalPages;source.page++;for(const comment of data.data||[])renderItem(comment,source);
      }
      Array.from(list.children).sort((a,b)=>Number(b.dataset.time)-Number(a.dataset.time)).forEach(item=>list.append(item));
      more.hidden=!sources.some(x=>x.page<=x.total);status.textContent=list.children.length?'':'暂时没有公开申报。';
    }catch(error){status.textContent='申报读取失败：'+error.message;more.hidden=false;}
    finally{loading=false;more.disabled=false;}
  }
  more.addEventListener('click',()=>load(!sources.length));document.addEventListener('feedback-submitted',()=>load(true));
  const observer=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting)){observer.disconnect();load(true);}},{rootMargin:'200px'});observer.observe(root);
}
if(typeof document!=='undefined'){
 document.querySelectorAll('[data-feedback-editor]').forEach(mountEditor);
 document.querySelectorAll('[data-feedback-home]').forEach(mountHome);
}
