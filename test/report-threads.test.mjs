import test from 'node:test';
import assert from 'node:assert/strict';
import {groupReports} from '../static/js/report-threads.js';
const c=(objectId,extra={})=>({objectId,time:`2026-11-0${objectId}T00:00:00Z`,...extra});
const record=(comment,path='')=>({comment,path});
test('nested and flat replies form one thread, deduplicate and retain immediate target',()=>{
  const first=c(2,{pid:1,rid:1}),second=c(3,{pid:2,rid:1});
  const threads=groupReports([record(c(1,{children:[first,second]})),record(first)]);
  assert.equal(threads.length,1);
  assert.deepEqual(threads[0].replies.map(x=>x.id),['2','3']);
  assert.equal(threads[0].replies[1].parent.id,'2');
});
test('nested replies without explicit IDs inherit parent and thread',()=>{
  const threads=groupReports([record(c(1,{children:[c(2,{children:[c(3)]})]}))]);
  assert.equal(threads.length,1);assert.equal(threads[0].replies.length,2);
  assert.equal(threads[0].replies[1].rootId,'1');
});
test('unloaded parent stays visible and joins original once pagination loads it',()=>{
  const reply=record(c(2,{pid:1,rid:1}));
  assert.equal(groupReports([reply])[0].parentId,1);
  const threads=groupReports([reply,record(c(1))]);
  assert.equal(threads.length,1);assert.equal(threads[0].id,'1');assert.equal(threads[0].replies[0].id,'2');
});
test('page boundaries and cyclic relationships never hide records',()=>{
  assert.equal(groupReports([record(c(1),'/a/'),record(c(2,{pid:1}),'/b/')]).length,2);
  assert.equal(groupReports([record(c(1,{pid:2})),record(c(2,{pid:1}))]).length,2);
});
