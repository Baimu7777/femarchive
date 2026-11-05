export function safeNoticeURL(value){if(typeof value!=='string'||value.startsWith('//')||value.includes('..')||value.length>500)return null;return /^\/(?:posts\/|news\/|lexicon\/|#feedback)/.test(value)?value:null;}
export function updatePublicState(previous,items,now=Date.now()){
 const valid=items.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&['posts','news','lexicon'].includes(x.kind)&&safeNoticeURL(x.url));
 if(!previous||!Array.isArray(previous.known)||!Array.isArray(previous.items))return {known:valid.map(x=>x.id),items:[],checked:now};
 const known=new Set(previous.known);const notices=previous.items.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&safeNoticeURL(x.href));
 for(const item of valid)if(!known.has(item.id)){notices.unshift({id:item.id,kind:item.kind,title:item.title,message:({posts:'新文章',news:'新新闻',lexicon:'新词条'})[item.kind],href:item.url,time:Date.parse(item.publishedAt)||now,read:false});known.add(item.id);}
 return {known:[...known],items:notices.sort((a,b)=>b.time-a.time).slice(0,500),checked:now};
}
