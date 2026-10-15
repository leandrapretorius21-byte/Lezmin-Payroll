/* Lezmin Payroll — app logic.
   Data lives in Supabase (tables: staff, settings, runs, app_users). Without keys in config.js it runs in demo mode. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = n => { const [a, b] = r2(n).toFixed(2).split("."); return a.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "." + b; };
const R = n => "R " + fmt(n);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const monthLabel = m => { const [y, mo] = m.split("-"); return MONTHS[+mo - 1] + " " + y; };
const shiftMonth = (m, k) => { let [y, mo] = m.split("-").map(Number); mo += k; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return `${y}-${String(mo).padStart(2, "0")}`; };
const fmtDate = s => { if (!s) return ""; const [y, m, d] = s.split("-"); return `${+d} ${MONTHS[+m - 1].slice(0, 3)} ${y}`; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const thisMonth = () => iso(new Date()).slice(0, 7);

const DEFAULT_SETTINGS = { companyName: "", address: "", regNo: "", phone: "", hourlyRate: 30.23, workingDays: 26, uifPct: 1, sundayFactor: 0.5, otFactor: 1.5, deductLate: false, sites: { O: { name: "Ormonde", hours: 7.5 }, X: { name: "Xavier", hours: 7 } } };

// Columns of the month grid, in the order he fills them in
const COLS = [
  { g: "Leave & days off (days)", cols: [["unpaid","Unpaid leave"],["absent","Absent"],["annual","Annual leave"],["sick","Sick leave"],["family","Family resp."],["notEmployed","Not employed yet / any more"]] },
  { g: "Extra pay", cols: [["ph","Public holidays worked"],["sundays","Sundays worked"],["otHours","Overtime hours"],["extraDays","Extra days"],["bonus","Bonus (R)"]] },
  { g: "Other", cols: [["lateMin","Late (minutes)"],["paye","PAYE (R)"],["otherDed","Other deduction (R)"],["note","Note"]] },
];
const FIELD_KEYS = COLS.flatMap(g => g.cols.map(c => c[0]));

// ---------- state ----------
const CFG = window.PAYROLL_CONFIG || {};
const DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY;
let sb = null, me = { email: "", role: "admin" };
let settings = { ...DEFAULT_SETTINGS }, staff = [], runs = {}, month = null;
let headerImg = null; // data URL of the payslip banner

// ---------- data layer ----------
const api = DEMO ? demoApi() : supabaseApi();

function demoApi() {
  const d = JSON.parse(JSON.stringify(window.DEMO_DATA || { settings: DEFAULT_SETTINGS, staff: [], runs: {} }));
  let n = 100;
  return {
    async session() { return { email: "demo@example.com" }; },
    async signIn() {}, async signOut() {},
    async role() { return "admin"; },
    async load() { return { settings: d.settings, staff: d.staff.map(s => ({ ...s })), runs: JSON.parse(JSON.stringify(d.runs)) }; },
    async saveEntry(m, id, e) { d.runs[m] = d.runs[m] || { month: m, entries: {}, locked: null, pay_date: null }; d.runs[m].entries[id] = e; },
    async upsertRun(m, patch) { d.runs[m] = { ...(d.runs[m] || { month: m, entries: {}, locked: null, pay_date: null }), ...patch }; return d.runs[m]; },
    async saveStaff(row) { if (row.id) { const i = d.staff.findIndex(s => s.id === row.id); d.staff[i] = { ...d.staff[i], ...row }; return d.staff[i]; } const s = { ...row, id: "d" + (++n) }; d.staff.push(s); return s; },
    async deleteStaff(id) { d.staff = d.staff.filter(s => s.id !== id); },
    async saveSettings(s) { d.settings = s; },
  };
}
function supabaseApi() {
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  return {
    async session() { const { data } = await sb.auth.getSession(); return data.session ? { email: data.session.user.email } : null; },
    async signIn(email, password) { ok(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    async role() { const rows = ok(await sb.from("app_users").select("role").limit(1)); return rows[0]?.role || null; },
    async load() {
      const [s, st, rn] = await Promise.all([
        sb.from("settings").select("data").eq("id", 1).maybeSingle(),
        sb.from("staff").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("name"),
        sb.from("runs").select("*"),
      ]);
      [s, st, rn].forEach(x => { if (x.error) throw x.error; });
      const runs = {}; (rn.data || []).forEach(r => runs[r.month] = r);
      return { settings: s.data?.data || DEFAULT_SETTINGS, staff: st.data || [], runs };
    },
    async saveEntry(m, id, e) { ok(await sb.rpc("save_entry", { p_month: m, p_staff: id, p_entry: e })); },
    async upsertRun(m, patch) { return ok(await sb.from("runs").upsert({ month: m, ...patch, updated_at: new Date().toISOString() }, { onConflict: "month" }).select().single()); },
    async saveStaff(row) {
      const body = { ...row, updated_at: new Date().toISOString() };
      if (row.id) { const id = body.id; delete body.id; return ok(await sb.from("staff").update(body).eq("id", id).select().single()); }
      delete body.id; return ok(await sb.from("staff").insert(body).select().single());
    },
    async deleteStaff(id) { ok(await sb.from("staff").delete().eq("id", id)); },
    async saveSettings(s) { ok(await sb.from("settings").upsert({ id: 1, data: s })); },
  };
}

// ---------- UI helpers ----------
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); }
function banner(msg, kind = "warn") { const b = $("#banner"); b.hidden = !msg; b.className = "notice " + kind; b.textContent = msg || ""; }
function friendly(err) {
  const m = String(err?.message || err || "");
  if (/Failed to fetch|NetworkError/i.test(m)) return "Could not reach the server. Check the internet connection and try again.";
  if (/row-level security|permission|not allowed/i.test(m)) return "Your login does not have access to change this. Ask the site owner to add your email.";
  if (/duplicate key.*emp_no/i.test(m)) return "That employee number is already used by someone else.";
  return "Something went wrong: " + m;
}
function downloadBlob(blob, filename) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }

// ---------- pay maths ----------
function dayRateFor(st, S) { if (st.day_rate_override) return num(st.day_rate_override); return num(S.hourlyRate) * num(S.sites?.[st.site]?.hours || 8); }
function calc(st, e = {}, S = settings) {
  const dr = dayRateFor(st, S), hr = dr / (num(S.sites?.[st.site]?.hours) || 8), wd = num(S.workingDays);
  const g = k => num(e[k]);
  const earn = [
    ["Basic Salary", wd, dr * wd],
    ["Sunday Overtime", g("sundays"), g("sundays") * dr * num(S.sundayFactor)],
    ["Overtime Pay", g("otHours"), g("otHours") * hr * num(S.otFactor)],
    ["Extra Day", g("extraDays"), g("extraDays") * dr],
    ["Public Holidays", g("ph"), g("ph") * dr],
  ];
  if (g("bonus")) earn.push(["Performance Bonus", "", g("bonus")]);
  const gross = earn.reduce((a, x) => a + x[2], 0);
  const late = S.deductLate ? g("lateMin") * hr / 60 : 0;
  const leaveDed = (g("unpaid") + g("absent") + g("notEmployed")) * dr;
  const uif = st.uif ? (gross - leaveDed - late) * num(S.uifPct) / 100 : 0;
  const ded = [
    ["UIF", "", uif],
    ["PAYE", "", g("paye")],
    ["Other Deductions", "", g("otherDed")],
    ["Unpaid Leave", g("unpaid"), g("unpaid") * dr],
    ["Absent", g("absent"), g("absent") * dr],
    ["Late", g("lateMin") ? g("lateMin") + " min" : "", late],
  ];
  if (g("notEmployed")) ded.push(["Days not employed", g("notEmployed"), g("notEmployed") * dr]);
  const totalDed = ded.reduce((a, x) => a + x[2], 0);
  const off = ["annual","sick","family","unpaid","absent","notEmployed"].reduce((a, k) => a + g(k), 0);
  return { dr, earn, ded, gross, totalDed, net: gross - totalDed, uif, daysWorked: wd - off };
}

// ---------- South African public holidays ----------
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
function holidays(y) {
  const fixed = [[1,1,"New Year's Day"],[3,21,"Human Rights Day"],[4,27,"Freedom Day"],[5,1,"Workers' Day"],[6,16,"Youth Day"],[8,9,"National Women's Day"],[9,24,"Heritage Day"],[12,16,"Day of Reconciliation"],[12,25,"Christmas Day"],[12,26,"Day of Goodwill"]];
  const out = [];
  fixed.forEach(([m, d, n]) => { const dt = new Date(y, m - 1, d); out.push([dt, n]); if (dt.getDay() === 0) out.push([new Date(y, m - 1, d + 1), n + " (observed)"]); });
  const ez = easter(y); out.push([new Date(ez.getFullYear(), ez.getMonth(), ez.getDate() - 2), "Good Friday"], [new Date(ez.getFullYear(), ez.getMonth(), ez.getDate() + 1), "Family Day"]);
  return out;
}
function monthCalendar(m) {
  const [y, mo] = m.split("-").map(Number); const last = new Date(y, mo, 0).getDate();
  let sundays = 0; for (let d = 1; d <= last; d++) if (new Date(y, mo - 1, d).getDay() === 0) sundays++;
  const ph = holidays(y).filter(([d]) => d.getMonth() === mo - 1).sort((a, b) => a[0] - b[0]);
  return { sundays, ph };
}

// ---------- the working month ----------
// One working sheet (runs row "current"). "month" holds which month is being paid, e.g. "2026-09".
function monthBounds(m) { const [y, mo] = m.split("-").map(Number); return [m + "-01", `${m}-${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`]; }
const blankRun = () => ({ month: "current", period: shiftMonth(thisMonth(), -1), pay_date: null, entries: {} });
const run = () => runs.current || (runs.current = blankRun());
const monthSettings = () => settings;
function staffForMonth() {
  const [a, b] = monthBounds(month);
  return staff.filter(s => (!s.start_date || s.start_date <= b) && (s.status !== "left" || !s.left_date || s.left_date >= a));
}
const entryOf = id => run().entries?.[id] || {};
const hasFigures = () => Object.values(run().entries || {}).some(e => Object.keys(e || {}).length);

// ---------- render: month ----------
function renderMonth() {
  const r = run(), locked = false, people = staffForMonth(), S = monthSettings();
  $("#monthTitle").textContent = monthLabel(month);
  $("#periodInput").value = month;
  const n = Object.values(r.entries || {}).filter(e => Object.keys(e || {}).length).length;
  $("#workPill").className = "pill " + (n ? "open" : "paid");
  $("#workPill").textContent = n ? `${n} ${n === 1 ? "person has" : "people have"} changes` : "Everyone on a full month";
  const cal = monthCalendar(month);
  $("#calHint").textContent = `${cal.sundays} Sundays · ` + (cal.ph.length ? "Public holiday" + (cal.ph.length > 1 ? "s" : "") + ": " + cal.ph.map(([d, n]) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} (${n})`).join(", ") : "No public holidays");
  $("#payDate").value = r.pay_date || "";
  ["printAll", "pdfAll", "zipAll", "xlsx"].forEach(id => $("#" + id).disabled = !people.length);

  const list = $("#monthList");
  list.innerHTML = people.length
    ? people.map(st => `<div class="row ${openRow === st.id ? "open" : ""}" data-id="${st.id}"><button class="rowhead" aria-expanded="${openRow === st.id}">${rowHeadHTML(st)}</button>${openRow === st.id ? detailHTML(st) : ""}</div>`).join("")
    : `<div class="empty">Nobody was employed in ${monthLabel(month)}. Add people on the Staff tab.</div>`;
  renderTotals();
}
let openRow = null;
const CHIP = { annual: "annual", sick: "sick", family: "family", unpaid: "unpaid", absent: "absent", notEmployed: "not employed", ph: "PH", sundays: "Sun", otHours: "OT hrs", extraDays: "extra day", bonus: "bonus R", lateMin: "late min", paye: "PAYE R", otherDed: "other ded R" };
const WARN = ["unpaid", "absent", "notEmployed", "lateMin", "otherDed", "paye"];
function chipsFor(e) { return Object.keys(CHIP).filter(k => num(e[k])).map(k => `<span class="chip ${WARN.includes(k) ? "w" : "on"}">${num(e[k])} ${CHIP[k]}</span>`).join(""); }
function rowHeadHTML(st) {
  const S = monthSettings(), e = entryOf(st.id), c = calc(st, e, S);
  return `<div class="who"><div class="n">${esc(st.name)}${st.known_as ? ` <span class="muted">(${esc(st.known_as)})</span>` : ""}</div>
    <div class="m">${esc(st.emp_no)} · ${esc(S.sites?.[st.site]?.name || st.site)} · ${c.daysWorked} days worked${st.uif ? "" : " · no UIF"}</div>
    <div class="chips">${chipsFor(e)}</div></div>
    <div class="money">${R(c.net)}<small>net pay</small></div><span class="chev" aria-hidden="true">›</span>`;
}
function breakdownHTML(st) {
  const c = calc(st, entryOf(st.id), monthSettings());
  const line = (l, v, neg) => `<span>${esc(l)}</span><span class="${neg ? "neg" : ""}">${neg ? "−" : ""}${fmt(v)}</span>`;
  return c.earn.filter(x => x[2]).map(x => line(x[0], x[2])).join("") + `<span class="t">Total earnings</span><span class="t">${fmt(c.gross)}</span>`
    + c.ded.filter(x => x[2]).map(x => line(x[0], x[2], true)).join("") + `<span class="t">Net pay</span><span class="t">${fmt(c.net)}</span>`;
}
function detailHTML(st) {
  const e = entryOf(st.id), locked = !!run().locked;
  const groups = COLS.map(g => `<p class="grp">${g.g}</p><div class="igrid">${g.cols.filter(([k]) => k !== "note").map(([k, l]) =>
    `<label class="f">${l}<input type="number" min="0" step="any" inputmode="decimal" data-k="${k}" value="${num(e[k]) || ""}" placeholder="0" ${locked ? "disabled" : ""}></label>`).join("")}</div>`).join("");
  return `<div class="detail">${groups}
    <label class="f">Note for this month (prints on the payslip) <input data-k="note" value="${esc(e.note || "")}" placeholder="e.g. what the other deduction is for" ${locked ? "disabled" : ""}></label>
    <div class="bar" style="align-items:flex-start"><div class="breakdown" id="bd_${st.id}">${breakdownHTML(st)}</div><span class="spacer"></span>
      <div class="stack" style="gap:6px"><button data-slip="${st.id}">Print this payslip</button><button data-slippdf="${st.id}">Save this payslip (PDF)</button>${st.pb_pct ? `<span class="muted small">Performance bonus band: ${esc(st.pb_pct)}%</span>` : ""}</div></div></div>`;
}
function refreshRow(id) {
  const row = document.querySelector(`#monthList .row[data-id="${id}"]`); if (!row) return;
  const st = staffForMonth().find(s => s.id === id); if (!st) return;
  row.querySelector(".rowhead").innerHTML = rowHeadHTML(st);
  const bd = row.querySelector("#bd_" + CSS.escape(id)); if (bd) bd.innerHTML = breakdownHTML(st);
  renderTotals();
}
function monthTotals() {
  const r = run(), S = settings, people = staffForMonth();
  let gross = 0, net = 0, uif = 0, ded = 0;
  // add up the rounded cents per person, so totals match what the bank actually pays out
  people.forEach(st => { const c = calc(st, r.entries?.[st.id] || {}, S); gross += r2(c.gross); net += r2(c.net); uif += r2(c.uif); ded += r2(c.totalDed); });
  return { n: people.length, gross, net, uif, ded };
}
function renderTotals() {
  const t = monthTotals();
  $("#totals").innerHTML = `<div><small>Staff paid</small><b>${t.n}</b></div><div><small>Total earnings</small><b>${R(t.gross)}</b></div><div><small>UIF deducted</small><b>${R(t.uif)}</b></div><div class="net"><small>Total to transfer</small><b>${R(t.net)}</b></div>`;
}

// ---------- saving ----------
const timers = {}; let pending = 0;
function setSave(state) { const el = $("#saveState"); el.textContent = state === "saving" ? "Saving…" : state === "error" ? "Not saved, check your connection" : "All changes saved"; el.style.color = state === "error" ? "var(--bad)" : state === "saving" ? "var(--muted)" : "var(--good)"; }
function onCell(input) {
  const id = input.closest(".row").dataset.id, k = input.dataset.k;
  const r = run(); r.entries = r.entries || {};
  const e = r.entries[id] = { ...(r.entries[id] || {}) };
  if (k === "note") { if (input.value.trim()) e.note = input.value; else delete e.note; }
  else { const v = num(input.value); if (v) e[k] = v; else delete e[k]; }
  refreshRow(id);
  setSave("saving");
  clearTimeout(timers[id]);
  timers[id] = setTimeout(async () => {
    pending++;
    try { await api.saveEntry("current", id, run().entries[id] || {}); if (--pending === 0) setSave("saved"); }
    catch (err) { pending--; setSave("error"); banner(friendly(err), "bad"); }
  }, 500);
}
$("#monthList").addEventListener("input", ev => { if (ev.target.matches("input[data-k]")) onCell(ev.target); });
$("#monthList").addEventListener("focusin", ev => { if (ev.target.matches("input[type=number]")) ev.target.select(); });
$("#monthList").addEventListener("click", ev => {
  const p = ev.target.closest("[data-slip]"); if (p) { printSlips([p.dataset.slip]); return; }
  const d = ev.target.closest("[data-slippdf]"); if (d) { busy(d, async () => { const st = staffForMonth().find(s => s.id === d.dataset.slippdf); const doc = await buildPdf([st]); downloadBlob(doc.output("blob"), `${safeName(st.emp_no)} ${safeName(st.name)} - ${monthLabel(month)}.pdf`); }); return; }
  const head = ev.target.closest(".rowhead"); if (!head) return;
  const id = head.parentElement.dataset.id; openRow = openRow === id ? null : id; renderMonth();
  const row = document.querySelector(`#monthList .row[data-id="${id}"]`); row?.querySelector(".rowhead")?.focus();
  if (openRow) row?.querySelector("input[data-k]")?.focus();
});
window.addEventListener("beforeunload", ev => { if ($("#saveState").textContent === "Saving…") { ev.preventDefault(); ev.returnValue = ""; } });

async function saveRun(patch) { const saved = await api.upsertRun("current", { period: month, entries: run().entries || {}, pay_date: run().pay_date || null, ...patch }); runs.current = { ...run(), ...saved }; }
$("#payDate").addEventListener("change", async ev => {
  run().pay_date = ev.target.value || null;
  try { await saveRun({ pay_date: run().pay_date }); toast("Pay date saved"); } catch (err) { banner(friendly(err), "bad"); }
});
$("#periodInput").addEventListener("change", async ev => {
  if (!ev.target.value) return;
  month = ev.target.value; openRow = null; renderMonth();
  try { await saveRun({ period: month }); toast("Now paying " + monthLabel(month)); } catch (err) { banner(friendly(err), "bad"); }
});

// "Start next month": keep staff and pay rules, empty everything typed in for this month
let exportedThisSession = false;
$("#resetBtn").addEventListener("click", () => {
  const next = shiftMonth(month, 1);
  $("#resetTitle").textContent = `Finished with ${monthLabel(month)}?`;
  $("#resetNext").textContent = monthLabel(next);
  $("#resetExported").checked = exportedThisSession;
  $("#resetGo").disabled = !exportedThisSession;
  $("#resetDlg").showModal();
});
$("#resetExported").addEventListener("change", ev => { $("#resetGo").disabled = !ev.target.checked; });
$("#resetExport").addEventListener("click", () => { exportExcel(); exportedThisSession = true; $("#resetExported").checked = true; $("#resetGo").disabled = false; });
$("#resetCancel").addEventListener("click", () => $("#resetDlg").close());
$("#resetGo").addEventListener("click", async () => {
  const next = shiftMonth(month, 1);
  $("#resetGo").disabled = true;
  try {
    runs.current = { ...run(), period: next, pay_date: null, entries: {} };
    await api.upsertRun("current", { period: next, pay_date: null, entries: {} });
    month = next; openRow = null; exportedThisSession = false;
    $("#resetDlg").close(); renderMonth(); toast(`Cleared. Ready for ${monthLabel(next)}.`);
  } catch (err) { banner(friendly(err), "bad"); }
  finally { $("#resetGo").disabled = false; }
});

// ---------- payslips: HTML for printing ----------
function slipData(st) { const S = monthSettings(), e = entryOf(st.id); return { st, S, e, c: calc(st, e, S) }; }
function slipHTML({ st, S, c, e }) {
  const row = ([l, q, v]) => `<tr class="${v ? "" : "zero"}"><td>${esc(l)}</td><td class="r">${q !== "" && q != null && v ? esc(q) : ""}</td><td class="r">${fmt(v)}</td></tr>`;
  const pad = n => Array.from({ length: Math.max(0, n) }, () => `<tr><td>&nbsp;</td><td></td><td></td></tr>`).join("");
  const rows = Math.max(c.earn.length, c.ded.length);
  const pay = run().pay_date;
  const att = [["Days worked", c.daysWorked], ["Annual leave", num(e.annual)], ["Sick leave", num(e.sick)], ["Family resp.", num(e.family)], ["Unpaid leave", num(e.unpaid)], ["Absent", num(e.absent)], ["Late (min)", num(e.lateMin)]];
  return `<div class="slip">
    <img class="banner" src="payslip-header.jpg" alt="Payslip — ${esc(S.companyName)}">
    <div class="co"><span>${esc(S.address)}</span><span>Reg. no ${esc(S.regNo)} · Tel ${esc(S.phone)}</span></div>
    <div class="info">
      <div><small>Employee</small><b>${esc(st.name)}${st.known_as ? ` (${esc(st.known_as)})` : ""}</b></div>
      <div><small>Number</small><b>${esc(st.emp_no)}</b></div>
      <div><small>Pay period</small><b>${monthLabel(month)}</b></div>
      <div><small>Paid on</small><b>${pay ? fmtDate(pay) : "Monthly"}</b></div>
      <div><small>Site</small><b>${esc(S.sites?.[st.site]?.name || st.site)}</b></div>
      <div><small>ID number</small><b>${esc(st.id_number) || "—"}</b></div>
      <div><small>Start date</small><b>${fmtDate(st.start_date) || "—"}</b></div>
      <div><small>Date of birth</small><b>${fmtDate(st.dob) || "—"}</b></div>
      <div><small>Occupation</small><b>${esc(st.occupation) || "—"}</b></div>
      <div><small>Day rate</small><b>R ${fmt(c.dr)}</b></div>
    </div>
    <div class="tables">
      <table><tr><th>Earnings</th><th class="r">Qty</th><th class="r">Amount</th></tr>${c.earn.map(row).join("")}${pad(rows - c.earn.length)}<tr class="tot"><td>Total payments</td><td></td><td class="r">${fmt(c.gross)}</td></tr></table>
      <table><tr><th>Deductions</th><th class="r">Qty</th><th class="r">Amount</th></tr>${c.ded.map(row).join("")}${pad(rows - c.ded.length)}<tr class="tot"><td>Total deductions</td><td></td><td class="r">${fmt(c.totalDed)}</td></tr></table>
    </div>
    <div><div class="cap">Attendance this month</div><div class="att">${att.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join("")}</div></div>
    <div class="foot">
      <div><div class="cap">Paid into</div>Bank: <b>${esc(st.bank)}</b><br>Account: <b>${esc(st.account)}</b><br>Branch code: <b>${esc(st.branch) || "—"}</b></div>
      <div class="net"><small>NET PAY</small><b>R ${fmt(c.net)}</b></div>
    </div>
    ${e.note ? `<p class="note">Note: ${esc(e.note)}</p>` : ""}
    <div class="sigs"><div>Signature of employee</div><div class="d">Date</div><div>Signature of employer</div><div class="d">Date</div></div>
  </div>`;
}
function printSlips(ids) {
  const people = staffForMonth().filter(s => !ids || ids.includes(s.id));
  if (!people.length) return;
  const slips = people.map(st => slipHTML(slipData(st)));
  const html = slips.map(s => `<div class="sheet">${s}</div>`).join(""); // one person per A4 page
  const area = $("#printArea"); area.innerHTML = html;
  const imgs = [...area.querySelectorAll("img")];
  Promise.all(imgs.map(im => im.complete ? 0 : new Promise(res => { im.onload = im.onerror = res; }))).then(() => { window.print(); });
}
window.addEventListener("afterprint", () => { $("#printArea").innerHTML = ""; });
$("#printAll").addEventListener("click", () => printSlips(null));

// ---------- payslips: PDF ----------
async function loadHeader() {
  if (headerImg) return headerImg;
  const blob = await (await fetch("payslip-header.jpg")).blob();
  headerImg = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  return headerImg;
}
function drawSlip(doc, { st, S, c, e }, img) {
  // Full A4 page, one person. Measurements in mm.
  const L = 14, Rr = 196, W = Rr - L, bh = W * 173 / 1600;
  const gold = [209, 177, 20], ink = [17, 17, 17];
  doc.addImage(img, "JPEG", L, 12, W, bh, "header", "FAST");
  let y = 12 + bh + 7.5;
  doc.setTextColor(70); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(S.address || "", L, y); doc.text(`Reg. no ${S.regNo || ""}   ·   Tel ${S.phone || ""}`, L, y + 4.5);
  y += 8.5; doc.setDrawColor(0); doc.setLineWidth(0.4); doc.line(L, y, Rr, y);

  // Employee details: two rows of five
  const cols = [L, L + 60, L + 88, L + 126, L + 156];
  const kv = (x, yy, k, v) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(110); doc.text(k.toUpperCase(), x, yy);
    doc.setTextColor(0); doc.setFontSize(10.5); doc.setFont("helvetica", "bold"); doc.text(String(v || "—").slice(0, 30), x, yy + 5.5);
  };
  const pay = run().pay_date;
  kv(cols[0], y + 8, "Employee", st.name + (st.known_as ? ` (${st.known_as})` : "")); kv(cols[1], y + 8, "Number", st.emp_no); kv(cols[2], y + 8, "Pay period", monthLabel(month)); kv(cols[3], y + 8, "Paid on", pay ? fmtDate(pay) : "Monthly"); kv(cols[4], y + 8, "Site", S.sites?.[st.site]?.name || st.site);
  kv(cols[0], y + 22, "ID number", st.id_number); kv(cols[1], y + 22, "Start date", fmtDate(st.start_date)); kv(cols[2], y + 22, "Date of birth", fmtDate(st.dob)); kv(cols[3], y + 22, "Occupation", st.occupation); kv(cols[4], y + 22, "Day rate", "R " + fmt(c.dr));
  y += 32; doc.setDrawColor(0); doc.line(L, y, Rr, y);

  // Earnings and deductions
  const ty = y + 8, colW = W / 2 - 4, rowH = 7.5, rowsN = Math.max(c.earn.length, c.ded.length);
  const table = (x, title, rows, total, label) => {
    doc.setFillColor(...ink); doc.rect(x, ty, colW, 8, "F"); doc.setTextColor(255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text(title, x + 3, ty + 5.4); doc.text("QTY", x + colW - 32, ty + 5.4, { align: "right" }); doc.text("AMOUNT", x + colW - 3, ty + 5.4, { align: "right" });
    doc.setTextColor(0); doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    let yy = ty + 8 + rowH - 2.4;
    rows.forEach(([l, q, v]) => {
      doc.setTextColor(v ? 0 : 140);
      doc.text(l, x + 3, yy); if (q !== "" && q != null && v) doc.text(String(q), x + colW - 32, yy, { align: "right" }); doc.text(fmt(v), x + colW - 3, yy, { align: "right" });
      doc.setDrawColor(220); doc.setLineWidth(0.2); doc.line(x, yy + 2.4, x + colW, yy + 2.4); yy += rowH;
    });
    doc.setTextColor(0);
    const yt = ty + 8 + rowsN * rowH; doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(x, yt + 1, x + colW, yt + 1);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.text(label, x + 3, yt + 7.5); doc.text(fmt(total), x + colW - 3, yt + 7.5, { align: "right" });
    return yt + 7.5;
  };
  table(L, "EARNINGS", c.earn, c.gross, "Total payments");
  y = table(L + colW + 8, "DEDUCTIONS", c.ded, c.totalDed, "Total deductions") + 14;

  // Attendance this month
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0); doc.text("ATTENDANCE THIS MONTH", L, y);
  y += 3; doc.setFillColor(244, 243, 238); doc.rect(L, y, W, 20, "F");
  const att = [["Days worked", c.daysWorked], ["Annual leave", num(e.annual)], ["Sick leave", num(e.sick)], ["Family resp.", num(e.family)], ["Unpaid leave", num(e.unpaid)], ["Absent", num(e.absent)], ["Late (min)", num(e.lateMin)]];
  const cw = W / att.length;
  att.forEach(([k, v], i) => {
    const cx = L + cw * i + cw / 2;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(110); doc.text(k.toUpperCase(), cx, y + 7, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(0); doc.text(String(v), cx, y + 15, { align: "center" });
  });
  y += 20 + 16;

  // Bank details and net pay
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text("PAID INTO", L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  doc.text(`Bank: ${st.bank || ""}`, L, y + 8); doc.text(`Account: ${st.account || ""}`, L, y + 14.5); doc.text(`Branch code: ${st.branch || "—"}`, L, y + 21);
  const nw = 84, nh = 28, nx = Rr - nw, ny = y - 4;
  doc.setFillColor(...ink); doc.rect(nx, ny, nw, nh, "F"); doc.setFillColor(...gold); doc.rect(nx, ny, 3.5, nh, "F");
  doc.setTextColor(...gold); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text("NET PAY", Rr - 5, ny + 8, { align: "right" });
  doc.setTextColor(255); doc.setFontSize(22); doc.text("R " + fmt(c.net), Rr - 5, ny + 21, { align: "right" }); doc.setTextColor(0);
  y += 34;
  if (e.note) { doc.setFont("helvetica", "italic"); doc.setFontSize(9.5); doc.setTextColor(70); doc.text("Note: " + String(e.note).slice(0, 120), L, y); doc.setTextColor(0); }

  // Signatures near the bottom of the page
  const sy = 268; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setDrawColor(0); doc.setLineWidth(0.3);
  [[L, "Signature of employee"], [L + 58, "Date"], [Rr - 82, "Signature of employer"], [Rr - 24, "Date"]].forEach(([x, t], i) => {
    const w = i % 2 ? 24 : 52; doc.line(x, sy, x + w, sy); doc.text(t, x, sy + 4.5);
  });
}
async function buildPdf(people) {
  const img = await loadHeader();
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  people.forEach((st, i) => { // one person per A4 page
    if (i) doc.addPage();
    drawSlip(doc, slipData(st), img);
  });
  return doc;
}
const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, "").trim();
async function busy(btn, fn) { const t = btn.textContent; btn.disabled = true; btn.textContent = "Working…"; try { await fn(); } catch (err) { banner(friendly(err), "bad"); } finally { btn.disabled = false; btn.textContent = t; } }
$("#pdfAll").addEventListener("click", ev => busy(ev.currentTarget, async () => {
  const doc = await buildPdf(staffForMonth());
  downloadBlob(doc.output("blob"), `Payslips ${monthLabel(month)}.pdf`);
}));
$("#zipAll").addEventListener("click", ev => busy(ev.currentTarget, async () => {
  const zip = new window.JSZip();
  for (const st of staffForMonth()) { const doc = await buildPdf([st]); zip.file(`${safeName(st.emp_no)} ${safeName(st.name)} - ${monthLabel(month)}.pdf`, doc.output("arraybuffer")); }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `Payslips ${monthLabel(month)} (each person).zip`);
}));
// ---------- Excel export: salary sheet + one payslip tab per person ----------
function exportExcel() {
  const X = window.XLSX, r = run(), S = settings, people = staffForMonth(), m = month;
  const money = (ws, cells) => cells.forEach(ref => { if (ws[ref] && typeof ws[ref].v === "number") ws[ref].z = "#,##0.00"; });
  const head = ["No", "Name", "Known as", "Emp no", "Site", "Days worked", "Annual leave", "Sick leave", "Family resp.", "Unpaid leave", "Absent", "Not employed", "Public holidays", "Sundays", "Overtime hrs", "Extra days", "Late (min)",
    "Basic salary", "Sunday pay", "Overtime pay", "Public holiday pay", "Extra day pay", "Bonus", "Total earnings", "UIF", "PAYE", "Other deductions", "Unpaid/absent deduction", "Total deductions", "Net pay", "Bank", "Account", "Branch code", "Note"];
  const rows = [[`${S.companyName || "Lezmin"} — cleaners salaries ${monthLabel(m)}`], [r.pay_date ? `Paid on ${fmtDate(r.pay_date)}` : "", `Exported ${fmtDate(iso(new Date()))}`], [], head];
  const tot = Array(head.length).fill(null);
  people.forEach((st, i) => {
    const e = entryOf(st.id), c = calc(st, e, S), amt = name => r2(c.earn.find(x => x[0] === name)?.[2] || 0);
    const leave = r2((num(e.unpaid) + num(e.absent) + num(e.notEmployed)) * c.dr);
    const row = [i + 1, st.name, st.known_as || "", st.emp_no, S.sites?.[st.site]?.name || st.site, c.daysWorked, num(e.annual), num(e.sick), num(e.family), num(e.unpaid), num(e.absent), num(e.notEmployed), num(e.ph), num(e.sundays), num(e.otHours), num(e.extraDays), num(e.lateMin),
      amt("Basic Salary"), amt("Sunday Overtime"), amt("Overtime Pay"), amt("Public Holidays"), amt("Extra Day"), r2(num(e.bonus)), r2(c.gross), r2(c.uif), r2(num(e.paye)), r2(num(e.otherDed)), leave, r2(c.totalDed), r2(c.net), st.bank || "", st.account || "", st.branch || "", e.note || ""];
    row.forEach((v, j) => { if (j >= 17 && j <= 29) tot[j] = r2((tot[j] || 0) + v); });
    rows.push(row);
  });
  tot[1] = "TOTAL"; rows.push([]); rows.push(tot);
  const ws = X.utils.aoa_to_sheet(rows);
  ws["!cols"] = head.map((h, j) => ({ wch: j === 1 ? 26 : j === 33 ? 30 : j >= 30 ? 14 : Math.max(9, h.length + 1) }));
  const refs = []; for (let rr = 4; rr < rows.length; rr++) for (let j = 17; j <= 29; j++) refs.push(X.utils.encode_cell({ r: rr, c: j }));
  money(ws, refs);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "Salaries " + MONTHS[+m.split("-")[1] - 1].slice(0, 3) + " " + m.slice(0, 4));

  // One tab per person, laid out like the old payslip sheets
  const used = new Set();
  people.forEach(st => {
    const { e, c } = slipData(st);
    const rowsP = [
      ["PAYSLIP"], [S.companyName || ""], ["Address", S.address || ""], ["Registration number", S.regNo || "", "", "Phone", S.phone || ""], [],
      ["Employee", st.name + (st.known_as ? ` (${st.known_as})` : ""), "", "Number", st.emp_no],
      ["ID number", st.id_number || "", "", "Start date", fmtDate(st.start_date)],
      ["Date of birth", fmtDate(st.dob), "", "Occupation", st.occupation || ""],
      ["Pay period", monthLabel(m), "", "Paid on", r.pay_date ? fmtDate(r.pay_date) : "Monthly"],
      ["Site", S.sites?.[st.site]?.name || st.site, "", "Day rate", r2(c.dr)], [],
      ["EARNINGS", "", "Qty", "Total"], ...c.earn.map(([l, q, v]) => [l, "", q === "" ? "" : q, r2(v)]), ["", "", "Total payments", r2(c.gross)], [],
      ["DEDUCTIONS", "", "Qty", "Total"], ...c.ded.map(([l, q, v]) => [l, "", q === "" ? "" : q, r2(v)]), ["", "", "Total deductions", r2(c.totalDed)], [],
      ["Days worked", c.daysWorked, "", "NET PAY", r2(c.net)],
      ["Annual leave", num(e.annual), "", "Sick leave", num(e.sick)], ["Family resp.", num(e.family), "", "Unpaid leave", num(e.unpaid)], ["Absent", num(e.absent), "", "Late (min)", num(e.lateMin)], [],
      ["Bank", st.bank || ""], ["Account", st.account || ""], ["Branch code", st.branch || ""],
      ...(e.note ? [[], ["Note", e.note]] : []), [], [], ["Signature of employee", "", "", "Signature of employer"]
    ];
    const wsP = X.utils.aoa_to_sheet(rowsP);
    wsP["!cols"] = [{ wch: 22 }, { wch: 30 }, { wch: 16 }, { wch: 22 }, { wch: 16 }];
    // Rand amounts: the Total column of both tables, the day rate and net pay
    const mrefs = [X.utils.encode_cell({ r: 9, c: 4 })];
    rowsP.forEach((rw, i) => { if (i > 10 && rw.length === 4 && typeof rw[3] === "number") mrefs.push(X.utils.encode_cell({ r: i, c: 3 })); if (rw[3] === "NET PAY") mrefs.push(X.utils.encode_cell({ r: i, c: 4 })); });
    money(wsP, mrefs);
    let name = `${st.emp_no} ${st.known_as || st.name}`.replace(/[\[\]:*?\/\\]/g, "").slice(0, 31);
    while (used.has(name.toLowerCase())) name = name.slice(0, 28) + " " + Math.floor(Math.random() * 90 + 10);
    used.add(name.toLowerCase());
    X.utils.book_append_sheet(wb, wsP, name);
  });
  X.writeFile(wb, `Cleaners salaries ${monthLabel(m)}.xlsx`);
  exportedThisSession = true;
}
$("#xlsx").addEventListener("click", () => exportExcel());

// ---------- staff ----------
function nextEmpNo(name) {
  const nums = staff.map(s => parseInt((s.emp_no || "").replace(/\D/g, ""), 10)).filter(isFinite);
  const n = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0");
  const p = (name || "").trim().split(/\s+/).filter(Boolean);
  const ini = p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || "X"))).toUpperCase() : "XX";
  return "C" + ini + n;
}
function staffRow(s, former) {
  const missing = [!s.id_number && "ID number", !s.start_date && "start date", !s.branch && "branch code"].filter(Boolean);
  return `<button class="srow" data-edit="${s.id}"><div><div class="n">${esc(s.name)}${s.known_as ? ` <span class="muted">(${esc(s.known_as)})</span>` : ""}</div>
    <div class="m">${esc(s.emp_no)} · ${esc(s.occupation || "")} · ${esc(settings.sites?.[s.site]?.name || s.site)} · ${esc(s.bank || "")} ${esc(s.account || "")}</div>
    <div class="chips">${former ? `<span class="chip w">Left ${fmtDate(s.left_date)}${s.left_reason ? " · " + esc(s.left_reason) : ""}</span>` : `<span class="chip">Since ${s.start_date ? fmtDate(s.start_date) : "?"}</span>`}${s.uif ? "" : `<span class="chip">no UIF</span>`}${!former && missing.length ? `<span class="chip w">Missing: ${missing.join(", ")}</span>` : ""}</div></div>
    <div class="rate">${R(dayRateFor(s, settings))}<small>per day</small></div></button>`;
}
function renderStaff() {
  const q = ($("#staffSearch").value || "").toLowerCase();
  const match = s => !q || [s.name, s.known_as, s.emp_no].join(" ").toLowerCase().includes(q);
  const cur = staff.filter(s => s.status !== "left"), former = staff.filter(s => s.status === "left");
  $("#curCount").textContent = `(${cur.length})`;
  const c = cur.filter(match), f = former.filter(match);
  $("#staffList").innerHTML = c.length ? c.map(s => staffRow(s, false)).join("") : `<div class="empty">${q ? "Nobody matches that search." : "No staff yet. Add your first staff member."}</div>`;
  $("#formerList").innerHTML = f.length ? f.map(s => staffRow(s, true)).join("") : `<div class="empty">Nobody has left. When someone leaves, open them and choose “Mark as left”.</div>`;
}
$("#staffSearch").addEventListener("input", renderStaff);
$("#view-staff").addEventListener("click", ev => { const b = ev.target.closest("[data-edit]"); if (b) openStaff(b.dataset.edit); });

let editing = null;
const SF = ["name","known_as","id_number","dob","phone","emp_no","occupation","start_date","day_rate_override","pb_pct","bank","account","branch","notes"];
function openStaff(id) {
  editing = id || null; const s = id ? staff.find(x => x.id === id) : { occupation: "Cleaner", uif: true, site: "" };
  $("#staffDlgTitle").textContent = id ? "Edit " + s.name : "New staff member";
  SF.forEach(k => $("#f_" + k).value = s[k] ?? "");
  $("#f_uif").value = s.uif === false ? "no" : "yes";
  $("#siteRadios").innerHTML = Object.entries(settings.sites || {}).map(([k, v]) => `<label><input type="radio" name="site" value="${k}" ${s.site === k ? "checked" : ""}> ${esc(v.name)} · ${v.hours} h a day · ${R(num(settings.hourlyRate) * num(v.hours))} a day</label>`).join("");
  $("#empNoHint").textContent = id ? "" : "Suggested from their initials and the next free number";
  if (!id) $("#f_emp_no").value = nextEmpNo("");
  $("#staffErr").hidden = true;
  $("#leaveArea").innerHTML = !id ? "" : s.status === "left"
    ? `<div class="bar"><span class="muted small">Left on ${fmtDate(s.left_date)}.</span><button type="button" id="rehire">Bring back as current staff</button><span class="spacer"></span><button type="button" class="danger" id="delAsk">Delete permanently</button></div><div id="delConfirm"></div>`
    : `<div id="leftBox"><button type="button" class="danger" id="leaveAsk">Mark as left</button></div>`;
  $("#staffDlg").showModal();
  $("#f_name").focus();
}
$("#f_name").addEventListener("input", e => { if (!editing && /^C[A-Z]{0,2}\d{3}$/.test($("#f_emp_no").value)) $("#f_emp_no").value = nextEmpNo(e.target.value); });
$("#addStaff").addEventListener("click", () => openStaff(null));
$("#staffCancel").addEventListener("click", () => $("#staffDlg").close());
async function staffAction(fn, msg) { try { const row = await fn(); if (row) { const i = staff.findIndex(s => s.id === row.id); if (i >= 0) staff[i] = row; else staff.push(row); } $("#staffDlg").close(); toast(msg); renderStaff(); renderMonth(); } catch (err) { $("#staffErr").hidden = false; $("#staffErr").textContent = friendly(err); } }
$("#leaveArea").addEventListener("click", async ev => {
  const t = ev.target, s = staff.find(x => x.id === editing);
  if (t.id === "leaveAsk") {
    $("#leftBox").innerHTML = `<div class="confirm"><span>${esc(s.name)} still gets a payslip for the month they leave in, then drops off later months. Their record stays under Former staff in case they come back.</span>
      <div class="fgrid"><label class="f">Last working day <input type="date" id="leftDate" value="${iso(new Date())}"></label><label class="f">Reason (optional) <input id="leftReason" placeholder="Resigned, dismissed, contract ended…"></label></div>
      <div class="bar"><button type="button" id="leaveNo">Cancel</button><button type="button" class="danger" id="leaveYes">Confirm they left</button></div></div>`;
  } else if (t.id === "leaveNo") openStaff(editing);
  else if (t.id === "leaveYes") { if (!$("#leftDate").value) return; await staffAction(() => api.saveStaff({ id: editing, status: "left", left_date: $("#leftDate").value, left_reason: $("#leftReason").value.trim() || null }), "Moved to former staff"); }
  else if (t.id === "rehire") await staffAction(() => api.saveStaff({ id: editing, status: "active", left_date: null, left_reason: null }), "Back on current staff");
  else if (t.id === "delAsk") $("#delConfirm").innerHTML = `<div class="confirm">This removes ${esc(s.name)} and their bank details completely. It cannot be undone. <div class="bar"><button type="button" id="delNo">Keep</button><button type="button" class="danger" id="delYes">Delete</button></div></div>`;
  else if (t.id === "delNo") $("#delConfirm").innerHTML = "";
  else if (t.id === "delYes") { try { await api.deleteStaff(editing); staff = staff.filter(x => x.id !== editing); $("#staffDlg").close(); toast("Deleted"); renderStaff(); renderMonth(); } catch (err) { $("#staffErr").hidden = false; $("#staffErr").textContent = friendly(err); } }
});
$("#staffForm").addEventListener("submit", async ev => {
  ev.preventDefault();
  const v = k => $("#f_" + k).value.trim();
  const site = document.querySelector('input[name="site"]:checked')?.value || "";
  const errs = [];
  if (!v("name")) errs.push("their full name");
  if (!v("emp_no")) errs.push("an employee number");
  if (!v("start_date")) errs.push("a start date");
  if (!site) errs.push("which site they work at");
  if (!v("bank")) errs.push("the bank");
  if (!v("account")) errs.push("the account number");
  const dupe = staff.find(s => s.id !== editing && (s.emp_no || "").toLowerCase() === v("emp_no").toLowerCase());
  if (dupe) errs.push(`a different employee number (${v("emp_no")} belongs to ${dupe.name})`);
  if (errs.length) { $("#staffErr").hidden = false; $("#staffErr").textContent = "Please add " + errs.join(", ") + "."; return; }
  const row = { name: v("name"), known_as: v("known_as") || null, id_number: v("id_number") || null, dob: v("dob") || null, phone: v("phone") || null, emp_no: v("emp_no").toUpperCase(), occupation: v("occupation") || null, start_date: v("start_date"), site,
    day_rate_override: v("day_rate_override") ? num(v("day_rate_override")) : null, pb_pct: v("pb_pct") ? num(v("pb_pct")) : null, uif: $("#f_uif").value === "yes",
    bank: v("bank"), account: v("account").replace(/\s+/g, ""), branch: v("branch").replace(/\s+/g, "") || null, notes: v("notes") || null };
  if (editing) row.id = editing; else { row.status = "active"; row.sort_order = Math.max(0, ...staff.map(s => s.sort_order || 0)) + 1; }
  $("#staffSave").disabled = true;
  await staffAction(() => api.saveStaff(row), editing ? "Changes saved" : row.name + " added");
  $("#staffSave").disabled = false;
});

// ---------- settings ----------
function fillSettings() {
  const s = settings;
  ["companyName","regNo","address","phone","hourlyRate","workingDays","uifPct","sundayFactor","otFactor"].forEach(k => $("#s_" + k).value = s[k] ?? "");
  $("#s_hoursO").value = s.sites?.O?.hours ?? ""; $("#s_hoursX").value = s.sites?.X?.hours ?? "";
  $("#s_deductLate").value = s.deductLate ? "yes" : "no";
  $("#coName").textContent = (s.companyName || "Lezmin").replace(/\s+CC$/i, "");
}
$("#settingsForm").addEventListener("submit", async ev => {
  ev.preventDefault(); const g = k => $("#s_" + k).value;
  const next = { ...settings, companyName: g("companyName").trim(), regNo: g("regNo").trim(), address: g("address").trim(), phone: g("phone").trim(),
    hourlyRate: num(g("hourlyRate")), workingDays: num(g("workingDays")), uifPct: num(g("uifPct")), sundayFactor: num(g("sundayFactor")), otFactor: num(g("otFactor")),
    deductLate: g("deductLate") === "yes", sites: { O: { name: settings.sites?.O?.name || "Ormonde", hours: num(g("hoursO")) }, X: { name: settings.sites?.X?.name || "Xavier", hours: num(g("hoursX")) } } };
  try { await api.saveSettings(next); settings = next; fillSettings(); renderMonth(); renderStaff(); $("#settingsMsg").textContent = "Saved."; }
  catch (err) { $("#settingsMsg").textContent = friendly(err); }
});

// ---------- tabs ----------
function showTab(t) { ["month","staff","settings"].forEach(n => { $("#tab-" + n).setAttribute("aria-selected", n === t); $("#view-" + n).hidden = n !== t; }); }
["month","staff","settings"].forEach(n => $("#tab-" + n).addEventListener("click", () => showTab(n)));

// ---------- start ----------
async function startApp() {
  $("#login").hidden = true; $("#app").hidden = false;
  if (DEMO) banner("Demo mode with made-up staff. Nothing is saved. Add your Supabase details to config.js to use it for real.");
  try {
    const role = await api.role();
    if (!role) { banner("This login is not on the list of people allowed to use the payroll. Ask the site owner to add your email.", "bad"); return; }
    me.role = role;
    $("#tab-settings").hidden = role !== "admin";
    const d = await api.load();
    settings = { ...DEFAULT_SETTINGS, ...d.settings }; staff = d.staff;
    runs = { current: d.runs.current || blankRun() }; runs.current.entries = runs.current.entries || {};
    month = runs.current.period || shiftMonth(thisMonth(), -1);
    fillSettings(); renderStaff(); renderMonth(); setSave("saved");
  } catch (err) { banner(friendly(err), "bad"); }
}
$("#loginForm").addEventListener("submit", async ev => {
  ev.preventDefault(); $("#loginErr").hidden = true; $("#loginBtn").disabled = true;
  try { await api.signIn($("#loginEmail").value.trim(), $("#loginPassword").value); me.email = $("#loginEmail").value.trim(); await startApp(); }
  catch (err) { $("#loginErr").hidden = false; $("#loginErr").textContent = /invalid/i.test(err?.message || "") ? "That email and password don't match. Check for typos and try again." : friendly(err); }
  finally { $("#loginBtn").disabled = false; }
});
$("#signOut").addEventListener("click", async () => { await api.signOut(); location.reload(); });

(async () => {
  const s = await api.session().catch(() => null);
  if (s) { me.email = s.email; startApp(); } else { $("#login").hidden = false; $("#loginEmail").focus(); }
})();
})();
