'use strict';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let strings = {}, config = {}, view = 'all', page = 0, detailItem = null, playing = null, loadNumber = 0, toastTimer;
const t = text => strings[text] || text;
const seconds = value => { const n = Math.max(0, Math.floor(value || 0)); return `${Math.floor(n / 3600) ? Math.floor(n / 3600) + ':' : ''}${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const progressPercent = item => item.duration ? Math.min(100, Math.max(0, item.position / item.duration * 100)) : 0;
const art = (item, kind = 'poster', index = 0) => `api/library/${encodeURIComponent(item.id)}/art/${kind}?index=${index}`;
const buttons = (items) => items.map(([action, text, primary]) => `<button data-action="${action}" class="${primary ? 'primary' : ''}">${escape(t(text))}</button>`).join('');

async function api(path, data, keepalive = false) {
  const response = await fetch(path, data === undefined ? {cache: 'no-store'} : {method: 'POST', headers: {'Content-Type':'application/json', 'X-Play-Request':'1'}, body: JSON.stringify(data), keepalive});
  let result;
  try { result = await response.json(); } catch { throw new Error(t('The server is restarting or unavailable. Try again shortly.')); }
  if (!response.ok) throw new Error(t(result.error || 'Request failed.'));
  return result;
}
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 6500); }
function failure(error) { toast(error.message || String(error)); }
async function action(task) { try { await task(); } catch (error) { failure(error); } }
function translate() {
  document.documentElement.lang = config.language;
  $$('[data-i18n]').forEach(node => node.textContent = t(node.dataset.i18n));
  $$('[data-placeholder]').forEach(node => node.placeholder = t(node.dataset.placeholder));
  $$('.close').forEach(node => node.setAttribute('aria-label', t('Close')));
}
function openDialog(id) { const dialog = $('#' + id); if (!dialog.open) dialog.showModal(); }
function closeDialog(id) { $('#' + id).close(); }
function imageFallback(container) { container.querySelectorAll('img').forEach(img => img.addEventListener('error', () => img.remove(), {once:true})); }
function poster(item, className = '') {
  return `<div class="poster ${className}">${item.has_poster ? `<img loading="lazy" ${item.generated_previews && !item.local_poster ? `data-cycle="${item.id}"` : ''} src="${art(item)}" alt="">` : ''}<div class="poster-fallback"><span class="reel" aria-hidden="true">▷</span><span>${escape(item.title)}</span></div>${item.watched ? `<span class="badge">✓ ${escape(t('Watched'))}</span>` : item.favorite ? '<span class="badge">★</span>' : ''}</div>`;
}
function card(item) {
  return `<button class="movie-card" data-id="${item.id}" aria-label="${escape(t('Details') + ': ' + item.title)}">${poster(item)}<div class="progress"><i style="width:${progressPercent(item)}%"></i></div><div class="card-copy"><h3>${escape(item.title)}</h3><p>${escape([item.year || '', item.format, item.rating ? '★ ' + item.rating.toFixed(1) : ''].filter(Boolean).join(' · '))}</p>${item.kind === 'episode' ? `<div class="episode">${escape(item.show)} · S${String(item.season).padStart(2,'0')}E${String(item.episode).padStart(2,'0')}</div>` : ''}</div></button>`;
}
function bindCards(container) { container.querySelectorAll('[data-id]').forEach(node => node.onclick = () => action(() => showDetails(node.dataset.id))); imageFallback(container); }
function setOptions(id, values) {
  const select = $('#' + id), current = select.value;
  select.replaceChildren(new Option(t('All'), ''));
  values.forEach(value => select.add(new Option(id === 'root' ? value.split(/[\\/]/).filter(Boolean).pop() : value, value)));
  if ([...select.options].some(option => option.value === current)) select.value = current;
}
async function loadLibrary() {
  const number = ++loadNumber;
  const params = new URLSearchParams({q: $('#query').value, sort: $('#sort').value, page});
  if (view === 'movies' || view === 'series') params.set('kind', view === 'movies' ? 'movie' : 'episode');
  else params.set('view', view);
  ['genre','year','collection','show','root'].forEach(key => { if ($('#' + key).value) params.set(key, $('#' + key).value); });
  const result = await api('api/library?' + params);
  if (number !== loadNumber) return;
  page = result.page;
  $('#totalCount').textContent = result.stats.total; $('#continueCount').textContent = result.stats.watching; $('#watchedCount').textContent = result.stats.watched;
  Object.entries({genre:'genres',year:'years',collection:'collections',show:'shows',root:'roots'}).forEach(([id,key]) => setOptions(id,result.facets[key]));
  $('#resultCount').textContent = result.total + ' / ' + t('titles');
  $('#grid').innerHTML = result.items.map(card).join(''); bindCards($('#grid'));
  $('#empty').hidden = result.total > 0;
  $('#previous').disabled = page === 0; $('#next').disabled = (page + 1) * result.page_size >= result.total;
  $('#pageLabel').textContent = `${page + 1} / ${Math.max(1, Math.ceil(result.total / result.page_size))}`;
  $('#continueSection').hidden = !result.continue.length;
  $('#continueRail').innerHTML = result.continue.map(item => `<button class="resume-card" data-id="${item.id}">${item.has_poster ? `<img loading="lazy" ${item.generated_previews && !item.local_poster ? `data-cycle="${item.id}"` : ''} src="${art(item)}" alt="">` : ''}<div class="resume-copy"><strong>${escape(item.title)}</strong><small>${seconds(item.position)} ${t('of')} ${seconds(item.duration)}</small><div class="progress"><i style="width:${progressPercent(item)}%"></i></div></div></button>`).join('');
  bindCards($('#continueRail'));
  const messages = [];
  if (result.status.scanning) messages.push(t('Scanning library…'));
  if (result.status.matching) messages.push(t('Creating movie previews…'));
  if (result.status.matching || result.stats.previews_failed) messages.push(`${t('Previews ready')}: ${result.stats.previews_ready}/${result.stats.total}.`);
  if (result.stats.previews_failed) messages.push(`${t('Previews unavailable')}: ${result.stats.previews_failed}.`);
  if (result.status.unavailable.length) messages.push(t('Some media folders are unavailable.'));
  if (result.status.truncated) messages.push(t('Library scan limit reached (5,000 videos). Narrow the selected folders.'));
  if (result.status.error) messages.push(t(result.status.error));
  if (config.preview_error) messages.push(t(config.preview_error));
  $('#libraryStatus').textContent = messages.join(' ');
  if ((!$('#hero').dataset.filled || $('#hero').dataset.filled === 'pending') && (result.continue.length || result.items.length)) {
    const item = result.continue[0] || result.items[0];
    $('#hero').dataset.filled = item.has_backdrop ? 'true' : 'pending';
    if (item.has_backdrop) $('.hero-art').style.backgroundImage = `url("${art(item, 'backdrop')}")`;
    $('.hero-copy').innerHTML = `<div class="eyebrow">${escape(t(item.position && !item.watched ? 'YOUR STORY CONTINUES' : 'FROM YOUR COLLECTION'))}</div><h1>${escape(item.title)}</h1><p>${escape(t('One library. Every story. Pick a film and press play.'))}</p><div class="button-row">${buttons([['heroPlay', item.position > 5 && !item.watched ? 'Resume' : 'Play', true], ['heroDetail','Details']])}</div>`;
    $('[data-action="heroPlay"]').onclick = () => action(() => play(item.id));
    $('[data-action="heroDetail"]').onclick = () => action(() => showDetails(item.id));
  }
}
async function showDetails(id) {
  const item = await api('api/library/' + encodeURIComponent(id)); detailItem = item;
  const meta = [item.year || '', ...item.genres, (item.duration || item.runtime) ? Math.round((item.duration || item.runtime) / 60) + ' min' : '', item.rating ? '★ ' + item.rating.toFixed(1) : ''].filter(Boolean);
  const facts = [[t('Director'),item.directors.join(', ')], [t('Cast'),item.cast.map(person => person.name + (person.role ? ' · ' + person.role : '')).join(' / ')], [t('Collection'),item.collection], [t('Series'),item.show]].filter(pair => pair[1]);
  $('#detailContent').innerHTML = `<div class="detail-top">${item.has_backdrop ? `<div class="detail-backdrop" style="background-image:url('${art(item,'backdrop')}')"></div>` : ''}<div>${poster(item)}</div><div class="detail-copy"><div class="eyebrow">${escape(t(item.kind === 'episode' ? 'EPISODE' : 'MOVIE'))} / ${escape(item.format)}</div><h2>${escape(item.title)}</h2><div class="meta-line">${meta.map(value => `<span>${escape(value)}</span>`).join('')}</div>${item.position > 5 && !item.watched ? `<p>${escape(t('Continue at'))} ${seconds(item.position)}${item.progress_source === 'nova' ? ' · NOVA' : ''}</p>` : ''}<div class="button-row">${buttons([['play',item.position > 5 && !item.watched ? 'Resume' : 'Play',true],...(item.position > 5 ? [['start','Start from beginning']] : []),['favorite',item.favorite ? '★ Favorited' : '☆ Favorite'],['watched',item.watched ? 'Mark unwatched' : 'Mark watched']])}</div></div></div><div class="detail-plot">${item.preview_status === 'failed' ? `<p>${escape(t('Preview extraction failed. The video may be incomplete or unsupported.'))}</p>` : ''}<div class="detail-facts">${facts.map(([label,text]) => `<div><strong>${escape(label)}</strong><span>${escape(text)}</span></div>`).join('')}</div>${item.gallery_count ? `<h3>${escape(t('Gallery'))}</h3><div class="gallery">${Array.from({length:item.gallery_count},(_,i)=>`<button data-gallery="${i}" aria-label="${escape(t('Open artwork'))} ${i+1}"><img loading="lazy" src="${art(item,'gallery',i)}" alt=""></button>`).join('')}</div>` : ''}<div class="file-info">${escape(item.filename)} · ${(item.size/1024**3).toFixed(2)} GB · ${escape(item.folder)}<br>${escape(t('Metadata'))}: ${escape(item.source === 'nfo' ? 'NFO' : t('Filename'))}</div></div>`;
  imageFallback($('#detailContent'));
  $('#detailContent').querySelectorAll('[data-action]').forEach(button => button.onclick = () => action(async () => {
    const key = button.dataset.action;
    if (key === 'play' || key === 'start') return play(item.id, key === 'start');
    await api(`api/library/${item.id}/flags`, key === 'favorite' ? {favorite:!item.favorite} : {watched:!item.watched});
    await showDetails(item.id); await loadLibrary();
  }));
  $('#detailContent').querySelectorAll('[data-gallery]').forEach(button => button.onclick = () => { $('#galleryImage').src = art(item,'gallery',Number(button.dataset.gallery)); openDialog('galleryDialog'); });
  openDialog('details');
}

async function saveProgress(ended = false, keepalive = false) {
  const video = $('#video'), active = playing;
  if (!active || !active.ready || !Number.isFinite(video.duration) || video.duration <= 0) return;
  const data = {session:active.session,sequence:++active.sequence,position:video.currentTime,duration:video.duration,ended};
  try {
    const result = await api(`api/library/${active.item.id}/progress`, data, keepalive);
    if (playing === active) $('#saveStatus').textContent = t(result.saved ? 'Watch position saved' : 'Another playback session is active. Position was not overwritten.');
  } catch { if (playing === active) $('#saveStatus').textContent = t('Could not save position. Reconnecting…'); }
}
async function play(id, fromStart = false) {
  if (playing) { await saveProgress(); playing = null; $('#video').pause(); }
  const result = await api(`api/library/${encodeURIComponent(id)}/play`, {});
  const item = result.item, video = $('#video');
  playing = {item,session:result.session,sequence:0,ready:false};
  const active = playing;
  $('#playingTitle').textContent = item.title; $('#playError').hidden = true; $('#saveStatus').textContent = t('Watch position is saved automatically.');
  $('#nextEpisode').hidden = !item.next_episode;
  $('#nextEpisode').onclick = () => action(() => play(item.next_episode));
  video.replaceChildren();
  item.tracks.forEach(track => { const node = document.createElement('track'); node.kind='subtitles'; node.label=track.label; node.srclang=track.language; node.src=`api/library/${item.id}/subtitle/${track.index}`; video.append(node); });
  video.onloadedmetadata = () => { if (playing !== active) return; const position = fromStart || item.watched ? 0 : item.position; if (position > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(position, Math.max(0,video.duration-1)); active.ready=true; video.play().catch(() => {}); };
  video.src = `api/library/${item.id}/stream`; openDialog('player'); video.load();
}
$('#video').addEventListener('pause', () => { if (!$('#video').ended) saveProgress(); });
$('#video').addEventListener('ended', () => { saveProgress(true); action(loadLibrary); });
$('#video').addEventListener('error', () => { if (!playing) return; $('#playError').textContent = t('This file could not be played. Your browser may not support its video or audio codec. Try a compatible browser or your TV player.'); $('#playError').hidden = false; });
$('#player').addEventListener('close', () => { saveProgress(false,true); playing=null; $('#video').pause(); $('#video').removeAttribute('src'); $('#video').load(); action(loadLibrary); });
window.addEventListener('pagehide', () => saveProgress(false,true));
document.addEventListener('visibilitychange', () => { if (document.hidden) saveProgress(false,true); });
setInterval(() => { if (playing && !$('#video').paused) saveProgress(); },10000);

function networkLink() {
  const form = $('#settingsForm'), host = form.elements.lan_host.value || location.hostname;
  const link = $('#playerLink'); link.hidden = !form.elements.lan_enabled.checked;
  if (/^[a-zA-Z0-9.-]+$/.test(host)) { link.href = `http://${host}:${Number(form.elements.lan_port.value)}/`; link.textContent = link.href; }
  else { link.removeAttribute('href'); link.textContent=''; }
}
async function showSettings() {
  const value = await api('api/admin/settings'), form = $('#settingsForm');
  Object.entries(value).forEach(([key,data]) => { const input=form.elements[key]; if (!input) return; if (input.type === 'checkbox') input.checked=data; else input.value=Array.isArray(data)?data.join('\n'):data; });
  networkLink(); openDialog('settingsDialog');
}
$('#settingsForm').addEventListener('input',networkLink);
$('#settingsForm').onsubmit = event => { event.preventDefault(); action(async () => {
  const form = event.currentTarget, data = {};
  ['language','lan_host'].forEach(key=>data[key]=form.elements[key].value.trim());
  ['scan_interval','lan_port'].forEach(key=>data[key]=Number(form.elements[key].value));
  ['generate_previews','cycle_previews','import_nova_resume','lan_enabled'].forEach(key=>data[key]=form.elements[key].checked);
  data.media_roots=form.elements.media_roots.value.split('\n').map(s=>s.trim()).filter(Boolean);
  const result=await api('api/admin/settings',data); config.language=result.settings.language; config.cycle_previews=result.settings.cycle_previews;
  strings=config.language==='cs'?await api('cs.json'):{}; translate(); $('#hero').dataset.filled='';
  toast(t(result.automatic_restart?'Saved. The add-on is restarting to apply the port.':'Settings saved.'));
  if (!result.automatic_restart) await loadLibrary();
}); };
$('#settingsButton').onclick=()=>action(showSettings);
$('#scanNow').onclick=()=>action(async()=>{await api('api/admin/scan',{});toast(t('Library scan requested.'));});
$('#retryPreviews').onclick=()=>action(async()=>{await api('api/admin/retry-previews',{});toast(t('Preview generation requested.'));});
$('#aboutButton').onclick=()=>openDialog('aboutDialog');
$$('[data-close]').forEach(button=>button.onclick=()=>closeDialog(button.dataset.close));
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}}));
$('#views').querySelectorAll('button').forEach(button=>button.onclick=()=>{view=button.dataset.view;page=0;$('#views').querySelectorAll('button').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-current',item===button?'true':'false');});action(loadLibrary);});
let queryTimer;
$('#query').oninput=()=>{clearTimeout(queryTimer);queryTimer=setTimeout(()=>{page=0;action(loadLibrary);},250);};
$('#filters').onsubmit=event=>event.preventDefault();
$('#filters').querySelectorAll('select').forEach(select=>select.onchange=()=>{page=0;action(loadLibrary);});
$('#clearFilters').onclick=()=>{['query','genre','year','collection','show','root'].forEach(id=>$('#'+id).value='');view='all';$('#views [data-view="all"]').click();};
$('#previous').onclick=()=>{page--;action(loadLibrary);}; $('#next').onclick=()=>{page++;action(loadLibrary);};
$('#refresh').onclick=()=>action(async()=>{$('#hero').dataset.filled='';if(config.admin)await api('api/admin/scan',{});await loadLibrary();});
async function initialize(){config=await api('api/config');strings=config.language==='cs'?await api('cs.json'):{};translate();$('#settingsButton').hidden=!config.admin;$('#controlLink').hidden=!config.controls;$('#version').textContent='FastShare Play '+config.version;await loadLibrary();}
action(initialize);
setInterval(()=>{if(!document.hidden&&!playing&&!$('dialog[open]'))action(loadLibrary);},15000);

let previewIndex=0;
setInterval(()=>{
  if (!config.cycle_previews || document.hidden || playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  previewIndex=(previewIndex+1)%3;
  $$('[data-cycle]').forEach(image=>{const rect=image.getBoundingClientRect();if(rect.bottom>0 && rect.top<innerHeight)image.src=`api/library/${image.dataset.cycle}/art/gallery?index=${previewIndex}`;});
},6000);
