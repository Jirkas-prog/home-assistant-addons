import '../www/workflow-timers/workflow-timers.js?v=1.0.1';
import {buildSchedule,DAYS,localDate,SKIP} from '../www/workflow-timers/model.js';
const states={
 'light.aquarium':{state:'on',attributes:{friendly_name:'Osvětlení akvária'}},
 'switch.air_pump':{state:'off',attributes:{friendly_name:'Vzduchování'}},
 'light.hall':{state:'off',attributes:{friendly_name:'Světla v chodbě'}},
 'light.porch':{state:'on',attributes:{friendly_name:'Světlo u dveří'}},
 'switch.workshop':{state:'off',attributes:{friendly_name:'Zásuvka v dílně'}},
 'fan.bathroom':{state:'unavailable',attributes:{friendly_name:'Ventilátor'}},
 'cover.shades':{state:'closed',attributes:{friendly_name:'Rolety'}},
 'light.0x00158d000000a1b2':{state:'off',attributes:{friendly_name:'Obývák · stojací lampa'}},
 'sun.sun':{state:'above_horizon',attributes:{}},
};
// Optional large fictional inventory for checking selection and search behavior.
if(new URLSearchParams(location.search).has('many')){
 for(let i=1;i<=400;i++)states['light.0x'+(0x100000+i).toString(16)]={state:'off',attributes:{friendly_name:'Zkušební světlo '+i}};
}
function plan(name,ids,on,off,days=DAYS,enabled=true){const p=buildSchedule({name,days,date:'',on,off,targets:ids.map(id=>({id,on:{},off:{}}))});const id=crypto.randomUUID();return {...p,schedule_id:id,entity_id:'switch.schedule_'+id,enabled,timestamps:[]};}
const at=time=>({mode:'time',time,offset:0});
const seed=()=>[
 plan('Akvárium · ranní světlo',['light.aquarium'],at('07:00'),at('09:00')),
 plan('Akvárium · vzduchování',['switch.air_pump'],at('12:00'),at('12:15')),
 plan('Chodba · večerní světla',['light.hall','light.porch'],{mode:'sunset',offset:-20,time:'18:00'},at('22:30')),
 plan('Dílna · pracovní ráno',['switch.workshop'],at('06:00'),at('08:15'),DAYS.slice(0,5),false),
 plan('Koupelna · odvětrání',['fan.bathroom'],at('18:00'),at('18:30')),
 plan('Rolety · víkend',['cover.shades'],at('08:30'),{mode:'sunset',offset:15,time:'19:00'},DAYS.slice(5)),
];
let schedules;
try{schedules=JSON.parse(localStorage.getItem('workflow-timers-demo'));}catch{}
if(!Array.isArray(schedules)){schedules=seed();schedules[1].tags.push(SKIP+localDate('Europe/Prague'));}
const listeners=new Set();
function save(){localStorage.setItem('workflow-timers-demo',JSON.stringify(schedules));listeners.forEach(fn=>fn());}
const hass={states,config:{time_zone:'Europe/Prague'},user:{is_admin:true},connection:{subscribeEvents:async fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}},
 async callWS(msg){
   if(msg.type==='scheduler/workflow_info')return {version:'1.0.1',today:localDate('Europe/Prague'),time_zone:'Europe/Prague'};
   if(msg.type==='scheduler')return structuredClone(schedules);
   const s=schedules.find(s=>s.schedule_id===msg.schedule_id);
   if(msg.type==='scheduler/item')return structuredClone(s);
   if(msg.type==='scheduler/workflow_skip'){s.tags=s.tags.filter(t=>!t.startsWith(SKIP));if(msg.skip)s.tags.push(SKIP+localDate('Europe/Prague'));save();return {success:true};}
   throw Error('Unknown demo request');
 },
 async callService(domain,action,{entity_id}){schedules.find(s=>s.entity_id===entity_id).enabled=action==='turn_on';save();},
 async callApi(method,url,payload){
   if(url==='scheduler/add'){const id=crypto.randomUUID();schedules.push({...payload,schedule_id:id,entity_id:'switch.schedule_'+id,enabled:true,timestamps:[]});}
   else if(url==='scheduler/edit'){const i=schedules.findIndex(s=>s.schedule_id===payload.schedule_id);schedules[i]={...schedules[i],...payload};}
   else if(url==='scheduler/remove')schedules=schedules.filter(s=>s.schedule_id!==payload.schedule_id);
   else throw Error('Unknown demo endpoint');
   save();return {success:true};
 }
};
const card=document.querySelector('workflow-timers-card');card.setConfig({title:'Časovače'});card.hass=hass;card.shadowRoot.querySelector('.demo').hidden=false;
document.querySelector('#reset').onclick=()=>{localStorage.removeItem('workflow-timers-demo');location.reload();};
