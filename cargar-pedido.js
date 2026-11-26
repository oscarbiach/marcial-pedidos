function destacarProducto(row) {
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    row.classList.add('latido');
    const flash=row.animate([{backgroundColor:'#9fdfcd',transform:'translateX(6px)'},{backgroundColor:'#e0f5ee',offset:.6},{backgroundColor:'transparent',transform:'none'}], {duration:680,easing:'ease-out'});
    flash.onfinish=()=>row.classList.remove('latido');
  }
}
function movimientoPC(){return !esMobile() && (!matchMedia('(prefers-reduced-motion:reduce)').matches)}
function animarLista(lista,cambiar){
  if(!movimientoPC()){cambiar();return}
  const anterior=lista.getBoundingClientRect().height;
  const ultimaFila=lista.lastElementChild;
  lista.getAnimations().forEach(a=>a.cancel());
  cambiar();
  const alto=lista.getBoundingClientRect().height;
  if(alto===anterior)return;
  const nuevaFila=ultimaFila!==lista.lastElementChild && lista.lastElementChild && alto>anterior;
  const duracion=nuevaFila?320:240;
  const ritmo=nuevaFila?'cubic-bezier(.35,0,.25,1)':'cubic-bezier(.22,.68,.18,1)';
  const anim=lista.animate([{height:anterior+'px',overflow:'clip'},{height:alto+'px',overflow:'clip'}],
    {duration:duracion,easing:ritmo});
  if(nuevaFila){
    lista.lastElementChild.animate([{opacity:0},{opacity:1}],{duration:duracion,easing:ritmo});
  }
  const finalizar=()=>anim.cancel();
  lista.addEventListener('focusin',finalizar,{once:true});
  anim.finished.catch(()=>{}).finally(()=>lista.removeEventListener('focusin',finalizar));
}
document.getElementById('picker').addEventListener('click',event=>{
  if(event.target.closest('.pk-teclado button')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    document.getElementById('pkNum').animate([{transform:'translateY(8px) scale(.88)',color:'#13816f'},{transform:'none'}],{duration:260,easing:'ease-out'});
  }
});
document.getElementById('toast').setAttribute('role','status');
function actualizarCorte(check){
  const row=check.closest('.item-row');
  row.querySelector('.sincuero-input').checked=false;
  updateBoxHint(row);
  animarCorte(row);
  if(check.checked && check.closest('label').hidden)row.querySelector('.cuero-pc').focus();
}
function animarCorte(row){
  if(!movimientoPC())return;
  const control=row.querySelector('.corte');
  control.animate([{opacity:.45,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:190,easing:'ease-out'});
}
function elegirCuero(select){
  const row=select.closest('.item-row');
  const pieza=select.value==='pieza';
  row.querySelector('.fetear-input').checked=!pieza;
  row.querySelector('.sincuero-input').checked=select.value==='sin';
  updateBoxHint(row);
  animarCorte(row);
  if(pieza)row.querySelector('.fetear-input').focus();
}
const fechaInput=document.getElementById('n_fecha'), calendario=document.getElementById('almanaque'), fechaBoton=document.getElementById('fechaPC');
let mesVisible;
function claveFecha(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function pintarFecha(animar){
  const valor=fechaInput.value, texto=document.getElementById('fechaTexto');
  texto.replaceChildren();
  const etiqueta=valor?diaCorto(valor):'Fecha';
  const cel=document.getElementById('fechaCel');if(cel){cel.textContent=etiqueta;cel.classList.toggle('vacia',!valor)}
  document.querySelectorAll('.fecha-rapida [data-rap]').forEach(b=>b.setAttribute('aria-pressed',String(!!valor&&valor===fechaEn(+b.dataset.rap))));
  fechaBoton.setAttribute('aria-label','Elegir fecha'+(valor?' · '+etiqueta:''));
  for(const [i,letra] of [...etiqueta].entries()){
    const span=document.createElement('span');span.textContent=letra===' '?' ':letra;texto.append(span);
    if(valor && animar && movimientoPC() && /[0-9]/.test(letra))span.animate([{transform:'translateY(100%)',opacity:.2},{transform:'none',opacity:1}],{duration:220,delay:i*24,fill:'backwards',easing:'ease-out'});
  }
}
function dibujarMes(){
  const y=mesVisible.getFullYear(), m=mesVisible.getMonth(), grid=document.getElementById('dias');
  grid.innerHTML=['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(x=>'<small>'+x+'</small>').join('');
  document.getElementById('mesNombre').textContent=mesVisible.toLocaleDateString('es-AR',{month:'long',year:'numeric'});
  const inicio=(new Date(y,m,1).getDay()+6)%7;
  for(let i=0;i<inicio;i++)grid.append(document.createElement('span'));
  for(let n=1;n<=new Date(y,m+1,0).getDate();n++){
    const dia=document.createElement('button'), fecha=claveFecha(new Date(y,m,n));dia.type='button';dia.textContent=n;dia.dataset.fecha=fecha;
    dia.setAttribute('aria-label',fecha.split('-').reverse().join('/'));dia.setAttribute('aria-pressed',String(fecha===fechaInput.value));
    if(fecha===claveFecha(new Date()))dia.setAttribute('aria-current','date');
    grid.append(dia);
  }
}
function cerrarFecha(){calendario.hidden=true;fechaBoton.setAttribute('aria-expanded','false')}
function asignarFecha(v){fechaInput.value=v;fechaInput.dispatchEvent(new Event('change',{bubbles:true}));cerrarFecha();fechaBoton.focus()}
fechaInput.addEventListener('change',()=>pintarFecha(true));
fechaBoton.onclick=()=>{
 if(!calendario.hidden){cerrarFecha();return}
 const d=fechaInput.value?new Date(fechaInput.value+'T12:00:00'):new Date();
 mesVisible=new Date(d.getFullYear(),d.getMonth(),1);dibujarMes();calendario.hidden=false;fechaBoton.setAttribute('aria-expanded','true');
 calendario.style.top='';calendario.style.bottom='';
 if(calendario.getBoundingClientRect().top<4){calendario.style.top='calc(100% + 5px)';calendario.style.bottom='auto'}
 if(movimientoPC())calendario.animate([{opacity:0,transform:'translateY(6px) scale(.98)'},{opacity:1,transform:'none'}],{duration:200,easing:'ease-out'});
 (calendario.querySelector('[aria-pressed=true]')||calendario.querySelector('[aria-current=date]')||document.getElementById('mesSig')).focus({preventScroll:true});
};
for(const [id,salto] of [['mesAnt',-1],['mesSig',1]])document.getElementById(id).onclick=()=>{mesVisible.setMonth(mesVisible.getMonth()+salto);dibujarMes()};
document.getElementById('dias').onclick=e=>{if(e.target.dataset.fecha)asignarFecha(e.target.dataset.fecha)};
document.getElementById('quitarFecha').onclick=()=>asignarFecha('');
document.addEventListener('pointerdown',e=>{if(!e.target.closest('.fecha-wrap'))cerrarFecha()});
document.addEventListener('focusin',e=>{if(!e.target.closest('.fecha-wrap'))cerrarFecha()});
calendario.onkeydown=e=>{if(e.key==='Escape'){cerrarFecha();fechaBoton.focus()}};
/* [Opus] Fecha con día de la semana y atajos Hoy / Mañana */
function diaCorto(v){const d=new Date(v+'T12:00:00');return ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()]+' '+d.getDate()+'/'+(d.getMonth()+1)}
function fechaEn(n){const d=new Date();d.setDate(d.getDate()+n);return claveFecha(d)}
document.querySelector('.fecha-rapida').addEventListener('click',e=>{
  const b=e.target.closest('[data-rap]');if(!b)return;
  fechaInput.value=fechaEn(+b.dataset.rap);fechaInput.dispatchEvent(new Event('change',{bubbles:true}));cerrarFecha();
});

/* [Opus] «Suele pedir»: se suma desde el panel de la derecha */
function filasCargar(){return [...document.querySelectorAll('#cargarItemRows .item-row')]}
function filaDeProducto(prod){const k=String(prod).trim().toLowerCase();return filasCargar().find(r=>r.querySelector('.ac-input').value.trim().toLowerCase()===k)}
function sueleHtml(habs){
  const faltan=habs.filter(h=>!filaDeProducto(h.prod)).length;
  return '<div class="hc-sub hc-sub-suele"><span>Suele pedir</span>'+(faltan>1?'<button type="button" class="hc-todo" data-todo="1">Agregar todo</button>':'')+'</div><div class="hc-habs">'+
    habs.map((h,i)=>filaDeProducto(h.prod)
      ?'<div class="hc-hab ya" data-i="'+i+'"><span class="hh-mas">'+mIco('check')+'</span><span class="hh-q">'+h.qty+'</span><span class="hh-n">'+esc(h.prod)+'</span><span class="hh-v">'+h.veces+'×</span></div>'
      :'<button type="button" class="hc-hab" data-i="'+i+'" title="Sumar al pedido"><span class="hh-mas">'+mIco('plus')+'</span><span class="hh-q">'+h.qty+'</span><span class="hh-n">'+esc(h.prod)+'</span><span class="hh-v">'+h.veces+'×</span></button>').join('')+'</div>';
}
function llenarFila(row,it){
  row.querySelector('.ac-input').value=it.prod;
  row.querySelector('.qty-input').value=it.qty;
  row.querySelector('.fetear-input').checked=!!it.fetear;
  row.querySelector('.sincuero-input').checked=!!it.sinCuero;
  const pi=prodInfo(it.prod), mi=medidaDe(pi,it.fetear,it.unidades);
  row.dataset.unidades=it.unidades&&pi&&mi!==pi.u?mi:'';
  updateBoxHint(row);actualizarResumenFila(row);
}
function sumarHabitual(h){
  if(!h || filaDeProducto(h.prod))return null;
  const it={prod:h.item.prod,qty:h.item.qty,fetear:h.item.fetear,sinCuero:h.item.sinCuero,unidades:h.item.unidades};
  // Si hay un renglón vacío (el que deja «Agregar producto»), se usa ese.
  const vacia=filasCargar().find(r=>!r.querySelector('.ac-input').value.trim());
  let row;
  if(vacia){row=vacia;llenarFila(row,it)}
  else if(filasCargar().length>=20){toast('Máximo 20 productos por pedido');return null}
  else{addItemRowWith('cargar',it);row=filasCargar().pop()}
  if(movimientoPC()&&row)row.animate([{backgroundColor:'#d4ece8'},{backgroundColor:'transparent'}],{duration:900,easing:'ease-out'});
  return it;
}
document.getElementById('histCli').addEventListener('click',e=>{
  const box=document.getElementById('histCli'), habs=box._habs||[];
  const todo=e.target.closest('[data-todo]'), uno=e.target.closest('button.hc-hab');
  if(!todo&&!uno)return;
  const sumados=(todo?habs:[habs[+uno.dataset.i]]).map(sumarHabitual).filter(Boolean);
  if(!sumados.length)return;
  actualizarHistCliente();
  // El que se sumó pasa a tilde con un pequeño rebote.
  if(movimientoPC())box.querySelectorAll('.hc-hab.ya .hh-mas').forEach(m=>{
    const i=+m.closest('.hc-hab').dataset.i;
    if(sumados.some(s=>s.prod===habs[i].item.prod))m.animate([{transform:'scale(.4)'},{transform:'scale(1.15)'},{transform:'none'}],{duration:380,easing:'ease-out'});
  });
  toast(sumados.length>1?'Agregado lo que suele pedir':'Agregado: '+sumados[0].prod);
});
// Si se borra o cambia un renglón, el panel vuelve a ofrecer ese producto.
{
  const filas=document.getElementById('cargarItemRows');let t;
  const refrescar=()=>{clearTimeout(t);t=setTimeout(()=>{if(!document.getElementById('histCli').hidden)actualizarHistCliente()},120)};
  filas.addEventListener('input',refrescar);
  new MutationObserver(refrescar).observe(filas,{childList:true});
}

function abrirExtrasCarga(prefix, open) {
  const boton=document.getElementById(prefix+'_extrasBtn');
  boton.setAttribute('aria-expanded',String(open));
  boton.innerHTML='<span>Dirección y observación</span>'+mIco(open?'chevron-up':'chevron-down','ico-sm');
  document.getElementById(prefix+'_extras').classList.toggle('open',open);
  chipCarga(prefix);
}
function chipCarga(prefix){
  const hayDatos=['direccion','notas'].some(campo=>document.getElementById(prefix+'_'+campo).value.trim());
  document.getElementById(prefix+'_extrasBtn').classList.toggle('cargado',hayDatos);
}
let reciboTimer;
function mostrarReciboCarga(p){
  const recibo=document.getElementById('reciboCarga');
  document.getElementById('reciboDetalle').textContent=p.cliente+' · '+p.items.length+(p.items.length===1?' producto':' productos');
  recibo.hidden=false;
  clearTimeout(reciboTimer);
  reciboTimer=setTimeout(()=>{recibo.hidden=true},2600);
}
