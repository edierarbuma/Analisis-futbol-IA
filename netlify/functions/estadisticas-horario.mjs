// Cada hora descarga un poco más de estadísticas (remates, córners, paradas, tarjetas...).
// Así se respeta el límite del plan de API-Football sin perder partidos.
import { getStore } from "@netlify/blobs";
import { avanzarEstadisticas } from "../lib/estadisticas.mjs";

export default async () => {
  if (!process.env.API_FOOTBALL_KEY) return;
  const store = getStore("futbol");
  const anterior = await store.get("estadisticas", { type: "json" }).catch(() => null);
  const nuevo = await avanzarEstadisticas(anterior);
  await store.setJSON("estadisticas", nuevo);
  console.log("Estadísticas: pedidos usados hoy", nuevo.cuota.usadas);
};

export const config = { schedule: "20 * * * *" };
