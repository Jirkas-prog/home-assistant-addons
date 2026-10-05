import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {emptyState,newDocument} from '../src/model.js';
import {renderDocument,validateTemplate} from '../src/renderer.js';
const load=name=>fs.readFile(new URL('../public/'+name,import.meta.url));
test('compact invoice layout preserves variable values, row spacing and last-page totals',async()=>{
  const s=emptyState(),d=newDocument(s);
  Object.assign(d,{number:'TEST-17',date:'2026-09-14',due:'2026-10-16',currency:'CZK',items:[{name:'First',qty:1,unit:'pcs',price:1500},{name:'Second',qty:2.5,unit:'pcs',price:12.34}]});
  const t={name:'Compact invoice',locale:'cs-CZ',dateSeparator:'.',page:{width:210,height:297,top:20,bottom:90},nodes:[
    {id:'date',name:'Date',kind:'text',x:15,y:20,w:100,h:10,size:10,runs:[{field:'doc.date'}]},
    {id:'items',name:'Items',kind:'table',anchor:'after',after:'date',x:15,y:0,minY:50,w:180,h:40,size:10,paddingX:0,paddingY:0,lineHeight:1.1,headerHeight:4,rowHeight:5,rowHeights:[6],rowLines:false,currencyDisplay:'code',columns:[{key:'name',label:' ',width:50},{key:'qty',label:'Qty',width:15},{key:'price',label:'Price',width:35,headerAlign:'right'}]},
    {id:'total',name:'Total',kind:'text',x:100,y:220,w:95,h:10,size:12,repeat:'last',runs:[{field:'totals.total',format:'number',decimals:2},{text:' '},{field:'doc.currency'}]}
  ]};
  const r=await renderDocument(d,s,t,load),text=r.pages[0].filter(o=>o.kind==='text').map(o=>o.text).join('');
  assert.equal(r.pages.length,1);assert.deepEqual(r.errors,[]);
  assert(text.includes('14.09.2026'));assert(text.includes('1\u00a0500 CZK'));assert(text.includes('12,34 CZK'));assert(text.includes('2,5'));assert(text.includes('1\u00a0530,85 CZK'));
  const first=r.pages[0].find(o=>o.text==='First'),second=r.pages[0].find(o=>o.text==='Second');
  assert(Math.abs(second.y-first.y-6)<.001);assert.equal(r.bounds.items.y,50);assert(!r.pages[0].some(o=>o.kind==='line'));
  d.items=Array.from({length:95},(_,i)=>({name:'Row '+i+' '+'long description '.repeat(i===4?80:1),qty:1,unit:'pcs',price:10}));
  const long=await renderDocument(d,s,t,load);
  assert(long.pages.length>1);assert.deepEqual(long.errors,[]);
  assert(long.pages.slice(0,-1).every(ops=>!ops.some(o=>o.nodeId==='total')));
  assert(long.pages.at(-1).some(o=>o.nodeId==='total'&&o.text==='950,00'));
  for(const ops of long.pages)assert(ops.filter(o=>o.nodeId==='items'&&o.kind==='text').every(o=>o.y<=207));
  const invalid=structuredClone(t);invalid.nodes[1].paddingX=50;assert.throws(()=>validateTemplate(invalid,s),/padding/);
});
