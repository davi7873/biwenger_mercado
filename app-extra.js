// ============================================================
// Mejoras v2: fechas, periodo, jugadores, ultimos movimientos,
// resumen para WhatsApp y grafico de actividad.
// ============================================================

function escapeHtml(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function normalizeText(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// ---------- Fechas (siempre hora de Madrid) ----------
function pad2(n) { return String(n).padStart(2, "0"); }
function madridToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = t => Number(parts.find(p => p.type === t).value);
  return new Date(Date.UTC(g("year"), g("month") - 1, g("day")));
}
function dateStr(d) {
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}
function currentMonday() {
  const t = madridToday();
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t;
}
function isCurrentWeekLabel(label) {
  const mon = currentMonday();
  const sun = new Date(mon);
  sun.setUTCDate(sun.getUTCDate() + 6);
  const f = d => pad2(d.getUTCDate()) + "/" + pad2(d.getUTCMonth() + 1);
  return String(label || "").includes("[" + f(mon) + " - " + f(sun) + "]");
}

// ---------- Filtro por periodo (Estadisticas) ----------
let statsPeriod = { key: "todo", week: null };

function periodStartString() {
  if (statsPeriod.key === "mes") {
    const t = madridToday();
    t.setUTCDate(t.getUTCDate() - 30);
    return dateStr(t) + " 00:00";
  }
  if (statsPeriod.key === "semana") return dateStr(currentMonday()) + " 00:00";
  if (statsPeriod.key === "desde" && statsPeriod.week) {
    let min = "";
    Object.values(USER_DATA).forEach(data => {
      (data || []).forEach(r => {
        if (r && r.Fecha && r.Semana === statsPeriod.week && (!min || r.Fecha < min)) min = r.Fecha;
      });
    });
    return min;
  }
  return "";
}

function periodBarHtml() {
  const chip = (k, l) =>
    `<button class="stats-tab ${statsPeriod.key === k ? "active" : ""}" onclick="setPeriod('${k}')">${l}</button>`;
  let html = `<div class="stats-tabs period-tabs">
    ${chip("todo", "Todo")}${chip("mes", "Ultimo mes")}${chip("semana", "Esta semana")}${chip("desde", "Desde semana...")}
  </div>`;
  if (statsPeriod.key === "desde") {
    const weeks = SUMMARY_ROWS.map(r => r.Semana);
    if (weeks.length) {
      html += `<div class="period-select">${buildCustomSelect("period-week-select", weeks, statsPeriod.week, "onPeriodWeekChange")}</div>`;
    }
  }
  return html;
}

function setPeriod(key) {
  statsPeriod.key = key;
  if (key === "desde" && !statsPeriod.week) {
    const weeks = SUMMARY_ROWS.map(r => r.Semana);
    statsPeriod.week = weeks[Math.min(3, weeks.length - 1)] || null;
  }
  renderStats();
}
function onPeriodWeekChange(w) {
  statsPeriod.week = w;
  renderStats();
}

// ---------- Eventos de liga (una linea por fichaje / salida) ----------
// Cada traspaso entre managers genera 2 filas (comprador y vendedor); aqui se
// deja solo la del comprador. Las ventas al mercado y los patinazos van aparte.
function buildEvents(rows) {
  const ev = [];
  rows.forEach(r => {
    const base = {
      fecha: r.Fecha || "", jugador: r.Jugador, actor: r.usuario,
      otro: r.Vendedor, tipo: r.Tipo, corregida: !!r.corregida,
    };
    if (r.Tipo === "Compra" || r.Tipo === "Clausula compra" || r.Tipo === "Devolucion") ev.push(base);
    else if (r.Tipo === "Patinazo") ev.push(base);
    else if (r.Tipo === "Venta" && r.Vendedor === "Mercado") ev.push(base);
  });
  ev.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return ev;
}

function eventText(e) {
  const rival = e.otro && e.otro !== "Mercado" ? e.otro : null;
  let t;
  if (e.tipo === "Clausula compra") t = `${e.actor} clausulo a ${e.otro}`;
  else if (e.tipo === "Compra") t = rival ? `${e.actor} compro a ${rival}` : `${e.actor} compro al mercado`;
  else if (e.tipo === "Devolucion") t = `${e.actor} recupero el jugador (devuelto por ${e.otro})`;
  else if (e.tipo === "Patinazo") t = `${e.actor}: patinazo corregido, vuelve al mercado`;
  else t = `${e.actor} vendio al mercado`;
  return e.corregida ? t + " (corregido)" : t;
}

function eventCardHtml(e, showPlayerLink) {
  const player = showPlayerLink
    ? `<button type="button" class="user-link" style="font-size:16px;text-align:left;padding:0;" data-j="${escapeHtml(e.jugador)}" onclick="openPlayer(this.dataset.j)">${escapeHtml(e.jugador)}</button>`
    : `<p class="card-player">${escapeHtml(e.jugador)}</p>`;
  return `
    <div class="card ${e.corregida ? "card-corrected" : ""}">
      <div class="card-left">
        <div class="card-date">${escapeHtml(e.fecha.slice(0, 16))}</div>
        <div>
          ${player}
          <p class="feed-text">${escapeHtml(eventText(e))}</p>
        </div>
      </div>
      ${typeBadgeHtml(e.tipo)}
    </div>`;
}

// ---------- Ultimos movimientos ----------
function renderStatsUltimos(rows) {
  const ev = buildEvents(rows).slice(0, 40);
  if (ev.length === 0) return `<p class="hint">No hay movimientos en este periodo.</p>`;
  return `<p class="dossier-sub" style="margin-bottom:12px;">Ultimos ${ev.length} movimientos de la liga</p>` +
    ev.map(e => eventCardHtml(e, true)).join("");
}

// ---------- Jugadores mas movidos + historial de jugador ----------
let statsPlayer = null;

function openPlayer(name) {
  statsPlayer = name;
  statsTab = "jugadores";
  if (currentScreen !== "stats") openStats();
  else renderStats();
}
function closePlayer() {
  statsPlayer = null;
  renderStats();
}

function onPlayerSearch(value) {
  const box = document.getElementById("player-results");
  if (!box) return;
  const q = normalizeText(value).trim();
  if (q.length < 2) { box.innerHTML = ""; return; }
  const names = [...new Set(allRowsRaw().map(r => r.Jugador).filter(Boolean))];
  const found = names.filter(n => normalizeText(n).includes(q)).sort().slice(0, 8);
  box.innerHTML = found.length === 0
    ? `<div class="search-results"><button type="button" disabled>Sin resultados</button></div>`
    : `<div class="search-results">${found.map(n =>
        `<button type="button" data-j="${escapeHtml(n)}" onclick="openPlayer(this.dataset.j)">${escapeHtml(n)}</button>`
      ).join("")}</div>`;
}

function renderStatsJugadores(rows) {
  if (statsPlayer) return renderPlayerDetail(statsPlayer);
  const m = {};
  rows.forEach(r => {
    if ((r.Tipo === "Compra" || r.Tipo === "Clausula compra") && !r.corregida) {
      const o = m[r.Jugador] || (m[r.Jugador] = { n: 0, c: 0 });
      o.n++;
      if (r.Tipo === "Clausula compra") o.c++;
    }
  });
  const list = Object.entries(m)
    .sort((a, b) => b[1].n - a[1].n || b[1].c - a[1].c || a[0].localeCompare(b[0]))
    .slice(0, 20);
  const search = `
    <input id="player-search" class="search-input" type="search" placeholder="Buscar jugador..."
      autocomplete="off" oninput="onPlayerSearch(this.value)" />
    <div id="player-results"></div>`;
  if (list.length === 0) return search + `<p class="hint">No hay fichajes en este periodo.</p>`;
  return search +
    `<p class="stats-subtitle" style="margin-top:4px;">Los mas movidos</p>` +
    rankingTable(["Jugador", "Fichajes", "Clausulas"], list.map(([j, o]) => [j, o.n, o.c]), "openPlayer");
}

function renderPlayerDetail(name) {
  const ev = buildEvents(allRowsRaw()).filter(e => e.jugador === name);
  const owners = new Set();
  ev.forEach(e => {
    if ((e.tipo === "Compra" || e.tipo === "Clausula compra") && !e.corregida) owners.add(e.actor);
  });
  const resumen = ev.length === 0
    ? "Sin movimientos registrados."
    : `${ev.length} movimiento${ev.length === 1 ? "" : "s"} · ${owners.size} dueno${owners.size === 1 ? "" : "s"} distinto${owners.size === 1 ? "" : "s"}`;
  return `
    <button class="back-btn" onclick="closePlayer()">&larr; Volver a jugadores</button>
    <h3 class="font-display dossier-title" style="font-size:22px;">${escapeHtml(name)}</h3>
    <p class="player-summary">${resumen}</p>
    ${ev.map(e => eventCardHtml(e, false)).join("")}`;
}

// ---------- Resumen semanal para WhatsApp ----------
function buildWeekSummaryText(week) {
  const rows = allRowsRaw().filter(r => r.Semana === week);
  const summaryRow = SUMMARY_ROWS.find(r => r.Semana === week) || {};
  const fichajes = USERS.map(u => [u, Number(summaryRow[u] || 0)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const clausulas = rows.filter(r => r.Tipo === "Clausula compra" && !r.corregida);
  const patinazos = rows.filter(r => r.Tipo === "Patinazo");

  const lines = [`*MUVINS BIWENGER*`, week + (isCurrentWeekLabel(week) ? " (en curso)" : ""), ""];
  lines.push("🛒 *Fichajes*");
  lines.push(fichajes.length ? fichajes.map(([u, n]) => `${u}: ${n}`).join("\n") : "Sin fichajes");
  lines.push("");
  lines.push("🎯 *Clausulazos*");
  lines.push(clausulas.length ? clausulas.map(r => `${r.usuario} a ${r.Vendedor} (${r.Jugador})`).join("\n") : "Ninguno");
  lines.push("");
  lines.push("🛼 *Patinazos*");
  lines.push(patinazos.length ? patinazos.map(r => `${r.usuario} (${r.Jugador})`).join("\n") : "Ninguno");
  return lines.join("\n");
}

function openWeekShare() {
  const week = summarySelectedWeek;
  if (!week) return;
  closeWeekShare();
  const canShare = typeof navigator.share === "function";
  const div = document.createElement("div");
  div.id = "share-modal";
  div.className = "modal-backdrop";
  div.onclick = e => { if (e.target === div) closeWeekShare(); };
  div.innerHTML = `
    <div class="modal-box modal-wide">
      <textarea id="share-text" class="share-text"></textarea>
      <div class="modal-row">
        <button class="btn-main" id="share-copy" onclick="copyShareText()">Copiar</button>
        ${canShare ? `<button class="btn-ghost" onclick="nativeShare()">Compartir</button>` : ""}
        <button class="btn-ghost" onclick="closeWeekShare()">Cerrar</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  document.getElementById("share-text").value = buildWeekSummaryText(week);
}
function closeWeekShare() {
  const el = document.getElementById("share-modal");
  if (el) el.remove();
}
function copyShareText() {
  const ta = document.getElementById("share-text");
  const btn = document.getElementById("share-copy");
  const done = () => { btn.textContent = "Copiado"; setTimeout(() => { btn.textContent = "Copiar"; }, 1500); };
  const fallback = () => { ta.select(); try { document.execCommand("copy"); done(); } catch (e) {} };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done).catch(fallback);
  } else fallback();
}
function nativeShare() {
  const ta = document.getElementById("share-text");
  navigator.share({ text: ta.value }).catch(() => {});
}

// ---------- Grafico de actividad (ficha de usuario) ----------
function activityChartHtml(user) {
  const weeks = SUMMARY_ROWS.map(r => r.Semana).slice(0, 12).reverse();
  if (weeks.length === 0) return "";
  const rows = allRowsRaw().filter(r => r.usuario === user && !r.corregida);
  const counts = weeks.map(w => rows.filter(r => r.Semana === w).length);
  const max = Math.max(1, ...counts);
  const W = 300, H = 112, top = 16, bottom = 18;
  const bw = W / weeks.length;
  const bars = weeks.map((w, i) => {
    const c = counts[i];
    const h = c === 0 ? 2 : Math.max(3, Math.round((c / max) * (H - top - bottom)));
    const x = (i * bw + bw * 0.18).toFixed(1);
    const width = (bw * 0.64).toFixed(1);
    const y = H - bottom - h;
    const cls = c === 0 ? "bar-zero" : (weekHadPatinazo(user, w) ? "bar-pat" : "bar");
    const num = (String(w).match(/Semana\s+(\d+)/) || [])[1] || "";
    const cx = (i * bw + bw / 2).toFixed(1);
    return `<rect class="${cls}" x="${x}" y="${y}" width="${width}" height="${h}" rx="2"></rect>` +
      (c > 0 ? `<text class="val" x="${cx}" y="${y - 3}" text-anchor="middle">${c}</text>` : "") +
      `<text x="${cx}" y="${H - 5}" text-anchor="middle">S${num}</text>`;
  }).join("");
  return `
    <div class="chart-card">
      <p class="chart-title">Movimientos por semana</p>
      <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Movimientos por semana">${bars}</svg>
    </div>`;
}

// ---------- Tirar hacia abajo para actualizar ----------
(function setupPullToRefresh() {
  const appRoot = document.getElementById("app-root");
  const indicator = document.getElementById("pull-indicator");
  const THRESHOLD = 70;
  const MAX_PULL = 95;
  let startY = null;
  let pulling = false;
  let refreshing = false;

  appRoot.addEventListener("touchstart", (e) => {
    if (refreshing) return;
    if (appRoot.scrollTop <= 0) {
      startY = e.touches[0].clientY;
      pulling = true;
    } else {
      startY = null;
      pulling = false;
    }
  }, { passive: true });

  appRoot.addEventListener("touchmove", (e) => {
    if (!pulling || startY === null || refreshing) return;
    const delta = e.touches[0].clientY - startY;
    if (delta > 0 && appRoot.scrollTop <= 0) {
      e.preventDefault();
      const capped = Math.min(delta * 0.5, MAX_PULL);
      indicator.style.height = capped + "px";
      indicator.textContent = capped >= THRESHOLD
        ? "\u2191 Suelta para actualizar"
        : "\u2193 Desliza hacia abajo para actualizar";
    }
  }, { passive: false });

  appRoot.addEventListener("touchend", () => {
    if (!pulling) return;
    const currentHeight = parseFloat(indicator.style.height) || 0;
    if (currentHeight >= THRESHOLD && !refreshing) {
      refreshing = true;
      indicator.textContent = "Actualizando...";
      indicator.style.height = "50px";
      loadAll().finally(() => {
        indicator.style.height = "0px";
        refreshing = false;
      });
    } else {
      indicator.style.height = "0px";
    }
    pulling = false;
    startY = null;
  });
})();

window.__cargados = (window.__cargados || []).concat("app-extra.js");
loadAll();
