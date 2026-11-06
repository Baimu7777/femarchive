import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
class Element {
  children=[]; isConnected=true;
  append(...nodes){this.children.push(...nodes);}
  after(node){this.sibling=node;}
  remove(){this.isConnected=false;}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(){}
}
test('concurrent Turnstile callers share script, wait for callback, retry failed loads; widget never calls ready',async()=>{
  const scripts=[], removed=[];
  const api={render:(element,options)=>{queueMicrotask(()=>options.callback('fresh'));return 'widget';},remove:id=>removed.push(id),ready:()=>assert.fail('ready must not be called')};
  const context=vm.createContext({window:{},document:{createElement:()=>new Element(),head:{append:node=>scripts.push(node)},body:new Element()},setTimeout,clearTimeout,Promise,Error});
  vm.runInContext((await readFile('static/js/turnstile-loader.js','utf8')).replaceAll('export ',''),context);
  const one=vm.runInContext('loadTurnstile()',context),two=vm.runInContext('loadTurnstile()',context);
  assert.equal(one,two);assert.equal(scripts.length,1);
  scripts[0].onerror();await assert.rejects(one);
  const retry=vm.runInContext('loadTurnstile()',context);assert.equal(scripts.length,2);
  context.window.turnstile=api;context.window.archiveTurnstileLoaded();await retry;
  assert.equal(await vm.runInContext("verifyTurnstile('sitekey','social')",context),'fresh');assert.deepEqual(removed,['widget']);
});
test('attachment cards leave editor untouched, limit count, remove references, and clear on path changes',async()=>{
  const editor=new Element();editor.value='我的文字';
  let uploads=0;
  const context=vm.createContext({document:{createElement:()=>new Element()},URL,AbortSignal,Error,
    verifyTurnstile:async()=> 'fresh',
    FileReader:class{readAsDataURL(){this.result='data:image/png;base64,YQ==';this.onload();}},
    fetch:async(url,options)=>options?.method==='POST'?{ok:true,json:async()=>({url:`https://res.cloudinary.com/test/image/upload/${++uploads}.webp`})}:{ok:true},
    editor
  });
  const source=(await readFile('static/js/comment-attachments.js','utf8')).replace(/^import[^\n]+\n/,'').replaceAll('export ','');
  vm.runInContext(source+'\nvar files=createAttachments(()=>editor,()=>"key"); files.sync("/a/");',context);
  const add=()=>vm.runInContext('files.add({type:"image/png",size:1})',context);
  await add();assert.equal(editor.value,'我的文字');assert.match(vm.runInContext('files.markdown()',context),/!\[评论图片\]/);
  editor.sibling.children[0].children[2].onclick();assert.equal(vm.runInContext('files.markdown()',context),'');
  await add();await add();await add();await assert.rejects(add(),/最多/);
  vm.runInContext('files.sync("/b/")',context);assert.equal(vm.runInContext('files.markdown()',context),'');
});
test('unconfigured uploads show error and never request Turnstile or send file',async()=>{
  const editor=new Element();let verified=false;
  const context=vm.createContext({document:{createElement:()=>new Element()},URL,AbortSignal,Error,editor,fetch:async()=>({ok:false}),verifyTurnstile:()=>{verified=true;}});
  vm.runInContext((await readFile('static/js/comment-attachments.js','utf8')).replace(/^import[^\n]+\n/,'').replaceAll('export ','')+'\nvar files=createAttachments(()=>editor,()=>"key");',context);
  await vm.runInContext('files.add({type:"image/png",size:1})',context);
  assert.equal(verified,false);assert.match(editor.sibling.children[0].children[0].textContent,/暂未开放/);
});
