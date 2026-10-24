export const TAG = 'workflow-timers:v1';
export const SKIP = 'workflow-skip:';
export const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
export const DAY_NAMES = ['Po','Út','St','Čt','Pá','So','Ne'];
export const DOMAINS = ['light','switch','fan','input_boolean','cover'];
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
export function editable(s) {
  return isManaged(s) && ['repeat','pause'].includes(s.repeat_type) && s.start_date===s.end_date
    && s.weekdays.every(d=>d==='daily'||DAYS.includes(d))
    && s.timeslots?.length===2 && s.timeslots.every(t=>!t.stop && !t.conditions?.length && t.actions.length>0)
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
  if (!draft.targets.length) throw Error('Vyberte alespoň jedno zařízení.');
  const ids = draft.targets.map(t=>t.id);
  if (new Set(ids).size!==ids.length || ids.some(id=>!/^\w+\.\w+$/.test(id) || !DOMAINS.includes(id.split('.')[0]))) throw Error('Neplatný nebo duplicitní cíl.');
  const on = encodeTime(draft.on), off = encodeTime(draft.off);
  if (on===off) throw Error('Zapnutí a vypnutí musí mít rozdílné časy.');
  if (draft.on.mode==='time' && draft.off.mode==='time' && on>off && draft.days.length!==7) throw Error('Pro čas přes půlnoc vyberte každý den. Obě akce jinak platí jen pro označené dny.');
  if (!draft.date && (!draft.days.length || draft.days.some(d=>!DAYS.includes(d)))) throw Error('Vyberte alespoň jeden den.');
  if (draft.date && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || new Date(draft.date+'T12:00:00Z').toISOString().slice(0,10)!==draft.date)) throw Error('Neplatné datum.');
  if (draft.date && draft.on.mode==='time' && draft.off.mode==='time' && on>off) throw Error('Jednorázový plán musí začít i skončit ve vybraném dni.');
  return {
    name, weekdays:draft.date || draft.days.length===7?['daily']:draft.days,
    start_date:draft.date || null, end_date:draft.date || null, repeat_type:draft.date?'pause':'repeat',
    tags:[...new Set([...(old?.tags || []),TAG])],
    timeslots:[on,off].map((start,i)=>({start,actions:draft.targets.map(t=>({entity_id:t.id,service:service(t.id,i===0),service_data:parameters(i===0?t.on:t.off)}))})),
  };
}
export function toDraft(s) {
  if (!s) return {name:'',days:[...DAYS],date:'',on:parseTime('07:00:00'),off:parseTime('09:00:00'),targets:[]};
  return {name:s.name, days:s.weekdays.includes('daily')?[...DAYS]:[...s.weekdays],date:s.start_date===s.end_date?s.start_date||'':'',on:parseTime(s.timeslots[0].start),off:parseTime(s.timeslots[1].start),targets:entityIds(s).map(id=>({id,on:s.timeslots[0].actions.find(a=>a.entity_id===id)?.service_data || {},off:s.timeslots[1].actions.find(a=>a.entity_id===id)?.service_data || {}}))};
}
