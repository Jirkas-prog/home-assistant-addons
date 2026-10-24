import css from './styles.js';
import {TAG,DAYS,DAY_NAMES,DOMAINS,escapeHTML as e,localDate,timeLabel,dayLabel,isManaged,isSkipped,entityIds,editable,toDraft,buildSchedule} from './model.js';

const paths = {
  clock:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6M12 2v3M18 5l2 2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  edit:'<path d="m16 3 5 5-12 12-6 1 1-6ZM13 6l5 5"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  light:'<path d="M8 16c0-3-3-3-3-7a7 7 0 0 1 14 0c0 4-3 4-3 7M8 17h8M9 21h6"/>',
  switch:'<rect x="4" y="6" width="16" height="12" rx="6"/><circle cx="10" cy="12" r="3"/>',
  fan:'<circle cx="12" cy="12" r="2"/><path d="M11 10C4 1 19 0 14 10M14 12c11-2 5 12-1 3M11 14C7 24-2 12 10 12"/>',
  cover:'<path d="M4 3h16v18H4ZM4 7h16M4 11h16M4 15h16M10 19h4"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.clock}</svg>`;
const fingerprint = s => JSON.stringify([s.name,s.weekdays,s.start_date,s.end_date,s.repeat_type,s.timeslots,s.tags]);

class WorkFlowTimers extends HTMLElement {
  constructor() {
    super(); this.attachShadow({mode:'open'}); this.schedules=[]; this.filter='all'; this.search=''; this.editMode=false; this.loaded=false;
    this.shadowRoot.innerHTML=`<style>${css}</style><main class="app">
      <div class="top"><div class="brand"><button class="icon menu quiet" data-action="menu" aria-label="Otevřít postranní lištu">${icon('menu')}</button><span class="brand-mark">${icon('clock')}</span>WORKFLOW <span class="demo" hidden>DEMO</span></div><div class="top-right"><span class="connection"><i class="dot"></i><span id="connection">Připojování</span></span><time id="clock"></time></div></div>
      <header class="hero"><div><div class="eyebrow">RYTMUS VAŠEHO DOMOVA</div><h1 id="title">Časovače</h1><p>Všechno má svůj čas. Nastavte ten správný.</p></div><div class="hero-actions"><button data-action="edit-mode" id="edit-mode">${icon('edit')}Upravit přehled</button><button data-action="new" class="primary" id="new" hidden>${icon('plus')}Nový časovač</button></div></header>
      <div class="edit-note" id="edit-note" hidden>Režim úprav · Přidejte časovač nebo upravte některý ze stávajících.</div>
      <div class="error" id="error" role="alert"></div><section class="stats" aria-label="Souhrn časovačů"></section>
      <div class="toolbar"><nav class="tabs" aria-label="Filtr časovačů"></nav><label class="search">${icon('search')}<input id="search" type="search" aria-label="Hledat časovač nebo zařízení" placeholder="Hledat časovač nebo zařízení"></label></div>
      <div class="columns" aria-hidden="true"><span>Časovač / zařízení</span><span>Zapnout</span><span>Vypnout</span><span>Opakování</span><span>Ovládání plánu</span></div><section id="rows" aria-label="Časovače"></section>
      <footer class="footer"><span id="footer-text">Časy podle nastavení Home Assistantu</span><span>WORKFLOW / 01</span></footer>
    </main><dialog aria-labelledby="dialog-title"></dialog><div class="toast" role="status" aria-live="polite"></div>`;
    this.shadowRoot.addEventListener('click',event=>this.handleClick(event));
    this.$('#search').addEventListener('input',event=>{this.search=event.target.value;this.renderRows();});
    this.$('dialog').addEventListener('close',()=>{this.editing=null;this.opener?.focus();});
    this.$('dialog').addEventListener('cancel',event=>{if(this.busy) event.preventDefault();});
  }
  $(q) {return this.shadowRoot.querySelector(q);}
  setConfig(config) {this.config=config;this.$('#title').textContent=config.title || 'Časovače';}
  static getStubConfig(){return {title:'Časovače'};}
  getCardSize(){return 10;}
  getGridOptions(){return {columns:'full',rows:'auto',min_columns:12};}
  set panel(value){this._panel=value;this.setAttribute('panel','');}
  set narrow(value){this._narrow=value;}
  set hass(value) {
    this._hass=value;
    if (this.isConnected && this._connection!==value.connection) this.start();
    if(this.loaded) this.render();
  }
  get today(){return localDate(this.info?.time_zone || this._hass?.config?.time_zone || 'Europe/Prague');}
  get canWrite(){return !!this._hass?.user?.is_admin && this.loaded && !this.error && !this.busy;}
  connectedCallback(){if(this._hass) this.start();}
  disconnectedCallback(){this._generation=(this._generation||0)+1;this.unsubscribe?.();this.unsubscribe=null;this._connection=null;clearInterval(this.ticker);clearTimeout(this.refreshTimer);clearTimeout(this.toastTimer);}
  async start() {
    this.unsubscribe?.();clearInterval(this.ticker);
    const generation=this._generation=(this._generation||0)+1;
    this._connection=this._hass.connection;
    await this.refresh();
    if(!this.isConnected || generation!==this._generation)return;
    try {
      const unsubscribe=await this._connection.subscribeEvents(()=>{
        clearTimeout(this.refreshTimer);this.refreshTimer=setTimeout(()=>this.refresh(),150);
      },'scheduler_updated');
      if(!this.isConnected || generation!==this._generation)unsubscribe();else this.unsubscribe=unsubscribe;
    } catch(error){this.error='Spojení se přerušilo. Obnovte stránku. '+(error.message||error.code||'');this.render();}
    this.ticker=setInterval(()=>this.refresh(),30000);
  }
  async refresh() {
    if(!this._hass || this.refreshing)return;
    this.refreshing=true;
    try {
      const [info,schedules]=await Promise.all([this._hass.callWS({type:'scheduler/workflow_info'}),this._hass.callWS({type:'scheduler'})]);
      this.info=info;this.allSchedules=schedules;this.schedules=schedules.filter(s=>s.schedule_id && isManaged(s));this.loaded=true;this.error='';
    } catch(error){this.error='Časovače nelze načíst. Ověřte instalaci integrace Scheduler · WorkFlow a připojení k Home Assistantu. '+(error.message||error.code||'');}
    finally{this.refreshing=false;this.render();}
  }
  name(id){return this._hass?.states[id]?.attributes?.friendly_name || id;}
  state(id){return this._hass?.states[id]?.state || 'unavailable';}
  status(s){return s.enabled===false?'off':isSkipped(s,this.today)?'skip':'active';}
  render() {
    this.$('#error').textContent=this.error||'';
    this.$('#connection').textContent=this.error?'Nepřipojeno':this.loaded?'Home Assistant':'Připojování';
    this.$('.dot').style.background=this.error?'#f5c57a':'';
    this.$('#clock').textContent=new Intl.DateTimeFormat('cs-CZ',{timeZone:this.info?.time_zone || 'Europe/Prague',weekday:'short',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date());
    this.$('#edit-mode').hidden=!this._hass?.user?.is_admin;
    this.$('#edit-mode').disabled=!this.canWrite;
    this.$('#edit-mode').innerHTML=icon('edit')+(this.editMode?'Dokončit úpravy':'Upravit přehled');
    this.$('#new').hidden=!this.editMode;this.$('#new').disabled=!this.canWrite;this.$('#edit-note').hidden=!this.editMode;
    const counts={all:this.schedules.length,active:0,skip:0,off:0};this.schedules.forEach(s=>counts[this.status(s)]++);
    const candidates=this.schedules.filter(s=>s.enabled).flatMap(s=>(s.timestamps||[]).map((t,i)=>({s,t,i}))).filter(({s,t,i})=>t && new Date(t)>new Date() && !(isSkipped(s,this.today) && i===0 && localDate(this.info?.time_zone || 'Europe/Prague',new Date(t))===this.today)).sort((a,b)=>new Date(a.t)-new Date(b.t));
    const next=candidates[0];
    const nextTime=next?new Intl.DateTimeFormat('cs-CZ',{timeZone:this.info?.time_zone || 'Europe/Prague',hour:'2-digit',minute:'2-digit'}).format(new Date(next.t)):'—';
    this.$('.stats').innerHTML=`<div class="stat"><span class="stat-label">Připravené plány</span><span class="stat-value">${counts.active}<em>z ${counts.all} časovačů</em></span></div><div class="stat"><span class="stat-label">Dnes vynecháno</span><span class="stat-value">${counts.skip}<em>zítra automaticky zpět</em></span></div><div class="stat"><span class="stat-label">Nejbližší událost${next?' · '+e(new Intl.DateTimeFormat('cs-CZ',{timeZone:this.info?.time_zone || 'Europe/Prague',day:'numeric',month:'numeric'}).format(new Date(next.t))):''}</span><span class="stat-value">${e(nextTime)}</span><span class="next-name">${next?e(next.s.name)+' · '+(next.i===0?'zapnutí':'vypnutí'):'Žádná naplánovaná akce'}</span></div>`;
    this.$('.tabs').innerHTML=[['all','Všechny'],['active','Aktivní'],['skip','Vynechané'],['off','Vypnuté']].map(([id,label])=>`<button data-filter="${id}" class="${this.filter===id?'active':''}" aria-pressed="${this.filter===id}">${label}<span>${counts[id]}</span></button>`).join('');
    this.$('#footer-text').textContent=`${this.info?.time_zone || 'Časové pásmo Home Assistantu'} · Vynechání platí do půlnoci. Naplánované vypnutí zůstává aktivní.`;
    this.renderRows();
  }
  renderRows() {
    const query=this.search.toLocaleLowerCase('cs');
    const rows=this.schedules.filter(s=>(this.filter==='all'||this.status(s)===this.filter) && [s.name,...entityIds(s).map(id=>this.name(id)+' '+id)].join(' ').toLocaleLowerCase('cs').includes(query));
    const active=this.shadowRoot.activeElement, focusedId=active?.closest('[data-id]')?.dataset.id, focusedAction=active?.dataset.action;
    this.$('#rows').innerHTML=rows.length?rows.map(s=>this.row(s)).join(''):`<div class="empty">${icon('clock')}<h2>${!this.loaded?'Čekám na Home Assistant':this.schedules.length?'Žádný odpovídající časovač':'Dejte svému domovu rytmus.'}</h2><p>${!this.loaded?'Po připojení se zde zobrazí vaše plány.':this.schedules.length?'Změňte hledání nebo vybraný filtr.':'Zapněte režim úprav a vytvořte první časovač.'}</p></div>`;
    if(focusedId && focusedAction && !this.$('dialog').open)this.$(`[data-id="${CSS.escape(focusedId)}"] [data-action="${CSS.escape(focusedAction)}"]`)?.focus({preventScroll:true});
  }
  row(s) {
    const status=this.status(s), ids=entityIds(s), managed=editable(s), off=s.enabled===false, skipped=isSkipped(s,this.today);
    const devices=ids.map(id=>{const state=this.state(id),on=['on','open','opening'].includes(state),missing=['unavailable','unknown'].includes(state);const label=on?'zapnuto':state==='off'?'vypnuto':state==='closed'?'zavřeno':missing?'nedostupné':state;return `<span class="entity-state ${on?'on':missing?'missing':''}" title="${e(id)}"><i class="dot"></i>${e(this.name(id))} · ${e(label)}</span>`;}).join('');
    const time=(slot,caption)=>`<div><div class="time ${slot?.start?.startsWith('sun')?'solar':''}">${slot?.start?.startsWith('sun')?icon('sun'):''}${e(slot?timeLabel(slot.start):'—')}</div><span class="time-note" data-caption="${caption}">${slot?.start?.startsWith('sun')?'podle slunce':'pevný čas'}</span></div>`;
    return `<article class="row ${status==='skip'?'paused':off?'disabled':''}" data-id="${e(s.schedule_id)}"><div class="device"><div class="device-symbol">${icon(ids[0]?.split('.')[0])}</div><div><h2 class="device-title">${e(s.name || 'Bez názvu')}</h2><div class="device-details">${devices}</div></div></div>${time(s.timeslots?.[0],'Zapnout')}${time(s.timeslots?.[1],'Vypnout')}<div class="day">${e(dayLabel(s))}${skipped?'<br><span style="color:var(--amber)">Dnes bez zapnutí</span>':off?'<br>Pozastaveno':''}</div><div class="row-controls"><button class="skip" data-action="skip" ${!this.canWrite||!managed||off?'disabled':''} title="Vynechá dnešní zapnutí. Naplánované vypnutí zůstane aktivní." aria-label="${skipped?'Obnovit dnešek':'Dnes vynechat'}: ${e(s.name)}">${skipped?'Obnovit dnes':'Dnes vynechat'}</button><button class="toggle" role="switch" aria-checked="${!off}" aria-label="Povolit časovač ${e(s.name)}" data-action="toggle" ${!this.canWrite?'disabled':''}></button></div>${this.editMode?`<div class="row-footer"><small>${managed?'Plán ovládá '+ids.length+' zařízení':isManaged(s)?'Rozšířený formát · upravte v původní kartě Scheduler':'Původní plán Scheduler · zde pouze přehled'}</small><button class="small" data-action="edit" ${!this.canWrite||!managed?'disabled':''}>${icon('edit')}Upravit</button><button class="small danger" data-action="delete" ${!this.canWrite||!managed?'disabled':''}>Odstranit</button></div>`:''}</article>`;
  }
  async handleClick(event) {
    const button=event.target.closest('button');if(!button || button.disabled)return;
    if(button.dataset.filter){this.filter=button.dataset.filter;this.render();return;}
    const action=button.dataset.action, s=this.schedules.find(s=>s.schedule_id===button.closest('[data-id]')?.dataset.id);
    if(action==='menu'){this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));return;}
    if(action==='close'){if(!this.busy)this.$('dialog').close();return;}
    if(!this.canWrite)return;
    if(action==='edit-mode'){this.editMode=!this.editMode;this.render();}
    if(action==='new'||action==='edit'){this.opener=button;this.openEditor(s);}
    if(action==='toggle')await this.mutate(()=>this._hass.callService('switch',s.enabled?'turn_off':'turn_on',{entity_id:s.entity_id}),s.enabled?'Časovač pozastaven. Stav zařízení se nemění.':'Časovač je povolen.');
    if(action==='skip')await this.mutate(()=>this._hass.callWS({type:'scheduler/workflow_skip',schedule_id:s.schedule_id,skip:!isSkipped(s,this.today)}),'Dnešní plán byl upraven.');
    if(action==='delete')this.openDelete(s,button);
  }
  async mutate(call,message) {
    this.busy=true;this.render();
    try{await call();await this.refresh();this.toast(message);return true;}
    catch(error){this.error='Změnu se nepodařilo uložit. '+(error.message||error.code||String(error));return false;}
    finally{this.busy=false;this.render();}
  }
  toast(message){this.$('.toast').textContent=message;clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>this.$('.toast').textContent='',5000);}
  openDelete(s,button) {
    this.opener=button;
    this.$('dialog').innerHTML=`<div class="dialog-head"><h2 id="dialog-title">Odstranit časovač?</h2><button class="icon" data-action="close" aria-label="Zavřít">${icon('close')}</button></div><div class="form-body"><p>Plán <strong>${e(s.name)}</strong> se odstraní. Aktuální stav zařízení se nezmění.</p><p class="form-error" role="alert"></p></div><div class="form-actions"><button data-action="close">Zrušit</button><button class="danger" id="confirm-delete">Odstranit časovač</button></div>`;
    this.$('#confirm-delete').onclick=async()=>{this.$('#confirm-delete').disabled=true;const ok=await this.mutate(()=>this._hass.callApi('POST','scheduler/remove',{schedule_id:s.schedule_id}),'Časovač odstraněn.');if(ok)this.$('dialog').close();else{this.$('.form-error').textContent=this.error;this.$('#confirm-delete').disabled=false;}};
    this.$('dialog').showModal();
  }
  openEditor(s) {
    this.editing=s?structuredClone(s):null;this.editFingerprint=s?fingerprint(s):null;this.draft=toDraft(s);
    const d=this.draft;
    const timebox=(phase,title)=>`<div class="timebox ${phase}"><strong>${title}</strong><label>Způsob určení času<select data-phase="${phase}" data-field="mode"><option value="time">Konkrétní čas</option><option value="sunrise" ${!this._hass.states['sun.sun']?'disabled':''}>Východ slunce</option><option value="sunset" ${!this._hass.states['sun.sun']?'disabled':''}>Západ slunce</option></select></label><div class="inputs"><label data-time-label="${phase}">Čas<input type="time" required data-phase="${phase}" data-field="time" value="${e(d[phase].time)}"></label><label data-offset-label="${phase}">Posun v minutách<input type="number" min="-120" max="120" step="1" data-phase="${phase}" data-field="offset" value="${d[phase].offset}"></label></div></div>`;
    this.$('dialog').innerHTML=`<form><div class="dialog-head"><div><div class="eyebrow">JEDEN PLÁN. VŠECHNO POHROMADĚ.</div><h2 id="dialog-title">${s?'Upravit časovač':'Nový časovač'}</h2></div><button type="button" class="icon" data-action="close" aria-label="Zavřít">${icon('close')}</button></div><div class="form-body"><label>Název časovače<input name="name" required maxlength="100" placeholder="Například: Ranní osvětlení" value="${e(d.name)}" autofocus></label><div class="section-label">01 / Kdy se má spustit</div><div class="form-grid"><label>Opakování<select name="repeat"><option value="weekly">Vybrané dny v týdnu</option><option value="date">Jednou v konkrétní den</option></select></label><label id="date-label" hidden>Datum<input name="date" type="date" min="${this.today}" value="${e(d.date)}"></label></div><div id="weekdays"><div class="presets" style="margin-top:14px"><button type="button" data-days="all">Každý den</button><button type="button" data-days="work">Po–Pá</button><button type="button" data-days="weekend">Víkend</button></div><div class="day-picker">${DAYS.map((day,i)=>`<button type="button" data-day="${day}" aria-pressed="${d.days.includes(day)}">${DAY_NAMES[i]}</button>`).join('')}</div></div><div class="section-label">02 / Zapnutí a vypnutí</div><div class="form-grid">${timebox('on','ZAPNOUT / OTEVŘÍT')}${timebox('off','VYPNOUT / ZAVŘÍT')}</div><p class="hint">Časové pásmo: ${e(this.info?.time_zone)}. Obě akce platí pro vybrané kalendářní dny. Posun − znamená před sluneční událostí, + po ní.</p><div class="section-label">03 / Co má časovač ovládat</div><label>Vyhledat zařízení<input id="target-search" type="search" placeholder="Název nebo ID zařízení"></label><div class="target-list"></div><div id="parameters"></div><p class="form-error" role="alert"></p></div><div class="form-actions"><small>Ukládá se přímo do Home Assistantu</small><button type="button" data-action="close">Zrušit</button><button type="submit" class="primary">${s?'Uložit změny':'Vytvořit časovač'}</button></div></form>`;
    for(const phase of ['on','off']){this.$(`[data-phase="${phase}"][data-field="mode"]`).value=d[phase].mode;this.showTimeInputs(phase);}
    this.$('[name=repeat]').value=d.date?'date':'weekly';this.showRepeat();
    this.$('[name=repeat]').onchange=()=>this.showRepeat();
    this.shadowRoot.querySelectorAll('[data-phase]').forEach(input=>input.onchange=()=>{d[input.dataset.phase][input.dataset.field]=input.value;this.showTimeInputs(input.dataset.phase);});
    this.shadowRoot.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{d.days=d.days.includes(button.dataset.day)?d.days.filter(x=>x!==button.dataset.day):[...d.days,button.dataset.day];this.showDays();});
    this.shadowRoot.querySelectorAll('[data-days]').forEach(button=>button.onclick=()=>{d.days=button.dataset.days==='all'?[...DAYS]:button.dataset.days==='work'?DAYS.slice(0,5):DAYS.slice(5);this.showDays();});
    this.$('#target-search').oninput=()=>this.renderTargets();
    this.renderTargets();this.renderParameters();
    this.$('form').onsubmit=event=>{event.preventDefault();this.saveEditor();};
    this.$('dialog').showModal();
  }
  showDays(){this.shadowRoot.querySelectorAll('[data-day]').forEach(b=>b.setAttribute('aria-pressed',this.draft.days.includes(b.dataset.day)));}
  showTimeInputs(phase){const fixed=this.draft[phase].mode==='time';this.$(`[data-time-label="${phase}"]`).hidden=!fixed;this.$(`[data-offset-label="${phase}"]`).hidden=fixed;}
  showRepeat(){const date=this.$('[name=repeat]').value==='date';this.$('#date-label').hidden=!date;this.$('[name=date]').required=date;this.$('#weekdays').hidden=date;}
  renderTargets(){
    const query=this.$('#target-search').value.toLocaleLowerCase('cs');
    const items=Object.keys(this._hass.states).filter(id=>DOMAINS.includes(id.split('.')[0]) && !(this.allSchedules||this.schedules).some(s=>s.entity_id===id) && !id.startsWith('switch.schedule_')).sort((a,b)=>this.name(a).localeCompare(this.name(b),'cs')).filter(id=>(this.name(id)+' '+id).toLocaleLowerCase('cs').includes(query));
    this.$('.target-list').innerHTML=items.map(id=>`<label class="target-option"><input type="checkbox" data-target="${e(id)}" ${this.draft.targets.some(t=>t.id===id)?'checked':''}><span>${e(this.name(id))}</span><small>${e(id)}</small></label>`).join('') || '<p class="hint" style="padding:12px">Žádné odpovídající zařízení.</p>';
    this.shadowRoot.querySelectorAll('[data-target]').forEach(input=>input.onchange=()=>{if(input.checked)this.draft.targets.push({id:input.dataset.target,on:{},off:{}});else this.draft.targets=this.draft.targets.filter(t=>t.id!==input.dataset.target);this.renderParameters();});
  }
  renderParameters(){
    this.$('#parameters').innerHTML=this.draft.targets.map((t,i)=>{const light=t.id.startsWith('light.'),fan=t.id.startsWith('fan.');return `<div class="params"><div class="params-title">${e(this.name(t.id))}</div>${light||fan?`<label>${light?'Jas při zapnutí':'Otáčky při zapnutí'} (%) · prázdné = beze změny<input type="number" min="1" max="100" data-level="${i}" value="${e((light?t.on.brightness_pct:t.on.percentage)??'')}" placeholder="Beze změny"></label>`:''}<details><summary>Další parametry pro toto zařízení</summary><div class="form-grid"><label>Parametry zapnutí · JSON<textarea rows="3" data-param="on" data-index="${i}">${e(typeof t.on==='string'?t.on:JSON.stringify(t.on,null,2))}</textarea></label><label>Parametry vypnutí · JSON<textarea rows="3" data-param="off" data-index="${i}">${e(typeof t.off==='string'?t.off:JSON.stringify(t.off,null,2))}</textarea></label></div></details></div>`;}).join('');
    this.shadowRoot.querySelectorAll('[data-level]').forEach(input=>input.oninput=()=>{const t=this.draft.targets[Number(input.dataset.level)],key=t.id.startsWith('light.')?'brightness_pct':'percentage';if(typeof t.on==='string'){try{t.on=JSON.parse(t.on);}catch{return;}}if(input.value==='')delete t.on[key];else t.on[key]=Number(input.value);this.$(`[data-param="on"][data-index="${input.dataset.level}"]`).value=JSON.stringify(t.on,null,2);});
    this.shadowRoot.querySelectorAll('[data-param]').forEach(input=>input.oninput=()=>{this.draft.targets[Number(input.dataset.index)][input.dataset.param]=input.value;});
  }
  async saveEditor(){
    if(this.busy)return;
    const error=this.$('.form-error'),submit=this.$('[type=submit]');error.textContent='';
    try{
      this.draft.name=this.$('[name=name]').value;this.draft.date=this.$('[name=repeat]').value==='date'?this.$('[name=date]').value:'';
      const payload=buildSchedule(this.draft,this.editing);
      if(this.draft.date && this.draft.date<this.today)throw Error('Vyberte dnešní nebo budoucí datum.');
      this.busy=true;submit.disabled=true;
      if(this.editing){const current=await this._hass.callWS({type:'scheduler/item',schedule_id:this.editing.schedule_id});if(!current||fingerprint(current)!==this.editFingerprint)throw Error('Plán mezitím někdo změnil. Zavřete editor a otevřete ho znovu.');}
      await this._hass.callApi('POST',this.editing?'scheduler/edit':'scheduler/add',{...payload,...(this.editing?{schedule_id:this.editing.schedule_id}:{})});
      this.$('dialog').close();await this.refresh();this.toast('Časovač uložen.');
    }catch(err){error.textContent=err.message||err.code||String(err);}
    finally{this.busy=false;submit.disabled=false;this.render();}
  }
}
if(!customElements.get('workflow-timers-card'))customElements.define('workflow-timers-card',WorkFlowTimers);
if(!customElements.get('workflow-timers-panel'))customElements.define('workflow-timers-panel',class extends WorkFlowTimers{constructor(){super();this.setAttribute('panel','');}});
window.customCards=window.customCards || [];
if(!window.customCards.some(c=>c.type==='workflow-timers-card'))window.customCards.push({type:'workflow-timers-card',name:'WorkFlow Časovače',description:'Řádkový plánovač s časy, sluncem a ovládáním více zařízení.',preview:false});
