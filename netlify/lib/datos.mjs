// Descarga partidos (football-data.org) y cuotas (the-odds-api.com)
// y los guarda en un formato compacto para la app.

export const LIGAS = {
  PL:  { nombre: "Premier League",   pais: "Inglaterra", odds: "soccer_epl" },
  PD:  { nombre: "LaLiga",           pais: "España",     odds: "soccer_spain_la_liga" },
  SA:  { nombre: "Serie A",          pais: "Italia",     odds: "soccer_italy_serie_a" },
  BL1: { nombre: "Bundesliga",       pais: "Alemania",   odds: "soccer_germany_bundesliga" },
  FL1: { nombre: "Ligue 1",          pais: "Francia",    odds: "soccer_france_ligue_one" },
  CL:  { nombre: "Champions League", pais: "Europa",     odds: "soccer_uefa_champs_league" },
  BSA: { nombre: "Brasileirão",      pais: "Brasil",     odds: "soccer_brazil_campeonato" },
  // Colombia no está en football-data.org: sus partidos vienen de API-Football (id 239)
  CO:  { nombre: "Liga BetPlay",     pais: "Colombia",   odds: "soccer_colombia_primera_a", fuente: "af", afId: 239 },
};

const HORA = 3600e3;
const DIAS_PROXIMOS = 10;
const LIGA_REGULAR = new Set(["REGULAR_SEASON", "LEAGUE_STAGE"]);

export function compactarPartidos(json, ahora = Date.now()) {
  const equipos = {};
  const jugados = [];
  const proximos = [];
  for (const m of json.matches || []) {
    const h = m.homeTeam, a = m.awayTeam;
    if (!h?.id || !a?.id) continue;
    for (const t of [h, a]) {
      equipos[t.id] = { n: t.shortName || t.name, f: t.name, c: t.crest || equipos[t.id]?.c || "" };
    }
    const t = Date.parse(m.utcDate);
    if (m.status === "FINISHED") {
      const s = m.score?.regularTime || m.score?.fullTime;
      if (s?.home == null || s?.away == null) continue;
      jugados.push([m.utcDate.slice(0, 10), h.id, a.id, s.home, s.away, LIGA_REGULAR.has(m.stage) ? 1 : 0]);
    } else if ((m.status === "SCHEDULED" || m.status === "TIMED") &&
               t > ahora - 2 * HORA && t < ahora + DIAS_PROXIMOS * 24 * HORA) {
      proximos.push({ id: m.id, f: m.utcDate, h: h.id, a: a.id, j: m.matchday || null });
    }
  }
  jugados.sort((x, y) => x[0].localeCompare(y[0]));
  proximos.sort((x, y) => x.f.localeCompare(y.f));
  return { equipos, jugados, proximos };
}

const media = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

export function compactarCuotas(eventos) {
  return (eventos || []).map((ev) => {
    const h2h = { h: [], d: [], a: [] };
    const tot = {};
    for (const b of ev.bookmakers || []) {
      for (const mk of b.markets || []) {
        if (mk.key === "h2h") {
          for (const o of mk.outcomes) {
            if (o.name === ev.home_team) h2h.h.push(o.price);
            else if (o.name === ev.away_team) h2h.a.push(o.price);
            else if (o.name === "Draw") h2h.d.push(o.price);
          }
        } else if (mk.key === "totals") {
          for (const o of mk.outcomes) {
            const k = String(o.point);
            tot[k] ??= { o: [], u: [] };
            (o.name === "Over" ? tot[k].o : tot[k].u).push(o.price);
          }
        }
      }
    }
    const totales = {};
    for (const [k, v] of Object.entries(tot)) {
      if (v.o.length && v.u.length) totales[k] = [r2(media(v.o)), r2(media(v.u))];
    }
    return {
      h: ev.home_team, a: ev.away_team, t: ev.commence_time,
      o1: r2(media(h2h.h)), oX: r2(media(h2h.d)), o2: r2(media(h2h.a)),
      tot: totales, casas: (ev.bookmakers || []).length,
    };
  });
}

// Partidos desde API-Football (para ligas que no están en football-data.org)
export function compactarPartidosAF(json, ahora = Date.now()) {
  const equipos = {};
  const jugados = [];
  const proximos = [];
  const items = json.response || [];
  const ronda = (r) => { const m = /^(.*?)\s*-\s*(\d+)$/.exec(r || ""); return m ? m[1] : null; };
  // Torneo actual (por ejemplo "Clausura"): el de la última fecha regular jugada
  let torneo = null, ultima = "";
  for (const f of items) {
    if (["FT", "AET", "PEN"].includes(f.fixture?.status?.short) && ronda(f.league?.round) && f.fixture.date > ultima) {
      ultima = f.fixture.date; torneo = ronda(f.league.round);
    }
  }
  for (const f of items) {
    const h = f.teams?.home, a = f.teams?.away;
    if (!h?.id || !a?.id) continue;
    for (const t of [h, a]) equipos[t.id] = { n: t.name, f: t.name, c: t.logo || equipos[t.id]?.c || "" };
    const st = f.fixture?.status?.short;
    const t = Date.parse(f.fixture.date);
    if (["FT", "AET", "PEN"].includes(st)) {
      const s = f.score?.fulltime?.home != null ? f.score.fulltime : f.goals;
      if (s?.home == null || s?.away == null) continue;
      const regular = torneo && ronda(f.league?.round) === torneo ? 1 : 0;
      jugados.push([f.fixture.date.slice(0, 10), h.id, a.id, s.home, s.away, regular]);
    } else if ((st === "NS" || st === "TBD") && t > ahora - 2 * HORA && t < ahora + DIAS_PROXIMOS * 24 * HORA) {
      const m = /(\d+)$/.exec(f.league?.round || "");
      proximos.push({ id: f.fixture.id, f: new Date(t).toISOString(), h: h.id, a: a.id, j: m ? Number(m[1]) : null });
    }
  }
  jugados.sort((x, y) => x[0].localeCompare(y[0]));
  proximos.sort((x, y) => x.f.localeCompare(y.f));
  return { equipos, jugados, proximos, torneo };
}

async function bajarPartidosAF(liga, clave) {
  if (!clave) throw new Error("Necesita la clave API_FOOTBALL_KEY");
  const y = new Date().getUTCFullYear();
  const r = await fetch(`https://v3.football.api-sports.io/fixtures?league=${liga.afId}&season=${y}`, {
    headers: { "x-apisports-key": clave },
  });
  if (!r.ok) throw new Error(`API-Football HTTP ${r.status}`);
  const j = await r.json();
  const errores = j.errors && (Array.isArray(j.errors) ? j.errors : Object.values(j.errors));
  if (errores && errores.length) throw new Error(`API-Football: ${errores.join(" ")}`);
  return compactarPartidosAF(j);
}

async function bajarPartidos(codigo, clave) {
  const r = await fetch(`https://api.football-data.org/v4/competitions/${codigo}/matches`, {
    headers: { "X-Auth-Token": clave },
  });
  if (!r.ok) throw new Error(`football-data ${codigo}: HTTP ${r.status}`);
  return compactarPartidos(await r.json());
}

async function bajarCuotas(deporte, clave) {
  const url = `https://api.the-odds-api.com/v4/sports/${deporte}/odds?apiKey=${clave}` +
    `&regions=eu&markets=h2h,totals&oddsFormat=decimal`;
  const r = await fetch(url);
  if (r.status === 404 || r.status === 422) return []; // liga fuera de temporada
  if (!r.ok) throw new Error(`odds ${deporte}: HTTP ${r.status}`);
  return compactarCuotas(await r.json());
}

export async function actualizarTodo(anterior = null) {
  const claveFutbol = process.env.FOOTBALL_DATA_KEY;
  const claveCuotas = process.env.ODDS_API_KEY;
  if (!claveFutbol) throw new Error("Falta la variable FOOTBALL_DATA_KEY en Netlify");

  const ahora = Date.now();
  // Las cuotas gastan créditos del plan gratis: máximo una descarga cada 20 horas.
  const ultCuotas = anterior?.cuotasActualizadas ? Date.parse(anterior.cuotasActualizadas) : 0;
  const tocaCuotas = !!claveCuotas && ahora - ultCuotas > 20 * HORA;

  const codigos = Object.keys(LIGAS);
  const partidos = await Promise.allSettled(codigos.map((c) => LIGAS[c].fuente === "af"
    ? bajarPartidosAF(LIGAS[c], process.env.API_FOOTBALL_KEY)
    : bajarPartidos(c, claveFutbol)));
  const cuotas = tocaCuotas
    ? await Promise.allSettled(codigos.map((c) => bajarCuotas(LIGAS[c].odds, claveCuotas)))
    : null;

  const ligas = {};
  codigos.forEach((c, i) => {
    const previa = anterior?.ligas?.[c];
    const p = partidos[i];
    const base = p.status === "fulfilled"
      ? p.value
      : previa ? { equipos: previa.equipos, jugados: previa.jugados, proximos: previa.proximos } : null;
    if (!base) {
      ligas[c] = { ...LIGAS[c], error: String(p.reason?.message || p.reason) };
      return;
    }
    let lista = previa?.cuotas || [];
    if (cuotas && cuotas[i].status === "fulfilled") lista = cuotas[i].value;
    ligas[c] = {
      ...LIGAS[c], ...base, cuotas: lista,
      error: p.status === "rejected" ? String(p.reason?.message || p.reason) : null,
    };
  });

  return {
    actualizado: new Date(ahora).toISOString(),
    cuotasActualizadas: tocaCuotas ? new Date(ahora).toISOString() : anterior?.cuotasActualizadas || null,
    ligas,
  };
}
