import {ready,setLanguage,observe} from './translations.js?v=2.1.3';
const form=document.querySelector('#local-login'), message=document.querySelector('#login-message');
// Remove the one-time credential from the address bar before any network request.
const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
await ready;
observe(document.body);
async function login(data){
  form.querySelector('button').disabled=true;
  try{const response=await fetch('api/local-auth',{method:'POST',headers:{'Content-Type':'application/json','X-FastShare-Request':'1'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error);location.replace('./');}
  catch(error){message.textContent=error.message;form.querySelector('button').disabled=false;}
}
try{const session=await fetch('api/session').then(r=>r.json());setLanguage(session.language);document.documentElement.lang=session.language||'en';form.hidden=!session.password_available;message.textContent=session.password_available?'':'Open this page from Home Assistant to sign in.';if(ticket)await login({ticket});}catch{message.textContent='Connection lost';}
form.onsubmit=event=>{event.preventDefault();login({password:document.querySelector('#password').value});};
