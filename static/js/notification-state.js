// The browser asks for its notification identity (a year-long cookie and a
// server-side inbox) only once the visitor has opened the bell or sent a
// comment. Someone who only reads is never given one.
export const SESSION_FLAG='archive-notice-session';
export function sessionWanted(storage){try{return storage.getItem(SESSION_FLAG)==='1';}catch{return false;}}
export function wantSession(storage){try{storage.setItem(SESSION_FLAG,'1');}catch{}}
export function safeNoticeURL(value){if(typeof value!=='string'||value.startsWith('//')||value.includes('..')||value.length>500)return null;return /^\/(?:posts\/|news\/|figures\/|lexicon\/|#feedback)/.test(value)?value:null;}
const KINDS=['posts','news','lexicon','figures'];
export function updatePublicState(previous,items,now=Date.now()){
 const valid=items.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&KINDS.includes(x.kind)&&safeNoticeURL(x.url));
 if(!previous||!Array.isArray(previous.known)||!Array.isArray(previous.items))return {known:valid.map(x=>x.id),kinds:KINDS,items:[],checked:now};
 // A kind this browser has never tracked starts from a baseline as well:
 // everything already published in it is known, not a pile of new notices.
 const tracked=Array.isArray(previous.kinds)?previous.kinds:['posts','news','lexicon'];
 const known=new Set(previous.known);const notices=previous.items.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&safeNoticeURL(x.href));
 for(const item of valid)if(!known.has(item.id)){if(!tracked.includes(item.kind)){known.add(item.id);continue;}notices.unshift({id:item.id,kind:item.kind,title:item.title,message:({posts:'新文章',news:'新新闻',lexicon:'新词条',figures:'新人物'})[item.kind],href:item.url,time:Date.parse(item.publishedAt)||now,read:false});known.add(item.id);}
 return {known:[...known],kinds:KINDS,items:notices.sort((a,b)=>b.time-a.time).slice(0,500),checked:now};
}
