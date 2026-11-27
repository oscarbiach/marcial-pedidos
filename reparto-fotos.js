/* Visor compartido: una galería por producto, sin salir de su preparación/remito. */
(function(){
 'use strict';
 function abrir({parent,clase,fotos,seleccionada,origen,titulo,onClose,revisar=false,retirado=false}){
  const lista=fotos.filter(f=>f.url);if(!lista.length)return;
  let index=Math.max(0,lista.findIndex(f=>f.path===seleccionada)),gesto=null,ignorarClick=false;
  const pointers=new Set(),v=document.createElement('div');
  v.className=clase+' rf-viewer';v.tabIndex=-1;v.setAttribute('role','dialog');v.setAttribute('aria-modal','true');v.setAttribute('aria-label',titulo||'Fotos del producto');
  v.innerHTML='<img draggable="false"><button class="rf-close" aria-label="Cerrar foto">✕</button><button class="rf-prev" aria-label="Foto anterior">‹</button><button class="rf-next" aria-label="Foto siguiente">›</button><span class="rf-count" role="status" aria-live="polite"></span>';
  if(revisar){const aviso=document.createElement('p');aviso.className='rf-edit-warning';aviso.setAttribute('role','status');aviso.textContent=retirado?'Este renglón se retiró al editar el pedido. Su preparación se conserva para revisión.':'El pedido fue editado. Revisá que esta foto y el peso sigan correspondiendo a lo que se va a enviar.';v.appendChild(aviso);}
  const img=v.querySelector('img'),close=v.querySelector('.rf-close'),prev=v.querySelector('.rf-prev'),next=v.querySelector('.rf-next'),count=v.querySelector('.rf-count');
  prev.hidden=next.hidden=count.hidden=lista.length<2;
  function pintar(direction=0){
   img.src=lista[index].url;img.alt=(titulo||'Foto del producto')+' · '+(index+1)+'/'+lista.length;
   count.textContent=(index+1)+'/'+lista.length;
   if(direction&&!matchMedia('(prefers-reduced-motion: reduce)').matches){img.getAnimations().forEach(a=>a.cancel());img.animate([{opacity:.45,transform:`translateX(${direction*18}px)`},{opacity:1,transform:'translateX(0)'}],{duration:160,easing:'ease-out'});}
  }
  function mover(direction){if(lista.length<2)return;index=(index+direction+lista.length)%lista.length;pintar(direction);}
  function cerrar(){v.remove();onClose?.();if(origen?.isConnected)origen.focus({preventScroll:true});else parent.querySelector('button')?.focus({preventScroll:true});}
  v.addEventListener('click',e=>{
   e.stopPropagation();if(ignorarClick){ignorarClick=false;return;}
   if(e.target.closest('.rf-close'))cerrar();
   else if(e.target.closest('.rf-prev'))mover(-1);
   else if(e.target.closest('.rf-next'))mover(1);
   else if(e.target===v&&gesto?.fondo)cerrar();
  });
  v.addEventListener('keydown',e=>{
   if(!['Escape','ArrowLeft','ArrowRight'].includes(e.key))return;
   e.preventDefault();e.stopPropagation();if(e.key==='Escape')cerrar();else mover(e.key==='ArrowLeft'?-1:1);
  });
  v.addEventListener('pointerdown',e=>{
   e.stopPropagation();ignorarClick=false;pointers.add(e.pointerId);
   if(pointers.size>1){gesto=null;return;}
   gesto={id:e.pointerId,x:e.clientX,y:e.clientY,fondo:e.target===v,boton:!!e.target.closest('button')};
   if(!gesto.boton)v.setPointerCapture(e.pointerId);
  });
  v.addEventListener('pointerup',e=>{
   e.stopPropagation();pointers.delete(e.pointerId);if(!gesto||gesto.id!==e.pointerId)return;
   const dx=e.clientX-gesto.x,dy=e.clientY-gesto.y;
   if(!gesto.boton&&Math.abs(dx)>=48&&Math.abs(dx)>Math.abs(dy)*1.3){ignorarClick=true;gesto.fondo=false;mover(dx<0?1:-1);}
   else if(Math.abs(dx)>12||Math.abs(dy)>12){ignorarClick=true;gesto.fondo=false;}
  });
  v.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);gesto=null;ignorarClick=true;});
  parent.appendChild(v);pintar();close.focus();return v;
 }
 function rutasRetiradas(r){
  const x=r.preparacion;
  return [...new Set([x.foto,...(x.fotos_extra||[]),x.sustituto_foto,...(x.sustituto_fotos_extra||[])].filter(Boolean))];
 }
 function retirados(filas,fotos,esc){
  if(!filas?.length)return '';
  return '<section class="rf-retirados"><h4>Retirados · fuera del envío</h4>'+filas.map(r=>{
   const x=r.preparacion,peso=n=>Number(n)>0?' · '+Number(n).toLocaleString('es-AR')+' kg':'';
   const galeria=rutasRetiradas(r).map((path,i)=>{
    const url=fotos.get(path)?.url;
    return url?`<button type="button" data-rf-item="${esc(r.item_id)}" data-path="${esc(path)}" aria-label="Ver foto ${i+1} de ${esc(r.producto)}"><img src="${esc(url)}" alt=""></button>`:'';
   }).join('');
   return `<article><b>! ${esc(r.producto)}</b>${peso(x.peso)}${x.sustituto?' · Sustituto: '+esc(x.sustituto)+peso(x.sustituto_peso):''}<div>${galeria}</div></article>`;
  }).join('')+'</section>';
 }
 function verRetirado(e,filas,fotos,clase,onClose){
  const boton=e.target.closest('[data-rf-item]');
  if(!boton)return false;
  const r=filas?.find(f=>String(f.item_id)===boton.dataset.rfItem);
  if(r)abrir({parent:e.currentTarget,clase,titulo:r.producto,seleccionada:boton.dataset.path,origen:boton,
   fotos:rutasRetiradas(r).map(path=>({path,url:fotos.get(path)?.url})),revisar:true,retirado:true,onClose});
  return true;
 }
 window.RepartoFotos={abrir,rutasRetiradas,retirados,verRetirado};
})();
