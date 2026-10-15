/* Lezmin Payroll — import the monthly salary Excel sheet, check it, print every payslip.
   Nothing is stored: all data lives in this open page and is gone when it closes. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = parseFloat(String(v ?? "").replace(/[R\s,]/g, "")); return isFinite(n) ? n : 0; };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const fmt = n => { const [a, b] = r2(n).toFixed(2).split("."); return a.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "." + b; };
const R = n => "R " + fmt(n);
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const monthLabel = m => { const [y, mo] = m.split("-"); return MONTHS[+mo - 1] + " " + y; };
const shiftMonth = (m, k) => { let [y, mo] = m.split("-").map(Number); mo += k; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return `${y}-${String(mo).padStart(2, "0")}`; };
const fmtDate = s => { if (!s) return ""; const [y, m, d] = s.split("-"); if (!m) return ""; return d ? `${+d} ${MONTHS[+m - 1].slice(0, 3)} ${y}` : `${MONTHS[+m - 1].slice(0, 3)} ${y}`; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const thisMonth = () => iso(new Date()).slice(0, 7);

const DEFAULT_SETTINGS = {
  companyName: "LEZMIN 2358 CC", address: "MO 1 Ormonde Shopping Centre, 18 Crownwood St, Ormonde, Johannesburg, 2091",
  regNo: "2003/014149/23", phone: "(011) 496 – 1916 / 2348 / 1702",
  hourlyRate: 30.23, workingDays: 26, uifPct: 1, sundayFactor: 0.5, otFactor: 1.5, deductLate: false,
  sites: { O: { name: "Ormonde", hours: 7.5 }, X: { name: "Xavier", hours: 7 } }
};

// The boxes he can check or fix per person, in the order they appear
const COLS = [
  { g: "Leave & days off (days)", cols: [["unpaid","Unpaid leave"],["absent","Absent"],["annual","Annual leave"],["sick","Sick leave"],["family","Family resp."],["notEmployed","Not employed yet / any more"]] },
  { g: "Extra pay", cols: [["ph","Public holidays worked"],["sundays","Sundays worked"],["otHours","Overtime hours"],["extraDays","Extra days"],["bonus","Bonus (R)"]] },
  { g: "Other", cols: [["lateMin","Late (minutes)"],["paye","PAYE (R)"],["otherDed","Other deduction (R)"],["note","Note"]] },
];
const ENTRY_KEYS = COLS.flatMap(g => g.cols.map(c => c[0]));

// ---------- state (memory only, never saved) ----------
let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
let staff = [];          // [{ id, name, known_as, emp_no, ..., e: {month figures}, sheetNet }]
let month = shiftMonth(thisMonth(), -1), payDate = "", fileName = "";
let openRow = null, headerImg = null, seq = 0;
const newId = () => "p" + (++seq);

// ---------- helpers ----------
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }
function banner(msg, kind = "warn") { const b = $("#banner"); b.hidden = !msg; b.className = "notice " + kind; b.textContent = msg || ""; }
function downloadBlob(blob, filename) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, "").trim();
async function busy(btn, fn) { const t = btn.textContent; btn.disabled = true; btn.textContent = "Working…"; try { await fn(); } catch (err) { console.error(err); banner("Something went wrong: " + (err?.message || err), "bad"); } finally { btn.disabled = false; btn.textContent = t; } }

// ---------- pay maths (matches the old Excel sheets) ----------
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

// =====================================================================
// IMPORT: reads his monthly salary workbook (the "Cleaners" tab with days and leave,
// plus the "SALARY CALC" tab with bank details), or a file this site exported.
// Columns are found by their heading, so moving columns around is fine.
// =====================================================================
const norm = s => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const ALIAS = {
  no: ["no", "部门编号", "#"],
  name: ["name", "employee", "full name"],
  known_as: ["known as", "nickname"],
  emp_no: ["emp no", "employee number", "employee no", "number", "emp number"],
  id_number: ["id number", "id no", "i.d. no.", "id"],
  occupation: ["occupation", "job"],
  site: ["ormonde / xavier", "ormonde/xavier", "site"],
  annual: ["annual leave"], sick: ["sick leave"], unpaid: ["unpaid leave"], family: ["family r. leave", "family resp.", "family responsibility", "family leave"],
  absent: ["absent days", "absent"], notEmployed: ["not employed"], ph: ["public holidays", "public holidays worked"], sundays: ["sundays", "sundays worked"],
  otHours: ["overtime (hrs)", "overtime hrs", "overtime hours"], extraDays: ["extra days"], lateMin: ["late (minutes)", "late (min)", "late minutes"],
  bonus: ["bonus"], paye: ["paye"], otherDed: ["deductions", "other deductions"], pb_pct: ["pb %", "pb%", "performance bonus %"], note: ["notes", "note"],
  days: ["days worked"],
  bank: ["bank list", "bank"], account: ["account", "account number", "bank account"], branch: ["branch code", "branch"],
  start: ["start working date", "start date", "start work date"],
  uifAmt: ["uif deduction", "uif"], net: ["money transfer", "net pay"],
};
function findHeader(rows, mustHave) {
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cells = (rows[r] || []).map(norm);
    if (mustHave.every(group => group.some(a => cells.includes(a)))) {
      const col = {};
      Object.entries(ALIAS).forEach(([k, al]) => { const i = cells.findIndex(c => al.includes(c)); if (i >= 0) col[k] = i; });
      return { r, col };
    }
  }
  return null;
}
function siteCode(v) { const s = norm(v); if (!s) return "O"; if (s.startsWith("x")) return "X"; return "O"; }
function parseStart(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && v > 20000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^([A-Za-z]{3})[A-Za-z]*[.\s-]+(\d{4})$/);       // AUG.2023
  if (m) { const i = MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === m[1].toLowerCase()); if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, "0")}`; }
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return s;
  m = s.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);              // 1 Aug 2023 (our own export)
  if (m) { const i = MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === m[2].toLowerCase()); if (i >= 0) return `${m[3]}-${String(i + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`; }
  return "";
}
function splitKnownAs(name) {
  const s = String(name || "").trim(); let known = "";
  const m = s.match(/\(([^)]+)\)/); if (m) known = m[1].trim();
  const clean = s.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const title = t => t === t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : t;
  return { name: title(clean), known_as: known ? title(known) : "" };
}
const nameKey = s => norm(splitKnownAs(s).name).replace(/[^a-z]/g, "");
const similar = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a) || a.slice(0, 5) === b.slice(0, 5));

function readWorkbook(wb) {
  const X = window.XLSX;
  const sheets = wb.SheetNames.map(n => ({ n, rows: X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }) }));
  const S = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  const notes = [];

  // Rates and month from anywhere in the workbook (the KEY box and the title line)
  let period = "", pay = "";
  sheets.forEach(({ rows }) => rows.forEach(row => row.forEach((c, j) => {
    const t = norm(c), next = () => { for (let k = j + 1; k < row.length; k++) if (typeof row[k] === "number") return row[k]; return null; };
    if (/ormonde hours/.test(t) && next()) S.sites.O.hours = next();
    if (/xavier hours/.test(t) && next()) S.sites.X.hours = next();
    if (/^hou?r?t?ly rate$/.test(t) && next()) S.hourlyRate = next();
    if (/working days in month/.test(t) && next()) S.workingDays = next();
    const cn = String(c).match(/(\d{4})年(\d{1,2})月.*?(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (cn) { period = `${cn[1]}-${cn[2].padStart(2, "0")}`; pay = `${cn[3]}-${cn[4].padStart(2, "0")}-${cn[5].padStart(2, "0")}`; }
    const en = String(c).match(/salaries\s+([A-Za-z]+)\s+(\d{4})/i);
    if (en && !period) { const i = MONTHS.findIndex(x => x.toLowerCase() === en[1].toLowerCase()); if (i >= 0) period = `${en[2]}-${String(i + 1).padStart(2, "0")}`; }
    const pd = String(c).match(/^Paid on (\d{1,2} [A-Za-z]{3} \d{4})/); if (pd && !pay) pay = parseStart(pd[1]);
  })));

  // Main tab: the one with days worked / annual leave per person
  let main = null;
  for (const sh of sheets) { const h = findHeader(sh.rows, [ALIAS.name, [...ALIAS.days, ...ALIAS.annual]]); if (h) { main = { ...sh, h }; break; } }
  if (!main) throw new Error("Couldn't find the staff list in this file. It needs a tab with a NAME column and DAYS WORKED or ANNUAL LEAVE columns, like the Cleaners tab of the monthly salary sheet.");

  // Bank tab: the one with bank names (may be the same tab)
  let bankTab = null;
  for (const sh of sheets) { const h = findHeader(sh.rows, [ALIAS.name, ALIAS.bank]); if (h) { bankTab = { ...sh, h }; break; } }

  const cell = (row, col, k) => col[k] != null ? row[col[k]] : "";
  const people = [];
  const { rows, h } = main;
  for (let r = h.r + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawName = String(cell(row, h.col, "name") || "").trim();
    if (/^(key|total)$/i.test(rawName) || /^key$/i.test(String(row[0] || "").trim())) break;
    if (!rawName) continue;
    const { name, known_as } = splitKnownAs(rawName);
    const e = {};
    ENTRY_KEYS.forEach(k => { if (h.col[k] == null) return; const v = cell(row, h.col, k); if (k === "note") { if (String(v).trim()) e.note = String(v).trim(); } else if (num(v)) e[k] = num(v); });
    people.push({
      id: newId(), no: num(cell(row, h.col, "no")) || people.length + 1, name, known_as: String(cell(row, h.col, "known_as") || known_as || "").trim(),
      emp_no: String(cell(row, h.col, "emp_no") || "").trim(), id_number: String(cell(row, h.col, "id_number") || "").trim(),
      occupation: String(cell(row, h.col, "occupation") || "Cleaner").trim(), site: siteCode(cell(row, h.col, "site")),
      pb_pct: num(cell(row, h.col, "pb_pct")) || null, uif: true, bank: "", account: "", branch: "", start_date: parseStart(cell(row, h.col, "start")), e,
    });
  }
  if (!people.length) throw new Error("Found the staff tab, but no people in it.");

  // Bank details, start dates, UIF and the sheet's own net pay
  if (bankTab) {
    const bh = bankTab.h, bankRows = [];
    for (let r = bh.r + 1; r < bankTab.rows.length; r++) {
      const row = bankTab.rows[r] || [], nm = String(cell(row, bh.col, "name") || "").trim();
      if (!nm || /^(total|cleaner|key)$/i.test(nm)) continue;
      const bc = bh.col.bank;
      const account = bh.col.account != null ? row[bh.col.account] : row[bc + 1];
      const branch = bh.col.branch != null ? row[bh.col.branch] : row[bc + 2];
      bankRows.push({ no: num(cell(row, bh.col, "no")), key: nameKey(nm), known: splitKnownAs(nm).known_as, bank: String(row[bc] || "").trim(),
        account: String(account ?? "").replace(/\s+/g, ""), branch: String(branch ?? "").replace(/\s+/g, ""),
        start: parseStart(cell(row, bh.col, "start")), uifAmt: bh.col.uifAmt != null ? num(cell(row, bh.col, "uifAmt")) : null, net: bh.col.net != null ? num(cell(row, bh.col, "net")) : null });
    }
    const used = new Set();
    people.forEach(p => {
      const k = nameKey(p.name);
      // match on the row number first (his two tabs share numbering), then on the name
      let b = bankRows.find(x => !used.has(x) && x.no && x.no === p.no && (similar(x.key, k) || !x.key));
      if (!b) b = bankRows.find(x => !used.has(x) && similar(x.key, k));
      if (!b) b = bankRows.find(x => !used.has(x) && x.no && x.no === p.no);
      if (!b) return;
      used.add(b);
      Object.assign(p, { bank: titleBank(b.bank), account: b.account, branch: b.branch, start_date: b.start || p.start_date });
      if (!p.known_as && b.known) p.known_as = b.known;
      if (b.uifAmt != null) p.uif = b.uifAmt > 0;
      if (b.net) p.sheetNet = b.net;
    });
    const missing = people.filter(p => !p.bank);
    if (missing.length) notes.push(`No bank details found for ${missing.map(p => p.name).join(", ")}. Add them on the Staff tab.`);
  } else notes.push("This file has no bank details. Add them on the Staff tab, or import the sheet that also has the SALARY CALC tab.");

  return { settings: S, people, period, pay, notes };
}
function titleBank(b) { const s = String(b || "").trim(); const known = { "TYME BANK": "TymeBank", "FNB": "FNB", "ABSA": "ABSA" }; return known[s.toUpperCase()] || (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s); }

async function importFile(file) {
  if (!file) return;
  if (!window.XLSX) { banner("The Excel reader didn't load. Check the internet connection and reload the page.", "bad"); return; }
  try {
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    const res = readWorkbook(wb);
    settings = { ...settings, hourlyRate: res.settings.hourlyRate, workingDays: res.settings.workingDays, sites: res.settings.sites };
    staff = res.people; month = res.period || month; payDate = res.pay || ""; fileName = file.name; openRow = null;
    banner(res.notes.join(" "), "warn");
    fillSettings(); renderAll(); showTab("month");
    const checked = staff.filter(p => p.sheetNet != null), off = checked.filter(p => Math.abs(r2(calc(p, p.e).net) - p.sheetNet) > 0.05);
    toast(`Imported ${staff.length} people` + (checked.length ? (off.length ? ` · ${off.length} differ from the sheet` : " · all match the sheet") : ""));
  } catch (err) { console.error(err); banner(err.message || "This file couldn't be read. Is it an Excel file (.xlsx)?", "bad"); }
}
$("#fileInput").addEventListener("change", ev => { importFile(ev.target.files[0]); ev.target.value = ""; });
document.querySelectorAll("[data-import]").forEach(b => b.addEventListener("click", () => $("#fileInput").click()));
document.addEventListener("dragover", ev => ev.preventDefault());
document.addEventListener("drop", ev => { ev.preventDefault(); if ($("#app").hidden) return; const f = ev.dataTransfer?.files?.[0]; if (f) importFile(f); });

// ---------- render: month ----------
const entryOf = st => st.e || (st.e = {});
function renderAll() { renderMonth(); renderStaff(); }
function diffCount() { const checked = staff.filter(p => p.sheetNet != null); return { checked, off: checked.filter(p => Math.abs(r2(calc(p, entryOf(p)).net) - p.sheetNet) > 0.05) }; }
function renderMonth() {
  const has = staff.length > 0;
  $("#emptyState").hidden = has; $("#monthWork").hidden = !has;
  if (!has) return;
  $("#monthTitle").textContent = monthLabel(month);
  $("#periodInput").value = month; $("#payDate").value = payDate || "";
  $("#fileNote").textContent = fileName ? `From ${fileName}` : "Added by hand";
  const cal = monthCalendar(month);
  $("#calHint").textContent = `${cal.sundays} Sundays · ` + (cal.ph.length ? "Public holiday" + (cal.ph.length > 1 ? "s" : "") + ": " + cal.ph.map(([d, n]) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} (${n})`).join(", ") : "No public holidays");
  renderCheckPill();
  $("#monthList").innerHTML = staff.map(st => `<div class="row ${openRow === st.id ? "open" : ""}" data-id="${st.id}"><button class="rowhead" aria-expanded="${openRow === st.id}">${rowHeadHTML(st)}</button>${openRow === st.id ? detailHTML(st) : ""}</div>`).join("");
  renderTotals();
}
function renderCheckPill() {
  const { checked, off } = diffCount(), pill = $("#checkPill");
  pill.hidden = !checked.length;
  pill.className = "pill " + (off.length ? "open" : "paid");
  pill.textContent = off.length ? `${off.length} differ from the sheet` : `All ${checked.length} match the sheet`;
}
const CHIP = { annual: "annual", sick: "sick", family: "family", unpaid: "unpaid", absent: "absent", notEmployed: "not employed", ph: "PH", sundays: "Sun", otHours: "OT hrs", extraDays: "extra day", bonus: "bonus R", lateMin: "late min", paye: "PAYE R", otherDed: "other ded R" };
const WARN = ["unpaid", "absent", "notEmployed", "lateMin", "otherDed", "paye"];
function chipsFor(st) {
  const e = entryOf(st), c = calc(st, e);
  const chips = Object.keys(CHIP).filter(k => num(e[k])).map(k => `<span class="chip ${WARN.includes(k) ? "w" : "on"}">${num(e[k])} ${CHIP[k]}</span>`);
  if (st.sheetNet != null) chips.push(Math.abs(r2(c.net) - st.sheetNet) > 0.05 ? `<span class="chip bad">Sheet says ${R(st.sheetNet)}</span>` : `<span class="chip ok">✓ matches sheet</span>`);
  if (!st.bank || !st.account) chips.push(`<span class="chip bad">No bank details</span>`);
  return chips.join("");
}
function rowHeadHTML(st) {
  const c = calc(st, entryOf(st));
  return `<div class="who"><div class="n">${esc(st.name)}${st.known_as ? ` <span class="muted">(${esc(st.known_as)})</span>` : ""}</div>
    <div class="m">${st.emp_no ? esc(st.emp_no) + " · " : ""}${esc(settings.sites?.[st.site]?.name || st.site)} · ${c.daysWorked} days worked${st.uif ? "" : " · no UIF"}</div>
    <div class="chips">${chipsFor(st)}</div></div>
    <div class="money">${R(c.net)}<small>net pay</small></div><span class="chev" aria-hidden="true">›</span>`;
}
function breakdownHTML(st) {
  const c = calc(st, entryOf(st));
  const line = (l, v, neg) => `<span>${esc(l)}</span><span class="${neg ? "neg" : ""}">${neg ? "−" : ""}${fmt(v)}</span>`;
  return c.earn.filter(x => x[2]).map(x => line(x[0], x[2])).join("") + `<span class="t">Total earnings</span><span class="t">${fmt(c.gross)}</span>`
    + c.ded.filter(x => x[2]).map(x => line(x[0], x[2], true)).join("") + `<span class="t">Net pay</span><span class="t">${fmt(c.net)}</span>`;
}
function detailHTML(st) {
  const e = entryOf(st);
  const groups = COLS.map(g => `<p class="grp">${g.g}</p><div class="igrid">${g.cols.filter(([k]) => k !== "note").map(([k, l]) =>
    `<label class="f">${l}<input type="number" min="0" step="any" inputmode="decimal" data-k="${k}" value="${num(e[k]) || ""}" placeholder="0"></label>`).join("")}</div>`).join("");
  return `<div class="detail">${groups}
    <label class="f">Note for this month (prints on the payslip) <input data-k="note" value="${esc(e.note || "")}" placeholder="e.g. what the other deduction is for"></label>
    <div class="bar" style="align-items:flex-start"><div class="breakdown" id="bd_${st.id}">${breakdownHTML(st)}</div><span class="spacer"></span>
      <div class="stack" style="gap:6px"><button data-slip="${st.id}">Print this payslip</button><button data-slippdf="${st.id}">Save this payslip (PDF)</button><button class="ghost" data-edit="${st.id}">Edit bank details & info</button></div></div></div>`;
}
function refreshRow(id) {
  const row = document.querySelector(`#monthList .row[data-id="${id}"]`), st = staff.find(s => s.id === id); if (!row || !st) return;
  row.querySelector(".rowhead").innerHTML = rowHeadHTML(st);
  const bd = row.querySelector("#bd_" + id); if (bd) bd.innerHTML = breakdownHTML(st);
  renderTotals(); renderCheckPill();
}
function monthTotals() {
  let gross = 0, net = 0, uif = 0;
  // rounded per person, so the total matches what the bank actually pays out
  staff.forEach(st => { const c = calc(st, entryOf(st)); gross += r2(c.gross); net += r2(c.net); uif += r2(c.uif); });
  return { n: staff.length, gross, net, uif };
}
function renderTotals() {
  const t = monthTotals();
  $("#totals").innerHTML = `<div><small>Staff paid</small><b>${t.n}</b></div><div><small>Total earnings</small><b>${R(t.gross)}</b></div><div><small>UIF deducted</small><b>${R(t.uif)}</b></div><div class="net"><small>Total to transfer</small><b>${R(t.net)}</b></div>`;
}

$("#monthList").addEventListener("input", ev => {
  const inp = ev.target.closest("input[data-k]"); if (!inp) return;
  const st = staff.find(s => s.id === inp.closest(".row").dataset.id), e = entryOf(st), k = inp.dataset.k;
  if (k === "note") { if (inp.value.trim()) e.note = inp.value; else delete e.note; }
  else { const v = num(inp.value); if (v) e[k] = v; else delete e[k]; }
  refreshRow(st.id);
});
$("#monthList").addEventListener("focusin", ev => { if (ev.target.matches("input[type=number]")) ev.target.select(); });
$("#monthList").addEventListener("click", ev => {
  const p = ev.target.closest("[data-slip]"); if (p) { printSlips([p.dataset.slip]); return; }
  const d = ev.target.closest("[data-slippdf]"); if (d) { busy(d, async () => { const st = staff.find(s => s.id === d.dataset.slippdf); const doc = await buildPdf([st]); downloadBlob(doc.output("blob"), `${safeName(st.emp_no || String(st.no).padStart(2, "0"))} ${safeName(st.name)} - ${monthLabel(month)}.pdf`); }); return; }
  const ed = ev.target.closest("[data-edit]"); if (ed) { openStaff(ed.dataset.edit); return; }
  const head = ev.target.closest(".rowhead"); if (!head) return;
  const id = head.parentElement.dataset.id; openRow = openRow === id ? null : id; renderMonth();
  const row = document.querySelector(`#monthList .row[data-id="${id}"]`);
  if (openRow) row?.querySelector("input[data-k]")?.focus(); else row?.querySelector(".rowhead")?.focus();
});
$("#periodInput").addEventListener("change", ev => { if (ev.target.value) { month = ev.target.value; renderMonth(); } });
$("#payDate").addEventListener("change", ev => { payDate = ev.target.value; });
$("#clearBtn").addEventListener("click", () => $("#clearDlg").showModal());
$("#clearYes").addEventListener("click", () => { staff = []; fileName = ""; payDate = ""; openRow = null; banner(""); settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); fillSettings(); $("#clearDlg").close(); renderAll(); toast("Cleared. Nothing was kept."); });
$("#clearNo").addEventListener("click", () => $("#clearDlg").close());
window.addEventListener("beforeunload", ev => { if (staff.length) { ev.preventDefault(); ev.returnValue = ""; } });

// ---------- payslips: HTML for printing ----------
function slipData(st) { const e = entryOf(st); return { st, S: settings, e, c: calc(st, e) }; }
function slipHTML({ st, S, c, e }) {
  const row = ([l, q, v]) => `<tr class="${v ? "" : "zero"}"><td>${esc(l)}</td><td class="r">${q !== "" && q != null && v ? esc(q) : ""}</td><td class="r">${fmt(v)}</td></tr>`;
  const pad = n => Array.from({ length: Math.max(0, n) }, () => `<tr><td>&nbsp;</td><td></td><td></td></tr>`).join("");
  const rows = Math.max(c.earn.length, c.ded.length);
  const att = [["Days worked", c.daysWorked], ["Annual leave", num(e.annual)], ["Sick leave", num(e.sick)], ["Family resp.", num(e.family)], ["Unpaid leave", num(e.unpaid)], ["Absent", num(e.absent)], ["Late (min)", num(e.lateMin)]];
  return `<div class="slip">
    <img class="banner" src="payslip-header.jpg" alt="Payslip — ${esc(S.companyName)}">
    <div class="co"><span>${esc(S.address)}</span><span>Reg. no ${esc(S.regNo)} · Tel ${esc(S.phone)}</span></div>
    <div class="info">
      <div><small>Employee</small><b>${esc(st.name)}${st.known_as ? ` (${esc(st.known_as)})` : ""}</b></div>
      <div><small>Number</small><b>${esc(st.emp_no) || "—"}</b></div>
      <div><small>Pay period</small><b>${monthLabel(month)}</b></div>
      <div><small>Paid on</small><b>${payDate ? fmtDate(payDate) : "Monthly"}</b></div>
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
      <div><div class="cap">Paid into</div>Bank: <b>${esc(st.bank) || "—"}</b><br>Account: <b>${esc(st.account) || "—"}</b><br>Branch code: <b>${esc(st.branch) || "—"}</b></div>
      <div class="net"><small>NET PAY</small><b>R ${fmt(c.net)}</b></div>
    </div>
    ${e.note ? `<p class="note">Note: ${esc(e.note)}</p>` : ""}
    <div class="sigs"><div>Signature of employee</div><div class="d">Date</div><div>Signature of employer</div><div class="d">Date</div></div>
  </div>`;
}
function printSlips(ids) {
  const people = staff.filter(s => !ids || ids.includes(s.id));
  if (!people.length) return;
  $("#printArea").innerHTML = people.map(st => `<div class="sheet">${slipHTML(slipData(st))}</div>`).join(""); // one person per A4 page
  const imgs = [...$("#printArea").querySelectorAll("img")];
  Promise.all(imgs.map(im => im.complete ? 0 : new Promise(res => { im.onload = im.onerror = res; }))).then(() => window.print());
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
  const cols = [L, L + 60, L + 88, L + 126, L + 156];
  const kv = (x, yy, k, v) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(110); doc.text(k.toUpperCase(), x, yy);
    doc.setTextColor(0); doc.setFontSize(10.5); doc.setFont("helvetica", "bold"); doc.text(String(v || "—").slice(0, 30), x, yy + 5.5);
  };
  kv(cols[0], y + 8, "Employee", st.name + (st.known_as ? ` (${st.known_as})` : "")); kv(cols[1], y + 8, "Number", st.emp_no); kv(cols[2], y + 8, "Pay period", monthLabel(month)); kv(cols[3], y + 8, "Paid on", payDate ? fmtDate(payDate) : "Monthly"); kv(cols[4], y + 8, "Site", S.sites?.[st.site]?.name || st.site);
  kv(cols[0], y + 22, "ID number", st.id_number); kv(cols[1], y + 22, "Start date", fmtDate(st.start_date)); kv(cols[2], y + 22, "Date of birth", fmtDate(st.dob)); kv(cols[3], y + 22, "Occupation", st.occupation); kv(cols[4], y + 22, "Day rate", "R " + fmt(c.dr));
  y += 32; doc.setDrawColor(0); doc.line(L, y, Rr, y);
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
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text("PAID INTO", L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  doc.text(`Bank: ${st.bank || "—"}`, L, y + 8); doc.text(`Account: ${st.account || "—"}`, L, y + 14.5); doc.text(`Branch code: ${st.branch || "—"}`, L, y + 21);
  const nw = 84, nh = 28, nx = Rr - nw, ny = y - 4;
  doc.setFillColor(...ink); doc.rect(nx, ny, nw, nh, "F"); doc.setFillColor(...gold); doc.rect(nx, ny, 3.5, nh, "F");
  doc.setTextColor(...gold); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text("NET PAY", Rr - 5, ny + 8, { align: "right" });
  doc.setTextColor(255); doc.setFontSize(22); doc.text("R " + fmt(c.net), Rr - 5, ny + 21, { align: "right" }); doc.setTextColor(0);
  y += 34;
  if (e.note) { doc.setFont("helvetica", "italic"); doc.setFontSize(9.5); doc.setTextColor(70); doc.text("Note: " + String(e.note).slice(0, 120), L, y); doc.setTextColor(0); }
  const sy = 268; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setDrawColor(0); doc.setLineWidth(0.3);
  [[L, "Signature of employee"], [L + 58, "Date"], [Rr - 82, "Signature of employer"], [Rr - 24, "Date"]].forEach(([x, t], i) => { const w = i % 2 ? 24 : 52; doc.line(x, sy, x + w, sy); doc.text(t, x, sy + 4.5); });
}
async function buildPdf(people) {
  const img = await loadHeader();
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  people.forEach((st, i) => { if (i) doc.addPage(); drawSlip(doc, slipData(st), img); });
  return doc;
}
$("#pdfAll").addEventListener("click", ev => busy(ev.currentTarget, async () => { const doc = await buildPdf(staff); downloadBlob(doc.output("blob"), `Payslips ${monthLabel(month)}.pdf`); }));
$("#zipAll").addEventListener("click", ev => busy(ev.currentTarget, async () => {
  const zip = new window.JSZip();
  for (const st of staff) { const doc = await buildPdf([st]); zip.file(`${safeName(st.emp_no || String(st.no).padStart(2, "0"))} ${safeName(st.name)} - ${monthLabel(month)}.pdf`, doc.output("arraybuffer")); }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `Payslips ${monthLabel(month)} (each person).zip`);
}));

// ---------- Excel export (it can be imported again next time) ----------
function exportExcel() {
  const X = window.XLSX, S = settings, m = month;
  const head = ["No", "Name", "Known as", "Emp no", "ID number", "Occupation", "Site", "Start date", "Days worked", "Annual leave", "Sick leave", "Family resp.", "Unpaid leave", "Absent", "Not employed", "Public holidays", "Sundays", "Overtime hrs", "Extra days", "Late (min)",
    "Bonus", "PAYE", "Other deductions", "Total earnings", "UIF", "Total deductions", "Net pay", "Bank", "Account", "Branch code", "Note"];
  const rows = [[`${S.companyName || "Lezmin"} — cleaners salaries ${monthLabel(m)}`], [payDate ? `Paid on ${fmtDate(payDate)}` : ""], [`Exported ${fmtDate(iso(new Date()))}`], head];
  let tot = 0;
  staff.forEach((st, i) => {
    const e = entryOf(st), c = calc(st, e); tot += r2(c.net);
    rows.push([i + 1, st.name, st.known_as || "", st.emp_no || "", st.id_number || "", st.occupation || "", S.sites?.[st.site]?.name || st.site, fmtDate(st.start_date), c.daysWorked, num(e.annual), num(e.sick), num(e.family), num(e.unpaid), num(e.absent), num(e.notEmployed), num(e.ph), num(e.sundays), num(e.otHours), num(e.extraDays), num(e.lateMin),
      r2(num(e.bonus)), r2(num(e.paye)), r2(num(e.otherDed)), r2(c.gross), r2(c.uif), r2(c.totalDed), r2(c.net), st.bank || "", st.account || "", st.branch || "", e.note || ""]);
  });
  rows.push([]); rows.push(["", "TOTAL", ...Array(24).fill(""), r2(tot)]);
  rows.push([]); rows.push(["KEY"]); rows.push(["", "Ormonde hours", S.sites.O.hours]); rows.push(["", "Xavier hours", S.sites.X.hours]); rows.push(["", "Hourly rate", S.hourlyRate]); rows.push(["", "Working days in month", S.workingDays]);
  const ws = X.utils.aoa_to_sheet(rows);
  ws["!cols"] = head.map((h, j) => ({ wch: j === 1 ? 26 : j === 30 ? 30 : Math.max(9, h.length + 1) }));
  for (let rr = 4; rr < rows.length; rr++) for (let j = 20; j <= 26; j++) { const ref = X.utils.encode_cell({ r: rr, c: j }); if (ws[ref] && typeof ws[ref].v === "number") ws[ref].z = "#,##0.00"; }
  ws["!merges"] = [0, 1, 2].map(r => ({ s: { r, c: 0 }, e: { r, c: 8 } }));
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "Salaries " + MONTHS[+m.split("-")[1] - 1].slice(0, 3) + " " + m.slice(0, 4));
  X.writeFile(wb, `Cleaners salaries ${monthLabel(m)}.xlsx`);
}
$("#xlsx").addEventListener("click", () => exportExcel());

// ---------- staff (this session only) ----------
function nextEmpNo(name) {
  const nums = staff.map(s => parseInt((s.emp_no || "").replace(/\D/g, ""), 10)).filter(isFinite);
  if (!nums.length) return "";
  const n = String(Math.max(...nums) + 1).padStart(3, "0");
  const p = (name || "").trim().split(/\s+/).filter(Boolean);
  const ini = p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || "X"))).toUpperCase() : "XX";
  return "C" + ini + n;
}
function staffRow(s) {
  const missing = [!s.bank && "bank", !s.account && "account"].filter(Boolean);
  return `<button class="srow" data-edit="${s.id}"><div><div class="n">${esc(s.name)}${s.known_as ? ` <span class="muted">(${esc(s.known_as)})</span>` : ""}</div>
    <div class="m">${s.emp_no ? esc(s.emp_no) + " · " : ""}${esc(s.occupation || "")} · ${esc(settings.sites?.[s.site]?.name || s.site)} · ${esc(s.bank || "no bank")} ${esc(s.account || "")}</div>
    <div class="chips"><span class="chip">Since ${s.start_date ? fmtDate(s.start_date) : "?"}</span>${s.uif ? "" : `<span class="chip">no UIF</span>`}${missing.length ? `<span class="chip w">Missing: ${missing.join(", ")}</span>` : ""}</div></div>
    <div class="rate">${R(dayRateFor(s, settings))}<small>per day</small></div></button>`;
}
function renderStaff() {
  const q = ($("#staffSearch").value || "").toLowerCase();
  const list = staff.filter(s => !q || [s.name, s.known_as, s.emp_no].join(" ").toLowerCase().includes(q));
  $("#curCount").textContent = `(${staff.length})`;
  $("#staffList").innerHTML = list.length ? list.map(staffRow).join("") : `<div class="empty">${q ? "Nobody matches that search." : "No staff yet. Import the month's Excel sheet on the Pay month tab, or add someone here."}</div>`;
}
$("#staffSearch").addEventListener("input", renderStaff);
$("#view-staff").addEventListener("click", ev => { const b = ev.target.closest("[data-edit]"); if (b) openStaff(b.dataset.edit); });

let editing = null;
const SF = ["name","known_as","id_number","dob","phone","emp_no","occupation","start_date","day_rate_override","pb_pct","bank","account","branch","notes"];
function openStaff(id) {
  editing = id || null; const s = id ? staff.find(x => x.id === id) : { occupation: "Cleaner", uif: true, site: "" };
  $("#staffDlgTitle").textContent = id ? "Edit " + s.name : "New staff member";
  SF.forEach(k => { $("#f_" + k).value = (k === "start_date" && s[k] && s[k].length === 7) ? s[k] + "-01" : (s[k] ?? ""); });
  $("#f_uif").value = s.uif === false ? "no" : "yes";
  $("#siteRadios").innerHTML = Object.entries(settings.sites || {}).map(([k, v]) => `<label><input type="radio" name="site" value="${k}" ${s.site === k ? "checked" : ""}> ${esc(v.name)} · ${v.hours} h a day · ${R(num(settings.hourlyRate) * num(v.hours))} a day</label>`).join("");
  $("#empNoHint").textContent = !id && nextEmpNo("") ? "Suggested from their initials and the next free number" : "";
  if (!id) $("#f_emp_no").value = nextEmpNo("");
  $("#staffErr").hidden = true;
  $("#leaveArea").innerHTML = id ? `<div id="leftBox"><button type="button" class="danger" id="removeAsk">Remove from this month</button></div>` : "";
  $("#staffDlg").showModal();
  $("#f_name").focus();
}
$("#f_name").addEventListener("input", e => { if (!editing && /^C[A-Z]{0,2}\d{3}$/.test($("#f_emp_no").value)) $("#f_emp_no").value = nextEmpNo(e.target.value); });
$("#addStaff").addEventListener("click", () => openStaff(null));
$("#staffCancel").addEventListener("click", () => $("#staffDlg").close());
$("#leaveArea").addEventListener("click", ev => {
  const t = ev.target, s = staff.find(x => x.id === editing);
  if (t.id === "removeAsk") $("#leftBox").innerHTML = `<div class="confirm"><span>Take ${esc(s.name)} off this month's payslips? Your Excel sheet is not changed.</span><div class="bar"><button type="button" id="removeNo">Keep</button><button type="button" class="danger" id="removeYes">Remove</button></div></div>`;
  else if (t.id === "removeNo") openStaff(editing);
  else if (t.id === "removeYes") { staff = staff.filter(x => x.id !== editing); if (openRow === editing) openRow = null; $("#staffDlg").close(); toast("Removed from this month"); renderAll(); }
});
$("#staffForm").addEventListener("submit", ev => {
  ev.preventDefault();
  const v = k => $("#f_" + k).value.trim();
  const site = document.querySelector('input[name="site"]:checked')?.value || "";
  const errs = [];
  if (!v("name")) errs.push("their full name");
  if (!site) errs.push("which site they work at");
  if (!v("bank")) errs.push("the bank");
  if (!v("account")) errs.push("the account number");
  const dupe = v("emp_no") && staff.find(s => s.id !== editing && (s.emp_no || "").toLowerCase() === v("emp_no").toLowerCase());
  if (dupe) errs.push(`a different employee number (${v("emp_no")} belongs to ${dupe.name})`);
  if (errs.length) { $("#staffErr").hidden = false; $("#staffErr").textContent = "Please add " + errs.join(", ") + "."; return; }
  const row = { name: v("name"), known_as: v("known_as"), id_number: v("id_number"), dob: v("dob"), phone: v("phone"), emp_no: v("emp_no").toUpperCase(), occupation: v("occupation"), start_date: v("start_date"), site,
    day_rate_override: v("day_rate_override") ? num(v("day_rate_override")) : null, pb_pct: v("pb_pct") ? num(v("pb_pct")) : null, uif: $("#f_uif").value === "yes",
    bank: v("bank"), account: v("account").replace(/\s+/g, ""), branch: v("branch").replace(/\s+/g, ""), notes: v("notes") };
  if (editing) { const s = staff.find(x => x.id === editing); Object.assign(s, row); }
  else staff.push({ ...row, id: newId(), no: staff.length + 1, e: {} });
  $("#staffDlg").close(); toast(editing ? "Changes made" : row.name + " added"); renderAll();
});

// ---------- settings ----------
function fillSettings() {
  const s = settings;
  ["companyName","regNo","address","phone","hourlyRate","workingDays","uifPct","sundayFactor","otFactor"].forEach(k => $("#s_" + k).value = s[k] ?? "");
  $("#s_hoursO").value = s.sites?.O?.hours ?? ""; $("#s_hoursX").value = s.sites?.X?.hours ?? "";
  $("#s_deductLate").value = s.deductLate ? "yes" : "no";
}
$("#settingsForm").addEventListener("submit", ev => {
  ev.preventDefault(); const g = k => $("#s_" + k).value;
  settings = { ...settings, companyName: g("companyName").trim(), regNo: g("regNo").trim(), address: g("address").trim(), phone: g("phone").trim(),
    hourlyRate: num(g("hourlyRate")), workingDays: num(g("workingDays")), uifPct: num(g("uifPct")), sundayFactor: num(g("sundayFactor")), otFactor: num(g("otFactor")),
    deductLate: g("deductLate") === "yes", sites: { O: { name: "Ormonde", hours: num(g("hoursO")) }, X: { name: "Xavier", hours: num(g("hoursX")) } } };
  renderAll(); $("#settingsMsg").textContent = "Applied to this month's payslips.";
});

// ---------- tabs ----------
function showTab(t) { ["month","staff","settings"].forEach(n => { $("#tab-" + n).setAttribute("aria-selected", n === t); $("#view-" + n).hidden = n !== t; }); }
["month","staff","settings"].forEach(n => $("#tab-" + n).addEventListener("click", () => showTab(n)));

// ---------- login (a fingerprint of the one email + password; the password itself is not in this file) ----------
const LOGIN_HASH = "a4e91115377afc10286d29e12e2f6c39c407e1ffcbc6f617a332f06c470463ae";
async function sha256(text) { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function showApp() { $("#login").hidden = true; $("#app").hidden = false; }
$("#loginForm").addEventListener("submit", async ev => {
  ev.preventDefault(); $("#loginErr").hidden = true;
  const h = await sha256($("#loginEmail").value.trim().toLowerCase() + ":" + $("#loginPassword").value);
  if (h === LOGIN_HASH) { try { sessionStorage.setItem("lezmin_in", "1"); } catch {} $("#loginPassword").value = ""; showApp(); }
  else { $("#loginErr").hidden = false; $("#loginErr").textContent = "That email and password don't match. Check for typos and capital letters, then try again."; }
});
$("#signOut").addEventListener("click", () => { try { sessionStorage.removeItem("lezmin_in"); } catch {} staff = []; location.reload(); });

fillSettings(); renderAll();
let signedIn = false; try { signedIn = sessionStorage.getItem("lezmin_in") === "1"; } catch {}
if (signedIn) showApp(); else { $("#login").hidden = false; $("#loginEmail").focus(); }
})();
