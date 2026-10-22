// ---------------------------------------------------------------------------
// Estadisticas
// ---------------------------------------------------------------------------
let statsTab = "total";

// Todas las filas de todos los usuarios, con las compras corregidas ya marcadas.
function allRowsRaw() {
  const rows = [];
  Object.entries(USER_DATA).forEach(([usuario, data]) => {
    (data || []).forEach(r => { if (r && r.Fecha) rows.push({ ...r, usuario }); });
  });
  markCorrectedAcquisitions(rows);
  return rows;
}

// Igual, pero aplicando el filtro de periodo elegido en Estadisticas.
// (La marca de "corregida" se calcula antes de filtrar, con el historial completo.)
function allRows() {
  const rows = allRowsRaw();
  const desde = periodStartString();
  return desde ? rows.filter(r => (r.Fecha || "") >= desde) : rows;
}

// Marca con .corregida=true las filas de Compra/Clausula compra que fueron
// corregidas despues por un Patinazo del mismo jugador (mismo usuario). Estas
// se excluyen de Total, Movimientos y Clausulas, pero NO de Patinazos (que
// usa los datos crudos a proposito, como "cuadro de la verguenza") ni de la
// ficha individual del usuario (que muestra el historial completo tal cual).
function markCorrectedAcquisitions(rows) {
  const byKey = {};
  rows.forEach(r => {
    const key = r.usuario + "||" + r.Jugador;
    (byKey[key] = byKey[key] || []).push(r);
  });
  Object.values(byKey).forEach(list => {
    list.sort((a, b) => (a.Fecha || "").localeCompare(b.Fecha || ""));
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if ((a.Tipo === "Compra" || a.Tipo === "Clausula compra") && b.Tipo === "Patinazo") {
        a.corregida = true;
      }
    }
  });
}

function openStats() {
  selectedUser = null;
  currentScreen = "stats";
  renderNav("__stats__");
  renderStats();
}

function statsTabButton(key, label) {
  const active = statsTab === key ? "active" : "";
  return `<button class="stats-tab ${active}" onclick="setStatsTab('${key}')">${label}</button>`;
}

function setStatsTab(key) {
  statsTab = key;
  renderStats();
}

function renderStats() {
  transitionTo(renderStatsImmediate);
}

function renderStatsImmediate() {
  const root = document.getElementById("app-content");
  const rows = allRows();

  let body = "";
  if (statsTab === "total") body = renderStatsTotal(rows);
  else if (statsTab === "movimientos") body = renderStatsMovimientos(rows);
  else if (statsTab === "clausulas") body = renderStatsClausulas(rows);
  else if (statsTab === "patinazos") body = renderStatsPatinazos(rows);
  else if (statsTab === "jugadores") body = renderStatsJugadores(rows);
  else if (statsTab === "ultimos") body = renderStatsUltimos(rows);
  else if (statsTab === "inactividad") body = renderStatsInactividad(rows);

  root.innerHTML = `
    <div class="container">
      <h2 class="font-display dossier-title">Estadisticas</h2>
      <div class="stats-tabs">
        ${statsTabButton("total", "Total")}
        ${statsTabButton("movimientos", "Movimientos")}
        ${statsTabButton("clausulas", "Clausulas")}
        ${statsTabButton("patinazos", "Patinazos")}
        ${statsTabButton("jugadores", "Jugadores")}
        ${statsTabButton("ultimos", "Ultimos")}
        ${statsTabButton("inactividad", "Inactividad")}
      </div>
      ${statsTab === "inactividad" ? "" : periodBarHtml()}
      ${body}
    </div>
  `;
}

function statRow(label, value) {
  return `<div class="stat-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function rankingTable(headers, dataRows, onNameClick) {
  const valueHeaders = headers.slice(1);
  const rows = dataRows.map(cols => {
    const name = cols[0];
    const nameHtml = onNameClick
      ? `<button type="button" class="rank-name rank-name-link" onclick="${onNameClick}('${name.replace(/'/g, "\\'")}')">${name}</button>`
      : `<span class="rank-name">${name}</span>`;
    const values = cols.slice(1).map((v, i) => `
      <div class="rank-value">
        <span class="rank-value-label">${valueHeaders[i]}</span>
        <span class="rank-value-num">${v}</span>
      </div>
    `).join("");
    return `
      <div class="rank-row">
        ${nameHtml}
        <div class="rank-values">${values}</div>
      </div>
    `;
  }).join("");
  return `<div class="rank-list">${rows}</div>`;
}

function renderStatsTotal(rows) {
  const vigentes = rows.filter(r => !r.corregida);
  const total = vigentes.length;
  const compras = vigentes.filter(r => r.Tipo === "Compra").length;
  const ventas = vigentes.filter(r => r.Tipo === "Venta").length;
  const clausulas = vigentes.filter(r => r.Tipo === "Clausula compra").length; // cada clausula genera 2 filas, contamos 1 vez
  return `
    <div class="stats-card">
      ${statRow("Movimientos totales", total)}
      ${statRow("Compras al mercado", compras)}
      ${statRow("Ventas al mercado", ventas)}
      ${statRow("Clausulazos", clausulas)}
    </div>
  `;
}

function renderStatsMovimientos(rows) {
  const compras = {};
  const ventas = {};
  USERS.forEach(u => { compras[u] = 0; ventas[u] = 0; });
  rows.forEach(r => {
    if (r.Tipo === "Compra" && !r.corregida) compras[r.usuario] = (compras[r.usuario] || 0) + 1;
    if (r.Tipo === "Venta") ventas[r.usuario] = (ventas[r.usuario] || 0) + 1;
  });
  const sorted = USERS.slice().sort((a, b) => (compras[b] || 0) - (compras[a] || 0));
  return rankingTable(
    ["Usuario", "Compras", "Ventas"],
    sorted.map(u => [u, compras[u] || 0, ventas[u] || 0])
  );
}

let CLAUSULA_CAZADOR = {};
let CLAUSULA_CLAUSULADO = {};
let CLAUSULA_PAID_TO = {};
let CLAUSULA_PAID_BY = {};
let clausulaSelectedUser = null;

function fullRivalList(map) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
}

function rivalColumn(title, list) {
  if (list.length === 0) {
    return `<div class="rival-col"><span class="rival-col-title">${title}</span><div class="rival-item rival-empty">-</div></div>`;
  }
  const items = list.map(([nombre, veces]) =>
    `<div class="rival-item"><span>${nombre}</span><strong>${veces}</strong></div>`
  ).join("");
  return `<div class="rival-col"><span class="rival-col-title">${title}</span>${items}</div>`;
}

function buildUserClausulaBlock(u) {
  const cazador = CLAUSULA_CAZADOR[u] || 0;
  const cazado = CLAUSULA_CLAUSULADO[u] || 0;
  return `
    <p class="stats-subtitle">Jachazos al paso</p>
    <div class="stats-card" style="margin-bottom:16px;">
      ${statRow("Cazador", cazador)}
      ${statRow("Cazado", cazado)}
    </div>
    <p class="stats-subtitle">Francotiradores</p>
    <div class="rival-block">
      <div class="rival-cols">
        ${rivalColumn("V\u00edstima", fullRivalList(CLAUSULA_PAID_TO[u]))}
        ${rivalColumn("Verdugo", fullRivalList(CLAUSULA_PAID_BY[u]))}
      </div>
    </div>
  `;
}

let clausulaSubTab = "general";
let CLAUSULA_SORTED_USERS = [];

function setClausulaSubTab(tab) {
  clausulaSubTab = tab;
  renderStats();
}

function goToClausulaDetail(u) {
  clausulaSelectedUser = u;
  clausulaSubTab = "detallado";
  renderStats();
}

function shiftClausulaUser(delta) {
  const list = CLAUSULA_SORTED_USERS;
  if (!list || list.length === 0) return;
  let idx = list.indexOf(clausulaSelectedUser);
  if (idx === -1) idx = 0;
  idx = (idx + delta + list.length) % list.length;
  clausulaSelectedUser = list[idx];
  renderStats();
}

function onClausulaUserChange(u) {
  clausulaSelectedUser = u;
  renderStats();
}

function renderStatsClausulas(rows) {
  const cazador = {};
  const cazado = {};
  USERS.forEach(u => { cazador[u] = 0; cazado[u] = 0; });
  rows.forEach(r => {
    if (r.Tipo === "Clausula compra" && !r.corregida) cazador[r.usuario] = (cazador[r.usuario] || 0) + 1;
  });
  CLAUSULA_CAZADOR = cazador;

  const paidTo = {};
  const paidBy = {};
  USERS.forEach(u => { paidTo[u] = {}; paidBy[u] = {}; });
  rows.forEach(r => {
    if (r.Tipo === "Clausula compra" && !r.corregida) {
      paidTo[r.usuario][r.Vendedor] = (paidTo[r.usuario][r.Vendedor] || 0) + 1;
      if (paidBy[r.Vendedor]) paidBy[r.Vendedor][r.usuario] = (paidBy[r.Vendedor][r.usuario] || 0) + 1;
    }
  });
  CLAUSULA_PAID_TO = paidTo;
  CLAUSULA_PAID_BY = paidBy;
  // "Cazado" se calcula a partir de las clausulas de compra vigentes (las mismas
  // que alimentan la lista Verdugo), para que ambos numeros siempre cuadren y
  // no se cuenten clausulas que luego se corrigieron con un Patinazo.
  USERS.forEach(u => {
    cazado[u] = Object.values(paidBy[u] || {}).reduce((t, n) => t + n, 0);
  });
  CLAUSULA_CLAUSULADO = cazado;

  const sorted = USERS.slice().sort((a, b) => (cazador[b] || 0) - (cazador[a] || 0));
  CLAUSULA_SORTED_USERS = sorted;
  if (!clausulaSelectedUser || !sorted.includes(clausulaSelectedUser)) {
    clausulaSelectedUser = sorted[0] || null;
  }

  const subTabs = `
    <div class="browser-tabs">
      <button class="browser-tab ${clausulaSubTab === "general" ? "active" : ""}" onclick="setClausulaSubTab('general')">General</button>
      <button class="browser-tab ${clausulaSubTab === "detallado" ? "active" : ""}" onclick="setClausulaSubTab('detallado')">Detallado</button>
    </div>
  `;

  if (sorted.length === 0) {
    return subTabs + `<p class="hint">Todavia no hay usuarios registrados.</p>`;
  }

  if (clausulaSubTab === "general") {
    const table = rankingTable(
      ["Usuario", "Cazador", "Cazado"],
      sorted.map(u => [u, cazador[u] || 0, cazado[u] || 0]),
      "goToClausulaDetail"
    );
    return subTabs + table;
  }

  return subTabs + `
    <div class="user-nav">
      <button class="nav-arrow" onclick="shiftClausulaUser(-1)" aria-label="Anterior">&laquo;</button>
      ${buildCustomSelect("clausula-user-select", sorted, clausulaSelectedUser, "onClausulaUserChange")}
      <button class="nav-arrow" onclick="shiftClausulaUser(1)" aria-label="Siguiente">&raquo;</button>
    </div>
    <div id="rival-detail">${buildUserClausulaBlock(clausulaSelectedUser)}</div>
  `;
}

function renderStatsPatinazos(rows) {
  const patinazos = {};
  USERS.forEach(u => { patinazos[u] = 0; });
  rows.forEach(r => {
    if (r.Tipo === "Patinazo") patinazos[r.usuario] = (patinazos[r.usuario] || 0) + 1;
  });
  const sorted = USERS.slice().sort((a, b) => (patinazos[b] || 0) - (patinazos[a] || 0));
  return rankingTable(
    ["Usuario", "BUBUBUUP"],
    sorted.map(u => [u, patinazos[u] || 0])
  );
}

function renderStatsInactividad(rows) {
  const lastSeen = {};
  Object.entries(USER_DATA).forEach(([usuario, data]) => {
    (data || []).forEach(r => {
      if (!r.Fecha) return;
      if (!lastSeen[usuario] || r.Fecha > lastSeen[usuario]) lastSeen[usuario] = r.Fecha;
    });
  });
  const now = new Date();
  const entries = USERS.map(u => {
    if (!lastSeen[u]) {
      return { usuario: u, days: -1, label: "Sin movimientos registrados" };
    }
    const lastDate = new Date(lastSeen[u].replace(" ", "T"));
    const days = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
    return { usuario: u, days, label: `${days} dia${days === 1 ? "" : "s"}` };
  });
  entries.sort((a, b) => b.days - a.days);
  return rankingTable(
    ["Usuario", "Inactividad"],
    entries.map(e => [e.usuario, e.label])
  );
}

window.__cargados = (window.__cargados || []).concat("app-stats.js");
