import test from 'node:test';import assert from 'node:assert/strict';import {createCommentBridge} from '../notifications/comments.mjs';
const origin='https://site.test';
function fixture(){const calls=[];return {calls,bridge:createCommentBridge({origin,waline:'https://comments.test/',store:{read:async()=>null,write:async()=>true},service:{identity:()=> 'browser',bind:async(cookie,data)=>calls.push({binding:data}),event:async data=>calls.push({event:data})},fetch:async(url,options)=>{calls.push({url,options});return Response.json({errno:0,data:{objectId:22,status:'approved'}})}})} }
const request=(originHeader=origin)=>new Request(origin+'/api/community',{method:'POST',headers:{origin:originHeader,'content-type':'application/json',cookie:'secret-browser-cookie',referer:origin+'/posts/1/'},body:JSON.stringify({url:'/posts/261041/',comment:'合成回复',pid:10,turnstile:'test-captcha'})});
test('bridge sends no cookie/referer upstream and binds returned id, never client recipient',async()=>{const f=fixture();assert.equal((await f.bridge(request())).status,200);const sent=f.calls.find(x=>x.url);assert.equal(sent.url,'https://comments.test/api/comment?lang=zh-CN');assert.equal(sent.options.headers.cookie,undefined);assert.equal(sent.options.headers.referer,undefined);assert.equal(sent.options.redirect,'error');assert.equal(f.calls.find(x=>x.binding).binding.id,'22');assert.equal(f.calls.find(x=>x.event).event.parentId,'10')});
test('cross origin blocked before remote write',async()=>{const f=fixture();assert.equal((await f.bridge(request('https://evil.test'))).status,403);assert.equal(f.calls.length,0)});
test('uncertain upstream failure is not automatically retried',async()=>{let n=0;const bridge=createCommentBridge({origin,waline:'https://comments.test/',store:{read:async()=>null,write:async()=>true},service:{identity:()=> 'owner'},fetch:async()=>{n++;throw Error('private remote detail')}});const r=await bridge(request());assert.equal(r.status,503);assert.equal(n,1);assert.ok(!(await r.text()).includes('private remote detail'))});
test('successful publication plus notification storage failure never asks to repost',async()=>{const bridge=createCommentBridge({origin,waline:'https://comments.test/',store:{read:async()=>null,write:async()=>true},service:{identity:()=> 'owner',bind:async()=>{throw Error('storage unavailable')}},fetch:async()=>Response.json({errno:0,data:{objectId:1}})});const result=await(await bridge(request())).json();assert.equal(result.errno,0);assert.ok(result.notificationWarning.includes('请勿重复发送'))});

test('one address is limited before the comment service is contacted, whatever identity it presents',async()=>{
  const records=new Map(),calls=[];
  const store={read:async key=>records.get(key)||null,write:async(key,value,etag)=>{const old=records.get(key);if((old?.etag??null)!==etag)return false;records.set(key,{value,etag:String(Number(etag||0)+1)});return true;}};
  let owner=0;
  const bridge=createCommentBridge({origin,waline:'https://comments.test/',secret:'s'.repeat(64),store,now:()=>600000,service:{identity:()=>'browser-'+(++owner),bind:async()=>{},event:async()=>{}},fetch:async url=>{calls.push(url);return Response.json({errno:0,data:{objectId:1}})}});
  for(let i=0;i<30;i++)assert.equal((await bridge(request(),'1.2.3.4')).status,200);
  assert.equal((await bridge(request(),'1.2.3.4')).status,429);
  assert.equal(calls.length,30);
  // The stored key never contains the address itself.
  assert.ok([...records.keys()].every(key=>!key.includes('1.2.3.4')));
  assert.equal((await bridge(request(),'5.6.7.8')).status,200);
  // Without a vouched-for address (tests, other hosts) the bridge behaves as before.
  assert.equal((await bridge(request())).status,200);
});
