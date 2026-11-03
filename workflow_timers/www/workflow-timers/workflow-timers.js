import {t,normalizeLanguage,readPreference,savePreference,errorText} from './i18n.js?v=1.0.5';
import css from './styles.js?v=1.0.5';
import {TAG,DAYS,DAY_NAMES,escapeHTML as e,localDate,timeLabel,dayLabel,isManaged,isSkipped,entityIds,editable,toDraft,buildSchedule,targetChoices,groupName,groupedSchedules,createVirtualSwitch} from './model.js?v=1.0.5';

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
    this.languageOverride=readPreference();this.language=this.languageOverride||normalizeLanguage(navigator.language);
    this.renderShell();
    this.shadowRoot.addEventListener('click',event=>this.handleClick(event));
  }
  renderShell(){
    this.shadowRoot.innerHTML=`<style>${css}</style><main class="app">
      <div class="top"><div class="brand"><button class="icon menu quiet" data-action="menu" aria-label="${this.t("Otevřít postranní lištu")}">${icon('menu')}</button><span class="brand-mark">${icon('clock')}</span>WORKFLOW <span class="demo" hidden>DEMO</span></div><div class="top-right"><select id="language" aria-label="${this.t('Jazyk')}"><option value="en">EN</option><option value="cs">CZ</option></select><span class="connection"><i class="dot"></i><span id="connection">${this.t("Připojování")}</span></span><time id="clock"></time></div></div>
      <header class="hero"><div><div class="eyebrow">${this.t("RYTMUS VAŠEHO DOMOVA")}</div><h1 id="title">${this.t("Časovače")}</h1><p>${this.t("Všechno má svůj čas. Nastavte ten správný.")}</p></div><div class="hero-actions"><button data-action="edit-mode" id="edit-mode">${icon('edit')}${this.t("Upravit přehled")}</button><button data-action="new" class="primary" id="new" hidden>${icon('plus')}${this.t("Nový časovač")}</button></div></header>
      <div class="edit-note" id="edit-note" hidden>${this.t("Režim úprav")} · ${this.t("Přidejte časovač nebo upravte některý ze stávajících.")}</div>
      <div class="error" id="error" role="alert"></div><section class="stats" aria-label="${this.t("Souhrn časovačů")}"></section>
      <div class="toolbar"><nav class="tabs" aria-label="${this.t("Filtr časovačů")}"></nav><label class="search">${icon('search')}<input id="search" type="search" aria-label="${this.t("Hledat časovač nebo zařízení")}" placeholder="${this.t("Hledat časovač nebo zařízení")}"></label></div>
      <div class="columns" aria-hidden="true"><span>${this.t("Časovač / zařízení")}</span><span>${this.t("Zapnout")}</span><span>${this.t("Vypnout")}</span><span>${this.t("Opakování")}</span><span>${this.t("Ovládání plánu")}</span></div><section id="rows" aria-label="${this.t("Časovače")}"></section>
      <footer class="footer"><span id="footer-text">${this.t("Časy podle nastavení Home Assistantu")}</span><span>WORKFLOW / 01</span></footer>
    </main><dialog aria-labelledby="dialog-title"></dialog><div class="toast" role="status" aria-live="polite"></div>`;
    this.$('.app').lang=this.language;this.$('dialog').lang=this.language;
    this.$('#title').textContent=this.config?.title||this.t('Časovače');
    this.$('#search').value=this.search;this.$('#language').value=this.language;
    this.$('#language').onchange=event=>this.setLanguage(event.target.value,true);
    this.$('#search').addEventListener('input',event=>{this.search=event.target.value;this.renderRows();});
    this.$('dialog').addEventListener('close',()=>{this.editing=null;this.opener?.focus();this.applyPendingLanguage();});
    this.$('dialog').addEventListener('cancel',event=>{if(this.busy) event.preventDefault();});
  }
  t(key,values){return t(this.language,key,values);}
  get locale(){return this.language==='cs'?'cs-CZ':'en-GB';}
  setLanguage(value,persist=false){
    const language=normalizeLanguage(value);
    if(persist){this.languageOverride=language;savePreference(language);}
    this.pendingLanguage=language;
    // A profile change must not replace an open form or an in-flight action.
    if(this.$('dialog').open||this.busy)return;
    this.pendingLanguage=null;
    if(language===this.language)return;
    this.language=language;this.renderShell();this.render();
    this.dispatchEvent(new CustomEvent('workflow-language-changed',{detail:language,bubbles:true,composed:true}));
  }
  applyPendingLanguage(){if(this.pendingLanguage)this.setLanguage(this.pendingLanguage);}
  $(q) {return this.shadowRoot.querySelector(q);}
  setConfig(config) {this.config=config;this.$('#title').textContent=config.title || this.t("Časovače");}
  static getStubConfig(){return {};}
  getCardSize(){return 10;}
  getGridOptions(){return {columns:'full',rows:'auto',min_columns:12};}
  set panel(value){this._panel=value;this.setAttribute('panel','');}
  set narrow(value){this._narrow=value;}
  set hass(value) {
    this._hass=value;
    if(!this.languageOverride)this.setLanguage(value.language||value.locale?.language||navigator.language);
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
    } catch(error){this.error=()=>this.t("Spojení se přerušilo. Obnovte stránku. ")+errorText(this.language,error);this.render();}
    this.ticker=setInterval(()=>this.refresh(),30000);
  }
  async refresh() {
    if(!this._hass || this.refreshing)return;
    this.refreshing=true;
    try {
      const [info,schedules]=await Promise.all([this._hass.callWS({type:'scheduler/workflow_info'}),this._hass.callWS({type:'scheduler'})]);
      this.info=info;this.allSchedules=schedules;this.schedules=schedules.filter(s=>s.schedule_id && isManaged(s));this.loaded=true;this.error='';
    } catch(error){this.error=()=>this.t("Časovače nelze načíst. Ověřte instalaci integrace Scheduler · WorkFlow a připojení k Home Assistantu. ")+errorText(this.language,error);}
    finally{this.refreshing=false;this.render();}
  }
  name(id){return this._hass?.states[id]?.attributes?.friendly_name || this.createdHelperNames?.[id] || id;}
  state(id){return this._hass?.states[id]?.state || 'unavailable';}
  status(s){return s.enabled===false?'off':isSkipped(s,this.today)?'skip':'active';}
  render() {
    this.$('#error').textContent=typeof this.error==='function'?this.error():this.error||'';
    this.$('.demo').hidden=!this.demoMode;this.$('.toast').textContent=typeof this.toastMessage==='function'?this.toastMessage():this.toastMessage||'';this.$('#language').disabled=!!this.busy;
    this.$('#connection').textContent=this.error?this.t("Nepřipojeno"):this.loaded?'Home Assistant':this.t("Připojování");
    this.$('.dot').style.background=this.error?'#f5c57a':'';
    this.$('#clock').textContent=new Intl.DateTimeFormat(this.locale,{timeZone:this.info?.time_zone || 'Europe/Prague',weekday:'short',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}).format(new Date());
    this.$('#edit-mode').hidden=!this._hass?.user?.is_admin;
    this.$('#edit-mode').disabled=!this.canWrite;
    this.$('#edit-mode').innerHTML=icon('edit')+(this.editMode?this.t("Dokončit úpravy"):this.t("Upravit přehled"));
    this.$('#new').hidden=!this.editMode;this.$('#new').disabled=!this.canWrite;this.$('#edit-note').hidden=!this.editMode;
    const counts={all:this.schedules.length,active:0,skip:0,off:0};this.schedules.forEach(s=>counts[this.status(s)]++);
    const candidates=this.schedules.filter(s=>s.enabled).flatMap(s=>(s.timestamps||[]).map((t,i)=>({s,t,i}))).filter(({s,t,i})=>t && new Date(t)>new Date() && !(isSkipped(s,this.today) && i===0 && localDate(this.info?.time_zone || 'Europe/Prague',new Date(t))===this.today)).sort((a,b)=>new Date(a.t)-new Date(b.t));
    const next=candidates[0];
    const nextTime=next?new Intl.DateTimeFormat(this.locale,{timeZone:this.info?.time_zone || 'Europe/Prague',hour:'2-digit',minute:'2-digit'}).format(new Date(next.t)):'—';
    this.$('.stats').innerHTML=`<div class="stat"><span class="stat-label">${this.t("Připravené plány")}</span><span class="stat-value">${counts.active}<em>${this.t("z")} ${counts.all} ${this.t("časovačů")}</em></span></div><div class="stat"><span class="stat-label">${this.t("Dnes vynecháno")}</span><span class="stat-value">${counts.skip}<em>${this.t("zítra automaticky zpět")}</em></span></div><div class="stat"><span class="stat-label">${this.t("Nejbližší událost")}${next?' · '+e(new Intl.DateTimeFormat(this.locale,{timeZone:this.info?.time_zone || 'Europe/Prague',day:'numeric',month:'numeric'}).format(new Date(next.t))):''}</span><span class="stat-value">${e(nextTime)}</span><span class="next-name">${next?e(next.s.name)+' · '+(next.i===0?this.t("zapnutí"):this.t("vypnutí")):this.t("Žádná naplánovaná akce")}</span></div>`;
    this.$('.tabs').innerHTML=[['all',this.t("Všechny")],['active',this.t("Aktivní")],['skip',this.t("Vynechané")],['off',this.t("Vypnuté")]].map(([id,label])=>`<button data-filter="${id}" class="${this.filter===id?'active':''}" aria-pressed="${this.filter===id}">${label}<span>${counts[id]}</span></button>`).join('');
    this.$('#footer-text').textContent=`${this.info?.time_zone || this.t("Časové pásmo Home Assistantu")} · ${this.t("Vynechání platí do půlnoci. Naplánované vypnutí zůstává aktivní.")}`;
    this.renderRows();this.applyPendingLanguage();
  }
  renderRows() {
    const query=this.search.toLocaleLowerCase('cs');
    const rows=this.schedules.filter(s=>(this.filter==='all'||this.status(s)===this.filter) && [s.name,groupName(s),...entityIds(s).map(id=>this.name(id)+' '+id)].join(' ').toLocaleLowerCase('cs').includes(query));
    const active=this.shadowRoot.activeElement, focusedId=active?.closest('[data-id]')?.dataset.id, focusedAction=active?.dataset.action;
    this.$('#rows').innerHTML=rows.length?groupedSchedules(rows).map(([name,items])=>`<section class="timer-group" aria-label="${e(name || this.t("Bez skupiny"))}">${name || this.schedules.some(groupName)?`<div class="group-head"><h2>${e(name || this.t("Bez skupiny"))}</h2><span>${this.t("Plány")} · ${items.length}</span></div>`:''}${items.map(s=>this.row(s)).join('')}</section>`).join(''):`<div class="empty">${icon('clock')}<h2>${!this.loaded?this.t("Čekám na Home Assistant"):this.schedules.length?this.t("Žádný odpovídající časovač"):this.t("Dejte svému domovu rytmus.")}</h2><p>${!this.loaded?this.t("Po připojení se zde zobrazí vaše plány."):this.schedules.length?this.t("Změňte hledání nebo vybraný filtr."):this.t("Zapněte režim úprav a vytvořte první časovač.")}</p></div>`;
    if(focusedId && focusedAction && !this.$('dialog').open)this.$(`[data-id="${CSS.escape(focusedId)}"] [data-action="${CSS.escape(focusedAction)}"]`)?.focus({preventScroll:true});
  }
  row(s) {
    const status=this.status(s), ids=entityIds(s), managed=editable(s), off=s.enabled===false, skipped=isSkipped(s,this.today);
    const devices=ids.map(id=>{const state=this.state(id),on=['on','open','opening'].includes(state),missing=['unavailable','unknown'].includes(state);const label=on?this.t("zapnuto"):state==='off'?this.t("vypnuto"):state==='closed'?this.t("zavřeno"):missing?this.t("nedostupné"):state;return `<span class="entity-state ${on?'on':missing?'missing':''}" title="${e(id)}"><i class="dot"></i>${e(this.name(id))} · ${e(label)}</span>`;}).join('');
    const time=(slot,caption)=>`<div><div class="time ${slot?.start?.startsWith('sun')?'solar':''}">${slot?.start?.startsWith('sun')?icon('sun'):''}${e(slot?timeLabel(slot.start,this.language):'—')}</div><span class="time-note" data-caption="${caption}">${slot?.start?.startsWith('sun')?this.t("podle slunce"):this.t("pevný čas")}</span></div>`;
    return `<article class="row ${status==='skip'?'paused':off?'disabled':''}" data-id="${e(s.schedule_id)}"><div class="device"><div class="device-symbol">${icon(ids[0]?.split('.')[0])}</div><div><h2 class="device-title">${e(s.name || this.t("Bez názvu"))}</h2><div class="device-details">${devices}</div></div></div>${time(s.timeslots?.[0],this.t("Zapnout"))}${time(s.timeslots?.[1],this.t("Vypnout"))}<div class="day">${e(dayLabel(s,this.language))}${skipped?`<br><span style="color:var(--amber)">${this.t("Dnes bez zapnutí")}</span>`:off?`<br>${this.t("Pozastaveno")}`:''}</div><div class="row-controls"><button class="skip" data-action="skip" ${!this.canWrite||!managed||off?'disabled':''} title="${this.t("Vynechá dnešní zapnutí. Naplánované vypnutí zůstane aktivní.")}" aria-label="${skipped?this.t("Obnovit dnešek"):this.t("Dnes vynechat")}: ${e(s.name)}">${skipped?this.t("Obnovit dnes"):this.t("Dnes vynechat")}</button><button class="toggle" role="switch" aria-checked="${!off}" aria-label="${this.t("Povolit časovač")} ${e(s.name)}" data-action="toggle" ${!this.canWrite?'disabled':''}></button></div>${this.editMode?`<div class="row-footer"><small>${managed?this.t("Plán ovládá ")+ids.length+this.t(" zařízení"):isManaged(s)?this.t("Rozšířený formát · upravte v původní kartě Scheduler"):this.t("Původní plán Scheduler · zde pouze přehled")}</small><button class="small" data-action="edit" ${!this.canWrite||!managed?'disabled':''}>${icon('edit')}${this.t("Upravit")}</button><button class="small danger" data-action="delete" ${!this.canWrite||!managed?'disabled':''}>${this.t("Odstranit")}</button></div>`:''}</article>`;
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
    if(action==='toggle')await this.mutate(()=>this._hass.callService('switch',s.enabled?'turn_off':'turn_on',{entity_id:s.entity_id}),()=>s.enabled?this.t("Časovač pozastaven. Stav zařízení se nemění."):this.t("Časovač je povolen."));
    if(action==='skip')await this.mutate(()=>this._hass.callWS({type:'scheduler/workflow_skip',schedule_id:s.schedule_id,skip:!isSkipped(s,this.today)}),()=>this.t("Dnešní plán byl upraven."));
    if(action==='delete')this.openDelete(s,button);
  }
  async mutate(call,message) {
    this.busy=true;this.render();
    try{await call();await this.refresh();this.toast(message);return true;}
    catch(error){this.error=()=>this.t("Změnu se nepodařilo uložit. ")+errorText(this.language,error);return false;}
    finally{this.busy=false;this.render();}
  }
  toast(message){this.toastMessage=message;this.$('.toast').textContent=typeof message==='function'?message():message;clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>{this.toastMessage='';this.$('.toast').textContent='';},5000);}
  openDelete(s,button) {
    this.opener=button;
    this.$('dialog').innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${this.t("Odstranit časovač?")}</h2><button class="icon" data-action="close" aria-label="${this.t("Zavřít")}">${icon('close')}</button></div><div class="form-body"><p>${this.t("Plán")} <strong>${e(s.name)}</strong> ${this.t("se odstraní. Aktuální stav zařízení se nezmění.")}</p><p class="form-error" role="alert"></p></div><div class="form-actions"><button data-action="close">${this.t("Zrušit")}</button><button class="danger" id="confirm-delete">${this.t("Odstranit časovač")}</button></div>`;
    this.$('#confirm-delete').onclick=async()=>{this.$('#confirm-delete').disabled=true;const ok=await this.mutate(()=>this._hass.callApi('POST','scheduler/remove',{schedule_id:s.schedule_id}),()=>this.t("Časovač odstraněn."));if(ok)this.$('dialog').close();else{this.$('.form-error').textContent=typeof this.error==='function'?this.error():this.error;this.$('#confirm-delete').disabled=false;}};
    this.$('dialog').showModal();
  }
  openEditor(s) {
    this.editing=s?structuredClone(s):null;this.editFingerprint=s?fingerprint(s):null;this.draft=toDraft(s);
    const d=this.draft;
    this.groupOptions=[...new Set([...this.schedules.map(groupName),d.group].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'cs'));
    const timebox=(phase,title)=>`<div class="timebox ${phase}"><strong>${title}</strong><label>${this.t("Způsob určení času")}<select data-phase="${phase}" data-field="mode"><option value="time">${this.t("Konkrétní čas")}</option><option value="sunrise" ${!this._hass.states['sun.sun']?'disabled':''}>${this.t("Východ slunce")}</option><option value="sunset" ${!this._hass.states['sun.sun']?'disabled':''}>${this.t("Západ slunce")}</option></select></label><div class="inputs"><label data-time-label="${phase}">${this.t("Čas")}<input type="time" required data-phase="${phase}" data-field="time" value="${e(d[phase].time)}"></label><label data-offset-label="${phase}">${this.t("Posun v minutách")}<input type="number" min="-120" max="120" step="1" data-phase="${phase}" data-field="offset" value="${d[phase].offset}"></label></div></div>`;
    this.$('dialog').innerHTML=`<form><div class="dialog-head"><div><div class="eyebrow">${this.t("JEDEN PLÁN. VŠECHNO POHROMADĚ.")}</div><h2 id="dialog-title">${s?this.t("Upravit časovač"):this.t("Nový časovač")}</h2></div><button type="button" class="icon" data-action="close" aria-label="${this.t("Zavřít")}">${icon('close')}</button></div><div class="form-body"><label>${this.t("Název časovače")}<input name="name" required maxlength="100" placeholder="${this.t("Například: Ranní osvětlení")}" value="${e(d.name)}" autofocus></label><div class="form-grid group-picker"><label>${this.t("Skupina časovačů")}<select name="group"><option value="">${this.t("Bez skupiny")}</option>${this.groupOptions.map((name,i)=>`<option value="${i}">${e(name)}</option>`).join('')}<option value="new">+ ${this.t("Nová skupina")}</option></select></label><label id="new-group-label" hidden>${this.t("Název nové skupiny")}<input name="new-group" maxlength="60" placeholder="${this.t("Například: Rybičky")}"></label></div><div class="section-label">01 / ${this.t("Kdy se má spustit")}</div><div class="form-grid"><label>${this.t("Opakování")}<select name="repeat"><option value="weekly">${this.t("Vybrané dny v týdnu")}</option><option value="date">${this.t("Jednou v konkrétní den")}</option></select></label><label id="date-label" hidden>${this.t("Datum")}<input name="date" type="date" min="${this.today}" value="${e(d.date)}"></label></div><div id="weekdays"><div class="presets" style="margin-top:14px"><button type="button" data-days="all">${this.t("Každý den")}</button><button type="button" data-days="work">${this.t("Po–Pá")}</button><button type="button" data-days="weekend">${this.t("Víkend")}</button></div><div class="day-picker">${DAYS.map((day,i)=>`<button type="button" data-day="${day}" aria-pressed="${d.days.includes(day)}">${this.t(DAY_NAMES[i])}</button>`).join('')}</div></div><div class="section-label">02 / ${this.t("Zapnutí a vypnutí")}</div><div class="form-grid">${timebox('on',this.t("ZAPNOUT / OTEVŘÍT"))}${timebox('off',this.t("VYPNOUT / ZAVŘÍT"))}</div><p class="hint">${this.t("Časové pásmo:")} ${e(this.info?.time_zone)}. ${this.t("Obě akce platí pro vybrané kalendářní dny. Posun − znamená před sluneční událostí, + po ní.")}</p>${d.conditions.length?`<div class="plan-conditions"><strong>${this.t("Podmínky plánu")}</strong>${d.conditions.map((c,i)=>`<label class="condition-option"><input type="checkbox" data-condition="${i}" checked>${e(this.name(c.entity_id))} ${this.t("musí být")} ${c.value==='on'?this.t("zapnuto"):this.t("vypnuto")}</label>`).join('')}</div>`:''}<div class="section-label">03 / ${this.t("Co má časovač ovládat")}</div><details class="virtual-helper"><summary>+ ${this.t("Vytvořit virtuální přepínač")}</summary><p class="hint">${this.t("Vlastní přepínač pro časovače a automatizace. Vytvoří se hned a zůstane v Home Assistantu i po zrušení tohoto formuláře.")}</p><div class="helper-create"><label>${this.t("Název virtuálního přepínače")}<input id="helper-name" maxlength="100" placeholder="${this.t("Například: Půda – noční režim")}"></label><button type="button" id="create-helper">${this.t("Vytvořit a vybrat")}</button></div><p class="helper-result" role="status" aria-live="polite"></p></details><label>${this.t("Vyhledat podle názvu nebo ID")}<input id="target-search" type="search" placeholder="${this.t("Například: světla obývák")}" aria-describedby="target-help"></label><div class="target-summary"><strong id="target-count" role="status" aria-live="polite" aria-atomic="true"></strong><span id="target-results"></span></div><p class="hint" id="target-help">${this.t("Vybraná zařízení jsou vždy nahoře, i během hledání.")}</p><div class="target-list" role="group" aria-label="${this.t("Zařízení časovače")}"></div><div id="parameters"></div><p class="form-error" role="alert"></p></div><div class="form-actions"><small>${this.t("Ukládá se přímo do Home Assistantu")}</small><button type="button" data-action="close">${this.t("Zrušit")}</button><button type="submit" class="primary">${s?this.t("Uložit změny"):this.t("Vytvořit časovač")}</button></div></form>`;
    for(const phase of ['on','off']){this.$(`[data-phase="${phase}"][data-field="mode"]`).value=d[phase].mode;this.showTimeInputs(phase);}
    this.$('[name=repeat]').value=d.date?'date':'weekly';this.showRepeat();
    this.$('[name=repeat]').onchange=()=>this.showRepeat();
    this.shadowRoot.querySelectorAll('[data-phase]').forEach(input=>input.onchange=()=>{d[input.dataset.phase][input.dataset.field]=input.value;this.showTimeInputs(input.dataset.phase);});
    this.shadowRoot.querySelectorAll('[data-day]').forEach(button=>button.onclick=()=>{d.days=d.days.includes(button.dataset.day)?d.days.filter(x=>x!==button.dataset.day):[...d.days,button.dataset.day];this.showDays();});
    this.shadowRoot.querySelectorAll('[data-days]').forEach(button=>button.onclick=()=>{d.days=button.dataset.days==='all'?[...DAYS]:button.dataset.days==='work'?DAYS.slice(0,5):DAYS.slice(5);this.showDays();});
    this.$('[name=group]').value=d.group?String(this.groupOptions.indexOf(d.group)):'';
    this.$('[name=group]').onchange=()=>{const fresh=this.$('[name=group]').value==='new';this.$('#new-group-label').hidden=!fresh;this.$('[name=new-group]').required=fresh;};
    this.$('#create-helper').onclick=()=>this.createHelper();
    this.$('#helper-name').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();this.createHelper();}};
    this.$('#target-search').oninput=()=>this.renderTargets();
    this.shadowRoot.querySelectorAll('[data-condition]').forEach(input=>input.onchange=()=>d.conditions[Number(input.dataset.condition)].enabled=input.checked);
    this.renderTargets();this.renderParameters();
    this.$('form').onsubmit=event=>{event.preventDefault();this.saveEditor();};
    this.$('dialog').showModal();
  }
  showDays(){this.shadowRoot.querySelectorAll('[data-day]').forEach(b=>b.setAttribute('aria-pressed',this.draft.days.includes(b.dataset.day)));}
  showTimeInputs(phase){const fixed=this.draft[phase].mode==='time';this.$(`[data-time-label="${phase}"]`).hidden=!fixed;this.$(`[data-offset-label="${phase}"]`).hidden=fixed;}
  showRepeat(){const date=this.$('[name=repeat]').value==='date';this.$('#date-label').hidden=!date;this.$('[name=date]').required=date;this.$('#weekdays').hidden=date;}
  renderTargets(changedId){
    const query=this.$('#target-search').value;
    const choices=targetChoices(this._hass.states,this.draft.targets.map(t=>t.id),(this.allSchedules||this.schedules).map(s=>s.entity_id),query);
    this.$('#target-count').textContent=`${this.t("Vybráno zařízení:")} ${choices.selected.length}`;
    this.$('#target-results').textContent=query.trim()?`${this.t("Další shody:")} ${choices.available.length}`:`${this.t("K dispozici:")} ${choices.total}`;
    for(const item of choices.selected)if(item.missing && this.createdHelperNames?.[item.id])item.name=this.createdHelperNames[item.id];
    const option=(item,checked)=>`<label class="target-option ${checked?'selected':''}"><input type="checkbox" data-target="${e(item.id)}" aria-label="${e(item.name)}" aria-describedby="target-id-${e(item.id)}" ${checked?'checked':''}><span class="target-text"><strong>${e(item.name)}</strong><small id="target-id-${e(item.id)}">${e(item.id)}${item.missing?this.t(" · nyní nedostupné"):''}</small></span>${checked?`<span class="target-selected" aria-hidden="true">${this.t("Vybráno")}</span>`:''}</label>`;
    this.$('.target-list').innerHTML=(choices.selected.length?`<div class="target-group">${this.t("Vybraná zařízení")} · ${choices.selected.length}</div>${choices.selected.map(item=>option(item,true)).join('')}`:'')+`<div class="target-group">${query.trim()?this.t("Výsledky hledání"):this.t("Další zařízení · podle názvu")}</div>`+(choices.available.map(item=>option(item,false)).join('')||`<p class="target-empty">${this.t("Žádné další odpovídající zařízení.")}</p>`);
    this.$('.target-list').scrollTop=0;
    if(changedId){const moved=this.$(`[data-target="${CSS.escape(changedId)}"]`);if(moved)moved.focus({preventScroll:moved.checked});else this.$('#target-search').focus({preventScroll:true});}
    this.shadowRoot.querySelectorAll('[data-target]').forEach(input=>input.onchange=()=>{
      const id=input.dataset.target;
      if(input.checked)this.draft.targets.push({id,on:{},off:{}});
      else this.draft.targets=this.draft.targets.filter(t=>t.id!==id);
      this.renderTargets(id);this.renderParameters();
    });
  }
  renderParameters(){
    this.$('#parameters').innerHTML=this.draft.targets.map((t,i)=>{const light=t.id.startsWith('light.'),fan=t.id.startsWith('fan.');return `<div class="params"><div class="params-title">${e(this.name(t.id))}</div><div class="action-picker"><label><input type="checkbox" data-target-action="onEnabled" data-index="${i}" ${t.onEnabled!==false?'checked':''}>${this.t("Zapnout / otevřít")}</label><label><input type="checkbox" data-target-action="offEnabled" data-index="${i}" ${t.offEnabled!==false?'checked':''}>${this.t("Vypnout / zavřít")}</label></div>${light||fan?`<label>${light?this.t("Jas při zapnutí"):this.t("Otáčky při zapnutí")} (%) · ${this.t("prázdné")} = ${this.t("beze změny")}<input type="number" min="1" max="100" data-level="${i}" value="${e((light?t.on.brightness_pct:t.on.percentage)??'')}" placeholder="${this.t("Beze změny")}"></label>`:''}<details><summary>${this.t("Další parametry pro toto zařízení")}</summary><div class="form-grid"><label>${this.t("Parametry zapnutí")} · JSON<textarea rows="3" data-param="on" data-index="${i}">${e(typeof t.on==='string'?t.on:JSON.stringify(t.on,null,2))}</textarea></label><label>${this.t("Parametry vypnutí")} · JSON<textarea rows="3" data-param="off" data-index="${i}">${e(typeof t.off==='string'?t.off:JSON.stringify(t.off,null,2))}</textarea></label></div></details></div>`;}).join('');
    this.shadowRoot.querySelectorAll('[data-target-action]').forEach(input=>input.onchange=()=>this.draft.targets[Number(input.dataset.index)][input.dataset.targetAction]=input.checked);
    this.shadowRoot.querySelectorAll('[data-level]').forEach(input=>input.oninput=()=>{const t=this.draft.targets[Number(input.dataset.level)],key=t.id.startsWith('light.')?'brightness_pct':'percentage';if(typeof t.on==='string'){try{t.on=JSON.parse(t.on);}catch{return;}}if(input.value==='')delete t.on[key];else t.on[key]=Number(input.value);this.$(`[data-param="on"][data-index="${input.dataset.level}"]`).value=JSON.stringify(t.on,null,2);});
    this.shadowRoot.querySelectorAll('[data-param]').forEach(input=>input.oninput=()=>{this.draft.targets[Number(input.dataset.index)][input.dataset.param]=input.value;});
  }
  async createHelper(){
    if(!this.canWrite)return;
    const input=this.$('#helper-name'),button=this.$('#create-helper'),result=this.$('.helper-result'),submit=this.$('[type=submit]');
    this.busy=true;button.disabled=true;submit.disabled=true;input.disabled=true;result.textContent=this.t("Vytvářím přepínač…");
    try{
      const helper=await createVirtualSwitch(this._hass,input.value);
      this.createdHelperNames={...this.createdHelperNames,[helper.id]:helper.name};
      if(!this.draft.targets.some(t=>t.id===helper.id))this.draft.targets.push({id:helper.id,on:{},off:{}});
      input.value='';this.renderTargets();this.renderParameters();
      result.textContent=`${this.t("Vytvořeno a vybráno:")} ${helper.name} · ${helper.id}`;
    }catch(error){result.textContent=errorText(this.language,error) || this.t("Vytvoření se nepotvrdilo. Před dalším pokusem vyhledejte přepínač podle názvu.");}
    finally{this.busy=false;button.disabled=false;submit.disabled=false;input.disabled=false;this.render();}
  }
  async saveEditor(){
    if(this.busy)return;
    const error=this.$('.form-error'),submit=this.$('[type=submit]');error.textContent='';
    try{
      this.draft.name=this.$('[name=name]').value;this.draft.date=this.$('[name=repeat]').value==='date'?this.$('[name=date]').value:'';
      const group=this.$('[name=group]').value;this.draft.group=group==='new'?this.$('[name=new-group]').value:group===''?'':this.groupOptions[Number(group)];
      if(group==='new' && !this.draft.group.trim())throw Error(this.t("Zadejte název nové skupiny."));
      const payload=buildSchedule(this.draft,this.editing);
      if(this.draft.date && this.draft.date<this.today)throw Error(this.t("Vyberte dnešní nebo budoucí datum."));
      this.busy=true;submit.disabled=true;
      if(this.editing){const current=await this._hass.callWS({type:'scheduler/item',schedule_id:this.editing.schedule_id});if(!current||fingerprint(current)!==this.editFingerprint)throw Error(this.t("Plán mezitím někdo změnil. Zavřete editor a otevřete ho znovu."));}
      await this._hass.callApi('POST',this.editing?'scheduler/edit':'scheduler/add',{...payload,...(this.editing?{schedule_id:this.editing.schedule_id}:{})});
      this.$('dialog').close();await this.refresh();this.toast(()=>this.t("Časovač uložen."));
    }catch(err){error.textContent=errorText(this.language,err);}
    finally{this.busy=false;submit.disabled=false;this.render();}
  }
}
if(!customElements.get('workflow-timers-card'))customElements.define('workflow-timers-card',WorkFlowTimers);
if(!customElements.get('workflow-timers-panel'))customElements.define('workflow-timers-panel',class extends WorkFlowTimers{connectedCallback(){this.setAttribute('panel','');super.connectedCallback();}});
window.customCards=window.customCards || [];
if(!window.customCards.some(c=>c.type==='workflow-timers-card'))window.customCards.push({type:'workflow-timers-card',name:'WorkFlow Timers',description:'A scheduler with times, solar events and multiple devices.',preview:false});
