/* Mapa vivo de problemas hídricos y de residuos de Jalisco */
(() => {
  "use strict";

  const COLOR = { agua: "--agua", residuos: "--residuos", ambos: "--ambos" };
  const TIPO_TXT = { agua: "Agua", residuos: "Residuos", ambos: "Agua + residuos" };
  const GRAV_TXT = { 5: "Crítica", 4: "Alta", 3: "Media", 2: "Baja", 1: "Local" };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let problemas = [];
  let noticias = { generales: [], por_problema: {} };
  let clima = {};            // id -> {ahora, ult24, prox24}
  const marcadores = {};     // id -> L.circleMarker
  const fotosCache = {};
  let seleccion = null;
  const filtro = { tipo: "todos", gravMin: 1, texto: "" };

  // ---------- Mapa ----------
  const mapa = L.map("mapa", { zoomControl: true, preferCanvas: false }).setView([20.55, -103.6], 8);
  const base = {
    "Calles (OSM)": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap",
    }),
    "Satélite (Esri)": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "Imágenes © Esri, Maxar, Earthstar Geographics",
    }),
    "Relieve (OpenTopoMap)": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17, attribution: "© OpenTopoMap (CC-BY-SA)",
    }),
  };
  base["Calles (OSM)"].addTo(mapa);
  const capaPuntos = L.layerGroup().addTo(mapa);
  const capaLluvia = L.layerGroup();
  L.control.layers(base, { "Problemas": capaPuntos, "Lluvia próximas 24 h": capaLluvia }, { collapsed: true, position: "topleft" }).addTo(mapa);
  L.control.scale({ imperial: false }).addTo(mapa);

  fetch("data/jalisco.geojson").then((r) => r.json()).then((g) => {
    L.geoJSON(g, { interactive: false, style: { color: css("--acento"), weight: 2, fillOpacity: 0.03, dashArray: "4 4" } }).addTo(mapa);
  }).catch(() => {});

  // ---------- Carga de datos ----------
  async function cargarProblemas() {
    const r = await fetch("data/problemas.json?v=" + Date.now());
    const d = await r.json();
    problemas = d.problemas.map((p, i) => ({ ...p, rango: i + 1 }));
    dibujarMarcadores();
    dibujarLista();
  }

  async function cargarNoticias() {
    try {
      const r = await fetch("data/noticias.json?v=" + Date.now(), { cache: "no-store" });
      noticias = await r.json();
      dibujarNoticias();
      dibujarLista();
      if (seleccion) dibujarNoticiasDetalle(seleccion);
      estado();
    } catch (e) { /* se mantiene lo anterior */ }
  }

  async function cargarClima() {
    if (!problemas.length) return;
    const lat = problemas.map((p) => p.lat.toFixed(3)).join(",");
    const lng = problemas.map((p) => p.lng.toFixed(3)).join(",");
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=precipitation,temperature_2m&hourly=precipitation&past_days=1&forecast_days=2&timezone=America%2FMexico_City`;
    try {
      const r = await fetch(url);
      let d = await r.json();
      if (!Array.isArray(d)) d = [d];
      d.forEach((c, i) => {
        const p = problemas[i];
        const h = c.hourly; const ahoraIso = c.current.time.slice(0, 13);
        let idx = h.time.findIndex((t) => t.slice(0, 13) === ahoraIso);
        if (idx < 0) idx = 24;
        const suma = (a, b) => h.precipitation.slice(Math.max(0, a), b).reduce((s, x) => s + (x || 0), 0);
        clima[p.id] = {
          ahora: c.current.precipitation, temp: c.current.temperature_2m,
          ult24: suma(idx - 24, idx), prox24: suma(idx, idx + 24),
        };
      });
      dibujarLluvia();
      dibujarLista();
      if (seleccion) dibujarClimaDetalle(seleccion);
      estado();
    } catch (e) { /* sin clima */ }
  }

  // ---------- Render ----------
  function radio(g) { return 5 + g * 3.2; }

  function dibujarMarcadores() {
    capaPuntos.clearLayers();
    [...problemas].sort((a, b) => a.gravedad - b.gravedad).forEach((p) => {
      const color = css(COLOR[p.tipo]);
      const m = L.circleMarker([p.lat, p.lng], {
        radius: radio(p.gravedad), color: "#fff", weight: 1.5, fillColor: color, fillOpacity: 0.82,
      });
      m.bindTooltip(`<b>#${p.rango}</b> ${esc(p.titulo)}`, { direction: "top", offset: [0, -radio(p.gravedad)] });
      m.on("click", () => abrir(p.id));
      m.addTo(capaPuntos);
      marcadores[p.id] = m;
    });
    aplicarFiltro();
  }

  function dibujarLluvia() {
    capaLluvia.clearLayers();
    problemas.forEach((p) => {
      const c = clima[p.id]; if (!c || c.prox24 < 0.5) return;
      L.circle([p.lat, p.lng], {
        radius: Math.min(25000, 3000 + c.prox24 * 900), color: css("--agua"), weight: 1, fillOpacity: 0.12, interactive: false,
      }).addTo(capaLluvia);
    });
  }

  function visible(p) {
    if (filtro.tipo !== "todos" && p.tipo !== filtro.tipo) return false;
    if (p.gravedad < filtro.gravMin) return false;
    if (filtro.texto) {
      const t = (p.titulo + " " + p.municipios.join(" ") + " " + p.descripcion).toLowerCase();
      if (!t.normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(filtro.texto)) return false;
    }
    return true;
  }

  function aplicarFiltro() {
    problemas.forEach((p) => {
      const m = marcadores[p.id]; if (!m) return;
      if (visible(p)) { if (!capaPuntos.hasLayer(m)) capaPuntos.addLayer(m); }
      else capaPuntos.removeLayer(m);
    });
  }

  function dibujarLista() {
    const ol = $("#lista");
    const vis = problemas.filter(visible);
    ol.innerHTML = vis.map((p) => {
      const c = clima[p.id];
      const n = (noticias.por_problema?.[p.id] || []).length;
      const ll = c && c.prox24 >= 1 ? `<span class="lluvia" title="Lluvia pronosticada próximas 24 h">🌧 ${c.prox24.toFixed(0)} mm/24h</span>` : "";
      return `<li data-id="${p.id}" class="${seleccion === p.id ? "sel" : ""}">
        <span class="num">${p.rango}</span>
        <div>
          <h3>${esc(p.titulo)}</h3>
          <div class="linea">
            <span class="grav g${p.gravedad}">${GRAV_TXT[p.gravedad]}</span>
            <span><i class="dot ${p.tipo}"></i> ${TIPO_TXT[p.tipo]}</span>
            <span>· ${esc(p.municipios.slice(0, 2).join(", "))}</span>
            ${n ? `<span>· 📰 ${n}</span>` : ""}
            ${ll}
          </div>
        </div></li>`;
    }).join("") || `<li><span></span><div class="meta">Sin resultados con estos filtros.</div></li>`;
  }

  function fechaRel(iso) {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    const d = Math.round(s / 86400);
    return d === 1 ? "ayer" : `hace ${d} días`;
  }

  function itemNoticia(n) {
    return `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.titulo)}</a>
      <div class="meta">${esc(n.fuente)} · ${fechaRel(n.fecha)}</div></li>`;
  }

  function dibujarNoticias() {
    $("#noticiasMeta").textContent = noticias.generado
      ? `Actualizado ${fechaRel(noticias.generado)} · se revisa cada 3 h automáticamente` : "";
    $("#noticiasGen").innerHTML = (noticias.generales || []).map(itemNoticia).join("") ||
      `<li class="meta">Aún no hay noticias descargadas.</li>`;
  }

  function estado() {
    const partes = [];
    if (noticias.generado) partes.push(`Noticias ${fechaRel(noticias.generado)}`);
    if (Object.keys(clima).length) partes.push("Lluvia en vivo");
    $("#estadoTexto").textContent = partes.join(" · ") || "En línea";
  }

  // ---------- Detalle ----------
  function abrir(id) {
    const p = problemas.find((x) => x.id === id); if (!p) return;
    seleccion = id;
    const enc = encodeURIComponent;
    const det = $("#detalle");
    det.classList.remove("oculto");
    det.innerHTML = `
      <div class="cab">
        <button class="cerrar" aria-label="Cerrar">×</button>
        <h2>#${p.rango} · ${esc(p.titulo)}</h2>
        <div class="linea" style="display:flex;gap:6px;flex-wrap:wrap;font-size:12px;color:var(--suave)">
          <span class="grav g${p.gravedad}">Gravedad ${p.gravedad}/5 · ${GRAV_TXT[p.gravedad]}</span>
          <span><i class="dot ${p.tipo}"></i> ${TIPO_TXT[p.tipo]}</span>
        </div>
      </div>
      <div class="cuerpo">
        <p>${esc(p.descripcion)}</p>
        <p class="estado"><b>Situación actual:</b> ${esc(p.estado)}</p>
        <p class="meta"><b>Municipios:</b> ${esc(p.municipios.join(", "))}<br><b>Afectados:</b> ${esc(p.afectados)}</p>
        <div class="acciones">
          <button class="btn" id="btnSat">🛰 Ver en satélite</button>
          <a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}">📍 Google Maps</a>
          <a class="btn" target="_blank" rel="noopener" href="https://news.google.com/search?q=${enc(p.busqueda)}&hl=es-419&gl=MX&ceid=MX:es-419">🔎 Más noticias</a>
        </div>
        <h4>Lluvia en este punto (en vivo)</h4>
        <div id="detClima" class="clima"><div><span>Cargando…</span></div></div>
        <h4>Imágenes reales</h4>
        <div id="detFotos" class="fotos"><span class="meta">Buscando imágenes…</span></div>
        <h4>Noticias recientes</h4>
        <ul id="detNoticias" class="noticias"></ul>
        ${p.fuentes.length ? `<h4>Fuentes</h4><ul class="fuentes">${p.fuentes.map((f) =>
          `<li><a href="${esc(f.u)}" target="_blank" rel="noopener">${esc(f.t)}</a></li>`).join("")}</ul>` : ""}
      </div>`;
    det.querySelector(".cerrar").onclick = cerrar;
    det.querySelector("#btnSat").onclick = () => {
      Object.values(base).forEach((l) => mapa.removeLayer(l));
      base["Satélite (Esri)"].addTo(mapa);
      mapa.flyTo([p.lat, p.lng], 14);
    };
    det.scrollTop = 0;
    dibujarClimaDetalle(id);
    dibujarNoticiasDetalle(id);
    cargarFotos(p);
    mapa.flyTo([p.lat, p.lng], Math.max(mapa.getZoom(), 10), { duration: 0.8 });
    Object.entries(marcadores).forEach(([k, m]) => m.setStyle({ weight: k === id ? 4 : 1.5, color: k === id ? css("--texto") : "#fff" }));
    dibujarLista();
    const li = document.querySelector(`#lista li[data-id="${id}"]`);
    if (li) li.scrollIntoView({ block: "nearest" });
    history.replaceState(null, "", "#" + id);
  }

  function cerrar() {
    seleccion = null;
    $("#detalle").classList.add("oculto");
    Object.values(marcadores).forEach((m) => m.setStyle({ weight: 1.5, color: "#fff" }));
    dibujarLista();
    history.replaceState(null, "", location.pathname + location.search);
  }

  function dibujarClimaDetalle(id) {
    const el = $("#detClima"); if (!el || seleccion !== id) return;
    const c = clima[id];
    if (!c) { el.innerHTML = `<div style="grid-column:1/-1"><span>Sin datos de clima por ahora</span></div>`; return; }
    el.innerHTML = `
      <div><b>${c.ahora.toFixed(1)}</b><span>mm ahora</span></div>
      <div><b>${c.ult24.toFixed(1)}</b><span>mm últimas 24 h</span></div>
      <div><b>${c.prox24.toFixed(1)}</b><span>mm próximas 24 h</span></div>`;
  }

  function dibujarNoticiasDetalle(id) {
    const el = $("#detNoticias"); if (!el || seleccion !== id) return;
    const ns = noticias.por_problema?.[id] || [];
    el.innerHTML = ns.map(itemNoticia).join("") || `<li class="meta">Sin notas en los últimos 30 días.</li>`;
  }

  // Fotos de Wikimedia Commons: búsqueda por nombre y, si no hay, fotos geolocalizadas cercanas.
  async function cargarFotos(p) {
    const el = () => (seleccion === p.id ? $("#detFotos") : null);
    if (!fotosCache[p.id]) {
      const api = "https://commons.wikimedia.org/w/api.php?origin=*&format=json&action=query&prop=imageinfo" +
        "&iiprop=url|extmetadata&iiextmetadatafilter=Artist|LicenseShortName&iiurlwidth=420";
      const pedir = async (params) => {
        try {
          const d = await (await fetch(api + params)).json();
          return Object.values(d.query?.pages || {})
            .filter((x) => x.imageinfo && /\.(jpe?g|png|webp)$/i.test(x.title))
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
            .map((x) => {
              const ii = x.imageinfo[0]; const md = ii.extmetadata || {};
              const autor = (md.Artist?.value || "").replace(/<[^>]+>/g, "").trim();
              return { src: ii.thumburl, pag: ii.descriptionurl, autor, lic: md.LicenseShortName?.value || "", titulo: x.title.replace(/^File:/, "") };
            });
        } catch { return []; }
      };
      const fotos = p.fotoQuery
        ? await pedir(`&generator=search&gsrnamespace=6&gsrlimit=6&gsrsearch=${encodeURIComponent(p.fotoQuery + " filetype:bitmap")}`)
        : [];
      fotosCache[p.id] = fotos.slice(0, 3);
    }
    const fotos = fotosCache[p.id];
    const cont = el(); if (!cont) return;
    const d = 0.012;   // ~2.5 km de ancho
    const sat = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${p.lng - d * 1.07},${p.lat - d * 0.8},${p.lng + d * 1.07},${p.lat + d * 0.8}&bboxSR=4326&imageSR=3857&size=640,480&format=jpg&f=image`;
    const nota = p.fotoTipo === "lugar"
      ? `<span class="cercana">Fotos del lugar (Wikimedia Commons); pueden no mostrar el problema en sí.</span>` : "";
    cont.innerHTML =
      `<figure style="grid-column:1/-1"><a href="#" id="satLink"><img src="${sat}" alt="Imagen satelital del sitio" style="height:200px"></a>
        <figcaption>Imagen satelital del sitio${p.aprox ? " (ubicación aproximada)" : ""} · Esri, Maxar</figcaption></figure>` +
      (fotos.length ? nota : "") +
      fotos.map((f) => `<figure><a href="${esc(f.pag)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(f.src)}" alt="${esc(f.titulo)}"></a>
        <figcaption title="${esc(f.autor)} · ${esc(f.lic)}">${esc(f.autor || "Wikimedia Commons")} · ${esc(f.lic)}</figcaption></figure>`).join("");
    cont.querySelector("#satLink").onclick = (e) => { e.preventDefault(); $("#btnSat").click(); };
  }

  // ---------- Eventos ----------
  $("#lista").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]"); if (li) abrir(li.dataset.id);
  });
  $("#chipsTipo").addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    document.querySelectorAll("#chipsTipo .chip").forEach((c) => c.classList.toggle("activa", c === b));
    filtro.tipo = b.dataset.tipo; aplicarFiltro(); dibujarLista();
  });
  $("#gravMin").addEventListener("input", (e) => {
    filtro.gravMin = +e.target.value; $("#gravVal").textContent = e.target.value; aplicarFiltro(); dibujarLista();
  });
  $("#buscar").addEventListener("input", (e) => {
    filtro.texto = e.target.value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
    aplicarFiltro(); dibujarLista();
  });
  document.querySelectorAll(".pestanas button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".pestanas button").forEach((x) => { x.classList.toggle("activa", x === b); x.setAttribute("aria-selected", x === b); });
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("oculto", t.id !== "tab-" + b.dataset.tab));
  }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && seleccion) cerrar(); });
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (h && h !== seleccion) abrir(h); });

  // ---------- Arranque y refresco ----------
  (async () => {
    await cargarProblemas();
    const hash = location.hash.slice(1);
    if (hash) abrir(hash);
    cargarNoticias();
    cargarClima();
    setInterval(cargarNoticias, 10 * 60 * 1000);   // revisa si el robot publicó notas nuevas
    setInterval(cargarClima, 15 * 60 * 1000);
    setInterval(estado, 60 * 1000);
  })();
})();
