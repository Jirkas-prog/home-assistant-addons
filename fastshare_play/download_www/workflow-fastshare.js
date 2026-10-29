import {ready,localize,t} from './translations.js?v=2.1.3';
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bytes = (v=0) => {let n=Number(v)||0,i=0;while(n>=1024&&i<4){n/=1024;i++;}return `${n.toLocaleString('cs-CZ',{maximumFractionDigits:i?1:0})} ${['B','kB','MB','GB','TB'][i]}`;};
const duration = v => v == null ? 'Calculating…' : v < 1 ? 'Done' : v >= 3600 ? `${Math.floor(v/3600)} h ${Math.floor(v%3600/60)} min` : v>=60 ? `${Math.floor(v/60)} min ${Math.floor(v%60)} s` : `${Math.ceil(v)} s`;
const labels = {queued:'Queued',resolving:'Preparing transfer',downloading:'Downloading',completed:'Finished',cancelled:'Cancelled',failed:'Failed',needs_action:'Needs attention'};
const cardRows=cfg=>[2,3,4].includes(Number(cfg?.grid_options?.rows??cfg?.rows))?Number(cfg?.grid_options?.rows??cfg?.rows):'auto';
const emailCountdown=(data,online,now=Date.now()/1000)=>{
  if(!online)return {text:'—',label:'The add-on is offline'};
  if(!data.email_enabled)return {text:'Off',label:'Email monitoring is disabled.'};
  if(data.email_poll?.checking)return {text:'…',label:'Checking email…'};
  const next=data.email_poll?.next_check_at;
  if(!Number.isFinite(next)||next<=now)return {text:'…',label:'Waiting for the next email check'};
  const seconds=Math.ceil(next-now),text=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  return {text,label:'Next email check in {time}',time:text};
};
const widgetCSS = `
:host{display:block;height:auto;min-height:0;container-type:inline-size;color:#f3f7f6;font-family:"Segoe UI",system-ui,sans-serif}
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:#76985b #0d1c25}*::-webkit-scrollbar{width:8px;height:8px}*::-webkit-scrollbar-track{background:#0d1c25}*::-webkit-scrollbar-thumb{background:#76985b;border:2px solid #0d1c25;border-radius:0}*::-webkit-scrollbar-thumb:hover{background:#c2f86b}.shell{height:auto;border-radius:0;background:#152630;border:1px solid #607680;border-top:3px solid #c2f86b;padding:20px;display:flex;flex-direction:column;gap:16px;overflow:hidden;position:relative;isolation:isolate}
.shell::before{content:'';position:absolute;z-index:-1;inset:0;background:linear-gradient(118deg,transparent 45%,#213b40 45%,#213b40 58%,transparent 58%);opacity:.55;pointer-events:none}
.email-timer{display:flex;align-items:center;gap:5px;flex-shrink:0;color:#b9c4c9;font-size:15px;font-weight:500;line-height:1.2;font-variant-numeric:tabular-nums;white-space:nowrap}.email-timer svg{width:17px;height:17px;flex-shrink:0}.email-time{min-width:5ch;text-align:center}
.top{display:flex;align-items:center;gap:13px}.logo{width:42px;height:42px;flex-shrink:0}.logo svg{width:100%;height:100%}.heading{min-width:0;overflow-wrap:anywhere;font-size:23px;font-weight:750;flex:1;letter-spacing:-.5px}.sub{font-size:14px;font-weight:400;letter-spacing:0;color:#b9cbd0;margin-top:4px}.open{color:#c2f86b;text-decoration:none;border:1px solid #789287;padding:4px 10px;font-size:24px}.open[hidden]{display:none}
.health{display:flex;gap:0;flex-wrap:wrap;font-size:13px;color:#d3e0e3;border:1px solid #465e69;width:fit-content;background:#0d1c25}.health span{display:flex;align-items:center;gap:7px;padding:6px 9px;border-right:1px solid #465e69}.health span:last-child{border:0}.dot{width:7px;height:7px;background:#708997}.yes .dot{background:#c2f86b}.no .dot{background:#ffad91}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border:1px solid #bed1c9;margin:0;flex-shrink:0}.stat{padding:13px 12px 10px;border-right:1px solid #8ca3a0;position:relative;overflow:hidden;background:#c9dcd7;color:#183329}.stat:first-child{background:#c2f86b}.stat:last-child{border:0;background:#e6ede7}.stat::after{content:'';position:absolute;right:-14px;bottom:-13px;width:42px;height:65px;transform:skewX(-30deg);background:#24443b0d;pointer-events:none}.value{margin:7px 0 0;font-size:42px;line-height:1.1;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-1px}.short-caption{display:none}.caption{font-size:16px;line-height:1.25;font-weight:700;overflow-wrap:anywhere}.stat{display:flex;flex-direction:column}.value{margin-top:auto;padding-top:8px;overflow-wrap:anywhere}
.list{overflow-y:auto;overflow-x:hidden;max-height:320px;min-height:0}.list:has(.empty){overflow:visible;max-height:none}.job{padding:14px 0;border-top:1px solid #4a626d}.row{display:flex;justify-content:space-between;gap:12px;align-items:center}.name{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;font-weight:650}.percent{flex-shrink:0;font-variant-numeric:tabular-nums;font-size:15px;color:#c2f86b;white-space:nowrap}.track{height:7px;background:#07151e;margin:11px 0;overflow:hidden}.bar{height:100%;width:0;background:#c2f86b;transition:width 1.2s linear;position:relative}.downloading .bar:after{content:'';position:absolute;inset:0;background:repeating-linear-gradient(120deg,transparent 0,transparent 12px,#ffffff55 12px,#ffffff55 24px);animation:flow 1.5s linear infinite}.meta{flex-wrap:wrap;font-size:14px;color:#c4d4da;font-variant-numeric:tabular-nums}.error{overflow-wrap:anywhere;color:#ffb5a5;font-size:14px;margin-top:9px;line-height:1.45}.empty{padding:16px 4px;text-align:center;color:#c1d1d5;font-size:15px;line-height:1.6;white-space:pre-line}.footer{flex-wrap:wrap;overflow-wrap:anywhere;font-size:13px;color:#c4d4da;display:flex;justify-content:space-between;gap:8px;border-top:1px solid #435e68;padding-top:11px}.speed{color:#c2f86b;font-weight:650;white-space:nowrap}.offline .bar{filter:grayscale(1)}
@keyframes flow{from{background-position:0 0}to{background-position:28px 0}}@media(prefers-reduced-motion:reduce){.bar{transition:none}.bar:after{animation:none!important}}
@container(max-width:380px){.long-caption{display:none}.short-caption{display:inline}.shell{padding:14px;gap:12px}.heading{min-width:0;overflow-wrap:anywhere;font-size:21px}.value{font-size:35px}.caption{font-size:14px}.stat{padding:11px 8px}.logo{width:35px;height:35px}.sub{font-size:13px}.health span{padding:5px 7px}.empty{padding:10px 2px}}
:host([rows="2"]),:host([rows="3"]),:host([rows="4"]){height:calc(var(--rows)*var(--ha-section-grid-row-height,56px) + (var(--rows) - 1)*var(--ha-section-grid-row-gap,8px))}
:host([rows]:not([rows="auto"])) .shell{height:100%;padding:8px;gap:6px}
:host([rows]:not([rows="auto"])) .top{height:24px;min-height:24px;gap:8px}
:host([rows]:not([rows="auto"])) .logo{width:23px;height:23px}
:host([rows]:not([rows="auto"])) .email-timer{font-size:13px;gap:3px}
:host([rows]:not([rows="auto"])) .email-timer svg{width:14px;height:14px}
:host([rows]:not([rows="auto"])) .heading{font-size:19px;line-height:24px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
:host([rows]:not([rows="auto"])) .sub,:host([rows]:not([rows="auto"])) .health,:host([rows]:not([rows="auto"])) .footer{display:none}
:host([rows]:not([rows="auto"])) .open{font-size:20px;line-height:20px;padding:0 6px}
:host([rows]:not([rows="auto"])) .stats{height:70px}
:host([rows]:not([rows="auto"])) .stat{padding:5px 7px}
:host([rows]:not([rows="auto"])) .caption{font-size:13px;line-height:15px}
:host([rows]:not([rows="auto"])) .value{font-size:26px;line-height:28px;padding-top:0;margin-top:auto;white-space:nowrap}
:host([rows]:not([rows="auto"])) .list{flex:1;max-height:none;overflow:hidden}
:host([rows]:not([rows="auto"])) .job{padding:3px 0;height:56px;position:relative}
:host([rows]:not([rows="auto"])) .name{font-size:14px;line-height:18px}
:host([rows]:not([rows="auto"])) .percent{font-size:12px;max-width:45%;overflow:hidden;text-overflow:ellipsis}
:host([rows]:not([rows="auto"])) .track{height:4px;margin:5px 0 3px}
:host([rows]:not([rows="auto"])) .meta{font-size:12px;line-height:15px;justify-content:flex-end}
:host([rows]:not([rows="auto"])) .size,:host([rows]:not([rows="auto"])) .error{display:none}
:host([rows]:not([rows="auto"])) .empty{padding:6px 2px;font-size:14px;line-height:20px;white-space:normal}
:host([rows]:not([rows="auto"])) .long-caption{display:none}:host([rows]:not([rows="auto"])) .short-caption{display:inline}
:host([rows="2"]) .list{display:none}
:host([rows]:not([rows="auto"])) .offline .logo{filter:grayscale(1);opacity:.6}

`;

class FastShareStatus extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.shadowRoot.innerHTML=`<style>${widgetCSS}</style><section class="shell"><div class="top"><div class="logo" aria-hidden="true"><svg viewBox="0 0 64 64"><path fill="#c2f86b" d="M23 6h39L54 18H33l-7 11h20l-8 12H19L8 58H0z"/><path fill="#83b7a8" d="M51 32h12L47 58H28z"/></svg></div><div class="heading"><span class="title">FastShare</span><div class="sub">Files on their way home</div></div><span class="email-timer" role="timer" aria-live="off"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="14"/><path d="m3 6 9 7 9-7"/></svg><span class="email-time">—</span></span><a class="open" title="Open FastShare" aria-label="Open FastShare" hidden>↗</a></div><div class="health"></div><dl class="stats"><div class="stat"><dt class="caption" title="Downloading"><span class="long-caption">Downloading</span><span class="short-caption">Active</span></dt><dd class="value active">0</dd></div><div class="stat"><dt class="caption" title="Queued"><span class="long-caption">Queued</span><span class="short-caption">Queued</span></dt><dd class="value queued">0</dd></div><div class="stat"><dt class="caption" title="Completed"><span class="long-caption">Completed</span><span class="short-caption">Done</span></dt><dd class="value completed">0</dd></div></dl><div class="list"></div><div class="footer"><span class="mode"></span><span class="speed"></span></div></section>`;this.nodes=new Map();}
  connectedCallback(){ready.then(()=>this.render());this.timer=setInterval(()=>this.tick(),1000);}
  disconnectedCallback(){clearInterval(this.timer);}
  set state(data){this.data=data;this.render();}
  set config(value){this.options=value;this.render();}
  render(){const d=this.data||{},s=this.shadowRoot,q=x=>s.querySelector(x),cfg=this.options||{},rows=cardRows(cfg);this.setAttribute('rows',String(rows));this.style.setProperty('--rows',rows==='auto'?1:rows);q('.title').textContent=cfg.title||'FastShare';const link=q('.open');link.hidden=!cfg.url;if(cfg.url&&cfg.url.startsWith('/')&&!cfg.url.startsWith('//'))link.href=cfg.url;
    const stale=Date.now()/1000-(d.updated_at||0)>90,online=Boolean(d.online)&&!stale;this.online=online;q('.shell').classList.toggle('offline',!online);q('.logo').title=online?'Add-on online':'The add-on is offline';
    const health=[['Add-on',online],['FastShare',online?d.health?.fastshare:null],['Email',online&&d.email_enabled?d.health?.email:null]];q('.health').innerHTML=health.map(([n,v])=>`<span class="${v===true?'yes':v===false?'no':''}"><i class="dot"></i>${n}</span>`).join('');
    for(const key of ['active','queued','completed'])q('.'+key).textContent=online?String(d[key]??0):'—';q('.sub').textContent=!online?'Waiting for fresh add-on data':d.paused?'The queue is paused':'Files on their way home';
    q('.mode').textContent=!online?'The add-on is offline':d.account?.username?`Account · up to ${d.limit} concurrent files`:'Free mode · one file at a time';q('.speed').textContent=online&&d.speed?bytes(d.speed)+'/s':'';
    const jobs=(d.jobs||[]).filter(j=>!['completed','cancelled'].includes(j.status)).slice(0,rows==='auto'?(cfg.max_items||25):Math.max(0,rows-2)),list=q('.list'),ids=new Set(jobs.map(j=>j.id));
    for(const [id,node] of this.nodes){if(!ids.has(id)){node.remove();this.nodes.delete(id);}}
    list.querySelector('.empty')?.remove();
    if(!jobs.length){const empty=document.createElement('div');empty.className='empty';empty.textContent=!online?'Start the add-on and connect MQTT.':d.failed?'Some jobs need attention.':rows==='auto'?'Everything is downloaded.\nAdd a link or send an email.':'Everything is downloaded.';list.append(empty);}
    for(const job of jobs){let node=this.nodes.get(job.id);if(!node){node=document.createElement('div');node.innerHTML='<div class="row"><span class="name"></span><span class="percent"></span></div><div class="track" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100"><div class="bar"></div></div><div class="row meta"><span class="size"></span><span class="eta"></span></div><div class="error"></div>';this.nodes.set(job.id,node);}list.append(node);node.className='job '+(online?job.status:'');node.querySelector('.name').textContent=job.name;node.querySelector('.name').title=job.name;node.querySelector('.percent').textContent=job.status==='downloading'?`${job.progress||0} %`:labels[job.status]||job.status;node.querySelector('.track').setAttribute('aria-valuenow',Math.max(0,Math.min(100,Number(job.progress)||0)));node.querySelector('.bar').style.width=`${Math.max(0,Math.min(100,Number(job.progress)||0))}%`;node.querySelector('.size').textContent=job.status==='downloading'?`${bytes(job.downloaded)} / ${job.total?bytes(job.total):'…'}`:job.source==='email'?'From email':'Added manually';node.querySelector('.error').textContent=job.error||'';node.querySelector('.error').hidden=!job.error;}
    this.tick();
  }
  tick(){if(!this.data)return;const elapsed=Math.max(0,Date.now()/1000-this.data.updated_at);if(elapsed>90&&this.online){this.render();return;}const countdown=emailCountdown(this.data,this.online),locale=this.options?.language||this.data.language||'en',timer=this.shadowRoot.querySelector('.email-timer'),label=t(countdown.label,{time:countdown.time},locale);timer.querySelector('.email-time').textContent=t(countdown.text,{},locale);timer.title=label;timer.setAttribute('aria-label',label);for(const job of this.data.jobs||[]){const node=this.nodes.get(job.id);if(node)node.querySelector('.eta').textContent=this.online&&job.status==='downloading'?duration(job.eta==null?null:Math.max(1,job.eta-elapsed)):job.status==='queued'&&job.retry_at>Date.now()/1000?'Retry in '+duration(job.retry_at-Date.now()/1000):'';}localize(this.shadowRoot,this.options?.language||this.data.language||'en');}
}
if(!customElements.get('fastshare-status'))customElements.define('fastshare-status',FastShareStatus);

class WorkflowFastShareCard extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});this.shadowRoot.innerHTML='<style>:host{display:block;height:auto}fastshare-status{min-height:0}</style><fastshare-status></fastshare-status>';}
  setConfig(config){this.config=config;this.shadowRoot.querySelector('fastshare-status').config={...config,url:config.addon?'/'+config.addon:undefined};}
  set hass(hass){const entity=this.config?.entity?hass.states[this.config.entity]:Object.values(hass.states).find(s=>s.attributes?.fastshare_widget);const data=entity?.attributes||{};this.shadowRoot.querySelector('fastshare-status').state={...data,online:!['unavailable','unknown'].includes(entity?.state)&&Boolean(data.online)};}
  getCardSize(){return Math.ceil((this.getBoundingClientRect().height||350)/50);}
  getGridOptions(){return {columns:6,rows:cardRows(this.config),min_columns:6,min_rows:2,max_rows:4};}
  static getConfigElement(){return document.createElement('workflow-fastshare-editor');}
  static getStubConfig(){return {title:'FastShare'};}
}
if(!customElements.get('workflow-fastshare-card'))customElements.define('workflow-fastshare-card',WorkflowFastShareCard);

class WorkflowFastShareEditor extends HTMLElement {
  constructor(){super();this.attachShadow({mode:'open'});}
  setConfig(config){this.config={...config};this.render();}
  set hass(hass){const language=hass.language==='cs'?'cs':'en';if(this.language!==language){this.language=language;this.render();}}
  render(){
    if(!this.config)return;
    this.shadowRoot.innerHTML=`<style>:host{display:block;color:var(--primary-text-color);font-family:inherit}label{display:grid;gap:8px;margin:16px 0;font-size:16px}input,select{font:inherit;padding:12px;border:1px solid #617781;border-radius:0;background:#192731;color:#f3f7f6;min-width:0;accent-color:#c2f86b}input:focus-visible,select:focus-visible{outline:2px solid #c2f86b;outline-offset:2px}option:checked{background:#c2f86b;color:#14231b}p{font-size:14px;line-height:1.5}@supports(appearance:base-select){select,select::picker(select){appearance:base-select}select::picker(select){background:#192731;color:#f3f7f6;border:1px solid #617781}option{padding:12px}option:hover,option:checked{background:#c2f86b;color:#14231b}}</style><label>Title<input name="title" value="${esc(this.config.title||'FastShare')}"></label><label>Card height<select name="rows"><option value="auto">Auto · fit content</option><option value="2">2 rows · counts</option><option value="3">3 rows · one transfer</option><option value="4">4 rows · two transfers</option></select></label><p>Compact cards keep counts visible and show fewer transfers. Auto fits all content.</p><label>Entity (optional)<input name="entity" value="${esc(this.config.entity||'')}" placeholder="sensor.fastshare_status"></label>`;
    this.shadowRoot.querySelector('select').value=String(cardRows(this.config));
    for(const field of this.shadowRoot.querySelectorAll('input,select'))field.onchange=()=>{
      const config={...this.config};
      if(field.name==='rows'){config.rows=field.value==='auto'?'auto':Number(field.value);config.grid_options={...config.grid_options,columns:config.grid_options?.columns||6,rows:config.rows};}
      else if(field.value.trim())config[field.name]=field.value.trim();else delete config[field.name];
      this.config=config;this.dispatchEvent(new CustomEvent('config-changed',{detail:{config},bubbles:true,composed:true}));
    };
    ready.then(()=>localize(this.shadowRoot,this.language||'en'));
  }
}
if(!customElements.get('workflow-fastshare-editor'))customElements.define('workflow-fastshare-editor',WorkflowFastShareEditor);

window.customCards=window.customCards||[];
if(!window.customCards.some(c=>c.type==='workflow-fastshare-card'))window.customCards.push({type:'workflow-fastshare-card',name:'WorkFlow FastShare',description:'A live queue, progress and availability. Entities are detected automatically.',preview:true});
export {bytes,duration,esc,labels,emailCountdown};
