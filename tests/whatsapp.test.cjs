/* Local mocked integration checks; never sends real WhatsApp messages. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),path=require('node:path');
const base=path.resolve(__dirname,'..');
const shared=fs.readFileSync(path.join(base,'supabase/functions/_shared/whatsapp.js'),'utf8').replace(/^export /gm,'');
function context(extra={}){
  const c={crypto:crypto.webcrypto,TextEncoder,TextDecoder,Uint8Array,Date,console:{error(){}},AbortSignal,Response,Request,...extra};
  vm.createContext(c);new vm.Script(shared).runInContext(c);return c;
}
const phone='340539642484757', personal='5493421234567';
function message(id='m1'){return {id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',from:personal,text:{body:'Necesito papas'}};}
async function main(){
 const c=context();
 const inbound=c.normalizeMessage(message(),{contact_name:'Cliente'},phone,'whatsapp.message.received');
 assert.equal(inbound.phone_number,personal);assert.equal(inbound.direction,'inbound');
 const echo=c.normalizeWebhook({entry:[{changes:[{value:{metadata:{phone_number_id:phone},message_echoes:[
   {...message(),from:'5493426288271',to:personal}]}}]}]},'',phone);
 assert.equal(echo[0].phone_number,personal);assert.equal(echo[0].origin,'business_app');assert.equal(echo[0].direction,'outbound');
 const bsuid=c.normalizeMessage({...message(),from:undefined,from_user_id:'US.123'},{},phone,'whatsapp.message.received');
 assert.equal(bsuid.phone_number,null);assert.equal(bsuid.contact_key,phone+':US.123');
 const unicode=new TextEncoder().encode('{"mensaje":"á ñ 🍔"}'),secret='fixture-secret';
 const signature=crypto.createHmac('sha256',secret).update(unicode).digest('hex');
 assert.equal(await c.verifySignature(unicode,signature,secret),true);
 assert.equal(await c.verifySignature(new TextEncoder().encode('altered'),signature,secret),false);
 assert.equal(await c.verifySignature(unicode,null,secret),false);
 assert.equal(c.normalizeWebhook({batch:true,data:[{phone_number_id:phone,message:message()},{phone_number_id:phone,message:message('m2')}]},'whatsapp.message.received',phone).length,2);
 assert.throws(()=>c.normalizeWebhook({phone_number_id:'other',message:message()},'whatsapp.message.received',phone));
 const status=c.normalizeWebhook({phone_number_id:phone,message:{id:'m1',timestamp:'1730093000'}},'whatsapp.message.read',phone)[0];
 assert.equal(status.status_only,true);assert.equal(status.occurred_at,undefined);
 const old=Date.now()-25*3600000;
 for(const caseName of ['no-auth','no-access','no-send','expired','send','rejected','timeout']){
  let calls=0,requestRow=null,saved=[],permissions={read:true,send:true,manage:false};
  if(caseName==='no-access')permissions.read=false;if(caseName==='no-send')permissions.send=false;
  const contact={contact_key:inbound.contact_key,phone_number_id:phone,phone_number:personal,last_inbound_at:new Date(caseName==='expired'?old:Date.now()).toISOString()};
  function chain(table){
   const q={op:null,value:null,select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},
    insert(value){q.op='insert';q.value=value;return q;},update(value){q.op='update';q.value=value;return q;},
    single(){return Promise.resolve({data:table==='whatsapp_contacts'?contact:requestRow,error:null});},
    maybeSingle(){return q.single();},
    then(resolve,reject){let res;
      if(table==='whatsapp_send_requests' && q.op==='insert'){
        if(requestRow)res={error:{code:'23505'}};else{requestRow={...q.value,state:'processing'};res={error:null};}
      }else if(table==='whatsapp_send_requests' && q.op==='update'){Object.assign(requestRow,q.value);res={error:null};}
      else res={data:null,error:null};
      return Promise.resolve(res).then(resolve,reject);
    }};return q;
  }
  const userDb={auth:{getUser:async()=>caseName==='no-auth'?{data:{},error:{}}:{data:{user:{id:'operator'}},error:null}},
   rpc:async()=>({data:permissions,error:null})};
  const db={from:chain,rpc:async(name,args)=>{saved.push(...args.p_events);return {data:args.p_events.length,error:null};}};
  const apiContext=context({createClient:(url,key)=>key==='anon'?userDb:db,
    Deno:{env:{get:k=>({SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_ANON_KEY:'anon',
      SUPABASE_SERVICE_ROLE_KEY:'service',KAPSO_PHONE_NUMBER_ID:phone,KAPSO_API_KEY:'not-public'})[k]},serve:handler=>apiContext.handler=handler},
    fetch:async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.to,personal);
      assert.equal(body.biz_opaque_callback_data,'12345678-1234-1234-1234-123456789abc');
      if(caseName==='timeout')throw new TypeError('network failed');
      if(caseName==='rejected')return new Response(JSON.stringify({error:{message:'fixture rejection',code:131047}}),{status:400});
      return new Response(JSON.stringify({messages:[{id:'sent-message'}]}),{status:200});
    }});
  const source=fs.readFileSync(path.join(base,'supabase/functions/kapso-api/index.ts'),'utf8').replace(/^import .*;\n/gm,'');
  new vm.Script(source).runInContext(apiContext);
  const payload={action:'send',contact_key:inbound.contact_key,content:'Hola!',request_id:'12345678-1234-1234-1234-123456789abc'};
  const req=()=>new Request('https://fixture/api',{method:'POST',headers:{authorization:'Bearer user-token','content-type':'application/json'},body:JSON.stringify(payload)});
  const response=await apiContext.handler(req());
  const expected={'no-auth':401,'no-access':403,'no-send':403,expired:409,send:200,rejected:422,timeout:502}[caseName];
  assert.equal(response.status,expected,caseName);
  if(['no-auth','no-access','no-send','expired'].includes(caseName))assert.equal(calls,0,caseName);
  else{
    assert.equal(calls,1);await apiContext.handler(req());assert.equal(calls,1,'same request must not send twice');
    if(caseName==='send'){assert.equal(saved.length,1);assert.equal(requestRow.state,'sent');}
    if(caseName==='timeout')assert.equal(requestRow.state,'uncertain');
  }
 }
 // Parse every changed JS/Edge file and the app inline script, without executing app/network calls.
 for(const f of ['whatsapp-inbox.js','seguimiento-clientes-ui.js','sw.js','supabase/functions/kapso-webhook/index.ts','supabase/functions/kapso-api/index.ts']){
  new vm.Script(fs.readFileSync(path.join(base,f),'utf8').replace(/^import .*;\n/gm,''));
 }
 const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
 for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
 assert.ok(html.includes('id="tab-whatsapp"'));assert.ok(html.includes('whatsapp-inbox.js'));
 assert.ok(!html.includes('not-public'));assert.ok(!fs.readFileSync(path.join(base,'whatsapp-inbox.js'),'utf8').includes('KAPSO_API_KEY'));
 console.log('Passed: HMAC, batches, Business App echoes, BSUID, status parsing, access, reply window, send idempotency/ambiguity, JS syntax.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

{
 const assertAgenda=require('node:assert/strict'), vmAgenda=require('node:vm'), fsAgenda=require('node:fs');
 const sandboxAgenda={window:{},TextEncoder,TextDecoder};
 vmAgenda.runInNewContext(fsAgenda.readFileSync('whatsapp-agenda.js','utf8'),sandboxAgenda);
 const parseAgenda=sandboxAgenda.window.WhatsAppAgenda.parse;
 const sampleAgenda='BEGIN:VCARD\r\nVERSION:3.0\r\nFN:María\\, Pizzería\r\nTEL;TYPE=CELL:+54 9 342 555-0001\r\nEND:VCARD\r\nBEGIN:VCARD\r\nFN:Nombre distinto\r\nTEL:543425550001\r\nEND:VCARD\r\nBEGIN:VCARD\r\nN:Apellido;Nombre;;;\r\nTEL:3425550002\r\nEND:VCARD';
 const parsedAgenda=parseAgenda(sampleAgenda);
 assertAgenda.equal(parsedAgenda.cards,3);
 assertAgenda.equal(parsedAgenda.conflicts,1);
 assertAgenda.equal(parsedAgenda.contacts.length,1);
 assertAgenda.equal(parsedAgenda.contacts[0].name,'Nombre Apellido');
 assertAgenda.equal(parsedAgenda.contacts[0].phone,'543425550002');
 const foldedAgenda=parseAgenda('BEGIN:VCARD\nFN:Pizzería\n  Marcial\nTEL:+393510000001\nEND:VCARD');
 assertAgenda.equal(foldedAgenda.contacts[0].name,'Pizzería Marcial');
 assertAgenda.equal(foldedAgenda.contacts[0].phone,'393510000001');
 const qpAgenda=parseAgenda('BEGIN:VCARD\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Mar=C3=AD=\na\nTEL:005493425550003\nEND:VCARD');
 assertAgenda.equal(qpAgenda.contacts[0].name,'María');
 assertAgenda.equal(qpAgenda.contacts[0].phone,'5493425550003');
 assertAgenda.equal(sandboxAgenda.window.WhatsAppAgenda.phoneNumber('3425550001 ext 9'),null);
 assertAgenda.throws(()=>parseAgenda('not a vCard'));
 console.log('Passed: vCard names, UTF-8, folding, quoted-printable, phone formats, conflicts.');
}

new (require('node:vm').Script)(require('node:fs').readFileSync('whatsapp-client-review.js','utf8'));
console.log('Passed: client link review JS syntax.');
