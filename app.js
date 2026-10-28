/* Planner: Google Tasks + Google Calendar backed PWA. No build step, no dependencies. */
(() => {
"use strict";
const CFG = window.PLANNER_CONFIG || {};
const AREAS = { work: { label: "Work" }, school: { label: "School" }, personal: { label: "Personal" } };
const AKEYS = Object.keys(AREAS);
const LIST_NAMES = Object.assign({ work: "Work", school: "School", personal: "Personal" }, CFG.lists || {});
const DEFAULT_TARGETS = Object.assign({ work: 20, school: 15, personal: 10 }, CFG.defaultTargets || {});
const SCOPES = "https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.readonly";
const TASKS = "https://tasks.googleapis.com/tasks/v1";
const CAL = "https://www.googleapis.com/calendar/v3";
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, "");

/* ---------- small utils ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; };
const todayStr = () => ymd(new Date());
const fmtMins = m => { if (!m) return ""; const h = Math.floor(m / 60), r = m % 60; return h ? (r ? h + "h" + r : h + "h") : r + "m"; };
const fmtH = m => (Math.round(m / 6) / 10).toString();
const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hhmm = d => pad(d.getHours()) + ":" + pad(d.getMinutes());
const rid = () => "tmp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

/* ---------- notes metadata (start time, duration, priority live in a trailing tag line) ---------- */
const META_RE = /(?:^|\n)#planner((?:[ \t]+[a-z]+=\S+)*)[ \t]*$/;
function parseNotes(raw) {
  const out = { notes: raw || "", start: null, mins: 0, prio: 2 };
  const m = (raw || "").match(META_RE);
  if (!m) return out;
  out.notes = raw.slice(0, m.index).replace(/\s+$/, "");
  for (const kv of m[1].trim().split(/\s+/).filter(Boolean)) {
    const [k, v] = kv.split("=");
    if (k === "start" && /^\d{2}:\d{2}$/.test(v)) out.start = v;
    if (k === "mins") out.mins = Math.max(0, parseInt(v, 10) || 0);
    if (k === "prio" && /^[123]$/.test(v)) out.prio = +v;
  }
  return out;
}
function buildNotes(t) {
  const bits = [];
  if (t.start) bits.push("start=" + t.start);
  if (t.mins) bits.push("mins=" + t.mins);
  if (t.prio && t.prio !== 2) bits.push("prio=" + t.prio);
  const base = (t.notes || "").replace(/\s+$/, "");
  if (!bits.length) return base;
  return (base ? base + "\n\n" : "") + "#planner " + bits.join(" ");
}

/* ---------- quick add parser ---------- */
const WD = { sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6 };
function parseQuick(str, defArea, now = new Date()) {
  let s = " " + str + " ";
  const out = { area: defArea, prio: 2, due: null, start: null, mins: 30 };
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  s = s.replace(/\s#(work|w|cet|school|s|uni|personal|p|life)(?=\s)/i, (m, a) => { a = a.toLowerCase(); out.area = (a === "work" || a === "w" || a === "cet") ? "work" : (a === "school" || a === "s" || a === "uni") ? "school" : "personal"; return " "; });
  s = s.replace(/\s!([123])(?=\s)/, (m, p) => { out.prio = +p; return " "; });
  s = s.replace(/\s(\d+(?:\.\d+)?)\s?(m|min|mins|h|hr|hrs)(?=\s)/i, (m, n, u) => { out.mins = Math.round(/^h/i.test(u) ? parseFloat(n) * 60 : parseFloat(n)); return " "; });
  s = s.replace(/\s(?:at\s|@)?(\d{1,2}):(\d{2})(?=\s)/i, (m, h, mi) => { if (+h < 24 && +mi < 60) { out.start = pad(+h) + ":" + mi; return " "; } return m; });
  if (!out.start) s = s.replace(/\s(?:at\s|@)?(\d{1,2})(?::(\d{2}))?\s?(am|pm)(?=\s)/i, (m, h, mi, ap) => { if (+h > 12) return m; h = (+h % 12) + (ap.toLowerCase() === "pm" ? 12 : 0); out.start = pad(h) + ":" + (mi || "00"); return " "; });
  s = s.replace(/\s(\d{4}-\d{2}-\d{2})(?=\s)/, (m, d) => { out.due = d; return " "; });
  if (!out.due) s = s.replace(/\s(\d{1,2})\/(\d{1,2})(?=\s)/, (m, d, mo) => { if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return m; const y = today.getFullYear(); let dt = new Date(y, +mo - 1, +d); if (dt < addDays(today, -60)) dt = new Date(y + 1, +mo - 1, +d); out.due = ymd(dt); return " "; });
  if (!out.due) s = s.replace(/\s(today|tod|tonight|tomorrow|tmrw|tmr|tom)(?=\s)/i, (m, w) => { out.due = ymd(/^to(d|day|night)$/i.test(w) ? today : addDays(today, 1)); return " "; });
  if (!out.due) s = s.replace(/^([\s\S]*)\s(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)(?=\s)/i, (m, pre, w) => { const t = WD[w.slice(0, 3).toLowerCase()]; out.due = ymd(addDays(today, (t - today.getDay() + 7) % 7)); return pre + " "; });
  if (out.start && !out.due) out.due = ymd(today);
  out.title = s.replace(/\s+/g, " ").trim();
  return out;
}
function niceDate(s) {
  if (!s) return "";
  const n = new Date();
  if (s === ymd(n)) return "Today";
  if (s === ymd(addDays(n, 1))) return "Tomorrow";
  if (s === ymd(addDays(n, -1))) return "Yesterday";
  const d = parseYmd(s); return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()];
}

// Exposed for tests in Node.
if (typeof module !== "undefined") { module.exports = { parseQuick, parseNotes, buildNotes }; return; }

/* ---------- state ---------- */
const cache = ls.get("pl.cache", {});
const settings = Object.assign({ targets: { ...DEFAULT_TARGETS }, calAreas: {} }, ls.get("pl.settings", {}));
settings.targets = Object.assign({ ...DEFAULT_TARGETS }, settings.targets);
const ui = ls.get("pl.ui", {});
const state = {
  token: ls.get("pl.token", null),
  lists: cache.lists || {},              // area -> tasklist id
  tasks: cache.tasks || {},              // id -> task
  calendars: cache.calendars || [],      // [{id, name, color, selected}]
  events: cache.events || {},            // key -> event
  fetchedMonths: {},                     // month key -> timestamp (this session)
  outbox: ls.get("pl.outbox", []),       // [{kind, id, listId}]
  view: "today", cursor: new Date(), filter: "all",
  qaArea: AKEYS.includes(ui.qaArea) ? ui.qaArea : "work",
  editing: null, syncing: false, online: navigator.onLine, authProblem: null, lastPull: 0
};
function saveCache() { ls.set("pl.cache", { lists: state.lists, tasks: state.tasks, calendars: state.calendars, events: state.events }); }
function saveOutbox() { ls.set("pl.outbox", state.outbox); }
function saveSettings() { ls.set("pl.settings", settings); }

/* ---------- auth (OAuth 2.0 implicit redirect flow; works in iOS home-screen apps) ---------- */
function tokenValid() { return state.token && state.token.exp > Date.now() + 60000; }
function authRedirect(silent) {
  if (!CFG.clientId || /PASTE_CLIENT_ID/.test(CFG.clientId)) { showGate("This app isn't configured yet: add the Google client ID to config.js."); return; }
  const st = Math.random().toString(36).slice(2) + Date.now().toString(36);
  ls.set("pl.oauthState", st);
  ls.set("pl.returnHash", location.hash && !/access_token|error=/.test(location.hash) ? location.hash : "");
  if (silent) ls.set("pl.silentAt", Date.now());
  const p = new URLSearchParams({ client_id: CFG.clientId, redirect_uri: REDIRECT, response_type: "token", scope: SCOPES, include_granted_scopes: "true", state: st, prompt: silent ? "none" : "select_account" });
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}
function readRedirect() {
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  const expected = ls.get("pl.oauthState", null);
  ls.del("pl.oauthState");
  const back = ls.get("pl.returnHash", "") || "";
  history.replaceState(null, "", REDIRECT + back);
  if (expected && p.get("state") !== expected) return { error: "state_mismatch" };
  if (p.get("error")) return { error: p.get("error") };
  const scope = p.get("scope") || "";
  return { token: { access: p.get("access_token"), exp: Date.now() + (parseInt(p.get("expires_in"), 10) || 3600) * 1000 }, scope };
}
function canSilent() { return ls.get("pl.authed", false) && Date.now() - ls.get("pl.silentAt", 0) > 60000; }
async function signOut() {
  const t = state.token && state.token.access;
  ls.del("pl.token"); ls.del("pl.authed"); ls.del("pl.cache"); ls.del("pl.outbox");
  if (t) { try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(t), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }); } catch {} }
  location.replace(REDIRECT);
}

/* ---------- Google API ---------- */
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
async function api(method, url, body) {
  if (!tokenValid()) throw new ApiError(401, "Token expired");
  let res;
  try {
    res = await fetch(url, { method, headers: Object.assign({ Authorization: "Bearer " + state.token.access }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new ApiError(0, "offline"); }
  if (res.status === 204) return null;
  let data = null; try { data = await res.json(); } catch {}
  if (!res.ok) throw new ApiError(res.status, (data && data.error && data.error.message) || res.statusText);
  return data;
}
function handleApiError(e) {
  if (e.status === 401) {
    state.token = null; ls.del("pl.token");
    if (document.visibilityState === "visible" && !state.editing && canSilent()) { authRedirect(true); return; }
    state.authProblem = "expired";
  } else if (e.status === 403) {
    state.authProblem = /has not been used|disabled/i.test(e.message) ? "api" : "forbidden";
    state.authDetail = e.message;
  } else if (e.status === 0) {
    state.online = false;
  } else {
    toast("Google returned an error: " + e.message);
  }
  render();
}

/* ---------- tasks: mapping ---------- */
function fromGoogle(g, area, listId) {
  const meta = parseNotes(g.notes || "");
  return { id: g.id, listId, area, title: g.title || "", notes: meta.notes, due: g.due ? g.due.slice(0, 10) : null, start: meta.start, mins: meta.mins, prio: meta.prio, done: g.status === "completed", updated: g.updated };
}
function toGoogle(t, withId) {
  const b = { title: t.title, notes: buildNotes(t), status: t.done ? "completed" : "needsAction" };
  if (t.due) b.due = t.due + "T00:00:00.000Z";
  if (withId) b.id = t.id;
  return b;
}

/* ---------- sync ---------- */
async function ensureLists() {
  const have = [];
  let pageToken = "";
  do {
    const r = await api("GET", TASKS + "/users/@me/lists?maxResults=100" + (pageToken ? "&pageToken=" + pageToken : ""));
    have.push(...(r.items || [])); pageToken = r.nextPageToken || "";
  } while (pageToken);
  for (const a of AKEYS) {
    const found = have.find(l => (l.title || "").trim().toLowerCase() === LIST_NAMES[a].toLowerCase());
    if (found) state.lists[a] = found.id;
    else { const c = await api("POST", TASKS + "/users/@me/lists", { title: LIST_NAMES[a] }); state.lists[a] = c.id; }
  }
}
async function pullTasks() {
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const fresh = {};
  for (const a of AKEYS) {
    const lid = state.lists[a]; let pageToken = "";
    do {
      const r = await api("GET", `${TASKS}/lists/${encodeURIComponent(lid)}/tasks?maxResults=100&showCompleted=true&showHidden=true&completedMin=${encodeURIComponent(since)}` + (pageToken ? "&pageToken=" + pageToken : ""));
      for (const g of r.items || []) if (!g.deleted) fresh[g.id] = fromGoogle(g, a, lid);
      pageToken = r.nextPageToken || "";
    } while (pageToken);
  }
  // Keep local edits that haven't reached Google yet.
  for (const o of state.outbox) {
    if (o.kind === "upsert" && state.tasks[o.id]) fresh[o.id] = state.tasks[o.id];
    if (o.kind === "delete") delete fresh[o.id];
  }
  state.tasks = fresh;
}
async function pullCalendars() {
  const r = await api("GET", CAL + "/users/me/calendarList?minAccessRole=reader&maxResults=250");
  state.calendars = (r.items || []).map(c => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || "#888", selected: !!c.selected, primary: !!c.primary }));
}
function calArea(calId) {
  const v = settings.calAreas[calId];
  if (v) return v;
  const c = state.calendars.find(x => x.id === calId);
  return c && c.selected ? "show" : "off";
}
function monthKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
function monthRange(key) { const [y, m] = key.split("-").map(Number); const s = startOfWeek(new Date(y, m - 1, 1)); return [s, addDays(s, 42)]; }
async function pullEvents(key) {
  const [s, e] = monthRange(key);
  const cals = state.calendars.filter(c => calArea(c.id) !== "off");
  const got = {};
  for (const c of cals) {
    let pageToken = "";
    do {
      const q = new URLSearchParams({ timeMin: s.toISOString(), timeMax: e.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" });
      if (pageToken) q.set("pageToken", pageToken);
      const r = await api("GET", `${CAL}/calendars/${encodeURIComponent(c.id)}/events?` + q);
      for (const ev of r.items || []) {
        if (ev.status === "cancelled") continue;
        const mine = (ev.attendees || []).find(a => a.self);
        if (mine && mine.responseStatus === "declined") continue;
        const allDay = !!(ev.start && ev.start.date);
        const o = { id: ev.id, calId: c.id, title: ev.summary || "(busy)", link: ev.htmlLink || "", allDay };
        if (allDay) { o.date = ev.start.date; o.endDate = ev.end.date; }
        else { o.start = Date.parse(ev.start.dateTime); o.end = Date.parse(ev.end.dateTime); o.date = ymd(new Date(o.start)); }
        got[c.id + "|" + ev.id] = o;
      }
      pageToken = r.nextPageToken || "";
    } while (pageToken);
  }
  const sk = ymd(s), ek = ymd(e);
  for (const [k, v] of Object.entries(state.events)) if (v.date >= sk && v.date < ek) delete state.events[k];
  Object.assign(state.events, got);
  state.fetchedMonths[key] = Date.now();
}
function neededMonths() {
  const ks = new Set([monthKey(new Date()), monthKey(state.cursor)]);
  if (state.view === "week") { ks.add(monthKey(startOfWeek(state.cursor))); ks.add(monthKey(addDays(startOfWeek(state.cursor), 6))); }
  return [...ks];
}
let flushing = null;
function flush() { if (!flushing) flushing = doFlush().finally(() => { flushing = null; }); return flushing; }
async function doFlush() {
  while (state.outbox.length) {
    if (!tokenValid() || !state.online) return;
    const o = state.outbox[0];
    try {
      if (o.kind === "upsert") {
        const t = state.tasks[o.id];
        if (t) {
          const target = state.lists[t.area];
          if (o.id.startsWith("tmp_") || (t.listId && t.listId !== target)) {
            const g = await api("POST", `${TASKS}/lists/${encodeURIComponent(target)}/tasks`, toGoogle(t));
            if (!o.id.startsWith("tmp_") && t.listId) { try { await api("DELETE", `${TASKS}/lists/${encodeURIComponent(t.listId)}/tasks/${encodeURIComponent(t.id)}`); } catch (e) { if (e.status !== 404) throw e; } }
            const nt = { ...t, id: g.id, listId: target, updated: g.updated };
            delete state.tasks[o.id]; state.tasks[g.id] = nt;
            state.outbox.forEach(x => { if (x.id === o.id) x.id = g.id; });
            if (state.editing && state.editing.id === o.id) state.editing.id = g.id;
          } else {
            const g = await api("PUT", `${TASKS}/lists/${encodeURIComponent(target)}/tasks/${encodeURIComponent(t.id)}`, toGoogle(t, true));
            state.tasks[t.id] = { ...t, listId: target, updated: g.updated };
          }
        }
      } else if (o.kind === "delete" && !o.id.startsWith("tmp_")) {
        try { await api("DELETE", `${TASKS}/lists/${encodeURIComponent(o.listId)}/tasks/${encodeURIComponent(o.id)}`); } catch (e) { if (e.status !== 404) throw e; }
      }
      state.outbox.shift(); saveOutbox(); saveCache();
    } catch (e) {
      if (e.status === 404 && o.kind === "upsert") { // task deleted elsewhere: recreate it
        const t = state.tasks[o.id]; if (t) { t.listId = null; const nid = rid(); delete state.tasks[o.id]; t.id = nid; state.tasks[nid] = t; o.id = nid; saveOutbox(); continue; }
        state.outbox.shift(); saveOutbox(); continue;
      }
      if (e.status === 400) { toast("Google rejected a change and it was skipped: " + e.message); state.outbox.shift(); saveOutbox(); continue; }
      handleApiError(e); return;
    } finally { renderSync(); }
  }
  render();
}
async function sync(full) {
  if (state.syncing || !tokenValid()) return;
  state.syncing = true; renderSync();
  try {
    if (full || !state.lists.work) await ensureLists();
    await flush();
    if (state.outbox.length) return;
    await pullTasks();
    if (full || !state.calendars.length) await pullCalendars();
    for (const k of neededMonths()) await pullEvents(k);
    state.online = true; state.authProblem = null; state.lastPull = Date.now();
    saveCache();
  } catch (e) { if (e instanceof ApiError) handleApiError(e); else { console.error(e); toast("Sync failed: " + e.message); } }
  finally { state.syncing = false; render(); }
}
async function ensureMonths() {
  if (!tokenValid() || !state.online) return;
  const miss = neededMonths().filter(k => !state.fetchedMonths[k]);
  if (!miss.length) return;
  try { for (const k of miss) await pullEvents(k); saveCache(); render(); } catch (e) { if (e instanceof ApiError) handleApiError(e); }
}

/* ---------- local mutations (optimistic, queued) ---------- */
function queue(kind, id, listId) {
  state.outbox = state.outbox.filter(o => o.id !== id);
  if (!(kind === "delete" && id.startsWith("tmp_"))) state.outbox.push({ kind, id, listId });
  saveOutbox();
}
function writeTask(t) { state.tasks[t.id] = t; queue("upsert", t.id); saveCache(); render(); flush(); }
function deleteTask(id) { const t = state.tasks[id]; if (!t) return null; delete state.tasks[id]; queue("delete", id, t.listId); saveCache(); render(); flush(); return t; }
function newTask(f) { return Object.assign({ id: rid(), listId: null, title: "", area: state.qaArea, prio: 2, due: null, start: null, mins: 30, done: false, notes: "" }, f); }

/* ---------- derived data ---------- */
const allTasks = () => Object.values(state.tasks);
const visTasks = () => allTasks().filter(t => state.filter === "all" || t.area === state.filter);
function eventsOn(day) {
  const out = [];
  for (const e of Object.values(state.events)) {
    const a = calArea(e.calId); if (a === "off") continue;
    if (state.filter !== "all" && a !== state.filter) continue;
    if (e.allDay ? (e.date <= day && day < e.endDate) : e.date === day) out.push({ ...e, area: a });
  }
  return out.sort((x, y) => (x.allDay === y.allDay ? (x.start || 0) - (y.start || 0) : x.allDay ? -1 : 1));
}
const evMins = e => e.allDay ? 0 : Math.max(0, Math.round((e.end - e.start) / 60000));
const evColor = e => e.area === "show" || !AREAS[e.area] ? "cal" : e.area;
function sortTasks(a, b) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  if (a.start && b.start) return a.start.localeCompare(b.start);
  if (a.start !== b.start) return a.start ? -1 : 1;
  return (a.prio || 2) - (b.prio || 2) || a.title.localeCompare(b.title);
}
function dayLoad(day) {
  const by = { work: 0, school: 0, personal: 0 }; let cal = 0;
  for (const t of allTasks()) if (t.due === day && by[t.area] != null) by[t.area] += t.mins || 0;
  for (const e of Object.values(state.events)) { const a = calArea(e.calId); if (!e.allDay && e.date === day && by[a] != null) { by[a] += evMins(e); cal += evMins(e); } }
  return { by, cal };
}

/* ---------- rendering ---------- */
const CHECK = '<svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>';
const isPending = id => state.outbox.some(o => o.id === id);
function taskHTML(t, opts = {}) {
  const bits = [];
  if (opts.showDate && t.due) bits.push(esc(niceDate(t.due)));
  if (t.start) bits.push(esc(t.start));
  if (t.mins) bits.push(fmtMins(t.mins));
  if (t.prio === 1) bits.push('<span class="p1">P1</span>');
  if (state.filter === "all" && opts.showArea !== false) bits.push(esc(AREAS[t.area].label));
  return `<div class="task${t.done ? " done" : ""}${isPending(t.id) ? " pending" : ""}" data-c="${t.area}" data-id="${esc(t.id)}" draggable="true" tabindex="0">
    <button class="check" type="button" data-act="toggle" aria-label="${t.done ? "Mark not done" : "Mark done"}">${CHECK}</button>
    <div class="tb"><div class="ttl">${esc(t.title)}</div><div class="meta">${bits.join("<span>·</span>")}</div></div></div>`;
}
function evHTML(e) {
  const when = e.allDay ? "All day" : hhmm(new Date(e.start)) + "–" + hhmm(new Date(e.end));
  return `<a class="ev${e.allDay ? " allday" : ""}" data-c="${evColor(e)}" href="${esc(e.link)}" target="_blank" rel="noopener"><time>${when}</time><span>${esc(e.title)}</span></a>`;
}
const listHTML = (ts, opts, empty) => ts.length ? `<div class="list">${ts.map(t => taskHTML(t, opts)).join("")}</div>` : (empty ? `<div class="empty">${empty}</div>` : "");

function renderToday() {
  const t = todayStr(), vs = visTasks();
  const overdue = vs.filter(x => x.due && x.due < t && !x.done).sort((a, b) => a.due.localeCompare(b.due));
  const today = vs.filter(x => x.due === t).sort(sortTasks);
  const evs = eventsOn(t), allDay = evs.filter(e => e.allDay), timedEv = evs.filter(e => !e.allDay);
  const open = today.filter(x => !x.done);
  let left = "<div>";
  if (overdue.length) left += `<div class="group"><div class="group-h"><p class="sec-h" style="color:var(--danger)">Overdue</p><span class="count">${overdue.length}</span><span class="spacer"></span><button class="btn mini" type="button" data-act="rollover">Move all to today</button></div>${listHTML(overdue, { showDate: true })}</div>`;
  left += `<div class="group" data-drop-date="${t}"><div class="group-h"><p class="sec-h">Today</p><span class="count">${today.length - open.length}/${today.length} done · ${fmtH(open.reduce((s, x) => s + (x.mins || 0), 0))}h left</span></div>${listHTML(today, {}, "Nothing due today. Add a task above with <b>today</b>.")}</div></div>`;
  const H0 = 7, H1 = 24, hp = 46;
  let hrs = ""; for (let h = H0; h < H1; h++) hrs += `<div class="tl-hr"><span>${pad(h)}:00</span></div>`;
  const items = [
    ...today.filter(x => x.start).map(x => ({ kind: "t", o: x, s: toMin(x.start), e: toMin(x.start) + Math.max(x.mins || 30, 20) })),
    ...timedEv.map(e => { const s = new Date(e.start), en = new Date(e.end); const sm = s.getHours() * 60 + s.getMinutes(); const em = ymd(en) > t ? 24 * 60 : en.getHours() * 60 + en.getMinutes(); return { kind: "e", o: e, s: sm, e: Math.max(em, sm + 20) }; })
  ].sort((a, b) => a.s - b.s);
  const lanes = []; items.forEach(it => { let l = 0; while (lanes[l] != null && lanes[l] > it.s) l++; lanes[l] = it.e; it.l = l; });
  const nL = Math.max(1, lanes.length);
  const blocks = items.map(it => {
    const top = Math.max(0, (it.s - H0 * 60) / 60 * hp), h = Math.max(22, (it.e - Math.max(it.s, H0 * 60)) / 60 * hp - 2);
    const pos = `top:${top}px;height:${h}px;left:calc(${it.l}/${nL}*100%);width:calc(100%/${nL} - 4px)`;
    if (it.kind === "t") return `<div class="blk${it.o.done ? " done" : ""}" data-c="${it.o.area}" data-id="${esc(it.o.id)}" style="${pos}"><b>${esc(it.o.title)}</b><small>${esc(it.o.start)} · ${fmtMins(it.o.mins)}</small></div>`;
    return `<a class="blk evb" data-c="${evColor(it.o)}" href="${esc(it.o.link)}" target="_blank" rel="noopener" style="${pos}"><b>${esc(it.o.title)}</b><small>${hhmm(new Date(it.o.start))}–${hhmm(new Date(it.o.end))}</small></a>`;
  }).join("");
  const n = new Date(), nm = n.getHours() * 60 + n.getMinutes();
  const now = nm >= H0 * 60 && nm < H1 * 60 ? `<div class="now" style="top:${(nm - H0 * 60) / 60 * hp}px"></div>` : "";
  const right = `<section class="panel">${allDay.length ? `<div class="allday-row">${allDay.map(evHTML).join("")}</div>` : ""}<div class="tl">${hrs}<div class="tl-blocks">${blocks}${now}</div></div></section>`;
  return `<div class="today">${left}${right}</div>`;
}
function renderWeek() {
  const s = startOfWeek(state.cursor), t = todayStr(), vs = visTasks();
  let out = '<div class="week">';
  for (let i = 0; i < 7; i++) {
    const k = ymd(addDays(s, i)), d = addDays(s, i);
    const ts = vs.filter(x => x.due === k).sort(sortTasks), evs = eventsOn(k);
    const { by } = dayLoad(k); const tot = by.work + by.school + by.personal;
    const bar = tot ? AKEYS.map(a => by[a] ? `<i data-c="${a}" style="width:${by[a] / Math.max(tot, 480) * 100}%"></i>` : "").join("") : "";
    const rows = [
      ...evs.filter(e => e.allDay).map(e => ({ s: -1, h: evHTML(e) })),
      ...evs.filter(e => !e.allDay).map(e => { const x = new Date(e.start); return { s: x.getHours() * 60 + x.getMinutes(), h: evHTML(e) }; }),
      ...ts.filter(x => x.start && !x.done).map(x => ({ s: toMin(x.start) + 0.5, h: taskHTML(x, { showArea: false }) })),
    ].sort((a, b) => a.s - b.s).map(r => r.h).join("") + ts.filter(x => !x.start || x.done).sort(sortTasks).map(x => taskHTML(x, { showArea: false })).join("");
    out += `<div class="day${k === t ? " is-today" : ""}" data-drop-date="${k}">
      <div class="day-h"><b><em>${DOW[i]}</em>${d.getDate()}</b><small>${tot ? fmtH(tot) + "h" : ""}</small></div>
      <div class="loadbar" title="Planned hours, full bar = 8h">${bar}</div>${rows}
      <button class="add-day" type="button" data-act="addon" data-date="${k}">+ Add</button></div>`;
  }
  return out + "</div>";
}
function renderMonth() {
  const c = state.cursor, first = new Date(c.getFullYear(), c.getMonth(), 1), s = startOfWeek(first), t = todayStr(), vs = visTasks();
  const weeks = Math.ceil((first.getDay() + new Date(c.getFullYear(), c.getMonth() + 1, 0).getDate()) / 7);
  let out = '<div class="month-wrap"><div class="month">' + DOW.map(d => `<div class="mh">${d}</div>`).join("");
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(s, i), k = ymd(d);
    const items = [
      ...eventsOn(k).map(e => `<div class="mt ev" data-c="${evColor(e)}">${e.allDay ? "" : hhmm(new Date(e.start)) + " "}${esc(e.title)}</div>`),
      ...vs.filter(x => x.due === k).sort(sortTasks).map(x => `<div class="mt${x.done ? " done" : ""}" data-c="${x.area}" data-id="${esc(x.id)}" draggable="true">${x.start ? esc(x.start) + " " : ""}${esc(x.title)}</div>`)
    ];
    out += `<div class="mc${d.getMonth() !== c.getMonth() ? " out" : ""}${k === t ? " is-today" : ""}" data-drop-date="${k}" data-act="gotoweek" data-date="${k}"><span class="mn">${d.getDate()}</span>${items.slice(0, 4).join("")}${items.length > 4 ? `<span class="more">+${items.length - 4} more</span>` : ""}</div>`;
  }
  return out + "</div></div>";
}
function renderAll() {
  const t = todayStr(), wkEnd = ymd(addDays(startOfWeek(new Date()), 6));
  const g = { Overdue: [], Today: [], "Rest of this week": [], Later: [], "No date": [], Done: [] };
  visTasks().forEach(x => { if (x.done) g.Done.push(x); else if (!x.due) g["No date"].push(x); else if (x.due < t) g.Overdue.push(x); else if (x.due === t) g.Today.push(x); else if (x.due <= wkEnd) g["Rest of this week"].push(x); else g.Later.push(x); });
  const byDate = (a, b) => (a.due || "").localeCompare(b.due || "") || sortTasks(a, b);
  g.Done.sort((a, b) => (b.due || "").localeCompare(a.due || ""));
  let out = "";
  for (const [k, v] of Object.entries(g)) {
    if (!v.length) continue; if (k !== "Done") v.sort(byDate);
    out += `<div class="group"><div class="group-h"><p class="sec-h"${k === "Overdue" ? ' style="color:var(--danger)"' : ""}>${k}</p><span class="count">${v.length}</span></div>${listHTML(k === "Done" ? v.slice(0, 40) : v, { showDate: true })}</div>`;
  }
  return out || '<div class="empty">No tasks yet. Add your first one in the bar above.</div>';
}
function renderRail() {
  const s = startOfWeek(state.view === "week" ? state.cursor : new Date()), e = addDays(s, 6), ks = ymd(s), ke = ymd(e), now = Date.now();
  $("#balTitle").textContent = `Balance · ${s.getDate()} ${MON[s.getMonth()]} – ${e.getDate()} ${MON[e.getMonth()]}`;
  const wk = allTasks().filter(x => x.due && x.due >= ks && x.due <= ke);
  const wkEv = Object.values(state.events).filter(x => !x.allDay && x.date >= ks && x.date <= ke && AREAS[calArea(x.calId)]);
  $("#bal").innerHTML = AKEYS.map(a => {
    const ts = wk.filter(x => x.area === a), ev = wkEv.filter(x => calArea(x.calId) === a);
    const plan = ts.reduce((q, x) => q + (x.mins || 0), 0) + ev.reduce((q, x) => q + evMins(x), 0);
    const did = ts.filter(x => x.done).reduce((q, x) => q + (x.mins || 0), 0) + ev.filter(x => x.end < now).reduce((q, x) => q + evMins(x), 0);
    const tg = (+settings.targets[a] || 0) * 60, scale = Math.max(tg, plan, 60);
    return `<div class="bal-row" data-c="${a}"><span class="nm"><span class="dot"></span>${AREAS[a].label}</span>
      <div class="track" title="${fmtH(did)}h done of ${fmtH(plan)}h planned · target ${settings.targets[a]}h"><div class="plan" style="width:${plan / scale * 100}%"></div><div class="did" style="width:${did / scale * 100}%"></div>${tg ? `<div class="tg" style="left:calc(${tg / scale * 100}% - 1px)"></div>` : ""}</div>
      <span class="num${tg && plan > tg ? " over" : ""}">${fmtH(plan)}/${settings.targets[a]}h</span></div>`;
  }).join("");
  const days = [...Array(7)].map((_, i) => dayLoad(ymd(addDays(s, i))).by);
  const tots = days.map(b => b.work + b.school + b.personal), max = Math.max(480, ...tots), step = max > 720 ? 240 : 120;
  let gl = ""; for (let m = step; m <= max; m += step) gl += `<div class="gl" style="bottom:${m / max * 100}%"><span>${m / 60}h</span></div>`;
  $("#chart").innerHTML = gl + days.map((b, i) => `<div class="col" title="${fmtH(tots[i])}h planned">${AKEYS.map(a => b[a] ? `<i data-c="${a}" style="height:${b[a] / max * 100}%"></i>` : "").join("")}</div>`).join("");
  const t = todayStr();
  $("#chartX").innerHTML = [...Array(7)].map((_, i) => `<span class="${ymd(addDays(s, i)) === t ? "t" : ""}">${DOW[i][0]}</span>`).join("");
  $("#doneStat").textContent = `${wk.filter(x => x.done).length}/${wk.length}`;
  $("#calStat").textContent = fmtH(wkEv.reduce((q, x) => q + evMins(x), 0)) + "h";
  const inbox = visTasks().filter(x => !x.due && !x.done).sort(sortTasks);
  $("#inboxCount").textContent = inbox.length || "";
  $("#inbox").innerHTML = inbox.length ? inbox.map(x => taskHTML(x)).join("") : '<div class="empty">Tasks without a date land here.</div>';
}
function renderSync() {
  const el = $("#sync"), tx = $("#syncTxt"); if (!el) return;
  const n = state.outbox.length;
  el.className = "sync" + (!state.online || state.authProblem ? " off" : (n || state.syncing) ? " pending" : "");
  tx.textContent = !state.online ? `Offline${n ? " · " + n + " to sync" : ""}` : state.authProblem ? "Not syncing" : state.syncing ? "Syncing…" : n ? `${n} to sync` : "Synced";
}
function renderBanner() {
  let h = "";
  if (state.authProblem === "expired") h = `<div class="banner">Your Google session expired. Changes are saved on this device until you reconnect. <button class="btn mini primary" type="button" data-act="reconnect">Reconnect</button></div>`;
  else if (state.authProblem === "api") h = `<div class="banner">Google says an API isn't enabled for this app yet. Enable both Google Tasks API and Google Calendar API in Google Cloud, then refresh.</div>`;
  else if (state.authProblem === "forbidden") h = `<div class="banner">Google refused access (${esc(state.authDetail || "403")}). Sign out and sign in again, and allow both Tasks and Calendar. <button class="btn mini" type="button" data-act="reconnect">Sign in again</button></div>`;
  $("#banner").innerHTML = h;
}
function renderChrome() {
  const n = new Date();
  $("#todayLbl").textContent = `${DOW[n.getDay()]} ${n.getDate()} ${MON[n.getMonth()]}`;
  document.querySelectorAll(".tabs a").forEach(a => a.setAttribute("aria-current", a.dataset.v === state.view ? "page" : "false"));
  $("#qaArea").innerHTML = AKEYS.map(a => `<button type="button" data-c="${a}" data-qa="${a}" aria-pressed="${state.qaArea === a}">${AREAS[a].label}</button>`).join("");
  $("#filters").innerHTML = [["all", "All"], ...AKEYS.map(a => [a, AREAS[a].label])].map(([k, l]) => `<button class="fchip" type="button" data-f="${k}" ${k !== "all" ? `data-c="${k}"` : ""} aria-pressed="${state.filter === k}">${k !== "all" ? '<span class="dot"></span>' : ""}${l}</button>`).join("");
  let nav = "";
  if (state.view === "week") { const s = startOfWeek(state.cursor), e = addDays(s, 6); nav = `<button class="iconbtn" type="button" data-act="prev" aria-label="Previous week">‹</button><span class="lbl">${s.getDate()} ${MON[s.getMonth()]} – ${e.getDate()} ${MON[e.getMonth()]}</span><button class="iconbtn" type="button" data-act="next" aria-label="Next week">›</button><button class="btn mini ghost" type="button" data-act="now">This week</button>`; }
  else if (state.view === "month") nav = `<button class="iconbtn" type="button" data-act="prev" aria-label="Previous month">‹</button><span class="lbl">${MON[state.cursor.getMonth()]} ${state.cursor.getFullYear()}</span><button class="iconbtn" type="button" data-act="next" aria-label="Next month">›</button><button class="btn mini ghost" type="button" data-act="now">Today</button>`;
  $("#calNav").innerHTML = nav;
}
function render() {
  if ($("#app").hidden) return;
  renderChrome(); renderSync(); renderBanner();
  $(".shell").classList.toggle("wide", state.view === "week");
  $("#view").innerHTML = state.view === "week" ? renderWeek() : state.view === "month" ? renderMonth() : state.view === "all" ? renderAll() : renderToday();
  renderRail();
}

/* ---------- editor + settings ---------- */
function openEditor(t) {
  state.editing = { ...t }; state.delArm = false;
  const isNew = !state.tasks[t.id];
  const td = todayStr(), tm = ymd(addDays(new Date(), 1)), nw = ymd(addDays(startOfWeek(new Date()), 7));
  $("#modal").innerHTML = `<div class="ov" data-act="ovclose"><form class="ed" id="edForm" role="dialog" aria-modal="true" aria-labelledby="edH">
    <h2 id="edH">${isNew ? "New task" : "Edit task"}</h2>
    <div class="fgrid">
      <label class="fld full">Title<input id="e-title" required value="${esc(t.title)}"></label>
      <label class="fld">Area<select id="e-area">${AKEYS.map(a => `<option value="${a}"${t.area === a ? " selected" : ""}>${AREAS[a].label}</option>`).join("")}</select></label>
      <label class="fld">Priority<select id="e-prio"><option value="1"${t.prio === 1 ? " selected" : ""}>P1 · must do</option><option value="2"${(t.prio || 2) === 2 ? " selected" : ""}>P2 · should do</option><option value="3"${t.prio === 3 ? " selected" : ""}>P3 · nice to do</option></select></label>
      <label class="fld">Date<input type="date" id="e-due" value="${esc(t.due || "")}"></label>
      <label class="fld">Start time<input type="time" id="e-start" value="${esc(t.start || "")}"></label>
      <div class="fld full" style="flex-direction:row;gap:6px;flex-wrap:wrap">
        <button class="btn mini" type="button" data-setdue="${td}">Today</button><button class="btn mini" type="button" data-setdue="${tm}">Tomorrow</button><button class="btn mini" type="button" data-setdue="${nw}">Next week</button><button class="btn mini" type="button" data-setdue="">No date</button>
      </div>
      <label class="fld">Duration (minutes)<input type="number" inputmode="numeric" min="0" step="5" id="e-mins" value="${t.mins || ""}"></label>
      <label class="fld" style="flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:8px"><input type="checkbox" id="e-done"${t.done ? " checked" : ""}> Done</label>
      <label class="fld full">Notes<textarea id="e-notes">${esc(t.notes || "")}</textarea></label>
    </div>
    <div class="ed-act"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="cancel">Cancel</button><span class="spacer"></span>${isNew ? "" : '<button class="btn danger" type="button" data-act="del">Delete</button>'}</div>
  </form></div>`;
  if (!matchMedia("(pointer:coarse)").matches) setTimeout(() => $("#e-title") && $("#e-title").focus(), 0);
}
function closeModal() { state.editing = null; $("#modal").innerHTML = ""; }
function readEditor() {
  return { ...state.editing, title: $("#e-title").value.trim() || "Untitled", area: $("#e-area").value, prio: +$("#e-prio").value, due: $("#e-due").value || null, start: $("#e-start").value || null, mins: +$("#e-mins").value || 0, done: $("#e-done").checked, notes: $("#e-notes").value };
}
function openSettings() {
  const opts = [["work", "Work"], ["school", "School"], ["personal", "Personal"], ["show", "Show only"], ["off", "Hide"]];
  const cals = state.calendars.length ? state.calendars.map(c => `<div class="calrow"><span><i class="swatch" style="background:${esc(c.color)}"></i>${esc(c.name)}</span><select data-cal="${esc(c.id)}" aria-label="Area for ${esc(c.name)}">${opts.map(([v, l]) => `<option value="${v}"${calArea(c.id) === v ? " selected" : ""}>${l}</option>`).join("")}</select></div>`).join("") : '<p class="hint">Calendars load after the first sync.</p>';
  $("#modal").innerHTML = `<div class="ov" data-act="ovclose"><form class="ed" id="setForm" role="dialog" aria-modal="true" aria-labelledby="stH">
    <h2 id="stH">Settings</h2>
    <div><p class="sec-h">Weekly targets (hours)</p><div class="tgts">${AKEYS.map(a => `<label class="fld" data-c="${a}"><span style="display:flex;gap:6px;align-items:center"><span class="dot"></span>${AREAS[a].label}</span><input type="number" inputmode="numeric" min="0" max="100" id="tg-${a}" value="${settings.targets[a]}"></label>`).join("")}</div></div>
    <div><p class="sec-h">Calendars</p><p class="hint" style="margin:0 0 8px">Assign a calendar to an area to count its events toward that area's hours. "Show only" displays events without counting them.</p><div style="display:flex;flex-direction:column;gap:8px">${cals}</div></div>
    <div><p class="sec-h">Install</p><p class="hint" style="margin:0">iPhone: Safari → Share → Add to Home Screen. Mac: Safari → File → Add to Dock, or Chrome → ⋮ → Cast, save and share → Install page as app.</p></div>
    <div class="ed-act"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-act="cancel">Cancel</button><span class="spacer"></span><button class="btn danger" type="button" data-act="signout">Sign out</button></div>
  </form></div>`;
}

/* ---------- toast ---------- */
let toastT;
function toast(msg, undo) {
  clearTimeout(toastT);
  $("#toastHost").innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span>${undo ? '<button type="button" data-act="undo">Undo</button>' : ""}</div>`;
  state.undo = undo || null;
  toastT = setTimeout(() => { $("#toastHost").innerHTML = ""; state.undo = null; }, 5000);
}

/* ---------- events ---------- */
function updateParse() {
  const v = $("#qaInput").value.trim();
  if (!v) { $("#parse").innerHTML = $("#parse").dataset.hint; return; }
  const p = parseQuick(v, state.qaArea);
  $("#parse").innerHTML = `<span data-c="${p.area}" class="pchip" style="display:inline-flex;gap:5px;align-items:center"><span class="dot"></span>${AREAS[p.area].label}</span><span class="pchip">${p.due ? esc(niceDate(p.due)) : "No date"}</span>` + (p.start ? `<span class="pchip">${p.start}</span>` : "") + `<span class="pchip">${fmtMins(p.mins)}</span>` + (p.prio !== 2 ? `<span class="pchip">P${p.prio}</span>` : "") + `<span>“${esc(p.title)}”</span>`;
}
function bindEvents() {
  $("#parse").dataset.hint = $("#parse").innerHTML;
  $("#qaInput").addEventListener("input", updateParse);
  $("#qa").addEventListener("submit", e => {
    e.preventDefault();
    const v = $("#qaInput").value.trim(); if (!v) return;
    const p = parseQuick(v, state.qaArea); if (!p.title) return;
    const t = newTask({ title: p.title, area: p.area, prio: p.prio, due: p.due, start: p.start, mins: p.mins });
    writeTask(t); $("#qaInput").value = ""; updateParse();
    toast(`Added to ${AREAS[t.area].label} · ${t.due ? niceDate(t.due) : "no date"}`);
  });
  $("#signIn").addEventListener("click", () => authRedirect(false));
  $("#refreshBtn").addEventListener("click", () => { if (!tokenValid()) authRedirect(!!ls.get("pl.authed", false)); else sync(true); });
  $("#settingsBtn").addEventListener("click", openSettings);

  document.addEventListener("click", e => {
    const qa = e.target.closest("[data-qa]"); if (qa) { state.qaArea = qa.dataset.qa; ls.set("pl.ui", { qaArea: state.qaArea }); renderChrome(); updateParse(); return; }
    const f = e.target.closest("[data-f]"); if (f) { state.filter = f.dataset.f; render(); return; }
    const sd = e.target.closest("[data-setdue]"); if (sd) { $("#e-due").value = sd.dataset.setdue; return; }
    const act = e.target.closest("[data-act]"), a = act && act.dataset.act;
    if (a === "ovclose" && e.target === act) { closeModal(); return; }
    if (a === "cancel") { closeModal(); return; }
    if (a === "signout") { signOut(); return; }
    if (a === "reconnect") { authRedirect(state.authProblem === "expired" && canSilent()); return; }
    if (a === "del") {
      if (!state.delArm) { state.delArm = true; act.textContent = "Confirm delete"; return; }
      const id = state.editing.id; closeModal(); const old = deleteTask(id);
      toast("Task deleted", () => writeTask({ ...old, id: rid(), listId: null })); return;
    }
    if (a === "undo") { const u = state.undo; $("#toastHost").innerHTML = ""; state.undo = null; u && u(); return; }
    if (a === "toggle") { e.stopPropagation(); const t = state.tasks[act.closest("[data-id]").dataset.id]; if (t) writeTask({ ...t, done: !t.done }); return; }
    if (a === "prev" || a === "next") { const d = new Date(state.cursor); if (state.view === "week") d.setDate(d.getDate() + (a === "next" ? 7 : -7)); else { d.setDate(1); d.setMonth(d.getMonth() + (a === "next" ? 1 : -1)); } state.cursor = d; render(); ensureMonths(); return; }
    if (a === "now") { state.cursor = new Date(); render(); return; }
    if (a === "addon") { openEditor(newTask({ due: act.dataset.date })); return; }
    if (a === "rollover") { const t = todayStr(); visTasks().filter(x => x.due && x.due < t && !x.done).forEach(x => writeTask({ ...x, due: t })); toast("Moved overdue tasks to today"); return; }
    const task = e.target.closest("[data-id]");
    if (task && !e.target.closest(".ov")) { const t = state.tasks[task.dataset.id]; if (t) openEditor(t); return; }
    if (a === "gotoweek") { state.cursor = parseYmd(act.dataset.date); location.hash = "week"; return; }
  });
  document.addEventListener("submit", e => {
    if (e.target.id === "edForm") { e.preventDefault(); const t = readEditor(); closeModal(); writeTask(t); }
    if (e.target.id === "setForm") {
      e.preventDefault();
      AKEYS.forEach(a => { settings.targets[a] = Math.max(0, Math.min(100, +$("#tg-" + a).value || 0)); });
      const before = JSON.stringify(settings.calAreas);
      document.querySelectorAll("[data-cal]").forEach(s => { settings.calAreas[s.dataset.cal] = s.value; });
      saveSettings(); closeModal(); render();
      if (JSON.stringify(settings.calAreas) !== before) { state.fetchedMonths = {}; ensureMonths(); }
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("#modal").innerHTML) { closeModal(); return; }
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "");
    if (!typing && (e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !$("#modal").innerHTML) { e.preventDefault(); $("#qaInput").focus(); return; }
    if (!typing && e.key === "Enter" && document.activeElement && document.activeElement.classList.contains("task")) { const t = state.tasks[document.activeElement.dataset.id]; t && openEditor(t); }
  });
  // Drag to reschedule (desktop)
  let dragId = null;
  const clearDrop = () => document.querySelectorAll(".drop-on").forEach(x => x.classList.remove("drop-on"));
  document.addEventListener("dragstart", e => { const el = e.target.closest && e.target.closest("[data-id]"); if (!el) return; dragId = el.dataset.id; try { e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move"; } catch {} });
  document.addEventListener("dragover", e => { const z = e.target.closest && e.target.closest("[data-drop-date]"); if (!z || !dragId) return; e.preventDefault(); document.querySelectorAll(".drop-on").forEach(x => x !== z && x.classList.remove("drop-on")); z.classList.add("drop-on"); });
  document.addEventListener("drop", e => { const z = e.target.closest && e.target.closest("[data-drop-date]"); clearDrop(); if (!z || !dragId) return; e.preventDefault(); const t = state.tasks[dragId]; dragId = null; if (!t) return; const d = z.dataset.dropDate || null; if (t.due === d) return; writeTask({ ...t, due: d, start: d ? t.start : null }); toast(d ? `Moved to ${niceDate(d)}` : "Moved to No date"); });
  document.addEventListener("dragend", () => { dragId = null; clearDrop(); });

  window.addEventListener("hashchange", route);
  window.addEventListener("online", () => { state.online = true; sync(false); });
  window.addEventListener("offline", () => { state.online = false; renderSync(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!tokenValid() && canSilent() && !state.editing) { authRedirect(true); return; }
    if (Date.now() - state.lastPull > 120000) sync(false); else render();
  });
  setInterval(() => { if (document.visibilityState === "visible" && !$("#modal").innerHTML) { if (Date.now() - state.lastPull > 300000) sync(false); else if (state.view === "today") render(); } }, 60000);
}
function route() {
  const h = (location.hash || "").slice(1);
  state.view = ["today", "week", "month", "all"].includes(h) ? h : "today";
  render(); ensureMonths();
}

/* ---------- boot ---------- */
function showGate(msg) { $("#app").hidden = true; $("#gate").hidden = false; $("#gateMsg").textContent = msg || ""; }
function showApp() { $("#gate").hidden = true; $("#app").hidden = false; }
function boot() {
  bindEvents();
  const r = readRedirect();
  if (r && r.token) {
    if (!/auth\/tasks/.test(r.scope) || !/calendar/.test(r.scope)) toast("Allow both Tasks and Calendar access for everything to work.");
    state.token = r.token; ls.set("pl.token", r.token); ls.set("pl.authed", true);
  }
  if (r && r.error && r.error !== "state_mismatch" && !ls.get("pl.authed", false)) { showGate(r.error === "access_denied" ? "Sign-in was cancelled." : "Sign-in didn't finish (" + r.error + "). Try again."); return; }

  if (!tokenValid()) {
    if (canSilent() && navigator.onLine && !(r && r.error)) { authRedirect(true); return; }
    if (!ls.get("pl.authed", false)) { showGate(); return; }
    state.authProblem = navigator.onLine ? "expired" : null;
  }
  showApp(); route();
  if (tokenValid()) sync(!state.lists.work);
}
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
})();
