import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {createImageUpload, imageConfig} from '../notifications/comment-images.mjs';
const origin = 'https://site.test';
const config = {turnstileSecret:'private-turnstile',cloud:'test-cloud',apiKey:'test-key',apiSecret:'private-cloudinary'};
const sample = await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();
const request = (body = {}, headers = {}) => new Request(origin+'/api/comment-images',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify({token:'valid-token',data:sample.toString('base64'),...body})});
function fixture(verified = {}) {
  const records = new Map(), calls = [];
  const store = {read:async key => records.get(key) || null,write:async(key,value,etag)=>{const old=records.get(key);if((old?.etag??null)!==etag)return false;records.set(key,{value,etag:String(Number(etag || 0)+1)});return true;}};
  const handler = createImageUpload({config,origin,store,now:()=>100000000,fetch:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('siteverify'))return Response.json({success:true,action:'comment_image',hostname:'site.test',...verified});
    return Response.json({secure_url:'https://res.cloudinary.com/test-cloud/image/upload/v1/comment-attachments/test.webp'});
  }});
  return {handler,records,calls};
}
test('upload fails closed without configuration and requires origin and trusted IP',async()=>{
  assert.equal(imageConfig({}),null);
  assert.equal((await createImageUpload({})(request(),'1.2.3.4')).status,503);
  const f=fixture();
  assert.equal((await f.handler(request({}, {origin:'https://evil.test'}),'1.2.3.4')).status,403);
  assert.equal((await f.handler(request(),null)).status,503);
  assert.equal(f.calls.length,0);
});
for(const failure of [{success:false},{action:'social'},{hostname:'evil.test'}])test('rejects invalid verification '+JSON.stringify(failure),async()=>{
  const f=fixture(failure);
  assert.equal((await f.handler(request(),'1.2.3.4')).status,403);
  assert.equal(f.calls.length,1);
});
test('rejects oversized payload and disguised SVG without contacting image host',async()=>{
  const f=fixture();
  assert.equal((await f.handler(request({data:Buffer.alloc(2100000).toString('base64')}),'1.2.3.4')).status,413);
  assert.equal((await f.handler(request({data:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString('base64')}),'1.2.3.4')).status,415);
  assert.equal(f.calls.filter(x=>x.url.includes('cloudinary')).length,0);
});
test('re-encodes image and signs server-controlled isolated destination without exposing secrets',async()=>{
  const f=fixture(), response=await f.handler(request(),'1.2.3.4');
  assert.equal(response.status,200);
  const body=await response.text();assert.ok(!body.includes(config.apiSecret));
  const form=f.calls[1].options.body;
  assert.equal(form.get('upload_preset'),null);
  assert.match(form.get('public_id'),/^comment-attachments\/[0-9a-f-]+$/);
  assert.equal(form.get('overwrite'),'false');
  const expected=createHash('sha1').update(`overwrite=false&public_id=${form.get('public_id')}&timestamp=${form.get('timestamp')}${config.apiSecret}`).digest('hex');
  assert.equal(form.get('signature'),expected);
  assert.equal((await sharp(Buffer.from(await form.get('file').arrayBuffer())).metadata()).format,'webp');
});
test('persistent atomic limits reject the eleventh attempt and global quota across IPs',async()=>{
  const f=fixture({success:false});
  for(let i=0;i<10;i++)assert.equal((await f.handler(request(),'1.2.3.4')).status,403);
  assert.equal((await f.handler(request(),'1.2.3.4')).status,429);
  f.records.set('image-limits/day/1',{value:{count:200},etag:'1'});
  assert.equal((await f.handler(request(),'2.3.4.5')).status,429);
});
test('verification token replay cannot trigger another Cloudinary upload',async()=>{
  let redeemed=false, uploads=0;
  const handler=createImageUpload({config,origin,store:{read:async()=>null,write:async()=>true},fetch:async url=>{
    if(url.includes('siteverify')){const success=!redeemed;redeemed=true;return Response.json({success,action:'comment_image',hostname:'site.test'});}
    uploads++;return Response.json({secure_url:'https://res.cloudinary.com/test-cloud/image/upload/test.webp'});
  }});
  assert.equal((await handler(request(),'1.2.3.4')).status,200);
  assert.equal((await handler(request(),'1.2.3.4')).status,403);assert.equal(uploads,1);
});
