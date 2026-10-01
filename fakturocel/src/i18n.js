import cs from './locales/cs.json' with { type: 'json' };

const supported=new Set(['en','cs']);
let language='en',observer;
const entries=Object.entries(cs.translations).filter(([english,czech])=>english&&czech&&english!==czech).sort((a,b)=>b[0].length-a[0].length);
const exact=new Map(entries);

export const currentLanguage=()=>language;
export const locale=()=>language==='cs'?'cs-CZ':'en-GB';
export const storedLanguage=()=>{try{return supported.has(localStorage.getItem('fakturocel-language'))?localStorage.getItem('fakturocel-language'):'en';}catch{return'en';}};

export function tr(value){
  if(language!=='cs'||typeof value!=='string'||!value)return value;
  const leading=value.match(/^\s*/)?.[0]||'',trailing=value.match(/\s*$/)?.[0]||'',body=value.slice(leading.length,value.length-trailing.length);
  if(!body)return value;
  const direct=exact.get(body);if(direct)return leading+direct+trailing;
  for(const [english,czech]of entries){
    if(english.length<3)continue;
    if(body.startsWith(english))return leading+czech+body.slice(english.length)+trailing;
    if(body.endsWith(english))return leading+body.slice(0,-english.length)+czech+trailing;
  }
  return value;
}

function translateElement(element){
  if(element.matches?.('script,style,[data-no-translate]')||element.closest?.('[data-no-translate]'))return;
  for(const attribute of ['placeholder','title','aria-label'])if(element.hasAttribute?.(attribute))element.setAttribute(attribute,tr(element.getAttribute(attribute)));
  for(const node of element.childNodes||[]){
    if(node.nodeType===Node.TEXT_NODE){if(!element.matches?.('textarea,[contenteditable="true"]'))node.nodeValue=tr(node.nodeValue);}
    else if(node.nodeType===Node.ELEMENT_NODE)translateElement(node);
  }
}

export function translateTree(root=document.body){if(language==='cs'&&root)translateElement(root.nodeType===Node.ELEMENT_NODE?root:root.parentElement);}

export function setLanguage(value){
  language=supported.has(value)?value:'en';
  try{localStorage.setItem('fakturocel-language',language);}catch{}
  document.documentElement.lang=language;
  if(!observer&&document.body){
    observer=new MutationObserver(records=>{if(language!=='cs')return;for(const record of records)for(const node of record.addedNodes)if(node.nodeType===Node.ELEMENT_NODE)translateElement(node);else if(node.nodeType===Node.TEXT_NODE&&node.parentElement)node.nodeValue=tr(node.nodeValue);});
    observer.observe(document.body,{childList:true,subtree:true});
  }
  queueMicrotask(()=>translateTree(document.body));
  return language;
}

export const languages=[['en','English'],['cs',cs.language]];
