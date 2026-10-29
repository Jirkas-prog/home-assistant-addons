import {setupPlayer} from './player.js?v=1.3.0';
import {ready,setLanguage,localize,observe} from './translations.js?v=2.1.3';

const status=document.querySelector('#library-status');
async function api(path){
  const response=await fetch('api/'+path,{credentials:'omit'});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'The request failed.');
  return result;
}
async function run(button,task){
  if(button)button.disabled=true;
  try{return await task();}
  catch(error){status.textContent=error.message;}
  finally{if(button)button.disabled=false;}
}
await ready;
await run(null,async()=>{
  const config=await api('player-config');
  setLanguage(config.language);document.documentElement.lang=config.language;
  localize(document.body);observe(document.body);
  await setupPlayer({api,run,readOnly:true})();
});
