/* Lista de pendientes. Las tarjetas y sus acciones siguen siendo las de Pedidos. */
const TableroPedidos = (() => {
  const dias = { atrasados:'Atrasados', hoy:'Hoy', manana:'Mañana', sinfecha:'Sin fecha', futuro:'Más adelante' };
  const titulo = { ...dias, hoy:'Para hoy', manana:'Para mañana', sinfecha:'Sin fecha de entrega' };
  let vista = 'todos', dia = 'hoy', sinFechaAbierta = false;
  let ultimaLista = '', ultimoFiltro = '';
  const $ = id => document.getElementById(id);
  const animable = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esDestino = d => ['hoy','manana','sinfecha'].includes(d);

  function lista(grupos, buscando) {
    const futuro = grupos.futuro;
    const programados = pedidoPliegueHtml(futuro, {
      claseAviso:'prog-notice futuros', onclick:'toggleProgramados', entregaGrouping:true,
      abierto:buscando || showProgramados, texto:mIco('calendar-clock','ico-sm')+' Más adelante <b>'+futuro.length+'</b>'
    });
    if (vista === 'todos') {
      const abierta = sinFechaAbierta || buscando;
      const bandeja = '<section class="bandeja-sinfecha" data-dia-destino="sinfecha"><button type="button" data-bandeja aria-expanded="'+abierta+'">Sin fecha de entrega <b>'+grupos.sinfecha.length+'</b>'+mIco(abierta?'chevron-up':'chevron-down','ico-sm')+'</button>'+
        (abierta ? '<div class="order-list">'+(Turnos.grupos(grupos.sinfecha,pedidoCardHtml,'pedidos:sinfecha') || '<p>Sin pedidos para esta selección.</p>')+'</div>' : '')+'</section>';
      return bandeja+'<div class="pend-grid tablero-dias">'+['atrasados','hoy','manana'].map(d=>pedidoSectionHtml(titulo[d],grupos[d],esDestino(d)?d:null)).join('')+'</div>'+programados;
    }
    const tabs = Object.keys(dias).filter(d=>d!=='futuro'||grupos[d].length||dia===d).map(d=>
      '<button type="button" data-dia="'+d+'" '+(esDestino(d)?'data-dia-destino="'+d+'" ':'')+'aria-pressed="'+(dia===d)+'">'+dias[d]+' <b>'+grupos[d].length+'</b></button>').join('');
    const turnos = [['manana','Turno mañana'],['tarde','Turno tarde'],['','Sin turno']].map(([t,n])=>'<b data-turno="'+t+'">'+n+'</b>').join('');
    const contenido = dia==='futuro' ? listaPorEntrega(futuro) : Turnos.grupos(grupos[dia],pedidoCardHtml,'pedidos:'+dia);
    return '<div class="tablero-fecha"><div class="tablero-dias-nav" role="group" aria-label="Fecha de entrega">'+tabs+'</div><div class="tablero-turnos">Mover a '+turnos+'</div><div class="order-list tablero-turno-lista">'+(contenido || '<p>Sin pedidos para esta fecha.</p>')+'</div></div>';
  }

  function destino(el,p) {
    if (!el) return null;
    if (vista==='fecha' && !p.retiro && state.who!=='Mateo') {
      const turno=el.closest('#pedidosList [data-turno]');
      if (turno) return turno;
    }
    return el.closest('#pedidosList [data-dia-destino], #pedidosList .order-list[id^="dz-"]');
  }

  function fijos(abrir) {
    const panel=$('fijos');
    if (!panel) return;
    panel.hidden=!abrir;
    $('verFijos').setAttribute('aria-expanded',String(abrir));
  }

  function claveLista() {
    return [vista,dia,sinFechaAbierta,showProgramados,searchQuery,filtroEntregaActual()].join('|');
  }

  function posiciones() {
    const posiciones=new Map();
    if (activeTab!=='pedidos'||!animable()||claveLista()===ultimaLista) return posiciones;
    for (const el of $('pedidosList').querySelectorAll('[data-pid]')) {
      const r=el.getBoundingClientRect();
      if(r.bottom>0 && r.top<innerHeight && r.height) posiciones.set(el.dataset.pid,r);
    }
    return posiciones;
  }

  function actualizar(antes) {
    const root=$('pedidosList');
    for (const el of root.querySelectorAll('.Pendiente .sp-Pendiente,.Pendiente .turno-chip,.Pendiente :is(.oc-chip,.blk-fecha):is(.ent-hoy,.ent-maniana,.ent-sinfecha,.ent-vencida)')) el.remove();
    for (const b of document.querySelectorAll('[data-vista]')) b.setAttribute('aria-pressed',String(b.dataset.vista===vista));
    const filtro=filtroEntregaActual(), retiro=filtro==='retiro';
    $('tab-pedidos').classList.toggle('solo-retiros',retiro);
    const clave=claveLista();
    if (activeTab==='pedidos' && animable() && clave!==ultimaLista) {
      const entrada=retiro && ultimoFiltro!==filtro;
      const origen=document.querySelector('#entregaSwitch:not([hidden]) [data-tipo=retiro]') || $('retiroToggle');
      const centro=origen.getBoundingClientRect();
      const tarjetas=[...root.querySelectorAll(entrada?'.retiro[data-pid]':'[data-pid]')].map(el=>({el,r:el.getBoundingClientRect()})).filter(({r})=>r.height&&r.bottom>0&&r.top<innerHeight);
      if(entrada) tarjetas.sort((a,b)=>Math.hypot(a.r.x-centro.x,a.r.y-centro.y)-Math.hypot(b.r.x-centro.x,b.r.y-centro.y));
      tarjetas.forEach(({el,r},i)=>{
        const prev=antes.get(el.dataset.pid);
        const x=entrada?Math.sign(centro.x-r.x)*13:(prev?prev.x-r.x:0);
        const y=entrada?14:(prev?prev.y-r.y:9);
        if(!entrada&&prev&&Math.abs(x)+Math.abs(y)<1)return;
        el.animate([{opacity:entrada ? .08 : (prev ? 1 : .35),transform:'translate('+x+'px,'+y+'px)'},{opacity:1,transform:'none'}],
          {duration:entrada?1100:320,delay:entrada?180+Math.min(i,4)*145:0,easing:'cubic-bezier(.2,.78,.2,1)',fill:'backwards'});
      });
    }
    if(activeTab==='pedidos'){ultimaLista=clave;ultimoFiltro=filtro;}
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const cab=document.querySelector('body > header') || document.querySelector('header');
    if(cab && window.ResizeObserver)new ResizeObserver(()=>{
      $('tab-pedidos').style.setProperty('--tablero-cab',Math.ceil(cab.getBoundingClientRect().height)+'px');
    }).observe(cab);
  });
  document.addEventListener('pointerdown',e=>{
    if(!e.target.closest('#fijos,#verFijos'))fijos(false);
  });
  document.addEventListener('click',e=>{
    const el=e.target.closest('#tab-pedidos button');
    if (el?.id==='verFijos') {fijos($('fijos').hidden);return;}
    if(!el)return;
    if(el.dataset.vista)vista=el.dataset.vista;
    else if(el.dataset.dia)dia=el.dataset.dia;
    else if(el.hasAttribute('data-bandeja'))sinFechaAbierta=!sinFechaAbierta;
    else return;
    renderPedidos();
    if(el.dataset.dia)$('pedidosList').querySelector('[data-dia="'+dia+'"]')?.focus({preventScroll:true});
    if(el.hasAttribute('data-bandeja'))$('pedidosList').querySelector('[data-bandeja]')?.focus({preventScroll:true});
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape' && !$('fijos')?.hidden){fijos(false);$('verFijos').focus();}
  });
  return {lista,destino,fijos,posiciones,actualizar};
})();
