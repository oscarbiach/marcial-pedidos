/* Solo consulta: el servidor valida el rol antes de devolver cualquier dato. */
(function(){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dinero=v=>v==null?'—':Number(v).toLocaleString('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:2});
 const fecha=v=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
 async function montar(el,cliente){
  if(!el)return;el.innerHTML='<h4>Bonificaciones por producto</h4><p role="status">Cargando referencias…</p>';
  try{
   const {data,error}=await RepartoRed.pedir(sb.rpc('admin_bonificaciones_cliente',{p_cliente:cliente}));
   if(error)throw error;if(!el.isConnected)return;
   const rows=data?.productos||[];
   el.innerHTML=`<h4>Bonificaciones por producto</h4><p class="adm-sub">Última venta verificable · precios unitarios con IVA</p>${rows.length?`<div class="bc-scroll"><table class="bc-table"><thead><tr><th>Producto</th><th>Bonificación</th><th>Lista con IVA</th><th>Cobrado con IVA</th><th>Respaldo</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.producto)}</b><small>${esc(r.unidad||'')}</small></td><td>${r.estado==='Verificada'?`<b class="bc-percent">${Number(r.porcentaje).toLocaleString('es-AR',{maximumFractionDigits:2})} %</b>`:esc(r.estado)}</td><td>${dinero(r.lista_con_iva)}</td><td>${dinero(r.cobrado_con_iva)}${r.iva!=null?`<small>IVA ${esc(r.iva)} %</small>`:''}</td><td>${fecha(r.fecha)}<small>${esc(r.comprobante||'')}${r.renglon?` · renglón ${esc(r.renglon)}`:''}</small></td></tr>`).join('')}</tbody></table></div>`:'<p>Sin referencia verificada.</p>'}${data?.pendientes_vinculacion?`<p class="adm-sub">${Number(data.pendientes_vinculacion)} renglones pendientes de vincular a productos.</p>`:''}`;
  }catch(e){
   if(!el.isConnected)return;
   el.innerHTML='<h4>Bonificaciones por producto</h4><p role="alert">'+esc(e.code==='42501'?'No tenés permiso para consultar estas referencias.':'No se pudieron cargar las referencias.')+'</p>';
  }
 }
 window.BonificacionesCliente={montar};
})();
