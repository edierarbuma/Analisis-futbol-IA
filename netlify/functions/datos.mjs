// Entrega los datos guardados a la app. Si son viejos (o se pide "forzar"), los renueva.
import { getStore } from "@netlify/blobs";
import { actualizarTodo } from "../lib/datos.mjs";
import { resumenParaApp } from "../lib/estadisticas.mjs";

const MIN = 60e3;

export default async (req) => {
  const forzar = new URL(req.url).searchParams.get("forzar") === "1";
  const store = getStore("futbol");
  let datos = await store.get("datos", { type: "json" }).catch(() => null);
  const edad = datos ? Date.now() - Date.parse(datos.actualizado) : Infinity;

  if (!datos || edad > 26 * 60 * MIN || (forzar && edad > 15 * MIN)) {
    try {
      datos = await actualizarTodo(datos);
      await store.setJSON("datos", datos);
    } catch (e) {
      if (!datos) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }
  }

  // Estadísticas de remates, córners, paradas... (si hay clave de API-Football)
  const est = await store.get("estadisticas", { type: "json" }).catch(() => null);
  const salida = { ...datos, estadisticas: resumenParaApp(est), conEstadisticas: !!process.env.API_FOOTBALL_KEY };

  return new Response(JSON.stringify(salida), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/datos" };
