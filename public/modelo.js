// Modelo de análisis: fuerza de ataque/defensa por equipo + distribución de Poisson
// (con ajuste Dixon-Coles para marcadores bajos). Todo corre en el celular.
const Modelo = (() => {
  const DIA = 864e5;
  const VIDA_MEDIA = 120;   // días: los partidos recientes pesan más
  const PSEUDO = 4;         // partidos "promedio" que suavizan equipos con pocos datos
  const RHO = -0.08;        // ajuste Dixon-Coles
  const MEZCLA = 0.15;      // cuánto se acerca cada probabilidad al promedio de la liga

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const pois = (k, l) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };

  function fuerzas(jugados, hoy = Date.now()) {
    const ms = jugados.map(([f, h, a, gh, ga]) => ({
      h, a, gh, ga,
      w: Math.exp((-Math.LN2 * Math.max(0, (hoy - Date.parse(f)) / DIA)) / VIDA_MEDIA),
    }));
    const W = ms.reduce((s, m) => s + m.w, 0);
    let avgH = 1.5, avgA = 1.2;
    if (ms.length >= 10) {
      avgH = ms.reduce((s, m) => s + m.w * m.gh, 0) / W;
      avgA = ms.reduce((s, m) => s + m.w * m.ga, 0) / W;
    }
    const avgG = (avgH + avgA) / 2;
    const ids = new Set(ms.flatMap((m) => [m.h, m.a]));
    let att = {}, def = {};
    const n = {};
    ids.forEach((t) => { att[t] = 1; def[t] = 1; n[t] = 0; });
    ms.forEach((m) => { n[m.h]++; n[m.a]++; });

    for (let it = 0; it < 8; it++) {
      const acc = {};
      ids.forEach((t) => (acc[t] = { gf: 0, egf: 0, gc: 0, egc: 0 }));
      for (const m of ms) {
        const H = acc[m.h], A = acc[m.a];
        H.gf += m.w * m.gh; H.egf += m.w * avgH * def[m.a];
        H.gc += m.w * m.ga; H.egc += m.w * avgA * att[m.a];
        A.gf += m.w * m.ga; A.egf += m.w * avgA * def[m.h];
        A.gc += m.w * m.gh; A.egc += m.w * avgH * att[m.h];
      }
      const nAtt = {}, nDef = {};
      ids.forEach((t) => {
        const c = acc[t];
        nAtt[t] = (c.gf + PSEUDO * avgG) / (c.egf + PSEUDO * avgG);
        nDef[t] = (c.gc + PSEUDO * avgG) / (c.egc + PSEUDO * avgG);
      });
      const mA = [...ids].reduce((s, t) => s + nAtt[t], 0) / (ids.size || 1);
      const mD = [...ids].reduce((s, t) => s + nDef[t], 0) / (ids.size || 1);
      ids.forEach((t) => { nAtt[t] /= mA; nDef[t] /= mD; });
      att = nAtt; def = nDef;
    }
    return { att, def, avgH, avgA, n };
  }

  function baseLiga(jugados) {
    const ms = jugados.filter((m) => m[5]);
    if (ms.length < 20) return { p1: 0.44, pX: 0.27, p2: 0.29, o15: 0.75, o25: 0.52, o35: 0.29, btts: 0.52 };
    const c = { p1: 0, pX: 0, p2: 0, o15: 0, o25: 0, o35: 0, btts: 0 };
    for (const [, , , gh, ga] of ms) {
      if (gh > ga) c.p1++; else if (gh === ga) c.pX++; else c.p2++;
      const t = gh + ga;
      if (t > 1.5) c.o15++; if (t > 2.5) c.o25++; if (t > 3.5) c.o35++;
      if (gh > 0 && ga > 0) c.btts++;
    }
    for (const k in c) c[k] /= ms.length;
    return c;
  }

  function forma(jugados, id, cuantos = 5) {
    const r = [];
    for (let i = jugados.length - 1; i >= 0 && r.length < cuantos; i--) {
      const [, h, a, gh, ga] = jugados[i];
      if (h !== id && a !== id) continue;
      const gf = h === id ? gh : ga, gc = h === id ? ga : gh;
      r.push(gf > gc ? "G" : gf === gc ? "E" : "P");
    }
    return r.reverse();
  }

  // Cuota aproximada de doble oportunidad a partir de las cuotas 1X2
  const dc = (a, b) => (a && b ? Math.round((1 / (1 / a + 1 / b)) * 100) / 100 : null);

  function analizar(p, F, base, cuota, nombres) {
    const lh = clamp(F.avgH * (F.att[p.h] ?? 1) * (F.def[p.a] ?? 1), 0.2, 4.5);
    const la = clamp(F.avgA * (F.att[p.a] ?? 1) * (F.def[p.h] ?? 1), 0.15, 4);
    const N = 10;
    let tot = 0;
    const M = [];
    for (let i = 0; i <= N; i++) {
      M[i] = [];
      for (let j = 0; j <= N; j++) {
        let tau = 1;
        if (i === 0 && j === 0) tau = 1 - lh * la * RHO;
        else if (i === 0 && j === 1) tau = 1 + lh * RHO;
        else if (i === 1 && j === 0) tau = 1 + la * RHO;
        else if (i === 1 && j === 1) tau = 1 - RHO;
        M[i][j] = pois(i, lh) * pois(j, la) * tau;
        tot += M[i][j];
      }
    }
    const r = { p1: 0, pX: 0, p2: 0, o15: 0, o25: 0, o35: 0, btts: 0 };
    const marcadores = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const q = M[i][j] / tot;
      if (i > j) r.p1 += q; else if (i === j) r.pX += q; else r.p2 += q;
      if (i + j > 1.5) r.o15 += q; if (i + j > 2.5) r.o25 += q; if (i + j > 3.5) r.o35 += q;
      if (i > 0 && j > 0) r.btts += q;
      marcadores.push([`${i}-${j}`, q]);
    }
    if (base) for (const k in r) r[k] = (1 - MEZCLA) * r[k] + MEZCLA * base[k];
    const s = r.p1 + r.pX + r.p2;
    r.p1 /= s; r.pX /= s; r.p2 /= s;
    marcadores.sort((x, y) => y[1] - x[1]);

    const nMin = Math.min(F.n[p.h] || 0, F.n[p.a] || 0);
    const confianza = nMin >= 8 ? "alta" : nMin >= 4 ? "media" : "baja";
    const H = nombres.h, A = nombres.a;
    const c = cuota || {};
    const t = c.tot || {};
    const mercados = [
      { k: "1",   txt: `Gana ${H}`,          p: r.p1, o: c.o1 },
      { k: "X",   txt: "Empate",             p: r.pX, o: c.oX },
      { k: "2",   txt: `Gana ${A}`,          p: r.p2, o: c.o2 },
      { k: "1X",  txt: `${H} o empate`,      p: r.p1 + r.pX, o: dc(c.o1, c.oX), est: true },
      { k: "X2",  txt: `${A} o empate`,      p: r.p2 + r.pX, o: dc(c.o2, c.oX), est: true },
      { k: "12",  txt: "No hay empate",      p: r.p1 + r.p2, o: dc(c.o1, c.o2), est: true },
      { k: "O15", txt: "Más de 1.5 goles",   p: r.o15,     o: t["1.5"]?.[0] },
      { k: "O25", txt: "Más de 2.5 goles",   p: r.o25,     o: t["2.5"]?.[0] },
      { k: "U25", txt: "Menos de 2.5 goles", p: 1 - r.o25, o: t["2.5"]?.[1] },
      { k: "O35", txt: "Más de 3.5 goles",   p: r.o35,     o: t["3.5"]?.[0] },
      { k: "U35", txt: "Menos de 3.5 goles", p: 1 - r.o35, o: t["3.5"]?.[1] },
      { k: "BS",  txt: "Ambos marcan: sí",   p: r.btts },
      { k: "BN",  txt: "Ambos marcan: no",   p: 1 - r.btts },
    ].map((m) => ({ ...m, justa: 1 / m.p, ev: m.o ? m.p * m.o - 1 : null }));

    return { lh, la, ...r, marcadores: marcadores.slice(0, 3), confianza, mercados };
  }

  function lectura(an, nombres, formaH, formaA) {
    const H = nombres.h, A = nombres.a;
    const pct = (x) => Math.round(x * 100) + " %";
    const partes = [];
    if (an.p1 > 0.55) partes.push(`${H} es favorito en casa (${pct(an.p1)}).`);
    else if (an.p2 > 0.5) partes.push(`${A} llega como favorito aun de visitante (${pct(an.p2)}).`);
    else if (an.p1 > an.p2 + 0.1) partes.push(`Ligera ventaja para ${H}, pero el empate es posible (${pct(an.pX)}).`);
    else if (an.p2 > an.p1 + 0.1) partes.push(`Ligera ventaja para ${A}; ${H} puede sacar algo en casa.`);
    else partes.push(`Partido muy parejo: cualquier resultado es razonable.`);
    const g = an.lh + an.la;
    if (g > 3.1) partes.push(`Se esperan bastantes goles (${g.toFixed(1)} en promedio).`);
    else if (g < 2.2) partes.push(`Pinta para partido cerrado (${g.toFixed(1)} goles esperados).`);
    else partes.push(`Goles esperados: ${g.toFixed(1)}.`);
    const pts = (f) => f.reduce((s, r) => s + (r === "G" ? 3 : r === "E" ? 1 : 0), 0);
    if (formaH.length >= 4 && formaA.length >= 4) {
      const d = pts(formaH) - pts(formaA);
      if (d >= 6) partes.push(`${H} llega en mejor momento.`);
      else if (d <= -6) partes.push(`${A} llega en mejor momento.`);
    }
    const valor = an.mercados.filter((m) => m.ev != null && m.ev > 0.04 && m.p > 0.35).sort((x, y) => y.ev - x.ev)[0];
    if (valor) partes.push(`Posible valor en “${valor.txt}” a cuota ${valor.o.toFixed(2)}.`);
    if (an.confianza === "baja") partes.push(`Hay pocos partidos de referencia: tómalo con cautela.`);
    return partes.join(" ");
  }

  // ---------- Partidos sin historial (copas): probabilidades sacadas de las cuotas ----------
  // Busca los goles esperados de cada equipo que mejor reproducen el 1X2 y el más/menos de las casas.
  function ajustarAMercado(c) {
    const inv = [1 / c.o1, 1 / c.oX, 1 / c.o2];
    const s = inv[0] + inv[1] + inv[2];
    const q1 = inv[0] / s, q2 = inv[2] / s;
    let linea = null, qOver = null;
    const lineas = Object.keys(c.tot || {}).map(Number).filter((L) => Math.abs(L % 1 - 0.5) < 1e-9);
    if (lineas.length) {
      linea = lineas.includes(2.5) ? 2.5 : lineas.sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5))[0];
      const [o, u] = c.tot[String(linea)];
      qOver = (1 / o) / (1 / o + 1 / u);
    }
    const vec = (l) => { const v = []; for (let k = 0; k <= 10; k++) v.push(pois(k, l)); return v; };
    const error = (lh, la) => {
      const ph = vec(lh), pa = vec(la);
      let p1 = 0, p2 = 0, over = 0;
      for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
        const q = ph[i] * pa[j];
        if (i > j) p1 += q; else if (j > i) p2 += q;
        if (linea != null && i + j > linea) over += q;
      }
      let err = (p1 - q1) ** 2 + (p2 - q2) ** 2;
      if (linea != null) err += (over - qOver) ** 2;
      return err;
    };
    // Búsqueda gruesa y luego fina alrededor del mejor punto
    let mejor = null;
    for (let lh = 0.2; lh <= 4.0; lh += 0.1) for (let la = 0.15; la <= 3.6; la += 0.1) {
      const err = error(lh, la);
      if (!mejor || err < mejor.err) mejor = { lh, la, err };
    }
    const c0 = { ...mejor };
    for (let lh = c0.lh - 0.1; lh <= c0.lh + 0.1; lh += 0.01) for (let la = c0.la - 0.1; la <= c0.la + 0.1; la += 0.01) {
      if (lh <= 0.05 || la <= 0.05) continue;
      const err = error(lh, la);
      if (err < mejor.err) mejor = { lh, la, err };
    }
    return mejor;
  }

  function analizarMercado(p, cuota, nombres) {
    const { lh, la } = ajustarAMercado(cuota);
    const F = { avgH: lh, avgA: la, att: {}, def: {}, n: {} };
    const an = analizar(p, F, null, cuota, nombres);
    an.confianza = "mercado";
    return an;
  }

  // Niveles de combinada
  const NIVELES = {
    mediana: { pMin: 0.60, pMax: 0.80, etiqueta: "Mediana" },
    grande:  { pMin: 0.68, pMax: 0.86, etiqueta: "Grande" },
  };

  function mejorSeleccion(an, nivel, soloValor, conStats) {
    const { pMin, pMax } = NIVELES[nivel];
    let mejor = null;
    for (const m of an.mercados) {
      if (m.p < pMin || m.p > pMax) continue;
      if (soloValor && !(m.ev != null && m.ev > 0)) continue;
      if (m.grupo && !conStats) continue;
      if (m.grupo && an.stats && an.stats._n < 4) continue;
      let score = m.p + (m.ev != null ? 0.3 * m.ev : 0);
      if (an.confianza === "baja") score -= 0.08;
      if (an.confianza === "media") score -= 0.03;
      if (!mejor || score > mejor.score) mejor = { ...m, score };
    }
    return mejor;
  }

  function armarCombinada(partidos, nivel, cantidad, soloValor = false, conStats = true) {
    const opciones = [];
    for (const pt of partidos) {
      const sel = mejorSeleccion(pt.an, nivel, soloValor, conStats);
      if (sel) opciones.push({ partido: pt, sel });
    }
    opciones.sort((x, y) => y.sel.score - x.sel.score);
    const elegidas = opciones.slice(0, cantidad)
      .sort((x, y) => x.partido.f.localeCompare(y.partido.f));
    if (!elegidas.length) return null;
    const prob = elegidas.reduce((s, e) => s * e.sel.p, 1);
    const todasConCuota = elegidas.every((e) => e.sel.o);
    const cuota = todasConCuota ? elegidas.reduce((s, e) => s * e.sel.o, 1) : null;
    return {
      nivel, elegidas, prob,
      justa: 1 / prob,
      cuota,
      ev: cuota ? prob * cuota - 1 : null,
      incompleta: elegidas.length < cantidad,
    };
  }

  // ---------- Estadísticas: remates, córners, paradas, tarjetas... ----------
  const ST = ["tiros", "aPuerta", "corners", "paradas", "faltas", "amarillas", "rojas", "offside", "posesion", "xg"];
  const ST_NOMBRE = {
    tiros: "Remates", aPuerta: "Remates a puerta", corners: "Tiros de esquina", paradas: "Paradas del portero",
    faltas: "Faltas", amarillas: "Tarjetas amarillas", rojas: "Tarjetas rojas", offside: "Fueras de juego",
    posesion: "Posesión (%)", xg: "Goles esperados (xG)",
  };

  // filas: [fecha, idLocal, idVisita, [stats local], [stats visita]]
  function fuerzasStats(filas, hoy = Date.now()) {
    const res = { n: {}, medias: {}, equipos: {} };
    const ws = filas.map((f) => Math.exp((-Math.LN2 * Math.max(0, (hoy - Date.parse(f[0])) / DIA)) / VIDA_MEDIA));
    filas.forEach((f) => { res.n[f[1]] = (res.n[f[1]] || 0) + 1; res.n[f[2]] = (res.n[f[2]] || 0) + 1; });
    ST.forEach((k, i) => {
      let sH = 0, sA = 0, W = 0;
      filas.forEach((f, j) => {
        if (f[3][i] == null || f[4][i] == null) return;
        sH += ws[j] * f[3][i]; sA += ws[j] * f[4][i]; W += ws[j];
      });
      if (W < 3) return;
      const mH = sH / W, mA = sA / W, m = (mH + mA) / 2;
      res.medias[k] = { mH, mA };
      const acc = {};
      filas.forEach((f, j) => {
        const vh = f[3][i], va = f[4][i];
        if (vh == null || va == null) return;
        const w = ws[j];
        const H = (acc[f[1]] ??= { af: 0, baf: 0, ec: 0, bec: 0, sum: 0, cnt: 0 });
        const A = (acc[f[2]] ??= { af: 0, baf: 0, ec: 0, bec: 0, sum: 0, cnt: 0 });
        H.af += w * vh; H.baf += w * mH; H.ec += w * va; H.bec += w * mA; H.sum += vh; H.cnt++;
        A.af += w * va; A.baf += w * mA; A.ec += w * vh; A.bec += w * mH; A.sum += va; A.cnt++;
        H.sumEc = (H.sumEc || 0) + va; A.sumEc = (A.sumEc || 0) + vh;
      });
      for (const [id, c] of Object.entries(acc)) {
        const e = (res.equipos[id] ??= {});
        e[k] = {
          favor: (c.af + PSEUDO * m) / (c.baf + PSEUDO * m || 1),
          contra: (c.ec + PSEUDO * m) / (c.bec + PSEUDO * m || 1),
          prom: c.sum / c.cnt, promContra: c.sumEc / c.cnt, pj: c.cnt,
        };
      }
    });
    return res;
  }

  function esperadas(S, idH, idA) {
    if (!S) return null;
    const out = {};
    for (const k of ST) {
      const m = S.medias[k];
      if (!m) continue;
      const h = S.equipos[idH]?.[k], a = S.equipos[idA]?.[k];
      if (k === "posesion") {
        const ph = h ? h.prom : 50, pa = a ? a.prom : 50;
        const loc = clamp((ph + (100 - pa)) / 2, 25, 75);
        out[k] = [loc, 100 - loc];
        continue;
      }
      const eh = m.mH * (h?.favor ?? 1) * (a?.contra ?? 1);
      const ea = m.mA * (a?.favor ?? 1) * (h?.contra ?? 1);
      out[k] = [eh, ea];
    }
    out._n = Math.min(S.n[idH] || 0, S.n[idA] || 0);
    return Object.keys(out).length > 1 ? out : null;
  }

  // P(X > linea) con X ~ Poisson(l)
  function masDe(l, linea) {
    let acum = 0;
    for (let k = 0; k <= Math.floor(linea); k++) acum += pois(k, l);
    return clamp(1 - acum, 0, 1);
  }

  function agregarStats(an, est, nombres) {
    if (!est) return an;
    an.stats = est;
    const nuevos = [];
    const linea = (clave, total, lineas, nombre, extra = {}) => {
      // Se usan solo líneas cercanas a lo esperado, que son las que ofrecen las casas
      const cerca = lineas.filter((L) => Math.abs(L - total) <= 2.6);
      for (const L of cerca) {
        const p = 0.9 * masDe(total, L) + 0.1 * 0.5; // ligera prudencia: los conteos varían más que una Poisson
        nuevos.push({ k: `${clave}+${L}`, txt: `${nombre}: más de ${L}`, p, grupo: extra.grupo, base: nombre, L, lado: "mas" });
        nuevos.push({ k: `${clave}-${L}`, txt: `${nombre}: menos de ${L}`, p: 1 - p, grupo: extra.grupo, base: nombre, L, lado: "menos" });
      }
    };
    if (est.corners) {
      const [h, a] = est.corners;
      linea("C", h + a, [7.5, 8.5, 9.5, 10.5, 11.5], "Córners totales", { grupo: "corners" });
      linea("CL", h, [3.5, 4.5, 5.5, 6.5], `Córners de ${nombres.h}`, { grupo: "corners" });
      linea("CV", a, [2.5, 3.5, 4.5, 5.5], `Córners de ${nombres.a}`, { grupo: "corners" });
    }
    if (est.amarillas) {
      const [h, a] = est.amarillas;
      linea("T", h + a, [2.5, 3.5, 4.5, 5.5], "Tarjetas amarillas", { grupo: "tarjetas" });
    }
    if (est.aPuerta) {
      const [h, a] = est.aPuerta;
      linea("RP", h + a, [6.5, 7.5, 8.5, 9.5], "Remates a puerta totales", { grupo: "remates" });
    }
    if (est.paradas) {
      const [h, a] = est.paradas;
      linea("PL", h, [1.5, 2.5, 3.5, 4.5], `Paradas del portero de ${nombres.h}`, { grupo: "paradas" });
      linea("PV", a, [1.5, 2.5, 3.5, 4.5], `Paradas del portero de ${nombres.a}`, { grupo: "paradas" });
    }
    an.mercados.push(...nuevos.map((m) => ({ ...m, justa: 1 / m.p, ev: null })));
    return an;
  }

  function lecturaStats(an, nombres) {
    const e = an.stats;
    if (!e) return "";
    const p = [];
    if (e.tiros && e.aPuerta) {
      p.push(`Remates esperados: ${e.tiros[0].toFixed(0)} de ${nombres.h} (${e.aPuerta[0].toFixed(1)} a puerta) y ${e.tiros[1].toFixed(0)} de ${nombres.a} (${e.aPuerta[1].toFixed(1)} a puerta).`);
    }
    if (e.corners) p.push(`Córners esperados: ${(e.corners[0] + e.corners[1]).toFixed(1)} en total.`);
    if (e.paradas) {
      const [h, a] = e.paradas;
      const quien = h > a ? nombres.h : nombres.a;
      if (Math.max(h, a) >= 3.5) p.push(`El portero de ${quien} tendría trabajo: unas ${Math.max(h, a).toFixed(1)} paradas.`);
    }
    if (e.amarillas) {
      const t = e.amarillas[0] + e.amarillas[1];
      if (t >= 5) p.push(`Partido que pinta caliente: ${t.toFixed(1)} amarillas esperadas.`);
    }
    if (e._n < 4) p.push(`Las estadísticas tienen pocos partidos de referencia.`);
    return p.join(" ");
  }

  return { fuerzas, baseLiga, forma, analizar, analizarMercado, lectura, armarCombinada, NIVELES,
    ST, ST_NOMBRE, fuerzasStats, esperadas, agregarStats, lecturaStats };
})();

if (typeof module !== "undefined") module.exports = Modelo;
