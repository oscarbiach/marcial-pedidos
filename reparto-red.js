/* Acota cada espera; nunca reenvía automáticamente una escritura. */
(function () {
  'use strict';
  async function pedir(solicitud, limite = 20000) {
    const controller = new AbortController();
    let timer;
    try {
      const tarea = solicitud?.abortSignal ? solicitud.abortSignal(controller.signal) : solicitud;
      return await Promise.race([
        Promise.resolve(tarea),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error('La respuesta demoró demasiado. Actualizando el estado; si no aparece el cambio, reintentá.');
            error.code = 'REPARTO_TIMEOUT';
            reject(error);
            controller.abort();
          }, limite);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  window.RepartoRed = { pedir };
})();
