/* Reads vCard locally. Only names and phone numbers leave the browser. */
(function(){
'use strict';
function unescapeText(value){
 return value.replace(/\\[nN]/g,' ').replace(/\\([\\,;:])/g,'$1').trim();
}
function decodeValue(header,value){
 if(/ENCODING=QUOTED-PRINTABLE/i.test(header)){
  const bytes=[];
  for(let i=0;i<value.length;i++){
   if(value[i]==='=' && /^[0-9a-f]{2}$/i.test(value.slice(i+1,i+3))){
    bytes.push(parseInt(value.slice(i+1,i+3),16));i+=2;
   }else bytes.push(...new TextEncoder().encode(value[i]));
  }
  const charset=/CHARSET=([^;:]+)/i.exec(header)?.[1] || 'utf-8';
  try{value=new TextDecoder(charset).decode(new Uint8Array(bytes));}
  catch{value=new TextDecoder().decode(new Uint8Array(bytes));}
 }
 return unescapeText(value);
}
function phoneNumber(value){
 value=value.trim().replace(/^tel:/i,'').replace(/;.*$/,'');
 if(!/^\+?[\d\s().-]+$/.test(value))return null;
 let digits=value.replace(/\D/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 // Argentina local numbers are accepted only when they include the complete area code.
 if(digits.length===11 && digits.startsWith('0'))digits=digits.slice(1);
 if(digits.length===10 && !value.startsWith('+'))digits='54'+digits;
 if(digits.length<8 || digits.length>15)return null;
 return digits;
}
function identity(phone){return /^549\d{10}$/.test(phone)?'54'+phone.slice(3):phone;}
function parse(text){
 if(typeof text!=='string' || text.length>10*1024*1024)throw new Error('La agenda debe pesar menos de 10 MB.');
 const unfolded=text.replace(/^\uFEFF/,'')
  .replace(/\r\n/g,'\n').replace(/\n[ \t]/g,'');
 // Quoted-printable soft continuations are handled inside each property.
 const rawLines=unfolded.split('\n'),lines=[];
 for(let i=0;i<rawLines.length;i++){
  let line=rawLines[i].replace(/\r$/,'');
  if(/ENCODING=QUOTED-PRINTABLE/i.test(line.split(':')[0])){
   while(line.endsWith('=') && i+1<rawLines.length)line=line.slice(0,-1)+rawLines[++i].replace(/\r$/,'');
  }
  lines.push(line);
 }
 let card=null,cards=0,skipped=0;
 const byPhone=new Map();
 function finish(){
  cards++;
  const name=card.fn || card.n;
  if(!name || !card.phones.length){skipped++;return;}
  for(const phone of card.phones){
   const key=identity(phone),prior=byPhone.get(key);
   if(!prior)byPhone.set(key,{phone,name:name.slice(0,250),conflict:false});
   else if(prior.name!==name.slice(0,250))prior.conflict=true;
  }
 }
 for(const line of lines){
  if(/^BEGIN:VCARD$/i.test(line.trim())){card={fn:'',n:'',phones:[]};continue;}
  if(/^END:VCARD$/i.test(line.trim())){if(card)finish();card=null;continue;}
  if(!card)continue;
  const colon=line.indexOf(':');if(colon<0)continue;
  const header=line.slice(0,colon),value=line.slice(colon+1);
  const prop=header.split(';')[0].split('.').at(-1).toUpperCase();
  if(prop==='FN')card.fn=decodeValue(header,value).replace(/\s+/g,' ').trim();
  else if(prop==='N' && !card.fn){
   const parts=value.split(/(?<!\\);/).map(v=>decodeValue(header,v));
   card.n=[parts[3],parts[1],parts[2],parts[0],parts[4]].filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
  }else if(prop==='TEL'){
   const phone=phoneNumber(decodeValue(header,value));if(phone)card.phones.push(phone);
  }
 }
 if(!cards)throw new Error('El archivo no contiene tarjetas de contactos válidas.');
 const contacts=[...byPhone.values()].filter(c=>!c.conflict).map(({phone,name})=>({phone,name}));
 return {cards,contacts,skipped,conflicts:[...byPhone.values()].filter(c=>c.conflict).length};
}
window.WhatsAppAgenda={parse,phoneNumber};
})();
