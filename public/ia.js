// Arma combinadas con IA a partir del mercado del día.
// Proveedores: Gemini de Google (tiene nivel gratis) o Claude de Anthropic (de pago).
// La clave se guarda solo en este celular y la llamada va directo al proveedor.
const IA = (() => {
  const URL_API = "https://api.anthropic.com/v1/messages";
  const pct = (x) => Math.round(x * 100);

  // Convierte los partidos analizados en una lista compacta de mercados con id
  function mercadoDelDia(partidos, maxPartidos = 45) {
    const indice = {};
    const lineas = [];
    partidos.slice(0, maxPartidos).forEach((p, i) => {
      const P = `P${i + 1}`;
      const an = p.an;
      const fecha = new Date(p.f).toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      let cab = `${P} | ${p.ligaNombre} | ${fecha} | ${p.nom.h} vs ${p.nom.a}` +
        ` | modelo 1X2: ${pct(an.p1)}/${pct(an.pX)}/${pct(an.p2)} %` +
        ` | goles esperados ${an.lh.toFixed(1)}-${an.la.toFixed(1)}` +
        ` | forma ${p.fH.join("") || "?"} / ${p.fA.join("") || "?"}` +
        ` | confianza datos: ${an.confianza}`;
      if (an.stats?.corners) cab += ` | córners esp ${(an.stats.corners[0] + an.stats.corners[1]).toFixed(1)}`;
      if (an.stats?.amarillas) cab += ` | amarillas esp ${(an.stats.amarillas[0] + an.stats.amarillas[1]).toFixed(1)}`;
      lineas.push(cab);

      const goles = an.mercados.filter((m) => !m.grupo && m.p >= 0.4 && m.p <= 0.93)
        .sort((a, b) => b.p - a.p).slice(0, 9);
      const stats = an.mercados.filter((m) => m.grupo && m.p >= 0.55 && m.p <= 0.9)
        .sort((a, b) => b.p - a.p).slice(0, 5);
      for (const m of [...goles, ...stats]) {
        const id = `${P}:${m.k}`;
        indice[id] = { partido: p, sel: m };
        let l = `  ${id} ${m.txt} | prob ${pct(m.p)} % | cuota justa ${m.justa.toFixed(2)}`;
        if (m.o) l += ` | casa ${m.o.toFixed(2)}${m.est ? " (estimada)" : ""} | valor ${m.ev > 0 ? "+" : ""}${pct(m.ev)} %`;
        lineas.push(l);
      }
    });
    return { texto: lineas.join("\n"), indice };
  }

  const SISTEMA = `Eres un analista de apuestas de fútbol. Recibes el mercado del día: partidos con probabilidades calculadas por un modelo estadístico (Poisson con fuerza de ataque y defensa), cuotas de casas cuando existen y mercados de goles, resultado, córners, remates, paradas y tarjetas. Cada mercado tiene un id como "P3:1X".

Tu tarea es armar dos combinadas:
- "simple": de 4 o 5 selecciones, la opción más sensata del día.
- "arriesgada": de 8 a 10 selecciones, buscando una cuota alta sin elegir selecciones absurdas.

Reglas:
- Usa SOLO ids que aparezcan en la lista. Copia el id exacto.
- Máximo una selección por partido dentro de cada combinada.
- Prefiere selecciones con valor (cuando hay cuota de casa) y con confianza de datos alta o media.
- Evita selecciones con probabilidad muy alta y cuota casi nula (menos de 1.15), porque no aportan.
- Mezcla tipos de mercado cuando tenga sentido; no te limites a goles.
- Si puedes buscar en internet, revisa bajas, lesiones, rotaciones y alineaciones de los partidos que elijas, y descarta los que tengan dudas serias. Menciona lo que encontraste.
- Sé honesto: ninguna combinada es segura. No exageres la confianza.

Responde ÚNICAMENTE con un objeto JSON, sin texto antes ni después y sin bloques de código, con esta forma:
{"simple":{"selecciones":[{"id":"P3:1X","motivo":"frase corta"}],"comentario":"una o dos frases"},
 "arriesgada":{"selecciones":[{"id":"P1:O15","motivo":"frase corta"}],"comentario":"una o dos frases"},
 "avisos":["frase corta"]}`;

  function extraerJSON(texto) {
    const limpio = texto.replace(/```json|```/g, "");
    const a = limpio.indexOf("{"), b = limpio.lastIndexOf("}");
    if (a < 0 || b < a) throw new Error("La IA no devolvió un resultado válido. Intenta de nuevo.");
    return JSON.parse(limpio.slice(a, b + 1));
  }

  // ---------- Gemini (Google) ----------
  async function llamarGemini(clave, modelo, texto, buscar) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
    const cuerpo = {
      systemInstruction: { parts: [{ text: SISTEMA }] },
      contents: [{ role: "user", parts: [{ text: texto }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    };
    // La búsqueda en Google no se puede combinar con la respuesta en JSON forzado
    if (buscar) cuerpo.tools = [{ google_search: {} }];
    else cuerpo.generationConfig.responseMimeType = "application/json";

    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": clave },
      body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || `HTTP ${r.status}`;
      const e = new Error(msg);
      e.status = r.status;
      if (r.status === 429) e.message = "Llegaste al límite gratis de Gemini por ahora. Espera un minuto (o hasta mañana) e intenta de nuevo.";
      else if (r.status === 404) e.message = `El modelo "${modelo}" no existe o ya no está disponible. Cámbialo en Ajustes.`;
      else if (/api key/i.test(msg)) e.message = "La clave de Gemini no es válida. Revísala en Ajustes.";
      else e.message = `Error de Gemini: ${msg}`;
      throw e;
    }
    const cand = j.candidates?.[0];
    const t = (cand?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("\n");
    if (!t) {
      throw new Error(cand?.finishReason === "MAX_TOKENS"
        ? "La respuesta de Gemini quedó incompleta. Elige menos días e intenta de nuevo."
        : "Gemini no devolvió respuesta. Intenta de nuevo.");
    }
    return t;
  }

  async function armarGemini({ clave, modelo, buscar, texto, alAvanzar }) {
    alAvanzar(buscar ? "Gemini está revisando el mercado y buscando noticias…" : "Gemini está revisando el mercado…");
    try {
      return { texto: await llamarGemini(clave, modelo, texto, buscar), avisos: [] };
    } catch (e) {
      // Si falla la búsqueda en Google (no disponible en el plan), se reintenta sin ella
      if (buscar && (e.status === 400 || e.status === 403 || e.status === 429)) {
        alAvanzar("La búsqueda no está disponible; Gemini sigue sin noticias…");
        const t = await llamarGemini(clave, modelo, texto, false);
        return { texto: t, avisos: ["No se pudo usar la búsqueda de noticias en esta ocasión: la combinada se armó solo con los datos."] };
      }
      throw e;
    }
  }

  // ---------- Claude (Anthropic) ----------
  async function llamar(clave, cuerpo) {
    const r = await fetch(URL_API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": clave,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || `HTTP ${r.status}`;
      if (r.status === 401) throw new Error("La clave de Claude no es válida. Revísala en Ajustes.");
      if (r.status === 404) throw new Error(`El modelo no existe: ${msg}. Cambia el modelo en Ajustes.`);
      throw new Error(`Error de la IA: ${msg}`);
    }
    return j;
  }

  async function armarClaude({ clave, modelo, buscar, texto, alAvanzar }) {
    const cuerpo = {
      model: modelo,
      max_tokens: 4000,
      system: SISTEMA,
      messages: [{ role: "user", content: texto }],
    };
    if (buscar) cuerpo.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }];
    alAvanzar(buscar ? "Claude está revisando el mercado y buscando noticias…" : "Claude está revisando el mercado…");
    let resp = await llamar(clave, cuerpo);
    // Las búsquedas largas pueden pausar el turno: se continúa hasta 3 veces
    for (let i = 0; i < 3 && resp.stop_reason === "pause_turn"; i++) {
      alAvanzar("Claude sigue buscando información…");
      cuerpo.messages = [...cuerpo.messages, { role: "assistant", content: resp.content }];
      resp = await llamar(clave, cuerpo);
    }
    return { texto: (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n"), avisos: [] };
  }

  async function armar({ proveedor = "gemini", partidos, clave, modelo, buscar, alAvanzar = () => {} }) {
    const nombre = proveedor === "claude" ? "Claude" : "Gemini";
    if (!clave) throw new Error(`Falta tu clave de ${nombre}. Agrégala en Ajustes.`);
    const { texto, indice } = mercadoDelDia(partidos);
    if (Object.keys(indice).length < 4) throw new Error("No hay suficientes mercados en los días elegidos.");
    const pedido = `Mercado del día (${new Date().toLocaleDateString("es")}):\n\n${texto}`;
    const args = { clave, modelo, buscar, texto: pedido, alAvanzar };
    const res = proveedor === "claude" ? await armarClaude(args) : await armarGemini(args);
    const j = extraerJSON(res.texto);
    j.avisos = [...(Array.isArray(j.avisos) ? j.avisos : []), ...res.avisos];
    return { crudo: j, indice };
  }

  // Convierte la respuesta en combinadas con las probabilidades del modelo
  function aCombinada(bloque, indice, nivel) {
    if (!bloque?.selecciones?.length) return null;
    const usados = new Set();
    const elegidas = [];
    for (const s of bloque.selecciones) {
      const it = indice[String(s.id || "").trim()];
      if (!it || usados.has(it.partido.id)) continue;
      usados.add(it.partido.id);
      elegidas.push({ ...it, motivo: s.motivo || "" });
    }
    if (!elegidas.length) return null;
    elegidas.sort((x, y) => x.partido.f.localeCompare(y.partido.f));
    const prob = elegidas.reduce((s, e) => s * e.sel.p, 1);
    const todas = elegidas.every((e) => e.sel.o);
    const cuota = todas ? elegidas.reduce((s, e) => s * e.sel.o, 1) : null;
    return {
      nivel, elegidas, prob, justa: 1 / prob, cuota, ev: cuota ? prob * cuota - 1 : null,
      comentario: bloque.comentario || "",
    };
  }

  return { armar, aCombinada, mercadoDelDia };
})();
