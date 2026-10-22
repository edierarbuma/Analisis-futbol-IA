// Estadísticas por partido (remates, córners, paradas, tarjetas...) desde API-Football.
// Se descargan poco a poco para respetar el límite diario del plan.

const BASE = "https://v3.football.api-sports.io";

// Códigos de La Pizarra -> id de liga en API-Football
export const LIGAS_AF = { PL: 39, PD: 140, SA: 135, BL1: 78, FL1: 61, CL: 2, BSA: 71, CO: 239 };

// Orden fijo de las estadísticas guardadas
export const ST = ["tiros", "aPuerta", "corners", "paradas", "faltas", "amarillas", "rojas", "offside", "posesion", "xg"];
const TIPOS = {
  "Total Shots": "tiros", "Shots on Goal": "aPuerta", "Corner Kicks": "corners",
  "Goalkeeper Saves": "paradas", "Fouls": "faltas", "Yellow Cards": "amarillas",
  "Red Cards": "rojas", "Offsides": "offside", "Ball Possession": "posesion", "expected_goals": "xg",
};

export function temporada(codigo, fecha = new Date()) {
  const y = fecha.getUTCFullYear(), m = fecha.getUTCMonth() + 1;
  if (codigo === "BSA" || codigo === "CO") return y;  // calendario anual
  return m >= 7 ? y : y - 1;               // temporada europea
}

function valor(v, clave) {
  if (v == null) return clave === "xg" || clave === "posesion" ? null : 0;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

export function filaDePartido(fx) {
  const est = fx.statistics || [];
  if (est.length < 2) return null;
  const idH = fx.teams?.home?.id;
  const porEquipo = (bloque) => {
    const r = Object.fromEntries(ST.map((k) => [k, null]));
    for (const s of bloque.statistics || []) {
      const k = TIPOS[s.type];
      if (k) r[k] = valor(s.value, k);
    }
    return ST.map((k) => r[k]);
  };
  const bH = est.find((b) => b.team?.id === idH) || est[0];
  const bA = est.find((b) => b !== bH);
  const h = porEquipo(bH), a = porEquipo(bA);
  if (h[0] == null && h[1] == null && h[2] == null) return null;
  return [String(fx.fixture?.date || "").slice(0, 10), fx.teams.home.name, fx.teams.away.name, h, a];
}

async function pedir(ruta, clave) {
  const r = await fetch(BASE + ruta, { headers: { "x-apisports-key": clave } });
  if (!r.ok) throw new Error(`API-Football HTTP ${r.status}`);
  const j = await r.json();
  const errores = j.errors && (Array.isArray(j.errors) ? j.errors : Object.values(j.errors));
  if (errores && errores.length) throw new Error(`API-Football: ${errores.join(" ")}`);
  return { j, restantes: Number(r.headers.get("x-ratelimit-requests-remaining") ?? NaN) };
}

// Una pasada: usa como máximo `porPasada` pedidos y respeta el tope diario.
export async function avanzarEstadisticas(estado, opciones = {}) {
  const clave = process.env.API_FOOTBALL_KEY;
  if (!clave) return estado;
  const topeDia = Number(process.env.API_FOOTBALL_LIMITE_DIA || 95);
  const porPasada = Number(process.env.API_FOOTBALL_POR_PASADA || 8);

  const hoy = new Date().toISOString().slice(0, 10);
  const E = estado || { ligas: {}, cuota: { dia: hoy, usadas: 0 } };
  if (E.cuota.dia !== hoy) E.cuota = { dia: hoy, usadas: 0 };
  let usadas = 0;
  const puede = () => usadas < porPasada && E.cuota.usadas < topeDia;
  const gastar = () => { usadas++; E.cuota.usadas++; };

  // 1) Una vez al día por liga: lista de partidos terminados
  for (const [cod, idLiga] of Object.entries(LIGAS_AF)) {
    const L = (E.ligas[cod] ??= { hechos: {}, pendientes: [], intentos: {}, lista: null, error: null });
    if (L.lista === hoy || !puede()) continue;
    gastar();
    try {
      const { j } = await pedir(`/fixtures?league=${idLiga}&season=${temporada(cod)}&status=FT-AET-PEN`, clave);
      const ids = (j.response || [])
        .filter((f) => !L.hechos[f.fixture.id] && (L.intentos[f.fixture.id] || 0) < 3)
        .map((f) => [f.fixture.id, f.fixture.date])
        .sort((x, y) => String(y[1]).localeCompare(String(x[1]))); // recientes primero
      L.pendientes = ids;
      L.lista = hoy;
      L.error = null;
    } catch (e) {
      L.error = e.message;
      L.lista = hoy;
    }
  }

  // 2) Estadísticas de 20 partidos por pedido, repartiendo entre ligas
  const cods = Object.keys(LIGAS_AF);
  let vuelta = 0;
  while (puede() && cods.some((c) => E.ligas[c]?.pendientes?.length)) {
    const cod = cods[vuelta++ % cods.length];
    const L = E.ligas[cod];
    if (!L?.pendientes?.length) continue;
    const lote = L.pendientes.splice(0, 20);
    gastar();
    try {
      const { j, restantes } = await pedir(`/fixtures?ids=${lote.map((x) => x[0]).join("-")}`, clave);
      const vistos = new Set();
      for (const fx of j.response || []) {
        const id = fx.fixture?.id;
        vistos.add(id);
        const fila = filaDePartido(fx);
        if (fila) L.hechos[id] = fila;
        else L.intentos[id] = (L.intentos[id] || 0) + 1;
      }
      for (const [id] of lote) if (!vistos.has(id)) L.intentos[id] = (L.intentos[id] || 0) + 1;
      if (restantes === 0) E.cuota.usadas = topeDia;
    } catch (e) {
      L.pendientes.unshift(...lote);
      L.error = e.message;
      break;
    }
  }
  E.actualizado = new Date().toISOString();
  return E;
}

// Lo que se manda a la app: solo las filas por liga
export function resumenParaApp(E) {
  if (!E) return null;
  const out = {};
  for (const [cod, L] of Object.entries(E.ligas || {})) {
    out[cod] = { filas: Object.values(L.hechos || {}), pendientes: L.pendientes?.length || 0, error: L.error };
  }
  return { actualizado: E.actualizado, ligas: out };
}
