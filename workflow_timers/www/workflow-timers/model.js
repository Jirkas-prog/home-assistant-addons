export const TAG = 'workflow-timers:v1';
export const SKIP = 'workflow-skip:';
export const GROUP = 'workflow-group:';
export const groupName = s => (s.tags || []).find(tag=>tag.startsWith(GROUP))?.slice(GROUP.length) || '';
export function groupedSchedules(schedules) {
  const groups=new Map();
  for(const s of schedules){const name=groupName(s);if(!groups.has(name))groups.set(name,[]);groups.get(name).push(s);}
  return [...groups].sort(([a],[b])=>a===''?1:b===''?-1:0);
}
export async function createVirtualSwitch(hass, name) {
  name=name.trim();
  if(!name || name.length>100)throw Error('Zadejte název přepínače (1 až 100 znaků).');
  if(!hass.user?.is_admin)throw Error('Přepínač může vytvořit jen správce.');
  const helper=await hass.callWS({type:'input_boolean/create',name,icon:'mdi:toggle-switch-outline'});
  try {
    const registry=await hass.callWS({type:'config/entity_registry/list'});
    const entity=registry.find(e=>e.platform==='input_boolean' && e.unique_id===helper.id && e.entity_id.startsWith('input_boolean.'));
    if(!entity)throw Error('Entita ještě není dostupná.');
    return {id:entity.entity_id,name:helper.name};
  } catch(error) {
    throw Error(`Přepínač „${name}“ byl vytvořen, ale nepodařilo se jej automaticky vybrat. Vyhledejte jej podle názvu v seznamu zařízení.`,{cause:error});
  }
}
export const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
export const DAY_NAMES = ['Po','Út','St','Čt','Pá','So','Ne'];
export const DOMAINS = ['light','switch','fan','input_boolean','cover'];
export function targetChoices(states, selectedIds, excludedIds = [], query = '') {
  const selected = new Set(selectedIds), excluded = new Set(excludedIds);
  const normalize = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('cs');
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  const candidates = Object.keys(states).filter(id => DOMAINS.includes(id.split('.')[0]) && !excluded.has(id) && !id.startsWith('switch.schedule_'));
  const items = [...new Set([...candidates, ...selected])].map(id => ({id, name:states[id]?.attributes?.friendly_name || id, missing:!states[id]}))
    .sort((a,b) => a.name.localeCompare(b.name, 'cs', {numeric:true}) || a.id.localeCompare(b.id));
  return {
    selected:items.filter(item => selected.has(item.id)),
    available:items.filter(item => !selected.has(item.id) && words.every(word => normalize(item.name+' '+item.id).includes(word))),
    total:items.length,
  };
}
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function localDate(zone, date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p => [p.type,p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function parseTime(value = '07:00:00') {
  const m = /^(sunrise|sunset)([+-])(\d{2}):(\d{2}):00$/.exec(value);
  if (m) return {mode:m[1], time:'07:00', offset:(Number(m[3])*60+Number(m[4]))*(m[2]==='-'?-1:1)};
  return {mode:'time',time:value.slice(0,5),offset:0};
}
export function encodeTime({mode,time,offset}) {
  if (mode === 'time') {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('Zadejte platný čas.');
    return `${time}:00`;
  }
  offset = Number(offset);
  if (!['sunrise','sunset'].includes(mode) || !Number.isInteger(offset) || Math.abs(offset)>120) throw Error('Posun slunce musí být od −120 do +120 minut.');
  return `${mode}${offset<0?'-':'+'}${String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')}:${String(Math.abs(offset)%60).padStart(2,'0')}:00`;
}
export function timeLabel(value) {
  const t = parseTime(value);
  if (t.mode === 'time') return t.time;
  return `${t.mode==='sunrise'?'Východ':'Západ'}${t.offset ? ` ${t.offset>0?'+':'−'}${Math.abs(t.offset)} min` : ''}`;
}
export function dayLabel(s) {
  if (s.start_date && s.start_date===s.end_date) return new Date(`${s.start_date}T12:00`).toLocaleDateString('cs-CZ');
  const d = s.weekdays || [];
  if (d.includes('daily') || DAYS.every(x=>d.includes(x))) return 'Každý den';
  if (d.length===5 && DAYS.slice(0,5).every(x=>d.includes(x))) return 'Po–Pá';
  if (d.length===2 && d.includes('sat') && d.includes('sun')) return 'Víkend';
  return d.map(x=>DAY_NAMES[DAYS.indexOf(x)] || ({workday:'Pracovní dny',weekend:'Víkend'}[x]) || x).join(' · ');
}
export const isManaged = s => (s.tags || []).includes(TAG);
export const isSkipped = (s,today) => (s.tags || []).includes(SKIP+today);
export const entityIds = s => [...new Set((s.timeslots||[]).flatMap(t=>t.actions.map(a=>a.entity_id).filter(Boolean)))];
const slotConditions = slot => (slot.conditions || []).map(c=>({entity_id:c.entity_id,match_type:c.match_type,value:c.value}));
const simpleCondition = c => /^\w+\.\w+$/.test(c.entity_id) && !c.attribute && c.match_type==='is' && ['on','off'].includes(c.value);
export function editable(s) {
  return isManaged(s) && ['repeat','pause'].includes(s.repeat_type) && s.start_date===s.end_date
    && s.weekdays.every(d=>d==='daily'||DAYS.includes(d))
    && s.timeslots?.length===2 && s.timeslots.every(t=>!t.stop && !t.track_conditions && (!t.condition_type || t.condition_type==='and') && (t.conditions || []).every(simpleCondition) && t.actions.length>0)
    && JSON.stringify(slotConditions(s.timeslots[0]))===JSON.stringify(slotConditions(s.timeslots[1]))
    && s.timeslots.every((t,i)=>t.actions.every(a=>DOMAINS.includes(a.entity_id?.split('.')[0]) && a.service===service(a.entity_id,i===0)));
}
function service(id,on) {const domain=id.split('.')[0];return `${domain}.${domain==='cover'?(on?'open_cover':'close_cover'):(on?'turn_on':'turn_off')}`;}
function parameters(value) {
  const data = typeof value==='string' ? JSON.parse(value || '{}') : value || {};
  if (!data || Array.isArray(data) || typeof data!=='object') throw Error('Parametry musí být JSON objekt.');
  if (['entity_id','device_id','area_id','target'].some(k=>k in data)) throw Error('Cíl vyberte v seznamu zařízení, ne v parametrech.');
  return data;
}
export function buildSchedule(draft, old) {
  if (old && !editable(old)) throw Error('Tento plán má jiný formát. Upravte jej v původní kartě Scheduler.');
  const name = draft.name.trim();
  if (!name || name.length>100) throw Error('Název musí mít 1 až 100 znaků.');
  const group=(draft.group || '').trim();
  if(group.length>60 || /[\u0000-\u001f]/.test(group))throw Error('Název skupiny musí mít nejvýše 60 znaků a být na jednom řádku.');
  if (!draft.targets.length) throw Error('Vyberte alespoň jedno zařízení.');
  const ids = draft.targets.map(t=>t.id);
  if (new Set(ids).size!==ids.length || ids.some(id=>!/^\w+\.\w+$/.test(id) || !DOMAINS.includes(id.split('.')[0]))) throw Error('Neplatný nebo duplicitní cíl.');
  if (draft.targets.some(t=>t.onEnabled===false && t.offEnabled===false)) throw Error('U každého zařízení vyberte zapnutí, vypnutí, nebo obojí.');
  const conditions=(draft.conditions || []).filter(c=>c.enabled!==false).map(({entity_id,match_type,value})=>({entity_id,match_type,value}));
  if (!conditions.every(simpleCondition)) throw Error('Neplatná podmínka plánu.');
  if (['onEnabled','offEnabled'].some(key=>!draft.targets.some(t=>t[key]!==false))) throw Error('Pro každý čas vyberte alespoň jednu akci.');
  const on = encodeTime(draft.on), off = encodeTime(draft.off);
  if (on===off) throw Error('Zapnutí a vypnutí musí mít rozdílné časy.');
  if (draft.on.mode==='time' && draft.off.mode==='time' && on>off && draft.days.length!==7) throw Error('Pro čas přes půlnoc vyberte každý den. Obě akce jinak platí jen pro označené dny.');
  if (!draft.date && (!draft.days.length || draft.days.some(d=>!DAYS.includes(d)))) throw Error('Vyberte alespoň jeden den.');
  if (draft.date && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || new Date(draft.date+'T12:00:00Z').toISOString().slice(0,10)!==draft.date)) throw Error('Neplatné datum.');
  if (draft.date && draft.on.mode==='time' && draft.off.mode==='time' && on>off) throw Error('Jednorázový plán musí začít i skončit ve vybraném dni.');
  return {
    name, weekdays:draft.date || draft.days.length===7?['daily']:draft.days,
    start_date:draft.date || null, end_date:draft.date || null, repeat_type:draft.date?'pause':'repeat',
    tags:[...new Set([...(old?.tags || []).filter(tag=>!tag.startsWith(GROUP) || (group && tag===GROUP+group)),TAG,...(group?[GROUP+group]:[])])],
    timeslots:[on,off].map((start,i)=>({start,...(conditions.length?{conditions,condition_type:'and'}:{}),actions:draft.targets.filter(t=>t[i===0?'onEnabled':'offEnabled']!==false).map(t=>({entity_id:t.id,service:service(t.id,i===0),service_data:parameters(i===0?t.on:t.off)}))})),
  };
}
export function toDraft(s) {
  if (!s) return {name:'',group:'',days:[...DAYS],date:'',on:parseTime('07:00:00'),off:parseTime('09:00:00'),targets:[],conditions:[]};
  return {name:s.name,group:groupName(s), days:s.weekdays.includes('daily')?[...DAYS]:[...s.weekdays],date:s.start_date===s.end_date?s.start_date||'':'',on:parseTime(s.timeslots[0].start),off:parseTime(s.timeslots[1].start),conditions:slotConditions(s.timeslots[0]),targets:entityIds(s).map(id=>({id,onEnabled:s.timeslots[0].actions.some(a=>a.entity_id===id),offEnabled:s.timeslots[1].actions.some(a=>a.entity_id===id),on:s.timeslots[0].actions.find(a=>a.entity_id===id)?.service_data || {},off:s.timeslots[1].actions.find(a=>a.entity_id===id)?.service_data || {}}))};
}
