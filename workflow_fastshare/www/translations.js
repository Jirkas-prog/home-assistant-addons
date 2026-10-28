let catalog = {};
let language = 'en';
const originals = new WeakMap();
export const ready = fetch(new URL('./cs.json?v=1.3.0', import.meta.url)).then(r=>r.json()).then(data=>{catalog=data;}).catch(()=>{});
export function setLanguage(value){language=value==='cs'?'cs':'en';}
export function t(text, values={}, locale=language){let value=locale==='cs'?(catalog[text]??text):text;return value.replace(/\{(\w+)\}/g,(all,key)=>values[key]??all);}
function translate(text,locale){
  if(locale!=='cs')return text;
  const raw=text.trim(), direct=catalog[raw];
  if(direct!==undefined)return text.replace(raw,direct);
  for(const [source,target] of Object.entries(catalog)){
    if(source.endsWith(' ')&&text.startsWith(source))return target+text.slice(source.length);
    if(source.includes('{')||source.includes('%s')){
      const keys=[];const pattern=source.split(/(\{\w+\}|%s)/g).map(s=>{if(/^\{\w+\}$|^%s$/.test(s)){keys.push(s);return '(.*?)';}return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('');
      const match=raw.match(new RegExp('^'+pattern+'$'));
      if(match){let output=target;keys.forEach((key,i)=>output=output.replace(key,match[i+1]));return text.replace(raw,output);}
    }
  }
  if(raw.includes(' · '))return text.replace(raw,raw.split(' · ').map(s=>translate(s,locale)).join(' · '));
  const icon=raw.match(/^([☁↓✉◉＋↗]\s*)(.+)$/);
  if(icon)return text.replace(raw,icon[1]+translate(icon[2],locale));
  return text;
}
export function localize(root,locale=language){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){
    if(node.parentElement?.closest('script,style,textarea,.name,.job-title b,[data-user-content]'))continue;
    const previous=originals.get(node), source=previous?.output===node.nodeValue?previous.source:node.nodeValue;
    const output=translate(source,locale);originals.set(node,{source,output});if(node.nodeValue!==output)node.nodeValue=output;
  }
  for(const element of root.querySelectorAll('[placeholder],[aria-label],[title],[alt]')){
    if(element.matches('.name,.job-title b,[data-user-content]'))continue;
    const previous=originals.get(element)||{};
    for(const key of ['placeholder','aria-label','title','alt']){if(!element.hasAttribute(key))continue;const raw=element.getAttribute(key),source=previous[key]?.output===raw?previous[key].source:raw,output=translate(source,locale);previous[key]={source,output};if(raw!==output)element.setAttribute(key,output);}
    originals.set(element,previous);
  }
}
export function observe(root){let pending=false;const observer=new MutationObserver(()=>{if(!pending){pending=true;queueMicrotask(()=>{pending=false;localize(root);});}});observer.observe(root,{childList:true,subtree:true,characterData:true});return observer;}
