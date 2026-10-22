# La Pizarra: análisis de fútbol en tu celular

App que analiza los partidos de Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, Champions League, Brasileirão y Liga BetPlay (Colombia): goles, resultados, remates, remates a puerta, tiros de esquina, paradas del portero, faltas, tarjetas, fueras de juego, posesión y xG. Calcula probabilidades y arma combinadas de dos formas: con el modelo estadístico, o con inteligencia artificial (Claude), que revisa todo el mercado del día, busca bajas y noticias, y te propone una combinada simple de 4 o 5 selecciones y una arriesgada de 8 a 10. Se actualiza sola todos los días.

Necesitas unos 20 minutos y, mejor, un computador para la instalación. Todo es gratis.

## 1. Saca las claves de datos

**Partidos y resultados (obligatoria).** Entra a https://www.football-data.org/client/register, regístrate con tu correo y te llega una clave (API token). Guárdala.

**Cuotas de casas de apuestas (opcional, pero recomendada).** Entra a https://the-odds-api.com, elige el plan gratis (500 créditos al mes) y copia tu clave. La app gasta unos 14 créditos al día, así que el plan gratis alcanza. Sin esta clave la app funciona igual, pero no podrá decirte qué apuestas tienen valor.

**Remates, córners, paradas y tarjetas (opcional).** Entra a https://dashboard.api-football.com/register, crea tu cuenta y copia tu clave (API key). Sin esta clave la app solo analiza goles y resultados.

Esta clave también es la que trae los partidos de la **Liga BetPlay**, porque football-data.org no tiene la liga colombiana. Sin ella, Colombia no aparece.

Ojo: el plan gratis de API-Football tiene 100 pedidos al día y es posible que no incluya la temporada actual. Si en Ajustes ves un aviso como "Free plans do not have access to this season", necesitas su plan pagado más económico (revisa el precio actual en su web). Con plan gratis la app descarga las estadísticas poco a poco, cada hora, y tarda unos días en completar la temporada; con plan pagado lo hace en horas.

**Combinadas con IA (opcional).** Entra a https://console.anthropic.com, crea una cuenta, carga saldo y crea una clave en "API Keys". Esta clave **no** va en Netlify: la pegas dentro de la app, en Ajustes → Inteligencia artificial, y queda guardada solo en tu celular. Cada combinada armada con IA gasta un poco de saldo; con la búsqueda de noticias activada gasta más. Revisa los precios en https://docs.claude.com.

## 2. Sube el proyecto a GitHub

1. Crea una cuenta en https://github.com.
2. Pulsa "New repository", ponle un nombre (por ejemplo `la-pizarra`) y créalo.
3. En el repositorio vacío, pulsa "uploading an existing file".
4. Descomprime el .zip y arrastra **el contenido** de la carpeta `futbol-ia` (las carpetas `netlify` y `public`, y los archivos `netlify.toml`, `package.json` y este `LEEME.md`). Pulsa "Commit changes".

## 3. Publícala en Netlify

1. Entra a https://app.netlify.com y regístrate con tu cuenta de GitHub.
2. Pulsa "Add new site" → "Import an existing project" → GitHub, y elige tu repositorio.
3. No cambies nada de la configuración y pulsa "Deploy".
4. Ve a "Site configuration" → "Environment variables" y agrega:
   - `FOOTBALL_DATA_KEY` con la clave de football-data.org
   - `ODDS_API_KEY` con la clave de the-odds-api.com (si la sacaste)
   - `API_FOOTBALL_KEY` con la clave de API-Football (si la sacaste)
   - Solo si pagas un plan de API-Football: `API_FOOTBALL_LIMITE_DIA` = `5000` y `API_FOOTBALL_POR_PASADA` = `20`, para que descargue más rápido.
5. Ve a "Deploys" → "Trigger deploy" → "Deploy site" para que tome las claves.

Netlify te da una dirección como `https://la-pizarra-123.netlify.app`. Puedes cambiarla en "Site configuration" → "Change site name".

(Los nombres de los botones de Netlify y GitHub pueden variar un poco con el tiempo.)

## 4. Instálala en el celular

**Android (Chrome):** abre tu dirección de Netlify, toca el menú ⋮ y elige "Instalar aplicación" o "Agregar a la pantalla principal".

**iPhone (Safari):** abre la dirección, toca el botón Compartir y elige "Agregar a inicio".

Queda con su ícono como cualquier app.

## Cómo se actualiza

Todos los días a las 9:00 UTC (4:00 am en Colombia, 11:00 en España) Netlify descarga los partidos y cuotas nuevas. Las estadísticas de remates, córners y paradas se descargan cada hora, poco a poco, para no pasarse del límite del plan. El botón de actualizar dentro de la app fuerza una descarga (como máximo cada 15 minutos, para no pasarte de los límites gratis). Las cuotas se descargan una vez al día.

## Qué hace el análisis

- Mide la fuerza de ataque y defensa de cada equipo con los resultados de la temporada, dando más peso a lo reciente.
- Calcula goles esperados y la probabilidad de cada resultado (1X2, doble oportunidad, más/menos goles, ambos marcan).
- Hace lo mismo con remates, remates a puerta, córners, paradas, faltas, tarjetas, fueras de juego, posesión y xG: cruza lo que produce cada equipo con lo que concede su rival, y calcula la probabilidad de las líneas más comunes (por ejemplo, córners totales más de 9.5 o paradas del portero más de 2.5).
- En Tablas muestra posiciones y un ranking de estadísticas por equipo, a favor y en contra.
- Compara con las cuotas de las casas para marcar las selecciones con valor.
- Arma las combinadas eligiendo en cada partido el mercado más sólido (de goles, resultado, córners, remates, paradas o tarjetas) y te muestra la probabilidad real de acertarlas todas.
- Lleva tu presupuesto semanal y te avisa si lo pasas.

Para córners, tarjetas y paradas no hay cuotas automáticas: compara la "cuota justa" de la app con lo que paga tu casa. Las tarjetas dependen mucho del árbitro, que el modelo no conoce. El modelo tampoco sabe de lesiones, rotaciones ni motivación, y nadie puede garantizar resultados. Úsalo como una opinión informada, revisa las noticias de cada partido y apuesta solo lo que puedas perder.

## Combinadas con IA

En Combinadas → "Armada con IA", eliges los días (hoy, hoy y mañana, 3 días o la semana) y tocas "Armar con IA". Claude recibe todos los partidos de esos días con las probabilidades del modelo, las cuotas y las líneas de córners, remates, paradas y tarjetas. Si dejas marcada la búsqueda en internet, revisa bajas y alineaciones. Te devuelve:

- **Combinada simple:** 4 o 5 selecciones, la opción más sensata del día.
- **Combinada arriesgada:** 8 a 10 selecciones, buscando una cuota alta.

Cada selección trae el motivo, y abajo verás lo que encontró la IA. Las probabilidades que muestra la app son siempre las del modelo, recalculadas con los datos más recientes.

El modelo de Claude viene configurado como `claude-sonnet-5-5`. Si Anthropic lo cambia y la app te avisa que el modelo no existe, cámbialo en Ajustes por uno vigente (la lista está en https://docs.claude.com).

## Liga BetPlay

Los partidos y estadísticas de Colombia vienen de API-Football. La tabla muestra el torneo en curso (Apertura o Finalización). Es posible que no haya cuotas automáticas para la liga colombiana; en ese caso compara la cuota justa de la app con la de tu casa de apuestas.

## Probarla sin claves

Si abres la app sin las claves configuradas, aparece el botón "Ver con datos de prueba" para recorrerla con una liga inventada.
