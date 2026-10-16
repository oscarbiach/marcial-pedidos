/* WhatsApp → fotos de contactos (pedido del usuario, 16/10/2026).
   WhatsApp no entrega las fotos de perfil, así que se cargan a mano desde «Importar → Fotos de contactos»: se elige el contacto y se
   pega una imagen (Ctrl+V, por ejemplo copiada de Google), se la arrastra, se elige un archivo o se pega su enlace.
   La imagen se recorta al centro y se achica a 160×160 (JPEG, unos 10 KB) en el navegador antes de guardarla (función wa_set_photo).
   Guardar dos veces la misma foto deja todo igual, y el botón queda deshabilitado mientras se guarda. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ico = (n, c) => (window.mIco ? mIco(n, c || 'ico-sm') : '');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LADO = 160, MAX_BYTES = 15 * 1024 * 1024;
  const fotos = new Map();
  let ctx = null;          // { DB, titulo(c), avatar(c), alCambiar() } que pasa whatsapp-inbox.js
  const V = { contacto: null, imagen: null, guardando: false, busca: 0, timer: null };

  async function cargar() {
    if (!ctx) return;
    const r = await Promise.resolve().then(() => ctx.DB.fotos()).catch(() => ({ error: true }));
    if (r.error || !Array.isArray(r.data)) return;   // sin la tabla instalada: siguen las iniciales
    fotos.clear(); r.data.forEach(f => fotos.set(f.contact_key, f.image));
  }
  const de = key => fotos.get(key) || null;

  function crear() {
    if ($('wa-fotos')) return $('wa-fotos');
    const o = document.createElement('div');
    o.className = 'overlay wa-carga-ov'; o.id = 'wa-fotos';
    o.innerHTML = `<div class="modal wa-carga-modal wa-fotos-modal" role="dialog" aria-modal="true" aria-labelledby="wa-fotos-t">
      <div class="modal-header"><h2 id="wa-fotos-t">${ico('image', 'ico')} <span>Foto de contacto</span></h2>
        <button type="button" class="close-btn" id="wa-fotos-x" aria-label="Cerrar">${ico('x', 'ico')}</button></div>
      <div class="modal-body">
        <label class="wa-fotos-lbl" for="wa-fotos-q">1. Contacto</label>
        <div id="wa-fotos-elegido" class="wa-fotos-elegido" hidden></div>
        <div id="wa-fotos-buscador"><input id="wa-fotos-q" type="search" class="wa-fotos-input" autocomplete="off" placeholder="Buscar nombre, cliente o teléfono">
          <div id="wa-fotos-res" class="wa-fotos-res" role="listbox" aria-label="Contactos"></div></div>
        <p class="wa-fotos-lbl">2. Foto</p>
        <div id="wa-fotos-zona" class="wa-fotos-zona" tabindex="0" role="button" aria-label="Pegar, arrastrar o elegir una imagen">
          <span id="wa-fotos-prev" class="wa-fotos-prev" aria-hidden="true">${ico('image', 'ico')}</span>
          <span><b>Pegá la imagen con Ctrl + V</b><small>En Google: clic derecho en la imagen → «Copiar imagen». También podés arrastrarla acá o elegir un archivo.</small></span>
        </div>
        <div class="wa-fotos-fila"><input id="wa-fotos-url" type="url" class="wa-fotos-input" placeholder="…o pegá el enlace de la imagen" autocomplete="off">
          <button type="button" class="wa-btn" id="wa-fotos-archivo">${ico('upload')}Elegir archivo</button>
          <input type="file" id="wa-fotos-file" accept="image/*" hidden></div>
        <p id="wa-fotos-msg" class="wa-fotos-msg" role="status" aria-live="polite"></p>
        <div class="wa-fotos-acc"><button type="button" class="wa-btn" id="wa-fotos-quitar" hidden>${ico('trash-2')}Quitar foto</button>
          <span></span><button type="button" class="wa-btn" id="wa-fotos-cancelar">Cancelar</button>
          <button type="button" class="wa-btn wa-btn--prim" id="wa-fotos-guardar" disabled>${ico('check')}Guardar</button></div>
      </div></div>`;
    document.body.appendChild(o);
    $('wa-fotos-x').onclick = $('wa-fotos-cancelar').onclick = cerrar;
    let desdeFondo = false;
    o.addEventListener('mousedown', e => { desdeFondo = e.target === o; });
    o.addEventListener('click', e => { if (e.target === o && desdeFondo) cerrar(); });
    o.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
    $('wa-fotos-q').addEventListener('input', () => { clearTimeout(V.timer); V.timer = setTimeout(buscar, 200); });
    $('wa-fotos-res').addEventListener('click', e => { const b = e.target.closest('[data-key]'); if (b) elegir(V.resultados.find(c => c.contact_key === b.dataset.key)); });
    $('wa-fotos-elegido').addEventListener('click', e => { if (e.target.closest('[data-cambiar]')) elegir(null); });
    $('wa-fotos-zona').addEventListener('click', () => $('wa-fotos-file').click());
    $('wa-fotos-zona').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('wa-fotos-file').click(); } });
    $('wa-fotos-archivo').onclick = () => $('wa-fotos-file').click();
    $('wa-fotos-file').addEventListener('change', e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) usarArchivo(f); });
    $('wa-fotos-url').addEventListener('change', e => { const u = e.target.value.trim(); if (u) usarEnlace(u); });
    const zona = $('wa-fotos-zona');
    zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('sobre'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('sobre'));
    zona.addEventListener('drop', e => {
      e.preventDefault(); zona.classList.remove('sobre');
      const f = [...(e.dataTransfer?.files || [])].find(x => x.type.startsWith('image/'));
      if (f) usarArchivo(f); else { const u = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain'); if (u) usarEnlace(u.trim()); }
    });
    // Pegar en cualquier parte de la ventana: una imagen copiada, o un enlace (salvo que se esté escribiendo en la búsqueda).
    o.addEventListener('paste', e => {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
      if (item) { e.preventDefault(); usarArchivo(item.getAsFile()); return; }
      if (e.target.id === 'wa-fotos-q') return;
      const t = (e.clipboardData?.getData('text') || '').trim();
      if (/^https?:\/\//i.test(t)) { e.preventDefault(); $('wa-fotos-url').value = t; usarEnlace(t); }
    });
    $('wa-fotos-guardar').onclick = () => guardar(V.imagen);
    $('wa-fotos-quitar').onclick = () => { if (confirm('¿Quitar la foto de este contacto? Vuelven a verse las iniciales.')) guardar(null); };
    return o;
  }
  function msg(t, error) { const p = $('wa-fotos-msg'); p.textContent = t || ''; p.classList.toggle('wa-error', !!error); }

  async function buscar() {
    const q = $('wa-fotos-q').value.trim(), n = ++V.busca;
    const { data, error } = await ctx.DB.rpc('wa_contacts_page', { p_query: q, p_client: null, p_offset: 0, p_limit: 8 });
    if (n !== V.busca) return;   // llegó tarde: ya se escribió otra cosa
    if (error) { msg('No se pudieron buscar los contactos.', true); return; }
    V.resultados = data || [];
    $('wa-fotos-res').innerHTML = V.resultados.length ? V.resultados.map(c => `<button type="button" role="option" data-key="${esc(c.contact_key)}">${ctx.avatar(c)}
      <span><b>${esc(ctx.titulo(c))}</b><small>${esc(c.phone_number ? '+' + c.phone_number : '')}${de(c.contact_key) ? ' · ya tiene foto' : ''}</small></span></button>`).join('')
      : '<p class="wa-fotos-vacio">Sin resultados.</p>';
  }
  function elegir(c) {
    V.contacto = c || null;
    $('wa-fotos-buscador').hidden = !!c; $('wa-fotos-elegido').hidden = !c;
    $('wa-fotos-elegido').innerHTML = c ? `${ctx.avatar(c)}<span><b>${esc(ctx.titulo(c))}</b><small>${esc(c.phone_number ? '+' + c.phone_number : '')}</small></span>
      <button type="button" class="wa-btn" data-cambiar>Cambiar</button>` : '';
    $('wa-fotos-quitar').hidden = !(c && de(c.contact_key));
    if (!c) { $('wa-fotos-q').focus(); buscar(); }
    listo();
  }
  function listo() { $('wa-fotos-guardar').disabled = V.guardando || !V.contacto || !V.imagen; }

  // Recorta al centro y achica a 160×160. Devuelve un data URL JPEG.
  function achicar(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const lado = Math.min(img.naturalWidth, img.naturalHeight);
        if (!lado) { reject(new Error('La imagen está vacía.')); return; }
        const cv = document.createElement('canvas'); cv.width = cv.height = LADO;
        const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, LADO, LADO);
        g.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, LADO, LADO);
        resolve(cv.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen. Probá con otra (JPG o PNG).')); };
      img.src = url;
    });
  }
  async function usarArchivo(f) {
    if (!f || !f.type.startsWith('image/')) { msg('Eso no es una imagen.', true); return; }
    if (f.size > MAX_BYTES) { msg('La imagen pesa más de 15 MB: probá con una más chica.', true); return; }
    try { mostrar(await achicar(f)); } catch (e) { msg(e.message, true); }
  }
  async function usarEnlace(u) {
    if (!/^https?:\/\//i.test(u)) { msg('El enlace tiene que empezar con http.', true); return; }
    msg('Trayendo la imagen…');
    try {
      const r = await fetch(u, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!r.ok) throw new Error();
      const b = await r.blob(); if (!b.type.startsWith('image/')) throw new Error();
      await usarArchivo(b);
    } catch (e) {
      msg('Ese sitio no deja traer la imagen por el enlace. En Google, hacé clic derecho en la imagen → «Copiar imagen» y pegala acá con Ctrl + V.', true);
    }
  }
  function mostrar(dataUrl) {
    V.imagen = dataUrl;
    $('wa-fotos-prev').innerHTML = `<img src="${esc(dataUrl)}" alt="Vista previa de la foto">`;
    $('wa-fotos-zona').classList.add('con-foto');
    msg(V.contacto ? 'Así va a verse. Tocá «Guardar».' : 'Ahora elegí el contacto.');
    listo();
  }
  async function guardar(imagen) {
    if (V.guardando || !V.contacto) return;
    V.guardando = true; listo(); $('wa-fotos-quitar').disabled = true;
    msg(imagen ? 'Guardando…' : 'Quitando…');
    try {
      const key = V.contacto.contact_key;
      const { error } = await ctx.DB.rpc('wa_set_photo', { p_contact: key, p_image: imagen });
      if (error) throw new Error(error.code === 'PGRST202' ? 'Falta instalar las fotos de contactos en Supabase.' : error.code === '42501' ? 'Tu cuenta no puede cambiar fotos.' : (error.message || 'No se pudo guardar.'));
      if (imagen) fotos.set(key, imagen); else fotos.delete(key);
      ctx.alCambiar();
      cerrar();
      ctx.aviso(imagen ? 'Foto guardada.' : 'Foto quitada.');
    } catch (e) { msg(e.message, true); }
    finally { V.guardando = false; listo(); const q = $('wa-fotos-quitar'); if (q) q.disabled = false; }
  }
  function abrir(contacto) {
    const o = crear();
    V.imagen = null; $('wa-fotos-url').value = ''; $('wa-fotos-q').value = ''; $('wa-fotos-res').innerHTML = '';
    $('wa-fotos-prev').innerHTML = ico('image', 'ico'); $('wa-fotos-zona').classList.remove('con-foto'); msg('');
    o.classList.add('open');
    elegir(contacto || null);
    if (contacto) $('wa-fotos-zona').focus();
  }
  function cerrar() { const o = $('wa-fotos'); if (o) o.classList.remove('open'); }

  window.WhatsAppFotos = { init: c => { ctx = c; }, cargar, de, abrir, cerrar };
})();
