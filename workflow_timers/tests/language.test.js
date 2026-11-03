import {test} from 'node:test';
import assert from 'node:assert/strict';
import {timeLabel,dayLabel,createVirtualSwitch} from '../www/workflow-timers/model.js';
import {errorText,normalizeLanguage,t} from '../www/workflow-timers/i18n.js';

test('calendar labels change language without changing scheduler values',()=>{
  const plan={weekdays:['mon','wed','fri']},before=JSON.stringify(plan);
  assert.equal(dayLabel(plan,'en'),'Mon · Wed · Fri');
  assert.equal(dayLabel(plan,'cs'),'Po · St · Pá');
  assert.equal(timeLabel('sunrise-00:20:00','en'),'Sunrise −20 min');
  assert.equal(timeLabel('sunrise-00:20:00','cs'),'Východ −20 min');
  assert.equal(JSON.stringify(plan),before);
  assert.equal(normalizeLanguage('cs-CZ'),'cs');assert.equal(normalizeLanguage('fr-FR'),'en');
});

test('a partially created helper has a localized error with its original name',async()=>{
  const hass={user:{is_admin:true},callWS:async m=>m.type==='input_boolean/create'?{id:'helper'}:[]};
  await assert.rejects(createVirtualSwitch(hass,'Zrušit'),error=>{
    assert.match(errorText('en',error),/Switch “Zrušit” was created/);
    assert.match(errorText('cs',error),/Přepínač „Zrušit“ byl vytvořen/);
    return true;
  });
  assert.equal(t('en','An unknown server message'),'An unknown server message');
});
