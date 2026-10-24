import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSchedule,toDraft,DAYS,TAG,encodeTime,localDate,editable} from '../www/workflow-timers/model.js';

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
