import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSchedule,toDraft,DAYS,TAG,GROUP,SKIP,encodeTime,localDate,editable,targetChoices,groupName,groupedSchedules,createVirtualSwitch} from '../www/workflow-timers/model.js';

test('groups keep related plans together and preserve skip and provenance tags',()=>{
  const d=toDraft();d.name='Morning';d.group='Rybičky';d.targets=[{id:'input_boolean.night_mode',on:{},off:{}}];
  const original=buildSchedule(d);original.tags.push(SKIP+'2026-10-24','workflow-origin:cas_01');
  const roundtrip=buildSchedule(toDraft(original),original);
  assert.deepEqual(roundtrip,original);
  const changed=toDraft(original);changed.group='Půda';
  const moved=buildSchedule(changed,original);
  assert.equal(groupName(moved),'Půda');assert.ok(!moved.tags.includes(GROUP+'Rybičky'));
  assert.ok(moved.tags.includes(SKIP+'2026-10-24'));assert.ok(moved.tags.includes('workflow-origin:cas_01'));
  changed.group='';assert.equal(groupName(buildSchedule(changed,original)),'');
  assert.deepEqual(groupedSchedules([{name:'free',tags:[]},original,moved,original]).map(([g,items])=>[g,items.length]),[['Rybičky',2],['Půda',1],['',1]]);
  assert.equal(original.timeslots[0].actions[0].service,'input_boolean.turn_on');
  assert.equal(original.timeslots[1].actions[0].service,'input_boolean.turn_off');
});

test('virtual switch creation resolves the real registry ID and never changes existing entities',async()=>{
  const calls=[];
  const hass={user:{is_admin:true},callWS:async msg=>{calls.push(msg);return msg.type==='input_boolean/create'?{id:'nocni_rezim',name:msg.name}:[{platform:'input_boolean',unique_id:'nocni_rezim',entity_id:'input_boolean.nocni_rezim_2'}];}};
  assert.deepEqual(await createVirtualSwitch(hass,' Noční režim '),{id:'input_boolean.nocni_rezim_2',name:'Noční režim'});
  assert.deepEqual(calls.map(c=>c.type),['input_boolean/create','config/entity_registry/list']);
  assert.equal(calls[0].initial,undefined); // Restore state normally after future restarts.
  await assert.rejects(createVirtualSwitch(hass,' '));
  await assert.rejects(createVirtualSwitch({...hass,user:{is_admin:false}},'Denied'));
  assert.equal(calls.length,2);
  await assert.rejects(createVirtualSwitch({...hass,callWS:async msg=>msg.type==='input_boolean/create'?{id:'created'}:[]},'Created'),/byl vytvořen/);
});

test('hundreds of devices sort by name, pin selections across searches and restore unchecked positions',()=>{
  const states=Object.fromEntries(Array.from({length:400},(_,i)=>['light.0x'+(400-i).toString(16),{attributes:{friendly_name:'Světlo '+(i+1)}}]));
  states['sensor.temperature']={attributes:{friendly_name:'Teplota'}};
  states['switch.schedule_demo']={attributes:{friendly_name:'Plán'}};
  states['switch.plan']={attributes:{friendly_name:'Další plán'}};
  const excluded=['switch.plan'], selected=['light.0x1','light.0x190'];
  const full=targetChoices(states,[],excluded);
  assert.equal(full.total,400);
  assert.equal(full.available[0].name,'Světlo 1');
  assert.equal(full.available[399].name,'Světlo 400');
  const filtered=targetChoices(states,selected,excluded,'SVETLO 200');
  assert.deepEqual(filtered.selected.map(x=>x.name),['Světlo 1','Světlo 400']);
  assert.deepEqual(filtered.available.map(x=>x.name),['Světlo 200']);
  assert.equal(filtered.total,400);
  assert.deepEqual(targetChoices(states,[],excluded,'0x190').available.map(x=>x.name),['Světlo 1']);
  const unchecked=targetChoices(states,selected.slice(1),excluded);
  assert.equal(unchecked.available.at(-1).name,'Světlo 400');
  assert.deepEqual(targetChoices(states,[],excluded).available,full.available);
  assert.equal(targetChoices(states,['light.removed'],excluded,'nothing').selected[0].missing,true);
});

test('a multi-device plan survives editing with per-device parameters',()=>{
  const draft=toDraft();draft.name='Morning';draft.days=['mon','wed'];draft.targets=[{id:'light.desk',on:{brightness_pct:60},off:{}},{id:'switch.pump',on:{},off:{}}];
  const result=buildSchedule(draft);
  assert.deepEqual(result.timeslots[0].actions.map(a=>a.service),['light.turn_on','switch.turn_on']);
  assert.deepEqual(result.timeslots[1].actions.map(a=>a.service),['light.turn_off','switch.turn_off']);
  assert.equal(result.timeslots[0].actions[0].service_data.brightness_pct,60);
  assert.deepEqual(buildSchedule(toDraft(result),result),result);
  assert.deepEqual(result.weekdays,['mon','wed']);
  assert.ok(result.tags.includes(TAG));
});
test('sun offsets, date-only plans and HA timezone dates',()=>{
  assert.equal(encodeTime({mode:'sunset',offset:-20}),'sunset-00:20:00');
  assert.equal(encodeTime({mode:'sunrise',offset:120}),'sunrise+02:00:00');
  assert.equal(localDate('Europe/Prague',new Date('2026-10-24T22:30:00Z')),'2026-10-25');
  const d=toDraft();d.name='One day';d.date='2026-12-01';d.targets=[{id:'cover.blind',on:{},off:{}}];
  const s=buildSchedule(d);assert.equal(s.start_date,s.end_date);assert.equal(s.repeat_type,'pause');assert.equal(s.timeslots[1].actions[0].service,'cover.close_cover');
});
test('editing preserves shared enable conditions and a device that only turns off',()=>{
  const d=toDraft();d.name='Aquarium';
  d.targets=[{id:'switch.light',on:{},off:{}},{id:'switch.air',onEnabled:false,offEnabled:true,on:{},off:{}}];
  d.conditions=[{entity_id:'input_boolean.aquarium_enabled',match_type:'is',value:'on'}];
  const s=buildSchedule(d);
  assert.equal(editable(s),true);
  assert.deepEqual(s.timeslots[0].actions.map(a=>a.entity_id),['switch.light']);
  assert.deepEqual(s.timeslots[1].actions.map(a=>a.entity_id),['switch.light','switch.air']);
  assert.deepEqual(buildSchedule(toDraft(s),s),s);
  const edited=toDraft(s);edited.conditions[0].enabled=false;
  assert.equal(buildSchedule(edited,s).timeslots[0].conditions,undefined);
  const asymmetric=structuredClone(s);asymmetric.timeslots[1].conditions=[];
  assert.equal(editable(asymmetric),false);
  const invalid=toDraft(s);invalid.targets[0].onEnabled=false;
  assert.throws(()=>buildSchedule(invalid,s));
});
test('invalid or destructive inputs are rejected',()=>{
  const d=toDraft();d.name='Test';d.targets=[{id:'light.desk',on:{},off:{}}];
  assert.throws(()=>buildSchedule({...d,days:[]}));
  assert.throws(()=>buildSchedule({...d,date:'2026-02-30'}));
  assert.throws(()=>buildSchedule({...d,off:d.on}));
  assert.throws(()=>encodeTime({mode:'time',time:'24:00'}));
  assert.throws(()=>encodeTime({mode:'sunrise',offset:121}));
  assert.throws(()=>buildSchedule({...d,targets:[{id:'light.desk',on:{entity_id:'light.other'}}]}));
  assert.throws(()=>buildSchedule({...d,targets:[{id:'light.desk',on:'[]'}]}));
  assert.throws(()=>buildSchedule({...d,days:['mon'],on:{mode:'time',time:'22:00'},off:{mode:'time',time:'06:00'}}));
  const advanced=buildSchedule(d);advanced.timeslots[0].conditions=[{entity_id:'sensor.test'}];assert.equal(editable(advanced),false);assert.throws(()=>buildSchedule(d,advanced));
  assert.equal(buildSchedule({...d,days:DAYS,on:{mode:'time',time:'22:00'},off:{mode:'time',time:'06:00'}}).weekdays[0],'daily');
});
