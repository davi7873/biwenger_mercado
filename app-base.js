// ============================================================
// CONFIGURACION: pon aqui el ID de tu Google Sheet
// ============================================================
const SHEET_ID = "1ir6uoalP7nLft8QX9776SuXW1yqGVw_CaUchFMLjdXc";
const APP_VERSION = "2.2";

let USERS = [];

function buildCustomSelect(id, options, selected, onSelectFnName) {
  const opts = options.map(o => `
    <button type="button" class="custom-select-option ${o === selected ? "active" : ""}"
      onclick="selectCustomOption('${id}', '${o.replace(/'/g, "\\'")}', '${onSelectFnName}')">${o}</button>
  `).join("");
  return `
    <div class="custom-select" id="${id}">
      <button type="button" class="custom-select-trigger" onclick="toggleCustomSelect('${id}')">
        <span class="custom-select-value">${selected}</span>
        <svg class="custom-select-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <div class="custom-select-panel" style="display:none;">${opts}</div>
    </div>
  `;
}

function toggleCustomSelect(id) {
  document.querySelectorAll(".custom-select").forEach(cs => {
    if (cs.id !== id) { cs.classList.remove("open"); cs.querySelector(".custom-select-panel").style.display = "none"; }
  });
  const el = document.getElementById(id);
  const panel = el.querySelector(".custom-select-panel");
  const isOpen = panel.style.display === "block";
  panel.style.display = isOpen ? "none" : "block";
  el.classList.toggle("open", !isOpen);
}

function selectCustomOption(id, value, onSelectFnName) {
  const el = document.getElementById(id);
  el.querySelector(".custom-select-panel").style.display = "none";
  el.classList.remove("open");
  // Actualiza lo que muestra el selector (antes se quedaba con el valor inicial)
  const label = el.querySelector(".custom-select-value");
  if (label) label.textContent = value;
  el.querySelectorAll(".custom-select-option").forEach(opt => {
    opt.classList.toggle("active", opt.textContent.trim() === value);
  });
  window[onSelectFnName](value);
}

document.addEventListener("click", (e) => {
  document.querySelectorAll(".custom-select").forEach(cs => {
    if (!cs.contains(e.target)) {
      cs.classList.remove("open");
      const panel = cs.querySelector(".custom-select-panel");
      if (panel) panel.style.display = "none";
    }
  });
});


function transitionTo(applyFn) {
  const root = document.getElementById("app-content");
  root.classList.add("screen-fade");
  setTimeout(() => {
    applyFn();
    document.getElementById("app-content").classList.remove("screen-fade");
  }, 160);
}

let SUMMARY_ROWS = [];
let USER_DATA = {}; // { nombre: filas[] }
let selectedUser = null;
let currentScreen = "resumen"; // "resumen" | "dossier" | "stats"

function sheetCsvUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

// Copia local de los datos (para poder abrir la app sin conexion)
let OFFLINE_FROM = null; // momento (ms) de la copia mas antigua usada, o null
function cacheSave(name, text) {
  try { localStorage.setItem("mb_cache_" + name, JSON.stringify({ ts: Date.now(), text })); } catch (e) {}
}
function cacheLoad(name) {
  try {
    const raw = localStorage.getItem("mb_cache_" + name);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function fetchCsv(sheetName) {
  let text;
  try {
    const res = await fetch(sheetCsvUrl(sheetName));
    text = await res.text();
    if (!res.ok || text.trim().toLowerCase().startsWith("<")) {
      throw new Error(`No se pudo leer la pestana "${sheetName}". Comprueba que la hoja esta compartida como "Cualquiera con el enlace puede ver".`);
    }
    cacheSave(sheetName, text);
  } catch (e) {
    const saved = cacheLoad(sheetName);
    if (!saved) throw e;
    text = saved.text;
    OFFLINE_FROM = OFFLINE_FROM === null ? saved.ts : Math.min(OFFLINE_FROM, saved.ts);
  }
  return Papa.parse(text, { header: true, skipEmptyLines: true });
}

function offlineLabel() {
  const d = new Date(OFFLINE_FROM);
  const p = n => String(n).padStart(2, "0");
  return `Sin conexion · datos del ${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function typeBadgeHtml(tipo) {
  const map = {
    Compra: { bg: "var(--green-bg)", text: "var(--green-text)", label: "Compra" },
    Venta: { bg: "var(--rose-bg)", text: "var(--rose-text)", label: "Venta" },
    "Clausula compra": { bg: "var(--gold-bg)", text: "var(--gold-text)", label: "Clausula C." },
    "Clausula venta": { bg: "var(--gold-bg)", text: "var(--gold-text)", label: "Clausula V." },
    Patinazo: { bg: "var(--pat-bg)", text: "var(--pat-text)", label: "Patinazo" },
    Devolucion: { bg: "var(--dev-bg)", text: "var(--dev-text)", label: "Devolucion" },
  };
  const conf = map[tipo] || { bg: "#EEE", text: "#555", label: tipo || "-" };
  return `<span class="badge" style="background:${conf.bg};color:${conf.text}">${conf.label}</span>`;
}

function toggleInfoModal() {
  const modal = document.getElementById("info-modal");
  const v = document.getElementById("app-version");
  if (v) v.textContent = "Version " + APP_VERSION;
  modal.style.display = modal.style.display === "none" ? "flex" : "none";
}
function closeInfoIfBackdrop(e) {
  if (e.target.id === "info-modal") toggleInfoModal();
}

async function loadAll() {
  const root = document.getElementById("app-content");
  root.innerHTML = '<div class="loading">Cargando datos del mercado...</div>';
  document.getElementById("ticker-wrap").style.display = "none";
  OFFLINE_FROM = null;

  try {
    const summary = await fetchCsv("Resumen");
    const fields = summary.meta.fields || [];
    USERS = fields.filter(f => {
      if (!f) return false;
      const clean = f.trim();
      if (clean === "" || clean === "Semana") return false;
      if (/^_+\d*$/.test(clean)) return false; // columnas fantasma tipo "_1", "_22"
      if (/^column\s*\d*$/i.test(clean)) return false; // por si acaso, otra variante
      return true;
    });
    SUMMARY_ROWS = summary.data;

    USER_DATA = {};
    await Promise.all(USERS.map(async (name) => {
      try {
        const parsed = await fetchCsv(name);
        USER_DATA[name] = parsed.data;
      } catch (e) {
        USER_DATA[name] = [];
      }
    }));

    let lastRunText = "Actualizado (sin datos)";
    try {
      const meta = await fetchCsv("Meta");
      const row = meta.data.find(r => r.Campo === "UltimaActualizacion");
      if (row && row.Valor) {
        lastRunText = "Actualizado " + row.Valor;
      }
    } catch (e) {
      // Si la pestana Meta aun no existe (primera vez), no pasa nada.
    }
    const lastEl = document.getElementById("last-updated");
    if (OFFLINE_FROM !== null) {
      lastEl.textContent = offlineLabel();
      lastEl.classList.add("offline-note");
    } else {
      lastEl.textContent = lastRunText;
      lastEl.classList.remove("offline-note");
    }

    renderTicker();
    if (currentScreen === "stats") {
      openStats();
    } else if (currentScreen === "dossier" && selectedUser) {
      renderDossier(selectedUser);
    } else {
      renderSummary();
    }
  } catch (e) {
    root.innerHTML = `<div class="error-box"><b>No se pudieron cargar los datos</b><br>${e.message}</div>`;
  }
}

function renderNav(activeKey) {
  const nav = document.getElementById("nav-wrap");
  if (USERS.length === 0) { nav.style.display = "none"; return; }
  nav.style.display = "flex";

  const isUserActive = USERS.includes(activeKey);
  const triggerLabel = isUserActive ? activeKey : "Ver datos de usuario";

  let html = `<button class="nav-tab nav-tab-resumen ${activeKey === "__resumen__" ? "active" : ""}" onclick="renderSummary()">Resumen</button>`;

  const options = USERS.map(u => `
    <button type="button" class="custom-select-option ${u === activeKey ? "active" : ""}"
      onclick="selectCustomOption('nav-user-select', '${u.replace(/'/g, "\\'")}', 'renderDossier')">${u}</button>
  `).join("");

  html += `
    <div class="custom-select nav-user-select" id="nav-user-select">
      <button type="button" class="nav-tab ${isUserActive ? "active" : ""}" onclick="toggleCustomSelect('nav-user-select')">
        ${triggerLabel}
        <svg class="nav-user-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <div class="custom-select-panel panel-up" style="display:none;">${options}</div>
    </div>
  `;
  nav.innerHTML = html;
}

function renderTicker() {
  const all = [];
  Object.entries(USER_DATA).forEach(([name, rows]) => {
    rows.forEach(r => { if (r && r.Fecha) all.push({ ...r, usuario: name }); });
  });
  all.sort((a, b) => (b.Fecha || "").localeCompare(a.Fecha || ""));
  const ticker = all.slice(0, 12);

  const wrap = document.getElementById("ticker-wrap");
  const track = document.getElementById("ticker-track");
  if (ticker.length === 0) { wrap.style.display = "none"; return; }
  wrap.style.display = "block";

  const itemHtml = (t) => {
    const accion = t.Tipo === "Venta"
      ? "vendio a"
      : (t.Vendedor === "Mercado" ? "compro al mercado" : `compro a ${t.Vendedor}`);
    return `<span class="ticker-item"><b>${t.usuario}</b><span>${accion}</span><strong>${t.Jugador}</strong></span>`;
  };
  track.innerHTML = [...ticker, ...ticker].map(itemHtml).join("");
}

let summarySelectedWeek = null;

function weekHadPatinazo(usuario, semana) {
  return (USER_DATA[usuario] || []).some(r => r.Semana === semana && r.Tipo === "Patinazo");
}

function buildWeekDetail(weekLabel) {
  const row = SUMMARY_ROWS.find(r => r.Semana === weekLabel);
  if (!row) return `<p class="hint">Sin datos para esta semana.</p>`;

  const entries = USERS.map(u => [u, Number(row[u] || 0)]);
  entries.sort((a, b) => b[1] - a[1]);

  const esActual = isCurrentWeekLabel(weekLabel);
  const items = entries.map(([u, val]) => {
    let style = "color:var(--border)";
    let cls = "count-pill";
    let texto = String(val);
    if (val > 3) style = "background:var(--rose);color:#fff";
    else if (weekHadPatinazo(u, weekLabel)) style = "background:var(--gold);color:#fff";
    else if (val === 3 && esActual) { style = ""; cls += " pill-limit"; }
    else if (val > 0) style = "background:var(--pitch-light);color:#fff";
    // En la semana en curso se muestra cuantos fichajes lleva sobre el maximo de 3
    if (esActual) { cls += " count-pill-wide"; texto = val + "/3"; }
    return `
      <div class="week-row">
        <button class="user-link" onclick="renderDossier('${u.replace(/'/g, "\\'")}')">${u}</button>
        <span class="${cls}" style="${style}">${texto}</span>
      </div>`;
  }).join("");

  return `<div class="week-list">${items}</div>
    <div class="week-extra">
      <button class="btn-main" onclick="openWeekShare()">Resumen para WhatsApp</button>
    </div>`;
}

function onSummaryWeekChange(w) {
  summarySelectedWeek = w;
  document.getElementById("week-detail").innerHTML = buildWeekDetail(w);
}

function renderSummary() {
  transitionTo(renderSummaryImmediate);
}

function renderSummaryImmediate() {
  selectedUser = null;
  currentScreen = "resumen";
  renderNav("__resumen__");
  const root = document.getElementById("app-content");

  if (SUMMARY_ROWS.length === 0) {
    root.innerHTML = `<div class="container"><p class="hint">Todavia no hay movimientos registrados.</p></div>`;
    return;
  }

  const weeks = SUMMARY_ROWS.map(r => r.Semana);
  if (!summarySelectedWeek || !weeks.includes(summarySelectedWeek)) {
    summarySelectedWeek = weeks[0];
  }

  root.innerHTML = `
    <div class="container">
      ${buildCustomSelect("week-select", weeks, summarySelectedWeek, "onSummaryWeekChange")}
      <div id="week-detail">${buildWeekDetail(summarySelectedWeek)}</div>
    </div>
  `;
}

let dossierFilter = "todos";

function dossierFilterButton(key, label) {
  const active = dossierFilter === key ? "active" : "";
  return `<button class="stats-tab ${active}" data-filter="${key}" onclick="setDossierFilter('${key}')">${label}</button>`;
}

function setDossierFilter(f) {
  dossierFilter = f;
  document.querySelectorAll("#dossier-filters .stats-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.filter === f);
  });
  renderDossierList();
}

function filterDossierRows(rows) {
  if (dossierFilter === "compras") {
    return rows.filter(r => r.Tipo === "Compra");
  }
  if (dossierFilter === "ventas") {
    return rows.filter(r => r.Tipo === "Venta");
  }
  if (dossierFilter === "clausulas") {
    return rows.filter(r => r.Tipo === "Clausula compra" || r.Tipo === "Clausula venta");
  }
  if (dossierFilter === "patinazos") {
    return rows.filter(r => r.Tipo === "Patinazo");
  }
  return rows;
}

function renderDossierList() {
  const allRows = (USER_DATA[selectedUser] || []).slice()
    .sort((a, b) => (b.Fecha || "").localeCompare(a.Fecha || ""));
  const rows = filterDossierRows(allRows);

  let html = `<p class="dossier-sub">${rows.length} movimiento${rows.length === 1 ? "" : "s"} registrado${rows.length === 1 ? "" : "s"}</p>`;

  if (rows.length === 0) {
    html += `<div class="card" style="justify-content:center;color:var(--ink-muted)">Sin movimientos con este filtro.</div>`;
  } else {
    rows.forEach(r => {
      const vendorLabel = r.Vendedor === "Mercado" ? "Mercado libre" : `Rival: ${r.Vendedor}`;
      html += `
        <div class="card">
          <div class="card-left">
            <div class="card-date">${r.Fecha}</div>
            <div>
              <p class="card-player">${r.Jugador}</p>
              <p class="card-vendor">${vendorLabel}</p>
            </div>
          </div>
          ${typeBadgeHtml(r.Tipo)}
        </div>`;
    });
  }
  document.getElementById("dossier-list").innerHTML = html;
}

function renderDossier(username) {
  transitionTo(() => renderDossierImmediate(username));
}

function renderDossierImmediate(username) {
  selectedUser = username;
  currentScreen = "dossier";
  dossierFilter = "todos";
  renderNav(username);

  const root = document.getElementById("app-content");
  let html = `<div class="container">`;
  html += `<h2 class="font-display dossier-title">${username}</h2>`;
  html += activityChartHtml(username);
  html += `<div class="stats-tabs" id="dossier-filters">
    ${dossierFilterButton("todos", "Todos")}
    ${dossierFilterButton("compras", "Compras")}
    ${dossierFilterButton("ventas", "Ventas")}
    ${dossierFilterButton("clausulas", "Clausulas")}
    ${dossierFilterButton("patinazos", "Patinazos")}
  </div>`;
  html += `<div id="dossier-list"></div>`;
  html += `</div>`;
  root.innerHTML = html;
  renderDossierList();
}

window.__cargados = (window.__cargados || []).concat("app-base.js");
