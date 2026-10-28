import {bytes,esc} from './workflow-fastshare.js?v=1.3.0';
import {t} from './translations.js?v=1.3.0';

export function setupPlayer({api,run,readOnly=false}) {
  const $=selector=>document.querySelector(selector), video=$('#movie'), dialog=$('#player');
  let page=0, total=0, current, savedAt=0, restored=false, requestNumber=0;
  async function load(refresh=false) {
    const number=++requestNumber;
    $('#library-status').textContent='Loading your library…';
    const params=new URLSearchParams({q:$('#library-query').value,folder:$('#library-folder').value,page,refresh:refresh?'1':'0'});
    const result=await api('library?'+params);
    if(number!==requestNumber)return;
    total=result.total;
    const selected=$('#library-folder').value;
    $('#library-folder').innerHTML='<option value="">All folders</option>'+result.folders.map(folder=>`<option value="${esc(folder)}" data-user-content>${esc(folder)}</option>`).join('');
    $('#library-folder').value=selected;
    $('#library-status').textContent=t('{count} videos in your library',{count:total});
    $('#library-warning').textContent=result.unavailable.length?(readOnly?'Some library folders are unavailable.':t('Unavailable folders: {folders}',{folders:result.unavailable.join(', ')})):result.truncated?(readOnly?'Only part of the library is shown.':'Library limit reached. Select a more specific folder in Settings.') :'';
    $('#library-warning').hidden=!$('#library-warning').textContent;
    $('#library-grid').replaceChildren();
    for(const item of result.items) {
      const card=document.createElement('article');card.className='media-card';
      card.innerHTML=`<button class="media-art" aria-label="${esc(t('Play {name}',{name:item.name}))}"><span class="media-format">${esc(item.format)}</span><svg viewBox="0 0 100 70" aria-hidden="true"><path d="M12 8h76v54H12zM12 20h76M12 50h76M24 8v12m13-12v12m13-12v12m13-12v12m13-12v12M24 50v12m13-12v12m13-12v12m13-12v12m13-12v12" fill="none" stroke="currentColor" stroke-width="2"/><path d="m43 26 18 9-18 9z" fill="currentColor"/></svg><span class="media-play">▶ <span>Play video</span></span></button><div class="media-info"><h2 data-user-content>${esc(item.name)}</h2><p>${esc(bytes(item.size))} <span aria-hidden="true">·</span> <span data-user-content>${esc(item.relative==='.'?item.folder:item.relative)}</span></p>${readOnly?'':`<a href="api/media/${encodeURIComponent(item.id)}/stream?download=1" class="text-button">Download file ↓</a>`}</div>`;
      card.querySelector('button').onclick=e=>run(e.currentTarget,()=>play(item.id));$('#library-grid').append(card);
    }
    $('#library-empty').hidden=!!total;
    $('#library-prev').disabled=page===0;$('#library-next').disabled=(page+1)*24>=total;
    $('#library-pages').textContent=total?t('Page {page} of {pages}',{page:page+1,pages:Math.ceil(total/24)}):'';
    $('#library-pagination').hidden=total<=24;
  }
  function savePosition() {
    if(!current||!restored||!Number.isFinite(video.duration))return;
    try {localStorage.setItem('fastshare:resume:'+current.resume_key,String(video.ended?0:video.currentTime));}catch{}
  }
  async function play(id) {
    const details=await api('media/'+encodeURIComponent(id));
    savePosition();video.pause();current=details;restored=false;
    $('#player-name').textContent=details.name;
    $('#player-meta').textContent=`${details.format} · ${bytes(details.size)}`;
    $('#player-error').hidden=true;$('#player-status').textContent='Loading video…';
    const stream='api/media/'+encodeURIComponent(id)+'/stream';
    if($('#player-download'))$('#player-download').href=stream+'?download=1';
    video.replaceChildren();video.src=stream;
    for(const item of details.tracks){const track=document.createElement('track');track.kind='subtitles';track.src='api/media/'+encodeURIComponent(item.id)+'/subtitle';track.srclang=item.language;track.label=item.label;video.append(track);}
    if(!dialog.open)dialog.showModal();
    video.load();
    // Playback starts from a user action; browsers may still require their Play button.
    video.play().catch(()=>{});
  }
  video.onloadedmetadata=()=>{
    let position=0;try{position=Number(localStorage.getItem('fastshare:resume:'+current.resume_key))||0;}catch{}
    if(position>5&&position<video.duration-5){video.currentTime=position;$('#player-status').textContent='Resuming where you left off.';}
    else $('#player-status').textContent='Ready to play.';
    restored=true;
  };
  video.ontimeupdate=()=>{if(Date.now()-savedAt>5000){savePosition();savedAt=Date.now();}};
  video.onpause=savePosition;video.onended=savePosition;
  video.onplaying=()=>{$('#player-status').textContent='Playing directly from your library.';};
  video.onerror=()=>{if(!current)return;$('#player-status').textContent='Playback unavailable';$('#player-error').hidden=false;};
  $('#player-restart').onclick=()=>{video.currentTime=0;savePosition();video.play().catch(()=>{});};
  $('#close-player').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{savePosition();video.pause();current=null;restored=false;video.removeAttribute('src');video.replaceChildren();video.load();});
  window.addEventListener('pagehide',savePosition);
  $('#library-search').onsubmit=e=>{e.preventDefault();page=0;run(e.submitter,()=>load());};
  $('#library-folder').onchange=()=>{page=0;run(null,()=>load());};
  $('#library-refresh').onclick=e=>{page=0;run(e.currentTarget,()=>load(true));};
  $('#library-prev').onclick=e=>{page=Math.max(0,page-1);run(e.currentTarget,()=>load()).then(()=>$('#library-prev').disabled=page===0);};
  $('#library-next').onclick=e=>{page++;run(e.currentTarget,()=>load()).then(()=>$('#library-next').disabled=(page+1)*24>=total);};
  return ()=>run(null,()=>load());
}
