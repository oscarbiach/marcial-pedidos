// Lee la foto de una factura o remito de proveedor y devuelve las líneas
// (producto, cantidad, unidad). No toca el stock: la app muestra el
// resultado, Oscar o Joaquín lo revisan y recién ahí se carga el ingreso.
// Solo para usuarios de stock_acceso. Necesita el secreto ANTHROPIC_API_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
};
const result = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

const PROMPT = `Sos un asistente que pasa a datos facturas y remitos de proveedores de una distribuidora mayorista de alimentos de Argentina (fiambres, quesos, lácteos, panificados, aceitunas, salsas).
Leé la imagen y devolvé SOLO las líneas de productos (no subtotales, impuestos, percepciones, fletes ni descuentos).
Para cada línea:
- codigo: el código del producto si figura, si no "".
- descripcion: el texto del producto tal cual figura.
- cantidad: número (usá punto decimal). Si la línea tiene bultos y kilos, poné los kilos en "kilos" y los bultos en "cantidad".
- unidad: "caja", "unidad" o "kg" según cómo esté expresada la cantidad. Si dice bultos/cajas/bt/cj, es "caja".
- kilos: número de kilos si figuran en la línea, si no null.
Además: proveedor (razón social), numero (número de comprobante) y fecha (AAAA-MM-DD) si se leen.
Si algo no se lee bien, ponelo igual y agregá "dudosa": true en esa línea. No inventes líneas.`;

const TOOL = {
  name: "factura",
  description: "Datos leídos de la factura o remito",
  input_schema: {
    type: "object",
    properties: {
      proveedor: { type: "string" },
      numero: { type: "string" },
      fecha: { type: "string" },
      lineas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            codigo: { type: "string" },
            descripcion: { type: "string" },
            cantidad: { type: "number" },
            unidad: { type: "string", enum: ["caja", "unidad", "kg"] },
            kilos: { type: ["number", "null"] },
            dudosa: { type: "boolean" },
          },
          required: ["descripcion", "cantidad", "unidad"],
        },
      },
    },
    required: ["lineas"],
  },
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return result(200, { ok: true });
  if (request.method !== "POST") return result(405, { error: "POST only" });
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return result(401, { error: "Volvé a ingresar con tu PIN." });
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const db = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: auth, error: authError } = await db.auth.getUser(authorization.slice(7));
  if (authError || !auth.user) return result(401, { error: "La sesión venció. Volvé a ingresar." });
  const { data: ok, error: permError } = await db.rpc("stock_es_admin");
  if (permError || ok !== true) return result(403, { error: "Tu cuenta no tiene acceso a Stock." });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return result(503, { error: "Falta configurar la clave para leer facturas (ANTHROPIC_API_KEY)." });

  let body: { imagenes?: { tipo: string; datos: string }[] };
  try { body = await request.json(); } catch { return result(400, { error: "Solicitud inválida." }); }
  const imgs = (body.imagenes || []).filter((i) => i && typeof i.datos === "string" && /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(i.tipo));
  if (!imgs.length || imgs.length > 4) return result(400, { error: "Mandá entre 1 y 4 fotos." });
  if (imgs.some((i) => i.datos.length > 7_000_000)) return result(413, { error: "La foto es muy pesada." });

  const content = [
    ...imgs.map((i) => i.tipo === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: i.tipo, data: i.datos } }
      : { type: "image", source: { type: "base64", media_type: i.tipo, data: i.datos } }),
    { type: "text", text: imgs.length > 1 ? "Son varias fotos de la MISMA factura (páginas). Juntá todas las líneas." : "Leé esta factura." },
  ];
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: Deno.env.get("STOCK_FACTURA_MODEL") || "claude-sonnet-5-5",
        max_tokens: 4096,
        system: PROMPT,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "factura" },
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("anthropic", r.status, JSON.stringify(j).slice(0, 500));
      return result(502, { error: r.status === 401 ? "La clave para leer facturas no es válida." : "No se pudo leer la factura. Probá de nuevo." });
    }
    const uso = (j.content || []).find((c: { type: string }) => c.type === "tool_use");
    if (!uso) return result(502, { error: "No se pudo leer la factura." });
    return result(200, uso.input);
  } catch (e) {
    console.error(e);
    return result(504, { error: "Tardó demasiado. Probá con una foto más nítida o de a una página." });
  }
});
