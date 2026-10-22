(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const contenido = $("#contenido");
  const DIA = 864e5;

  // ---------- Preferencias guardadas en el celular ----------
  const leer = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const prefs = Object.assign({
    ligasOcultas: [], presupuesto: 0, nivel: "mediana", cantMediana: 4, cantGrande: 8,
    ventana: 3, soloValor: false, conStats: true, tema: "auto", ordenStats: "tiros",
    modoComb: "ia", claveIA: "", modeloIA: "claude-sonnet-5-5", buscarIA: true,
    proveedorIA: "gemini", claveGemini: "", modeloGemini: "gemini-2.5-flash",
  }, leer("prefs", {}));
  let apuestas = leer("apuestas", []);
  const guardarPrefs = () => guardar("prefs", prefs);

  const estado = { datos: null, demo: false, vista: "partidos", liga: "todas", abiertos: new Set(), partidos: [], subTabla: "posiciones" };

  // ---------- Utilidades ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => Math.round(x * 100);
  const fmtCuota = (x) => (x ? x.toFixed(2) : "—");
  const hora = (iso) => new Date(iso).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
  const inicioDia = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  function nombreDia(iso) {
    const d = inicioDia(iso), hoy = inicioDia(Date.now());
    if (d === hoy) return "Hoy";
    if (d === hoy + DIA) return "Mañana";
    const s = new Date(iso).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "short" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function hace(iso) {
    const min = Math.round((Date.now() - Date.parse(iso)) / 60e3);
    if (min < 2) return "hace un momento";
    if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
  }
  const dinero = (x) => Math.round(x).toLocaleString("es");
  const escudo = (eq) => eq?.c
    ? `<img class="escudo" src="${esc(eq.c)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.className='escudo vacio';this.removeAttribute('src')">`
    : `<i class="escudo vacio"></i>`;

  // ---------- Emparejar cuotas con partidos ----------
  const STOP = new Set(["fc", "cf", "afc", "sc", "ac", "as", "ssc", "club", "de", "del", "la", "le", "of", "and", "the", "calcio", "1", "sv", "vfb", "vfl", "tsg", "rc", "rcd", "ud", "cd", "ca", "sd", "ec", "se", "fk", "us", "ogc", "stade", "olympique", "real", "sporting", "athletic", "atletico", "united", "city"]);
  const tokens = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  function parecido(a, b) {
    const ta = tokens(a), tb = tokens(b);
    const fa = ta.filter((t) => !STOP.has(t)), fb = tb.filter((t) => !STOP.has(t));
    const ig = (x, y) => x === y || (x.length >= 4 && y.length >= 4 && x.slice(0, 4) === y.slice(0, 4));
    let s = 0;
    for (const x of (fa.length ? fa : ta)) if ((fb.length ? fb : tb).some((y) => ig(x, y))) s += 1;
    for (const x of ta) if (STOP.has(x) && tb.includes(x)) s += 0.2;
    return s;
  }
  function buscarCuota(p, liga, eqH, eqA) {
    let mejor = null, mejorS = 0;
    const t = Date.parse(p.f);
    for (const c of liga.cuotas || []) {
      if (Math.abs(Date.parse(c.t) - t) > 3 * 3600e3) continue;
      const sh = Math.max(parecido(eqH.f, c.h), parecido(eqH.n, c.h));
      const sa = Math.max(parecido(eqA.f, c.a), parecido(eqA.n, c.a));
      if (sh >= 1 && sa >= 1 && sh + sa > mejorS) { mejor = c; mejorS = sh + sa; }
    }
    return mejor;
  }

  // ---------- Preparar el análisis ----------
  function procesar() {
    const out = [];
    const ahora = Date.now();
    for (const [codigo, liga] of Object.entries(estado.datos?.ligas || {})) {
      if (!liga.jugados) continue;
      const F = Modelo.fuerzas(liga.jugados, ahora);
      const base = Modelo.baseLiga(liga.jugados);
      liga._tabla = tabla(liga);
      liga._S = statsDeLiga(codigo, liga, ahora);
      for (const p of liga.proximos || []) {
        if (Date.parse(p.f) < ahora - 2 * 3600e3) continue;
        const eqH = liga.equipos[p.h] || { n: "Local" }, eqA = liga.equipos[p.a] || { n: "Visitante" };
        const nom = { h: eqH.n, a: eqA.n };
        if (liga.soloMercado) {
          // Copas sin historial: las probabilidades salen de las cuotas, sin el margen de las casas
          const cuota = (liga.cuotas || []).find((c) => c.id === p.id);
          if (!cuota?.o1) continue;
          const an = Modelo.analizarMercado(p, cuota, nom);
          out.push({
            ...p, codigo, ligaNombre: liga.nombre, eqH, eqA, nom, an, fH: [], fA: [], cuota, soloMercado: true,
            texto: `Probabilidades sacadas de las cuotas de ${cuota.casas} casas, quitando su margen. ` + Modelo.lectura(an, nom, [], []),
            textoStats: "",
          });
          continue;
        }
        const cuota = buscarCuota(p, liga, eqH, eqA);
        const an = Modelo.analizar(p, F, base, cuota, nom);
        Modelo.agregarStats(an, Modelo.esperadas(liga._S, p.h, p.a), nom);
        const fH = Modelo.forma(liga.jugados, p.h), fA = Modelo.forma(liga.jugados, p.a);
        out.push({
          ...p, codigo, ligaNombre: liga.nombre, eqH, eqA, nom, an, fH, fA, cuota,
          texto: Modelo.lectura(an, nom, fH, fA),
          textoStats: Modelo.lecturaStats(an, nom),
        });
      }
    }
    out.sort((x, y) => x.f.localeCompare(y.f));
    estado.partidos = out;
  }

  // Une las estadísticas de API-Football con los equipos por nombre
  function statsDeLiga(codigo, liga, ahora) {
    const filas = estado.datos?.estadisticas?.ligas?.[codigo]?.filas;
    if (!filas?.length) return null;
    const nombres = new Set(filas.flatMap((f) => [f[1], f[2]]));
    const mapa = {};
    for (const nom of nombres) {
      let mejor = null, mejorS = 0;
      for (const [id, eq] of Object.entries(liga.equipos)) {
        const sc = Math.max(parecido(eq.f, nom), parecido(eq.n, nom));
        if (sc > mejorS) { mejorS = sc; mejor = id; }
      }
      if (mejor && mejorS >= 1) mapa[nom] = Number(mejor);
    }
    const conv = filas.filter((f) => mapa[f[1]] && mapa[f[2]])
      .map((f) => [f[0], mapa[f[1]], mapa[f[2]], f[3], f[4]]);
    if (!conv.length) return null;
    const S = Modelo.fuerzasStats(conv, ahora);
    S.partidos = conv.length;
    return S;
  }

  function tabla(liga) {
    const T = {};
    const fila = (id) => (T[id] ??= { id, pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 });
    for (const [, h, a, gh, ga, regular] of liga.jugados) {
      if (!regular) continue;
      const H = fila(h), A = fila(a);
      H.pj++; A.pj++; H.gf += gh; H.gc += ga; A.gf += ga; A.gc += gh;
      if (gh > ga) { H.g++; A.p++; H.pts += 3; }
      else if (gh < ga) { A.g++; H.p++; A.pts += 3; }
      else { H.e++; A.e++; H.pts++; A.pts++; }
    }
    return Object.values(T).sort((x, y) => y.pts - x.pts || (y.gf - y.gc) - (x.gf - x.gc) || y.gf - x.gf);
  }

  const ligasVisibles = () => Object.keys(estado.datos?.ligas || {})
    .filter((c) => !prefs.ligasOcultas.includes(c) && estado.datos.ligas[c].jugados);
  const partidosFiltrados = () => estado.partidos.filter((p) =>
    !prefs.ligasOcultas.includes(p.codigo) && (estado.liga === "todas" || p.codigo === estado.liga));

  // ---------- Barra de ligas ----------
  function pintarLigas() {
    const nav = $("#ligas");
    if (estado.vista === "ajustes" || !estado.datos) { nav.hidden = true; return; }
    nav.hidden = false;
    const cods = ligasVisibles();
    if (estado.vista === "tablas" && (estado.liga === "todas" || !cods.includes(estado.liga))) estado.liga = cods[0] || "todas";
    const items = (estado.vista === "tablas" ? [] : [["todas", "Todas"]])
      .concat(cods.map((c) => [c, estado.datos.ligas[c].nombre]));
    nav.innerHTML = items.map(([c, n]) =>
      `<button class="chip" data-liga="${c}" aria-pressed="${estado.liga === c}">${esc(n)}</button>`).join("");
  }
  $("#ligas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-liga]");
    if (!b) return;
    estado.liga = b.dataset.liga;
    pintar();
  });

  // ---------- Vista: partidos ----------
  function tarjeta(p) {
    const an = p.an, abierto = estado.abiertos.has(String(p.id));
    const fav = Math.max(an.p1, an.pX, an.p2);
    const cls = (x) => (x === fav ? "pct fav" : "pct");
    const mercados = an.mercados.filter((m) => !m.grupo).sort((x, y) => y.p - x.p);
    return `
    <article class="partido">
      <button aria-expanded="${abierto}" data-abrir="${p.id}">
        <div class="meta"><span>${esc(p.ligaNombre)}${p.j ? `, fecha ${p.j}` : ""}</span><span>${hora(p.f)}</span></div>
        <div class="equipos">
          <div class="eq">${escudo(p.eqH)}<span>${esc(p.nom.h)}</span></div>
          <div class="${cls(an.p1)}">${pct(an.p1)}<small>%</small></div>
          <div class="eq">${escudo(p.eqA)}<span>${esc(p.nom.a)}</span></div>
          <div class="${cls(an.p2)}">${pct(an.p2)}<small>%</small></div>
        </div>
        <div class="barra" aria-hidden="true">
          <i class="b1" style="flex:${an.p1}"></i><i class="bx" style="flex:${an.pX}"></i><i class="b2" style="flex:${an.p2}"></i>
        </div>
        <div class="leyenda"><span>Local ${pct(an.p1)} %</span><span>Empate ${pct(an.pX)} %</span><span>Visita ${pct(an.p2)} %</span></div>
      </button>
      <div class="detalle" ${abierto ? "" : "hidden"}>
        <p class="lectura">${esc(p.texto)}${p.textoStats ? " " + esc(p.textoStats) : ""}</p>
        <div class="datos-clave">
          <div class="dato"><b>${an.lh.toFixed(1)} – ${an.la.toFixed(1)}</b><span>Goles esperados</span></div>
          <div class="dato"><b>${an.marcadores[0][0]}</b><span>Marcador más probable</span></div>
          <div class="dato"><b>${pct(an.btts)} %</b><span>Ambos marcan</span></div>
          <div class="dato"><b>${pct(an.o25)} %</b><span>Más de 2.5 goles</span></div>
          <div class="dato"><b>${an.confianza === "mercado" ? "cuotas" : an.confianza}</b><span>${an.confianza === "mercado" ? "Fuente" : "Confianza de datos"}</span></div>
          <div class="dato"><b>${p.cuota ? p.cuota.casas : "—"}</b><span>Casas con cuota</span></div>
        </div>
        ${p.soloMercado ? "" : `<div class="fila-forma"><span>${esc(p.nom.h)}</span>${formaHTML(p.fH)}</div>
        <div class="fila-forma"><span>${esc(p.nom.a)}</span>${formaHTML(p.fA)}</div>`}
        <div class="desliza"><table>
          <thead><tr><th>Mercado</th><th class="n">Prob.</th><th class="n">Cuota justa</th><th class="n">Cuota casas</th><th class="n">Valor</th></tr></thead>
          <tbody>${mercados.map((m) => `
            <tr class="${m.ev != null && m.ev > 0 ? "valor" : ""}">
              <td>${esc(m.txt)}</td><td class="n">${pct(m.p)} %</td><td class="n">${fmtCuota(m.justa)}</td>
              <td class="n">${m.o ? fmtCuota(m.o) + (m.est ? "*" : "") : "—"}</td>
              <td class="n">${m.ev == null ? "—" : m.ev > 0 ? `<span class="etq-valor">+${pct(m.ev)} %</span>` : `${pct(m.ev)} %`}</td>
            </tr>`).join("")}
          </tbody></table></div>
        ${p.cuota ? `<p class="nota">* Cuota de doble oportunidad estimada a partir del 1X2. Revisa la real en tu casa de apuestas.</p>` : ""}
        ${bloqueStats(p)}
      </div>
    </article>`;
  }
  function bloqueStats(p) {
    const e = p.an.stats;
    if (p.soloMercado) return "";
    if (!e) {
      return estado.datos?.conEstadisticas || estado.demo
        ? `<p class="nota">Aún no hay estadísticas de remates y córners para estos equipos. Se van completando cada hora.</p>`
        : "";
    }
    const filas = Modelo.ST.filter((k) => e[k] && k !== "rojas").map((k) => {
      const [h, a] = e[k];
      const dec = k === "xg" || k === "rojas" ? 2 : 1;
      const total = k === "posesion" ? "" : (h + a).toFixed(dec);
      return `<tr><td>${Modelo.ST_NOMBRE[k]}</td><td class="n">${h.toFixed(k === "posesion" ? 0 : dec)}</td>
        <td class="n">${a.toFixed(k === "posesion" ? 0 : dec)}</td><td class="n">${total}</td></tr>`;
    }).join("");
    // Líneas: una fila por línea con probabilidad de más y de menos
    const lineas = p.an.mercados.filter((m) => m.grupo && m.lado === "mas");
    const filasL = lineas.map((m) => `<tr class="${m.p >= 0.62 || m.p <= 0.38 ? "valor" : ""}"><td>${esc(m.base)}</td><td class="n">${m.L}</td>
      <td class="n">${pct(m.p)} %</td><td class="n">${pct(1 - m.p)} %</td><td class="n">${fmtCuota(1 / Math.max(m.p, 1 - m.p))}</td></tr>`).join("");
    return `
      <h3 class="sub">Estadísticas esperadas</h3>
      <div class="desliza"><table>
        <thead><tr><th></th><th class="n">${esc(p.nom.h)}</th><th class="n">${esc(p.nom.a)}</th><th class="n">Total</th></tr></thead>
        <tbody>${filas}</tbody></table></div>
      ${filasL ? `<h3 class="sub">Córners, remates, paradas y tarjetas</h3>
      <div class="desliza"><table>
        <thead><tr><th>Mercado</th><th class="n">Línea</th><th class="n">Más</th><th class="n">Menos</th><th class="n">Justa*</th></tr></thead>
        <tbody>${filasL}</tbody></table></div>
      <p class="nota">* Cuota justa de la opción más probable (más o menos). Si tu casa paga más que eso, la apuesta tiene valor según el modelo. Resaltadas: las líneas donde una opción supera el 62 %.</p>` : ""}`;
  }

  const formaHTML = (f) => f.length
    ? `<span class="forma" aria-label="Últimos resultados: ${f.join(", ")}">${f.map((r) => `<i class="${r}">${r}</i>`).join("")}</span>`
    : `<span class="forma">Sin datos</span>`;

  function vistaPartidos() {
    const lista = partidosFiltrados();
    if (!lista.length) {
      return `<div class="vacio-msj"><h2>No hay partidos próximos</h2><p>Prueba con otra liga o vuelve después de la próxima actualización.</p></div>`;
    }
    let html = "", dia = null;
    for (const p of lista) {
      const d = nombreDia(p.f);
      if (d !== dia) { html += `<h2 class="dia">${d}</h2>`; dia = d; }
      html += tarjeta(p);
    }
    return html;
  }

  // ---------- Vista: combinadas ----------
  function boletoHTML(combo, titulo, clave) {
    const unoDe = Math.max(1, Math.round(1 / combo.prob));
    const grande = combo.elegidas.length >= 8;
    const monto = prefs.presupuesto > 0 ? prefs.presupuesto * (grande ? 0.01 : 0.03) : 0;
    return `
      <section class="boleto" aria-label="${esc(titulo)}">
        <div class="boleto-cab"><h2>${esc(titulo)}</h2><span>${combo.elegidas.length} selecciones</span></div>
        ${combo.comentario ? `<p class="comentario">${esc(combo.comentario)}</p>` : ""}
        ${combo.elegidas.map(({ partido: p, sel, motivo }) => `
          <div class="seleccion">
            <div class="quien">${esc(p.nom.h)} vs ${esc(p.nom.a)}, ${nombreDia(p.f).toLowerCase()} ${hora(p.f)}</div>
            <div class="que">${esc(sel.txt)}</div>
            <div class="cuanto"><b>${pct(sel.p)} %</b><span>${sel.o ? `cuota ${fmtCuota(sel.o)}${sel.est ? "*" : ""}` : `justa ${fmtCuota(sel.justa)}`}</span></div>
            ${motivo ? `<div class="motivo">${esc(motivo)}</div>` : ""}
          </div>`).join("")}
        <div class="corte"></div>
        <div class="resumen">
          <div class="grande"><b>${(combo.prob * 100).toFixed(combo.prob < 0.1 ? 1 : 0)} %</b>
            <span>Probabilidad estimada de acertar todas: más o menos 1 de cada ${unoDe} veces</span></div>
          <div><b>${combo.justa.toFixed(1)}</b><span>Cuota justa según el modelo</span></div>
          <div><b>${combo.cuota ? combo.cuota.toFixed(1) : "—"}</b><span>${combo.cuota ? "Cuota aproximada en casas" : "Sin cuotas de casas para todas"}</span></div>
          ${combo.ev != null ? `<div class="grande"><span class="${combo.ev > 0 ? "" : "alerta"}">${combo.ev > 0
            ? `Según el modelo, la cuota paga más de lo que debería (+${pct(combo.ev)} %).`
            : `Según el modelo, la cuota de las casas paga menos de lo justo (${pct(combo.ev)} %).`}</span></div>` : ""}
        </div>
        <div class="acciones">
          ${monto ? `<p style="margin:0 0 4px;width:100%">Monto sugerido según tu presupuesto: <b>${dinero(monto)}</b></p>` : ""}
          <button class="btn" data-registrar="${clave}">Registrar apuesta</button>
          <button class="btn sec" data-copiar="${clave}">Copiar selecciones</button>
        </div>
      </section>`;
  }

  function opcionVentana() {
    return `<label>Partidos de
      <select data-opc="ventana">
        ${[[1, "hoy"], [2, "hoy y mañana"], [3, "los próximos 3 días"], [7, "la semana"]]
          .map(([v, t]) => `<option value="${v}" ${v === prefs.ventana ? "selected" : ""}>${t}</option>`).join("")}
      </select></label>`;
  }

  function partidosVentana() {
    const limite = inicioDia(Date.now()) + prefs.ventana * DIA;
    return partidosFiltrados().filter((p) => Date.parse(p.f) < limite && Date.parse(p.f) > Date.now());
  }

  function vistaCombinadas() {
    estado.combos = {};
    const modo = prefs.modoComb;
    const selector = `
      <div class="control" role="group" aria-label="Quién arma la combinada">
        <button data-modo="ia" aria-pressed="${modo === "ia"}">Armada con IA</button>
        <button data-modo="modelo" aria-pressed="${modo === "modelo"}">Del modelo</button>
      </div>`;
    return selector + (modo === "ia" ? vistaIA() : vistaModelo());
  }

  // ----- Combinadas con IA -----
  function rehidratar(bloque, nivel) {
    if (!bloque?.sel?.length) return null;
    const elegidas = [];
    for (const s of bloque.sel) {
      const partido = estado.partidos.find((p) => p.id === s.pid);
      const sel = partido?.an.mercados.find((m) => m.k === s.k);
      if (partido && sel && Date.parse(partido.f) > Date.now() - 3 * 3600e3) elegidas.push({ partido, sel, motivo: s.motivo });
    }
    if (!elegidas.length) return null;
    const prob = elegidas.reduce((a, e) => a * e.sel.p, 1);
    const cuota = elegidas.every((e) => e.sel.o) ? elegidas.reduce((a, e) => a * e.sel.o, 1) : null;
    return { nivel, elegidas, prob, justa: 1 / prob, cuota, ev: cuota ? prob * cuota - 1 : null, comentario: bloque.comentario };
  }

  const iaActual = () => prefs.proveedorIA === "claude"
    ? { proveedor: "claude", nombre: "Claude", clave: prefs.claveIA, modelo: prefs.modeloIA }
    : { proveedor: "gemini", nombre: "Gemini", clave: prefs.claveGemini, modelo: prefs.modeloGemini };

  function vistaIA() {
    const ia = iaActual();
    if (!ia.clave) {
      return `<div class="bloque"><h2>Combinadas armadas por IA</h2>
        <p>La IA revisa todo el mercado del día (probabilidades, cuotas, córners, remates, paradas y tarjetas), puede buscar bajas y noticias en internet, y te arma una combinada simple de 4 o 5 selecciones y una arriesgada de 8 a 10, explicando cada elección.</p>
        <p>Puedes usarla gratis con una clave de Gemini de Google: entra a <b>aistudio.google.com</b>, inicia sesión con tu cuenta de Google y toca “Get API key”.</p>
        <button class="btn" data-ir-ajustes>Agregar clave en Ajustes</button></div>`;
    }
    const n = partidosVentana().length;
    const guardado = leer("ia", null);
    let html = `
      <div class="opciones">
        ${opcionVentana()}
        <label><input type="checkbox" data-opc="buscar" ${prefs.buscarIA ? "checked" : ""}> Buscar bajas y noticias en internet</label>
      </div>
      <button class="btn ancho" data-armar-ia ${estado.iaCargando || n < 4 ? "disabled" : ""}>
        ${estado.iaCargando ? "Armando…" : guardado ? "Volver a armar con IA" : "Armar con IA"}</button>
      <p class="estado-ia" role="status">${estado.iaCargando ? esc(estado.iaEstado) : n < 4 ? "Hay menos de 4 partidos en los días elegidos." : `${ia.nombre} revisará ${Math.min(n, 45)} partidos.`}</p>
      ${estado.iaError ? `<p class="nota alerta">${esc(estado.iaError)}</p>` : ""}`;
    if (guardado && !estado.iaCargando) {
      const simple = rehidratar(guardado.simple, "mediana");
      const arriesgada = rehidratar(guardado.arriesgada, "grande");
      html += `<p class="nota">Armadas ${hace(new Date(guardado.t).toISOString())}${guardado.ia ? ` por ${esc(guardado.ia)}` : ""}${guardado.buscar ? ", con búsqueda de noticias" : ""}. Las probabilidades se recalculan con los datos más recientes.</p>`;
      if (simple) { estado.combos.simple = simple; html += boletoHTML(simple, "Combinada simple", "simple"); }
      if (arriesgada) { estado.combos.arriesgada = arriesgada; html += `<div style="height:14px"></div>` + boletoHTML(arriesgada, "Combinada arriesgada", "arriesgada"); }
      if (!simple && !arriesgada) html += `<p class="nota">Los partidos de esas combinadas ya se jugaron. Arma unas nuevas.</p>`;
      if (guardado.avisos?.length) html += `<div class="bloque"><h2>Lo que vio la IA</h2>${guardado.avisos.map((a) => `<p>${esc(a)}</p>`).join("")}</div>`;
    }
    html += `<p class="nota">La IA trabaja sobre las probabilidades del modelo y puede equivocarse o perderse una noticia de último momento. Revisa las alineaciones antes de apostar.</p>`;
    return html;
  }

  async function armarIA() {
    estado.iaCargando = true; estado.iaError = null; estado.iaEstado = "Preparando el mercado del día…";
    pintar();
    try {
      const lista = partidosVentana();
      const ia = iaActual();
      const { crudo, indice } = await IA.armar({
        proveedor: ia.proveedor, partidos: lista, clave: ia.clave, modelo: ia.modelo, buscar: prefs.buscarIA,
        alAvanzar: (t) => { estado.iaEstado = t; const e = $(".estado-ia"); if (e) e.textContent = t; },
      });
      const conv = (b) => {
        const c = IA.aCombinada(b, indice);
        return c ? { comentario: c.comentario, sel: c.elegidas.map((e) => ({ pid: e.partido.id, k: e.sel.k, motivo: e.motivo })) } : null;
      };
      const sinBusqueda = (crudo.avisos || []).some((a) => String(a).startsWith("No se pudo usar la búsqueda"));
      const res = { t: Date.now(), buscar: prefs.buscarIA && !sinBusqueda, ia: iaActual().nombre, simple: conv(crudo.simple), arriesgada: conv(crudo.arriesgada), avisos: crudo.avisos || [] };
      if (!res.simple && !res.arriesgada) throw new Error("La IA no eligió mercados válidos. Intenta de nuevo.");
      guardar("ia", res);
    } catch (e) {
      estado.iaError = e.message === "Failed to fetch" ? "No hubo conexión con la IA. Revisa tu internet e intenta de nuevo." : e.message;
    } finally {
      estado.iaCargando = false;
      if (estado.vista === "combinadas") pintar();
    }
  }

  // ----- Combinada del modelo -----
  function vistaModelo() {
    const nivel = prefs.nivel;
    const cant = nivel === "mediana" ? prefs.cantMediana : prefs.cantGrande;
    const lista = partidosVentana();
    const hayCuotas = lista.some((p) => p.cuota);
    const hayStats = lista.some((p) => p.an.stats);
    const combo = Modelo.armarCombinada(lista, nivel, cant, prefs.soloValor && hayCuotas, prefs.conStats);
    const opcCant = nivel === "mediana" ? [4, 5] : [8, 9, 10, 12];

    let html = `
      <div class="control" role="group" aria-label="Tamaño de la combinada">
        <button data-nivel="mediana" aria-pressed="${nivel === "mediana"}">Mediana (4–5)</button>
        <button data-nivel="grande" aria-pressed="${nivel === "grande"}">Grande (8 o más)</button>
      </div>
      <div class="opciones">
        <label>Selecciones
          <select data-opc="cant">${opcCant.map((n) => `<option ${n === cant ? "selected" : ""}>${n}</option>`).join("")}</select>
        </label>
        ${opcionVentana()}
        ${hayCuotas ? `<label><input type="checkbox" data-opc="valor" ${prefs.soloValor ? "checked" : ""}> Solo selecciones con valor</label>` : ""}
        ${hayStats ? `<label><input type="checkbox" data-opc="stats" ${prefs.conStats ? "checked" : ""}> Incluir córners, remates, paradas y tarjetas</label>` : ""}
      </div>`;

    if (!combo) {
      return html + `<div class="vacio-msj"><h2>No hay suficientes partidos</h2><p>Amplía los días o activa más ligas para armar la combinada.</p></div>`;
    }
    estado.combos.modelo = combo;
    html += boletoHTML(combo, `Combinada ${Modelo.NIVELES[nivel].etiqueta.toLowerCase()}`, "modelo");
    if (combo.incompleta) html += `<p class="nota alerta">Solo hubo ${combo.elegidas.length} selecciones que cumplen el nivel de confianza. Amplía los días o activa más ligas.</p>`;
    html += `<p class="nota">El modelo elige en cada partido el mercado más sólido y nunca repite partido. Las probabilidades se multiplican: por eso una combinada grande casi nunca sale aunque cada selección parezca segura. Revisa alineaciones y bajas antes de apostar.</p>`;
    return html;
  }

  // ---------- Vista: tablas ----------
  function vistaTablas() {
    const liga = estado.datos.ligas[estado.liga];
    const hayStats = !!liga?._S;
    const control = `<div class="control" role="group" aria-label="Tipo de tabla">
      <button data-subtabla="posiciones" aria-pressed="${estado.subTabla === "posiciones"}">Posiciones</button>
      <button data-subtabla="estadisticas" aria-pressed="${estado.subTabla === "estadisticas"}">Estadísticas</button></div>`;
    if (liga?.soloMercado) {
      return `<div class="vacio-msj"><h2>Sin tabla para esta copa</h2><p>De ${esc(liga.nombre)} solo llegan las cuotas de los próximos partidos (el plan gratis de football-data.org no la incluye), así que no hay tabla ni forma de equipos. Sus partidos sí aparecen en Partidos y Combinadas.</p></div>`;
    }
    if (estado.subTabla === "estadisticas") return control + tablaStats(liga, hayStats);
    if (!liga?._tabla?.length) return control + `<div class="vacio-msj"><h2>Sin tabla todavía</h2><p>Esta liga aún no tiene partidos jugados en la temporada.</p></div>`;
    return control + `<div class="bloque"><h2>${esc(liga.nombre)}${liga.torneo ? `, ${esc(liga.torneo)}` : ""}</h2><div class="desliza"><table>
      <thead><tr><th class="n">#</th><th>Equipo</th><th class="n">PJ</th><th class="n">G</th><th class="n">E</th><th class="n">P</th><th class="n">GF</th><th class="n">GC</th><th class="n">DG</th><th class="n">Pts</th><th>Forma</th></tr></thead>
      <tbody>${liga._tabla.map((f, i) => {
        const eq = liga.equipos[f.id] || {};
        const dg = f.gf - f.gc;
        return `<tr><td class="n">${i + 1}</td><td><span class="eq">${escudo(eq)}<span>${esc(eq.n)}</span></span></td>
          <td class="n">${f.pj}</td><td class="n">${f.g}</td><td class="n">${f.e}</td><td class="n">${f.p}</td>
          <td class="n">${f.gf}</td><td class="n">${f.gc}</td>
          <td class="n">${dg > 0 ? "+" + dg : dg}</td><td class="n"><b>${f.pts}</b></td><td>${formaHTML(Modelo.forma(liga.jugados, f.id))}</td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="nota">Tabla calculada con los resultados de la temporada. Los criterios de desempate oficiales pueden cambiar algún puesto.</p></div>`;
  }

  const COLS_STATS = [
    ["tiros", "Rem."], ["aPuerta", "A puerta"], ["corners", "Córn."], ["paradas", "Paradas"],
    ["faltas", "Faltas"], ["amarillas", "Amar."], ["offside", "Fuera j."], ["posesion", "Pos. %"], ["xg", "xG"],
  ];
  function tablaStats(liga, hay) {
    if (!hay) {
      return `<div class="vacio-msj"><h2>Sin estadísticas todavía</h2><p>${estado.datos.conEstadisticas
        ? "Se están descargando poco a poco (cada hora). Vuelve más tarde."
        : "Agrega la clave de API-Football en Netlify para ver remates, córners, paradas y tarjetas (mira la guía)."}</p></div>`;
    }
    const S = liga._S;
    const orden = prefs.ordenStats;
    const contra = prefs.statsContra;
    const filas = Object.entries(S.equipos).map(([id, e]) => ({ id, e, eq: liga.equipos[id] || {} }));
    const v = (f, k) => f.e[k] ? (contra ? f.e[k].promContra : f.e[k].prom) : null;
    filas.sort((a, b) => (v(b, orden) ?? -1) - (v(a, orden) ?? -1));
    return `<div class="bloque"><h2>${esc(liga.nombre)}</h2>
      <div class="opciones">
        <label>Ordenar por <select data-opc="orden">${COLS_STATS.map(([k]) =>
          `<option value="${k}" ${k === orden ? "selected" : ""}>${Modelo.ST_NOMBRE[k]}</option>`).join("")}</select></label>
        <label><input type="checkbox" data-opc="contra" ${contra ? "checked" : ""}> Ver lo que reciben</label>
      </div>
      <div class="desliza"><table>
        <thead><tr><th>Equipo</th><th class="n">PJ</th>${COLS_STATS.map(([k, t]) => `<th class="n${k === orden ? " activo" : ""}">${t}</th>`).join("")}</tr></thead>
        <tbody>${filas.map((f) => `<tr><td><span class="eq">${escudo(f.eq)}<span>${esc(f.eq.n)}</span></span></td>
          <td class="n">${S.n[f.id] || 0}</td>
          ${COLS_STATS.map(([k]) => { const x = v(f, k); return `<td class="n${k === orden ? " activo" : ""}">${x == null ? "—" : x.toFixed(k === "posesion" ? 0 : 1)}</td>`; }).join("")}</tr>`).join("")}
        </tbody></table></div>
      <p class="nota">Promedios por partido ${contra ? "de lo que les hacen los rivales (por ejemplo, córners concedidos o paradas del portero rival)" : "a favor de cada equipo"}, con ${S.partidos} partidos con estadísticas.</p></div>`;
  }

  // ---------- Vista: ajustes ----------
  function semanaActual() {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes
    return d.getTime();
  }
  function infoStats(c) {
    const e = estado.datos?.estadisticas?.ligas?.[c];
    if (!e) return "";
    const txt = e.error ? `<span class="alerta">${esc(e.error)}</span>`
      : `${e.filas.length} partidos con estadísticas${e.pendientes ? `, faltan ${e.pendientes}` : ""}`;
    return `<br><small style="color:var(--suave)">${txt}</small>`;
  }

  function vistaAjustes() {
    const desde = semanaActual();
    const deSemana = apuestas.filter((a) => a.t >= desde);
    const gastado = deSemana.reduce((s, a) => s + a.monto, 0);
    const P = prefs.presupuesto;
    const uso = P > 0 ? Math.min(1, gastado / P) : 0;
    const ligas = Object.entries(estado.datos?.ligas || {});
    return `
      <section class="bloque">
        <h2>Presupuesto semanal</h2>
        <div class="campo">
          <input type="number" inputmode="numeric" min="0" step="1000" id="presupuesto" value="${P || ""}" placeholder="Ej. 50000" aria-label="Presupuesto semanal">
          <button class="btn" data-guardar-presupuesto>Guardar</button>
        </div>
        ${P > 0 ? `
          <div class="medidor ${gastado > P ? "pasado" : ""}"><i style="width:${uso * 100}%"></i></div>
          <p style="margin:0">Llevas <b>${dinero(gastado)}</b> de ${dinero(P)} esta semana.
            ${gastado > P ? `<span class="alerta">Pasaste tu límite: lo más sano es parar hasta el lunes.</span>` : `Te quedan ${dinero(P - gastado)}.`}</p>` :
          `<p class="nota">Define cuánto puedes perder sin que te afecte. La app sugiere montos con base en esa cifra.</p>`}
        ${deSemana.length ? `<div class="desliza" style="margin-top:12px"><table>
          <thead><tr><th>Fecha</th><th>Combinada</th><th class="n">Monto</th><th></th></tr></thead>
          <tbody>${deSemana.map((a) => `<tr><td>${new Date(a.t).toLocaleDateString("es", { day: "numeric", month: "short" })}</td>
            <td>${esc(a.desc)}</td><td class="n">${dinero(a.monto)}</td>
            <td><button class="btn sec" style="padding:4px 10px" data-borrar="${a.t}" aria-label="Quitar">Quitar</button></td></tr>`).join("")}
          </tbody></table></div>` : ""}
      </section>
      <section class="bloque">
        <h2>Inteligencia artificial</h2>
        <div class="control" role="group" aria-label="Proveedor de IA">
          <button data-proveedor="gemini" aria-pressed="${prefs.proveedorIA !== "claude"}">Gemini (gratis)</button>
          <button data-proveedor="claude" aria-pressed="${prefs.proveedorIA === "claude"}">Claude (de pago)</button>
        </div>
        ${prefs.proveedorIA === "claude" ? `
          <p style="margin-top:0">Clave de la API de Claude (console.anthropic.com). Se guarda solo en este celular.</p>
          <div class="campo">
            <input type="password" id="clave-ia" value="${esc(prefs.claveIA)}" placeholder="sk-ant-…" autocomplete="off" aria-label="Clave de la API de Claude" style="width:100%">
            <label style="width:100%">Modelo <input id="modelo-ia" value="${esc(prefs.modeloIA)}" aria-label="Modelo de Claude" style="width:100%"></label>
            <button class="btn" data-guardar-ia>Guardar</button>
          </div>
          <p class="nota">Cada combinada armada con Claude consume un poco de saldo de tu cuenta de Anthropic; con búsqueda de noticias consume más.</p>` : `
          <p style="margin-top:0">Clave gratis de Gemini: entra a <b>aistudio.google.com</b> con tu cuenta de Google y toca “Get API key”. Se guarda solo en este celular.</p>
          <div class="campo">
            <input type="password" id="clave-gemini" value="${esc(prefs.claveGemini)}" placeholder="AIza…" autocomplete="off" aria-label="Clave de Gemini" style="width:100%">
            <label style="width:100%">Modelo <input id="modelo-gemini" value="${esc(prefs.modeloGemini)}" aria-label="Modelo de Gemini" style="width:100%"></label>
            <button class="btn" data-guardar-ia>Guardar</button>
          </div>
          <p class="nota">El nivel gratis tiene un límite de uso por minuto y por día, de sobra para algunas combinadas diarias. Si un día se acaba, la app te avisa.</p>`}
      </section>
      <section class="bloque">
        <h2>Ligas</h2>
        ${ligas.map(([c, l]) => `<label class="interruptor"><span>${esc(l.nombre)}${l.error ? ` <span class="alerta">(error al actualizar)</span>` : ""}${infoStats(c)}</span>
          <input type="checkbox" data-liga-onoff="${c}" ${prefs.ligasOcultas.includes(c) ? "" : "checked"}></label>`).join("")}
      </section>
      <section class="bloque">
        <h2>Tema</h2>
        <div class="control" role="group" aria-label="Tema">
          ${[["auto", "Automático"], ["light", "Claro"], ["dark", "Oscuro"]].map(([v, t]) =>
            `<button data-tema="${v}" aria-pressed="${prefs.tema === v}">${t}</button>`).join("")}
        </div>
      </section>
      <section class="bloque">
        <h2>Cómo funciona el análisis</h2>
        <p>Con los resultados de la temporada, el modelo mide qué tan fuerte ataca y defiende cada equipo, dando más peso a los partidos recientes y separando local y visitante. Con eso estima los goles de cada lado y calcula la probabilidad de cada resultado con una distribución de Poisson.</p>
        <p>Con la clave de API-Football hace lo mismo con remates, remates a puerta, tiros de esquina, paradas del portero, faltas, tarjetas, fueras de juego, posesión y xG: cruza lo que cada equipo produce con lo que su rival suele conceder.</p>
        ${estado.datos?.conEstadisticas || estado.demo ? "" : `<p class="alerta">Sin clave de API-Football: la app solo analiza goles y resultados.</p>`}
        <p>Cuando hay cuotas de casas, compara: si la probabilidad del modelo multiplicada por la cuota da más de 1, la selección tiene “valor”. El modelo no conoce lesiones, rotaciones, clima ni motivación, así que úsalo como una opinión informada, no como certeza.</p>
        <p class="nota">Apostar debe ser entretenimiento. Si sientes que necesitas recuperar pérdidas o apuestas más de lo planeado, busca apoyo en las líneas de ayuda de juego responsable de tu país.</p>
        ${estado.demo ? `<p class="alerta">Estás viendo datos de prueba inventados.</p>` : ""}
      </section>`;
  }

  // ---------- Pintar ----------
  function pintar() {
    document.querySelectorAll(".pestanas button").forEach((b) => {
      if (b.dataset.vista === estado.vista) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    pintarLigas();
    if (!estado.datos) return;
    const v = estado.vista;
    contenido.innerHTML = v === "partidos" ? vistaPartidos()
      : v === "combinadas" ? vistaCombinadas()
      : v === "tablas" ? vistaTablas() : vistaAjustes();
  }

  function aplicarTema() {
    if (prefs.tema === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = prefs.tema;
  }

  // ---------- Eventos ----------
  document.querySelector(".pestanas").addEventListener("click", (e) => {
    const b = e.target.closest("[data-vista]");
    if (!b) return;
    estado.vista = b.dataset.vista;
    if (estado.vista !== "tablas" && estado.vista !== "ajustes" && !ligasVisibles().includes(estado.liga)) estado.liga = "todas";
    pintar();
    window.scrollTo(0, 0);
  });

  contenido.addEventListener("click", async (e) => {
    const t = e.target;
    const abrir = t.closest("[data-abrir]");
    if (abrir) {
      const id = abrir.dataset.abrir;
      estado.abiertos.has(id) ? estado.abiertos.delete(id) : estado.abiertos.add(id);
      const det = abrir.nextElementSibling;
      det.hidden = !estado.abiertos.has(id);
      abrir.setAttribute("aria-expanded", String(!det.hidden));
      return;
    }
    if (t.closest("[data-armar-ia]")) { armarIA(); return; }
    if (t.closest("[data-ir-ajustes]")) { estado.vista = "ajustes"; pintar(); window.scrollTo(0, 0); return; }
    const modo = t.closest("[data-modo]");
    if (modo) { prefs.modoComb = modo.dataset.modo; guardarPrefs(); pintar(); return; }
    if (t.closest("[data-guardar-ia]")) {
      if (prefs.proveedorIA === "claude") {
        prefs.claveIA = $("#clave-ia").value.trim(); prefs.modeloIA = $("#modelo-ia").value.trim() || "claude-sonnet-5-5";
      } else {
        prefs.claveGemini = $("#clave-gemini").value.trim(); prefs.modeloGemini = $("#modelo-gemini").value.trim() || "gemini-2.5-flash";
      }
      guardarPrefs(); pintar();
      const b = $("[data-guardar-ia]"); if (b) b.textContent = "Guardado ✓";
      return;
    }
    const prov = t.closest("[data-proveedor]");
    if (prov) { prefs.proveedorIA = prov.dataset.proveedor; guardarPrefs(); pintar(); return; }
    const sub = t.closest("[data-subtabla]");
    if (sub) { estado.subTabla = sub.dataset.subtabla; pintar(); return; }
    const nivel = t.closest("[data-nivel]");
    if (nivel) { prefs.nivel = nivel.dataset.nivel; guardarPrefs(); pintar(); return; }
    const tema = t.closest("[data-tema]");
    if (tema) { prefs.tema = tema.dataset.tema; guardarPrefs(); aplicarTema(); pintar(); return; }
    if (t.closest("[data-guardar-presupuesto]")) {
      prefs.presupuesto = Math.max(0, Number($("#presupuesto").value) || 0); guardarPrefs(); pintar(); return;
    }
    const borrar = t.closest("[data-borrar]");
    if (borrar) { apuestas = apuestas.filter((a) => String(a.t) !== borrar.dataset.borrar); guardar("apuestas", apuestas); pintar(); return; }
    const copiar = t.closest("[data-copiar]");
    if (copiar) {
      const c = estado.combos[copiar.dataset.copiar];
      const txt = c.elegidas.map(({ partido: p, sel }) => `${p.nom.h} vs ${p.nom.a}: ${sel.txt}`).join("\n");
      try { await navigator.clipboard.writeText(txt); t.textContent = "Selecciones copiadas"; } catch { t.textContent = "No se pudo copiar"; }
      return;
    }
    const reg = t.closest("[data-registrar]");
    if (reg) registrar(estado.combos[reg.dataset.registrar]);
  });

  contenido.addEventListener("change", (e) => {
    const t = e.target;
    const o = t.dataset.opc;
    if (o === "cant") { if (prefs.nivel === "mediana") prefs.cantMediana = Number(t.value); else prefs.cantGrande = Number(t.value); }
    else if (o === "ventana") prefs.ventana = Number(t.value);
    else if (o === "valor") prefs.soloValor = t.checked;
    else if (o === "stats") prefs.conStats = t.checked;
    else if (o === "buscar") prefs.buscarIA = t.checked;
    else if (o === "orden") prefs.ordenStats = t.value;
    else if (o === "contra") prefs.statsContra = t.checked;
    else if (t.dataset.ligaOnoff) {
      const c = t.dataset.ligaOnoff;
      prefs.ligasOcultas = t.checked ? prefs.ligasOcultas.filter((x) => x !== c) : [...prefs.ligasOcultas, c];
    } else return;
    guardarPrefs(); pintar();
  });

  function registrar(c) {
    if (!c) return;
    const dlg = $("#dialogo");
    const desde = semanaActual();
    const gastado = apuestas.filter((a) => a.t >= desde).reduce((s, a) => s + a.monto, 0);
    const P = prefs.presupuesto;
    const sugerido = P > 0 ? Math.round(P * (c.elegidas.length >= 8 ? 0.01 : 0.03)) : "";
    dlg.innerHTML = `
      <form method="dialog">
        <h2>Registrar apuesta</h2>
        <p>Combinada de ${c.elegidas.length} selecciones.</p>
        ${P > 0 && gastado >= P ? `<p class="alerta">Ya llegaste a tu presupuesto de esta semana.</p>` : ""}
        <div class="campo"><input type="number" inputmode="numeric" min="1" id="monto" value="${sugerido}" placeholder="Monto" aria-label="Monto" required></div>
        <div class="acciones" style="padding:16px 0 0">
          <button class="btn" value="ok">Guardar</button><button class="btn sec" value="cancelar" formnovalidate>Cancelar</button>
        </div>
      </form>`;
    dlg.showModal();
    dlg.addEventListener("close", function f() {
      dlg.removeEventListener("close", f);
      const monto = Number($("#monto", dlg)?.value);
      if (dlg.returnValue !== "ok" || !(monto > 0)) return;
      apuestas.push({ t: Date.now(), monto, desc: `Combinada de ${c.elegidas.length}` });
      apuestas = apuestas.filter((a) => a.t > Date.now() - 60 * DIA);
      guardar("apuestas", apuestas);
      estado.vista = "ajustes"; pintar();
    });
  }

  // ---------- Cargar datos ----------
  async function cargar(forzar = false) {
    const btn = $("#btn-actualizar");
    btn.classList.add("girando");
    try {
      const r = await fetch("/api/datos" + (forzar ? "?forzar=1" : ""), { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      estado.datos = j; estado.demo = false;
      procesar();
      const errores = Object.values(j.ligas).filter((l) => l.error).length;
      $("#estado-datos").textContent = `Actualizado ${hace(j.actualizado)}` + (errores ? ` (${errores} liga con error)` : "");
      pintar();
    } catch (err) {
      if (!estado.datos) mostrarError(err);
      else $("#estado-datos").textContent = "Sin conexión: mostrando los últimos datos";
    } finally {
      btn.classList.remove("girando");
    }
  }

  function mostrarError(err) {
    $("#estado-datos").textContent = "Sin datos";
    $("#ligas").hidden = true;
    contenido.innerHTML = `<div class="vacio-msj">
      <h2>No se pudieron cargar los partidos</h2>
      <p>${esc(err.message)}</p>
      <p>Revisa que las claves estén configuradas en Netlify (mira la guía de instalación) y vuelve a intentar.</p>
      <p><button class="btn" id="reintentar">Reintentar</button> <button class="btn sec" id="ver-demo">Ver con datos de prueba</button></p>
    </div>`;
    $("#reintentar").onclick = () => cargar(true);
    $("#ver-demo").onclick = () => { estado.datos = datosDemo(); estado.demo = true; procesar(); $("#estado-datos").textContent = "Datos de prueba inventados"; pintar(); };
  }

  // Datos inventados para probar la app sin claves
  function datosDemo() {
    const nombres = ["Leones", "Halcones", "Toros", "Tiburones", "Águilas", "Lobos", "Panteras", "Cóndores", "Osos", "Pumas", "Jaguares", "Búhos"];
    const rp = (l) => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; };
    const eqs = nombres.map((n, i) => ({ id: i + 1, n, f: n + " FC", c: "", at: Math.exp((Math.random() - 0.5) * 0.7), df: Math.exp((Math.random() - 0.5) * 0.7) }));
    const equipos = Object.fromEntries(eqs.map((e) => [e.id, { n: e.n, f: e.f, c: "" }]));
    const jugados = [], proximos = [], cuotas = [];
    let d = Date.now() - 70 * DIA;
    for (let r = 0; r < 10; r++, d += 7 * DIA) {
      const s = [...eqs].sort(() => Math.random() - 0.5);
      for (let i = 0; i < s.length; i += 2) jugados.push([new Date(d).toISOString().slice(0, 10), s[i].id, s[i + 1].id, rp(1.5 * s[i].at * s[i + 1].df), rp(1.15 * s[i + 1].at * s[i].df), 1]);
    }
    for (let k = 0; k < 3; k++) {
      const s = [...eqs].sort(() => Math.random() - 0.5);
      for (let i = 0; i < s.length; i += 2) {
        const f = new Date(inicioDia(Date.now()) + k * DIA + (14 + i) * 3600e3).toISOString();
        proximos.push({ id: 9000 + k * 100 + i, f, h: s[i].id, a: s[i + 1].id, j: 11 + k });
        // Cuotas inventadas a partir de la fuerza "real" de los equipos, con margen de casa y algo de ruido
        const F = { att: { 1: s[i].at, 2: s[i + 1].at }, def: { 1: s[i].df, 2: s[i + 1].df }, avgH: 1.5, avgA: 1.15, n: {} };
        const an = Modelo.analizar({ h: 1, a: 2 }, F, Modelo.baseLiga([]), null, { h: "", a: "" });
        const q = (p) => +(1 / (p * 1.06) * (0.93 + Math.random() * 0.14)).toFixed(2);
        cuotas.push({ h: s[i].f, a: s[i + 1].f, t: f, o1: q(an.p1), oX: q(an.pX), o2: q(an.p2),
          tot: { "1.5": [q(an.o15), q(1 - an.o15)], "2.5": [q(an.o25), q(1 - an.o25)], "3.5": [q(an.o35), q(1 - an.o35)] }, casas: 8 });
      }
    }
    const porId = Object.fromEntries(eqs.map((e) => [e.id, e]));
    const filas = jugados.map(([f, h, a, gh, ga]) => {
      const H = porId[h], A = porId[a];
      const lado = (yo, rival, golesRival, local) => {
        const tiros = rp((local ? 13 : 10.5) * yo.at * rival.df);
        const aPuerta = Math.min(tiros, rp(tiros * 0.36));
        return { tiros, aPuerta, corners: rp((local ? 5.3 : 4.4) * yo.at * rival.df), golesRival };
      };
      const x = lado(H, A, ga, true), y = lado(A, H, gh, false);
      const pos = Math.round(Math.min(72, Math.max(28, 50 + 18 * (H.at - A.at) + 3)));
      const fila = (m, o, posesion, goles) => [m.tiros, m.aPuerta, m.corners, Math.max(0, o.aPuerta - m.golesRival),
        rp(11.5), rp(2.1), Math.random() < 0.06 ? 1 : 0, rp(1.8), posesion, +(goles * 0.6 + m.aPuerta * 0.12).toFixed(2)];
      return [f, H.f, A.f, fila(x, y, pos, gh), fila(y, x, 100 - pos, ga)];
    });
    return {
      actualizado: new Date().toISOString(), conEstadisticas: true,
      estadisticas: { ligas: { DEMO: { filas, pendientes: 0, error: null } } },
      ligas: {
        DEMO: { nombre: "Liga de prueba", equipos, jugados, proximos, cuotas },
        COPA: {
          nombre: "Copa de prueba", soloMercado: true, jugados: [],
          equipos: { "Dragones": { n: "Dragones", f: "Dragones", c: "" }, "Gaviotas": { n: "Gaviotas", f: "Gaviotas", c: "" } },
          proximos: [{ id: "copa-1", f: new Date(inicioDia(Date.now()) + DIA + 19 * 3600e3).toISOString(), h: "Dragones", a: "Gaviotas", j: null }],
          cuotas: [{ id: "copa-1", h: "Dragones", a: "Gaviotas", t: "", o1: 2.05, oX: 3.4, o2: 3.6, tot: { "2.5": [1.9, 1.9] }, casas: 20 }],
        },
      },
    };
  }

  $("#btn-actualizar").addEventListener("click", () => (estado.demo ? null : cargar(true)));

  aplicarTema();
  cargar();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
