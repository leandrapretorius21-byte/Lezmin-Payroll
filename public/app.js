/* Lezmin Payroll — import the salary Excel sheet and turn each row into a payslip.
   NO CALCULATIONS: every amount on a payslip is copied exactly from the sheet.
   Nothing is stored: all data lives in this open page and is gone when it closes. */
(() => {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthLabel = m => { if (!m) return ""; const [y, mo] = m.split("-"); return MONTHS[+mo - 1] + " " + y; };
const prevMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return iso(d).slice(0, 7); };
const fmtDate = s => { if (!s) return ""; const m = String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/); if (!m) return String(s); return (m[3] ? +m[3] + " " : "") + MONTHS[+m[2] - 1].slice(0, 3) + " " + m[1]; };

// Read a number exactly as written in the sheet ("R 5 835,90", "5835.9", 5835.9 all work). Empty stays empty.
function toNum(v) {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim(); if (!s) return null;
  s = s.replace(/[R\s ]/gi, "");
  if (/^-?\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");   // 5835,90
  s = s.replace(/,/g, "");
  const n = parseFloat(s); return isFinite(n) && /^-?[\d.]+$/.test(s) ? n : null;
}
const fmtMoney = v => { const n = toNum(v); if (n === null) return String(v ?? ""); const neg = n < 0, [a, b] = Math.abs(n).toFixed(2).split("."); return (neg ? "-" : "") + a.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + "." + b; };
const fmtCount = v => { const n = toNum(v); return n === null ? String(v ?? "") : String(+n.toFixed(2)); };
const isBlank = v => v == null || String(v).trim() === "";
const isZeroOrBlank = v => isBlank(v) || toNum(v) === 0;

const DEFAULT_COMPANY = { companyName: "LEZMIN 2358 CC", address: "MO 1 Ormonde Shopping Centre, 18 Crownwood St, Ormonde, Johannesburg, 2091", regNo: "2003/014149/23", phone: "(011) 496 – 1916 / 2348 / 1702" };
const SITE_NAMES = { O: "Ormonde", X: "Xavier" };

// ---------- state (memory only, never saved) ----------
let company = { ...DEFAULT_COMPANY };
let cols = [];      // [{ key, label, kind }]  kind: name|known|emp|id|dob|occ|site|start|bank|account|branch|phone|earn|ded|count|net|totEarn|totDed|text
let people = [];    // [{ id, v: { key: value } }]
let month = prevMonth(), payDate = "", fileName = "", headerImg = null, seq = 0, cseq = 0;
const newId = () => "p" + (++seq);

// ---------- helpers ----------
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); }
function banner(msg, kind = "warn") { const b = $("#banner"); b.hidden = !msg; b.className = "notice " + kind; b.textContent = msg || ""; }
function downloadBlob(blob, filename) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, "").trim();
async function busy(btn, fn) { const t = btn.textContent; btn.disabled = true; btn.textContent = "Working…"; try { await fn(); } catch (err) { console.error(err); banner("Something went wrong: " + (err?.message || err), "bad"); } finally { btn.disabled = false; btn.textContent = t; } }
const colsOf = kind => cols.filter(c => c.kind === kind);
const colOf = kind => cols.find(c => c.kind === kind);
const val = (p, kind) => { const c = colOf(kind); return c ? p.v[c.key] : ""; };
const nameOf = p => String(val(p, "name") || "").trim() || "(no name)";
const netOf = p => val(p, "net");

// =====================================================================
// IMPORT — reads any salary sheet. The heading of each column decides
// where its value goes on the payslip. Nothing is worked out or changed.
// =====================================================================
const norm = s => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const letters = s => norm(s).replace(/[^a-z一-鿿]/g, "");
function classifyHeader(h) {
  const t = norm(h);
  if (!t) return null;
  if (/^(no\.?|nr\.?|#|部门编号|count)$/.test(t)) return "skip";
  if (/^(name|names|full name|employee name|employee|name and surname|name & surname|naam|staff|staff name|worker)$/.test(t)) return "name";
  if (/^(first name|firstname|name\(s\))$/.test(t)) return "first";
  if (/^(surname|last name|lastname)$/.test(t)) return "last";
  if (/known as|nickname/.test(t)) return "known";
  if (/^(emp\.? ?no\.?|employee ?(no\.?|number|code|nr)|emp ?(number|code)|staff ?(no\.?|number|code)|number|code|clock ?(no|number))$/.test(t)) return "emp";
  if (/^(id|i\.?d\.?( no\.?| number)?|id ?(no|number|nr)\.?|identity( number)?|passport( no\.?| number)?)$/.test(t)) return "id";
  if (/birth|^dob$/.test(t)) return "dob";
  if (/^(occupation|position|job( title)?|role|title)$/.test(t)) return "occ";
  if (/ormonde|xavier|^site$|^location$|^workplace$|^area$/.test(t)) return "site";
  if (/start/.test(t)) return "start";
  if (/^(bank|bank list|bank name|banck|bank details|banck details)$/.test(t)) return "bank";
  if (/account|acc ?no|acc\.? number/.test(t)) return "account";
  if (/branch/.test(t)) return "branch";
  if (/^(phone|cell|cellphone|cell no|contact( no)?|tel)$/.test(t)) return "phone";
  if (/^(notes?|comments?|remarks?)$/.test(t)) return "note";
  if (/money transfer|net ?pay|^nett?( pay| salary| amount| wage)?$|take ?home|amount (paid|to pay)|^to pay$|^transfer$|^payout$/.test(t)) return "net";
  if (/total deduction/.test(t)) return "totDed";
  if (/^(total|totals|total earnings|total payments|gross|gross (pay|salary|earnings)|total (salary|pay|income))$/.test(t)) return "totEarn";
  if (/%/.test(t)) return "text";
  return "number?";   // decided from the values below
}
const DED_WORDS = /uif|paye|tax|deduct|loan|advance|unpaid|absent|late|medical|pension|garnish|union|fine|shortage|damage|less|repay|owing/;
const MONEY_WORDS = /pay|salary|wage|amount|deduct|bonus|commission|allowance|uif|paye|tax|loan|advance|rand|\(r\)|^r$|fee|incentive/;
const COUNT_WORDS = /day|leave|absent|sunday|holiday|hour|hrs|minute|\bmin\b|\(min|late|ph\b|shift|times/;
function decideNumberKind(header, values) {
  const t = norm(header);
  const nums = values.map(toNum).filter(n => n !== null && n !== 0);
  const texts = values.filter(v => !isBlank(v) && toNum(v) === null);
  if (texts.length > nums.length) return "text";
  if (MONEY_WORDS.test(t)) return DED_WORDS.test(t) ? "ded" : "earn";
  if (/hour|hrs|minute|\bmin\b|\(min/.test(t)) return "count";
  if (COUNT_WORDS.test(t) && nums.every(n => Math.abs(n) <= 31 && Number.isInteger(n * 2))) return "count";
  if (!nums.length && COUNT_WORDS.test(t)) return "count";
  return DED_WORDS.test(t) ? "ded" : "earn";
}

function findHeaderRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 50); r++) {
    const kinds = (rows[r] || []).map(classifyHeader);
    if (kinds.includes("name") || (kinds.includes("first") && kinds.includes("last"))) return r;
  }
  return -1;
}
function splitKnownAs(raw) {
  const s = String(raw || "").trim(); let known = "";
  const m = s.match(/\(([^)]+)\)/); if (m) known = m[1].trim();
  const clean = s.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const title = t => t && t === t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : t;
  return { name: title(clean), known: known && known.length > 2 ? title(known) : "" };
}
const nameKey = s => splitKnownAs(s).name.toLowerCase().replace(/[^a-z]/g, "");
function parseDateish(v) {
  if (isBlank(v)) return "";
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^([A-Za-z]{3})[A-Za-z]*[.\s-]+(\d{4})$/);       // AUG.2023
  if (m) { const i = MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === m[1].toLowerCase()); if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, "0")}`; }
  return s;
}

// Read one tab into { cols, rows: [{ rowNo, key, v }] }
function readTab(rows, tabName) {
  const hr = findHeaderRow(rows); if (hr < 0) return null;
  const header = rows[hr] || [];
  const body = [];
  const nameIdx = header.findIndex(h => classifyHeader(h) === "name");
  const firstIdx = header.findIndex(h => classifyHeader(h) === "first"), lastIdx = header.findIndex(h => classifyHeader(h) === "last");
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const raw = nameIdx >= 0 ? row[nameIdx] : [row[firstIdx], row[lastIdx]].filter(x => !isBlank(x)).join(" ");
    const nm = String(raw ?? "").trim();
    if (!nm) continue;
    if (/^(total|totals|grand total|key|cleaner|cleaners)$/i.test(nm)) continue;
    if (toNum(nm) !== null) continue;
    body.push({ r, row, nm });
  }
  if (!body.length) return null;
  const out = [];
  let bankIdx = -1;
  header.forEach((h, j) => {
    let kind = classifyHeader(h);
    if (kind === "bank") bankIdx = j;
    if (kind === null) {   // headerless column: the two right after BANK are account and branch
      if (bankIdx >= 0 && j === bankIdx + 1 && !header.some(x => classifyHeader(x) === "account")) kind = "account";
      else if (bankIdx >= 0 && j === bankIdx + 2 && !header.some(x => classifyHeader(x) === "branch")) kind = "branch";
      else return;
    }
    if (kind === "skip" || kind === "first" || kind === "last") return;
    const values = body.map(b => b.row[j]);
    if (kind === "number?") kind = decideNumberKind(h, values);
    if (kind === "note") kind = "text";
    if (values.every(isBlank)) return;                  // nothing in this column
    if ((kind === "earn" || kind === "ded") && values.every(isZeroOrBlank)) return;   // all zero: leave off
    let label = String(h || ({ account: "Account", branch: "Branch code" })[kind] || "").replace(/\s+/g, " ").trim();
    if (label === label.toUpperCase() && /[A-Z]{4,}/.test(label)) label = label.toLowerCase().replace(/^./, c => c.toUpperCase()).replace(/\b(uif|paye|pb|ph|id|ot)\b/gi, w => w.toUpperCase());
    out.push({ j, label, kind, tab: tabName });
  });
  const noIdx = header.findIndex(h => classifyHeader(h) === "skip");
  const people = body.map(b => {
    const v = {};
    out.forEach(c => { let x = b.row[c.j]; if (c.kind === "start" || c.kind === "dob") x = parseDateish(x); v[c.label + "|" + c.kind] = x; });
    const sk = splitKnownAs(b.nm);
    return { rowNo: noIdx >= 0 ? toNum(b.row[noIdx]) : null, rawName: b.nm, name: sk.name, known: sk.known, key: nameKey(b.nm), v };
  });
  return { tab: tabName, cols: out.filter(c => c.kind !== "name"), people, hasNet: out.some(c => c.kind === "net") };
}

function similarLabel(a, b) {
  a = letters(a); b = letters(b); if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= 2;
}
function matchScore(a, b) {
  let s = 0;
  if (a.key && b.key) { if (a.key === b.key) s = 4; else if (a.key.includes(b.key) || b.key.includes(a.key)) s = 3; else if (a.key.slice(0, 5) === b.key.slice(0, 5)) s = 1; }
  const wa = splitKnownAs(a.rawName || a.name).name.toLowerCase().split(/\s+/).filter(w => w.length > 3), wb = splitKnownAs(b.rawName || b.name).name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (s < 3 && wa.some(w => wb.includes(w))) s = Math.max(s, 2);   // same surname or first name, e.g. "Winne Khumbuzile Ndlela" / "Winnie Ndlela"
  if (a.rowNo != null && a.rowNo === b.rowNo) s += 2;
  return s;
}

function readWorkbook(wb) {
  const X = window.XLSX;
  const tabs = wb.SheetNames.map(n => ({ n, rows: X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }) }));
  // Pay month and pay date, if the sheet says them anywhere
  let period = "", pay = "";
  tabs.forEach(({ rows }) => rows.slice(0, 60).forEach(row => row.forEach(c => {
    const s = String(c);
    const cn = s.match(/(\d{4})年(\d{1,2})月.*?(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (cn && !period) { period = `${cn[1]}-${cn[2].padStart(2, "0")}`; pay = `${cn[3]}-${cn[4].padStart(2, "0")}-${cn[5].padStart(2, "0")}`; }
    const en = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i);
    if (en && !period && /salar|pay|wage/i.test(s)) period = `${en[2]}-${String(MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === en[1].toLowerCase()) + 1).padStart(2, "0")}`;
  })));
  if (!period) { const m = String(wb.__fileName || "").match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(20\d{2})/i); if (m) period = `${m[2]}-${String(MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === m[1].toLowerCase()) + 1).padStart(2, "0")}`; }

  const read = tabs.map(t => readTab(t.rows, t.n)).filter(Boolean);
  if (!read.length) throw new Error("Couldn't find a list of people in this file. One of the tabs needs a heading row with a NAME column.");
  // The main tab is the one with a net pay / money transfer column, otherwise the one with the most columns
  read.sort((a, b) => (b.hasNet - a.hasNet) || (b.cols.length - a.cols.length));
  const main = read[0];

  // Columns: the main tab's, then any extra ones from other tabs that the main tab doesn't already have
  const allCols = [];
  const addCol = c => { if (!allCols.some(x => x.kind === c.kind && similarLabel(x.label, c.label))) allCols.push({ ...c, key: c.label + "|" + c.kind }); };
  main.cols.forEach(addCol);
  const ppl = main.people.map(p => ({ id: newId(), name: p.name, rawName: p.rawName, known: p.known, rowNo: p.rowNo, key: p.key, v: { ...p.v } }));
  const notes = [];
  read.slice(1).forEach(t => {
    const before = allCols.length; t.cols.forEach(addCol);
    const newCols = allCols.slice(before);
    if (!newCols.length) return;
    const used = new Set();
    ppl.forEach(p => {
      let best = null, bs = 0;
      t.people.forEach(q => { if (used.has(q)) return; const s = matchScore(p, q); if (s > bs) { bs = s; best = q; } });
      if (!best || bs < 3) return;
      used.add(best);
      newCols.forEach(c => { const src = Object.keys(best.v).find(k => k === c.label + "|" + c.kind) || Object.keys(best.v).find(k => k.endsWith("|" + c.kind) && similarLabel(k.split("|")[0], c.label)); if (src) p.v[c.key] = best.v[src]; });
      if (best.name.split(" ").length > p.name.split(" ").length) p.name = best.name;   // keep the fuller name
      if (!p.known && best.known) p.known = best.known;
    });
  });

  // Put name / known-as into fixed columns so they can be edited like everything else
  const result = [{ key: "name|name", label: "Name", kind: "name" }];
  if (!allCols.some(c => c.kind === "known") && ppl.some(p => p.known)) result.push({ key: "known|known", label: "Known as", kind: "known" });
  result.push(...allCols);
  ppl.forEach(p => { p.v["name|name"] = p.name; if (p.known && !p.v["known|known"]) p.v["known|known"] = p.known; });
  if (!result.some(c => c.kind === "net")) notes.push("No net pay column was found (for example NET PAY or MONEY TRANSFER), so the payslips have no net pay amount. Add that column to the sheet, or type it in per person.");
  return { cols: result, people: ppl.map(p => ({ id: p.id, v: p.v })), period, pay, notes };
}

async function importFile(file) {
  if (!file) return;
  if (!window.XLSX) { banner("The Excel reader didn't load. Check the internet connection and reload the page.", "bad"); return; }
  try {
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    wb.__fileName = file.name;
    const res = readWorkbook(wb);
    cols = res.cols; people = res.people; month = res.period || month; payDate = res.pay || ""; fileName = file.name; cseq = 0;
    banner(res.notes.join(" "), "warn");
    renderAll(); showTab("month");
    toast(`Imported ${people.length} people from ${file.name}`);
  } catch (err) { console.error(err); banner(err.message || "This file couldn't be read. Is it an Excel file (.xlsx)?", "bad"); }
}
$("#fileInput").addEventListener("change", ev => { importFile(ev.target.files[0]); ev.target.value = ""; });
document.querySelectorAll("[data-import]").forEach(b => b.addEventListener("click", () => $("#fileInput").click()));
document.addEventListener("dragover", ev => ev.preventDefault());
document.addEventListener("drop", ev => { ev.preventDefault(); if ($("#app").hidden) return; const f = ev.dataTransfer?.files?.[0]; if (f) importFile(f); });

// ---------- the list ----------
function renderAll() { renderMonth(); renderStaff(); }
function renderMonth() {
  const has = people.length > 0;
  $("#emptyState").hidden = has; $("#monthWork").hidden = !has;
  if (!has) return;
  $("#monthTitle").textContent = monthLabel(month) || "Payslips";
  $("#periodInput").value = month || ""; $("#payDate").value = payDate || "";
  $("#fileNote").textContent = fileName ? `From ${fileName}` : "Added by hand";
  $("#monthList").innerHTML = people.map(p => `<div class="row" data-id="${p.id}"><button class="rowhead">${rowHeadHTML(p)}</button></div>`).join("");
  renderTotals();
}
function rowHeadHTML(p) {
  const known = val(p, "known"), emp = val(p, "emp"), site = val(p, "site");
  const sub = [emp, site ? (SITE_NAMES[String(site).trim().toUpperCase()] || site) : ""].filter(x => !isBlank(x)).map(esc).join(" · ");
  const chips = colsOf("count").filter(c => !isZeroOrBlank(p.v[c.key])).map(c => `<span class="chip on">${esc(fmtCount(p.v[c.key]))} ${esc(c.label.toLowerCase())}</span>`);
  if (colOf("net") && isBlank(netOf(p))) chips.push(`<span class="chip bad">No net pay in sheet</span>`);
  if (colOf("bank") && isBlank(val(p, "account"))) chips.push(`<span class="chip w">No account number</span>`);
  const net = netOf(p);
  return `<div class="who"><div class="n">${esc(nameOf(p))}${known ? ` <span class="muted">(${esc(known)})</span>` : ""}</div>
    ${sub ? `<div class="m">${sub}</div>` : ""}<div class="chips">${chips.join("")}</div></div>
    <div class="money">${isBlank(net) ? "—" : "R " + esc(fmtMoney(net))}<small>net pay</small></div><span class="chev" aria-hidden="true">›</span>`;
}
function renderTotals() {
  const sum = kind => { const c = colOf(kind); if (!c) return null; return people.reduce((a, p) => a + (toNum(p.v[c.key]) || 0), 0); };
  const net = sum("net"), gross = sum("totEarn");
  $("#totals").innerHTML = `<div><small>Payslips</small><b>${people.length}</b></div>` + (gross !== null ? `<div><small>Total earnings (sheet)</small><b>R ${fmtMoney(gross)}</b></div>` : "") + (net !== null ? `<div class="net"><small>Total net pay (sheet)</small><b>R ${fmtMoney(net)}</b></div>` : "");
}
$("#monthList").addEventListener("click", ev => { const r = ev.target.closest(".row"); if (r) openPerson(r.dataset.id); });
$("#periodInput").addEventListener("change", ev => { month = ev.target.value; renderMonth(); });
$("#payDate").addEventListener("change", ev => { payDate = ev.target.value; });
$("#clearBtn").addEventListener("click", () => $("#clearDlg").showModal());
$("#clearYes").addEventListener("click", () => { people = []; cols = []; fileName = ""; payDate = ""; banner(""); $("#clearDlg").close(); renderAll(); toast("Cleared. Nothing was kept."); });
$("#clearNo").addEventListener("click", () => $("#clearDlg").close());
window.addEventListener("beforeunload", ev => { if (people.length) { ev.preventDefault(); ev.returnValue = ""; } });

// ---------- one person: check, fix, add (no fields are required) ----------
const GROUPS = [
  ["Details", ["name", "known", "emp", "id", "dob", "occ", "site", "start", "phone"]],
  ["Earnings", ["earn"]], ["Deductions", ["ded"]], ["Totals and net pay", ["totEarn", "totDed", "net"]],
  ["Days, leave and hours", ["count"]], ["Bank", ["bank", "account", "branch"]], ["Other", ["text"]],
];
const KIND_LABEL = { name: "Name", known: "Known as", emp: "Employee number", id: "ID number", dob: "Date of birth", occ: "Occupation", site: "Site", start: "Start date", phone: "Phone", bank: "Bank", account: "Account number", branch: "Branch code", net: "Net pay", totEarn: "Total earnings", totDed: "Total deductions" };
const DEFAULT_COLS = () => [["name", "Name"], ["emp", "Employee number"], ["site", "Site"], ["count", "Days worked"], ["earn", "Basic salary"], ["ded", "UIF"], ["net", "Net pay"], ["bank", "Bank"], ["account", "Account number"], ["branch", "Branch code"]].map(([kind, label]) => ({ key: label + "|" + kind, label, kind }));
let editing = null;
function ensureCol(kind) { let c = colOf(kind); if (!c) { c = { key: (KIND_LABEL[kind] || kind) + "|" + kind, label: KIND_LABEL[kind] || kind, kind }; cols.push(c); } return c; }
function openPerson(id) {
  if (!cols.length) cols = DEFAULT_COLS();
  ["name", "net", "bank", "account", "branch"].forEach(ensureCol);
  editing = id || null;
  const p = id ? people.find(x => x.id === id) : { v: {} };
  $("#personTitle").textContent = id ? nameOf(p) : "Add a staff member";
  $("#personFields").innerHTML = GROUPS.map(([g, kinds]) => {
    const list = cols.filter(c => kinds.includes(c.kind)); if (!list.length) return "";
    return `<h3 class="section">${g}</h3><div class="fgrid">${list.map(c => `<label class="f">${esc(c.label)}<input data-key="${esc(c.key)}" value="${esc(c.kind === "start" || c.kind === "dob" ? fmtDate(p.v[c.key]) : (p.v[c.key] ?? ""))}" ${["earn","ded","net","totEarn","totDed","count"].includes(c.kind) ? 'inputmode="decimal"' : ""}></label>`).join("")}</div>`;
  }).join("") + `<div class="bar"><input id="newColLabel" placeholder="Add another line, e.g. Bonus" style="max-width:240px"><select id="newColKind" style="max-width:180px"><option value="earn">Earning (R)</option><option value="ded">Deduction (R)</option><option value="count">Days / hours</option><option value="text">Other info</option></select><button type="button" id="newColAdd">Add line</button></div>`;
  $("#personActions").hidden = !id;
  $("#personDlg").showModal();
}
$("#personFields").addEventListener("click", ev => {
  if (ev.target.id !== "newColAdd") return;
  const label = $("#newColLabel").value.trim(); if (!label) return;
  const kind = $("#newColKind").value;
  // keep what's been typed so far
  const p = editing ? people.find(x => x.id === editing) : null;
  const typed = {}; document.querySelectorAll("#personFields input[data-key]").forEach(i => typed[i.dataset.key] = i.value);
  cols.push({ key: label + "|" + kind + "|" + (++cseq), label, kind });
  openPerson(editing);
  document.querySelectorAll("#personFields input[data-key]").forEach(i => { if (typed[i.dataset.key] !== undefined) i.value = typed[i.dataset.key]; });
  if (p) {} // values are saved on Save
});
$("#personCancel").addEventListener("click", () => $("#personDlg").close());
$("#personForm").addEventListener("submit", ev => {
  ev.preventDefault();
  const v = {}; document.querySelectorAll("#personFields input[data-key]").forEach(i => v[i.dataset.key] = i.value.trim());
  if (editing) Object.assign(people.find(x => x.id === editing).v, v);
  else people.push({ id: newId(), v });
  $("#personDlg").close(); toast(editing ? "Changes made" : "Added"); renderAll();
});
$("#personPrint").addEventListener("click", () => { if (editing) { $("#personForm").requestSubmit(); printSlips([editing]); } });
$("#personPdf").addEventListener("click", ev => { if (!editing) return; const id = editing; $("#personForm").requestSubmit(); busy(ev.currentTarget, async () => { const p = people.find(x => x.id === id); const doc = await buildPdf([p]); downloadBlob(doc.output("blob"), `${safeName(nameOf(p))} - ${monthLabel(month)}.pdf`); }); });
$("#personRemove").addEventListener("click", () => { if (!editing) return; people = people.filter(x => x.id !== editing); $("#personDlg").close(); toast("Removed from this batch"); renderAll(); });
$("#addStaff").addEventListener("click", () => openPerson(null));

// ---------- staff tab ----------
function renderStaff() {
  const q = ($("#staffSearch").value || "").toLowerCase();
  const list = people.filter(p => !q || Object.values(p.v).join(" ").toLowerCase().includes(q));
  $("#curCount").textContent = `(${people.length})`;
  $("#staffList").innerHTML = list.length ? list.map(p => {
    const info = ["emp", "site", "bank", "account"].map(k => val(p, k)).filter(x => !isBlank(x)).map(esc).join(" · ");
    return `<button class="srow" data-id="${p.id}"><div><div class="n">${esc(nameOf(p))}</div><div class="m">${info}</div></div><div class="rate">${isBlank(netOf(p)) ? "—" : "R " + esc(fmtMoney(netOf(p)))}<small>net pay</small></div></button>`;
  }).join("") : `<div class="empty">${q ? "Nobody matches that search." : "Nobody yet. Import the Excel sheet on the Pay month tab, or add someone here."}</div>`;
}
$("#staffSearch").addEventListener("input", renderStaff);
$("#staffList").addEventListener("click", ev => { const b = ev.target.closest("[data-id]"); if (b) openPerson(b.dataset.id); });

// ---------- payslip content (copied straight from the sheet) ----------
function slip(p) {
  const info = [["Employee", nameOf(p) + (val(p, "known") ? ` (${val(p, "known")})` : "")], ["Pay period", monthLabel(month) || "—"], ["Paid on", payDate ? fmtDate(payDate) : "—"]];
  ["emp", "site", "id", "start", "dob", "occ", "phone"].forEach(k => cols.filter(c => c.kind === k).forEach(c => {
    let x = p.v[c.key]; if (isBlank(x)) return;
    if (k === "site") x = SITE_NAMES[String(x).trim().toUpperCase()] || x;
    if (k === "start" || k === "dob") x = fmtDate(x);
    info.push([KIND_LABEL[k] === "Employee number" ? "Number" : (KIND_LABEL[k] || c.label), String(x)]);
  }));
  colsOf("text").forEach(c => { if (!isBlank(p.v[c.key]) && /%/.test(c.label)) info.push([c.label, String(p.v[c.key])]); });
  const lines = kind => colsOf(kind).map(c => [c.label, p.v[c.key]]).filter(([, x]) => !isBlank(x));
  const tot = kind => { const c = colOf(kind); return c && !isBlank(p.v[c.key]) ? p.v[c.key] : null; };
  const notes = colsOf("text").filter(c => !/%/.test(c.label) && !isBlank(p.v[c.key])).map(c => `${c.label}: ${p.v[c.key]}`);
  return {
    info, earn: lines("earn"), ded: lines("ded"), totEarn: tot("totEarn"), totDed: tot("totDed"),
    counts: colsOf("count").map(c => [c.label, p.v[c.key]]).filter(([, x]) => !isBlank(x)),
    bank: val(p, "bank"), account: val(p, "account"), branch: val(p, "branch"), net: netOf(p), notes,
  };
}

// ---------- printing ----------
function slipHTML(p) {
  const s = slip(p), C = company;
  const rows = Math.max(s.earn.length, s.ded.length, 1);
  const tr = ([l, x]) => `<tr class="${toNum(x) ? "" : "zero"}"><td>${esc(l)}</td><td class="r">${esc(fmtMoney(x))}</td></tr>`;
  const pad = n => Array.from({ length: Math.max(0, n) }, () => `<tr><td>&nbsp;</td><td></td></tr>`).join("");
  return `<div class="slip">
    <img class="banner" src="payslip-header.jpg" alt="Payslip — ${esc(C.companyName)}">
    <div class="co"><span>${esc(C.address)}</span><span>Reg. no ${esc(C.regNo)} · Tel ${esc(C.phone)}</span></div>
    <div class="info">${s.info.map(([k, x]) => `<div><small>${esc(k)}</small><b>${esc(x)}</b></div>`).join("")}</div>
    <div class="tables">
      <table><tr><th>Earnings</th><th class="r">Amount</th></tr>${s.earn.map(tr).join("")}${pad(rows - s.earn.length)}${s.totEarn !== null ? `<tr class="tot"><td>Total earnings</td><td class="r">${esc(fmtMoney(s.totEarn))}</td></tr>` : ""}</table>
      <table><tr><th>Deductions</th><th class="r">Amount</th></tr>${s.ded.map(tr).join("")}${pad(rows - s.ded.length)}${s.totDed !== null ? `<tr class="tot"><td>Total deductions</td><td class="r">${esc(fmtMoney(s.totDed))}</td></tr>` : ""}</table>
    </div>
    ${s.counts.length ? `<div><div class="cap">Days, leave and hours</div><div class="att">${s.counts.map(([k, x]) => `<div><small>${esc(k)}</small><b>${esc(fmtCount(x))}</b></div>`).join("")}</div></div>` : ""}
    <div class="foot">
      <div><div class="cap">Paid into</div>Bank: <b>${esc(s.bank) || "—"}</b><br>Account: <b>${esc(s.account) || "—"}</b><br>Branch code: <b>${esc(s.branch) || "—"}</b></div>
      <div class="net"><small>NET PAY</small><b>${isBlank(s.net) ? "—" : "R " + esc(fmtMoney(s.net))}</b></div>
    </div>
    ${s.notes.length ? `<p class="note">${s.notes.map(esc).join("<br>")}</p>` : ""}
    <div class="sigs"><div>Signature of employee</div><div class="d">Date</div><div>Signature of employer</div><div class="d">Date</div></div>
  </div>`;
}
function printSlips(ids) {
  const list = people.filter(p => !ids || ids.includes(p.id));
  if (!list.length) return;
  $("#printArea").innerHTML = list.map(p => `<div class="sheet">${slipHTML(p)}</div>`).join(""); // one person per A4 page
  const imgs = [...$("#printArea").querySelectorAll("img")];
  Promise.all(imgs.map(im => im.complete ? 0 : new Promise(res => { im.onload = im.onerror = res; }))).then(() => window.print());
}
window.addEventListener("afterprint", () => { $("#printArea").innerHTML = ""; });
$("#printAll").addEventListener("click", () => printSlips(null));

// ---------- PDF ----------
async function loadHeader() {
  if (headerImg) return headerImg;
  const blob = await (await fetch("payslip-header.jpg")).blob();
  headerImg = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  return headerImg;
}
function drawSlip(doc, p, img) {
  const s = slip(p), C = company;
  const L = 14, Rr = 196, W = Rr - L, bh = W * 173 / 1600, gold = [209, 177, 20], ink = [17, 17, 17];
  const fit = (t, w) => { t = String(t ?? ""); while (t.length > 1 && doc.getTextWidth(t) > w) t = t.slice(0, -1); return t; };
  doc.addImage(img, "JPEG", L, 12, W, bh, "header", "FAST");
  let y = 12 + bh + 7.5;
  doc.setTextColor(70); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  doc.text(C.address || "", L, y); doc.text(`Reg. no ${C.regNo || ""}   ·   Tel ${C.phone || ""}`, L, y + 4.5);
  y += 8.5; doc.setDrawColor(0); doc.setLineWidth(0.4); doc.line(L, y, Rr, y);
  // details, five per row (first one wider)
  const xs = [L, L + 60, L + 92, L + 124, L + 156], ws = [56, 30, 30, 30, 26];
  s.info.forEach(([k, x], i) => {
    const r = Math.floor(i / 5), c = i % 5, yy = y + 8 + r * 13;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(110); doc.text(fit(k.toUpperCase(), ws[c]), xs[c], yy);
    doc.setTextColor(0); doc.setFontSize(10.5); doc.setFont("helvetica", "bold"); doc.text(fit(x || "—", ws[c]), xs[c], yy + 5.5);
  });
  y += 8 + Math.ceil(s.info.length / 5) * 13 - 2; doc.setDrawColor(0); doc.setLineWidth(0.4); doc.line(L, y, Rr, y);
  // earnings and deductions
  const ty = y + 7, colW = W / 2 - 4, rowsN = Math.max(s.earn.length, s.ded.length, 1);
  const rowH = rowsN > 10 ? 5.8 : 7.2;
  const table = (x, title, rows, total, label) => {
    doc.setFillColor(...ink); doc.rect(x, ty, colW, 8, "F"); doc.setTextColor(255);
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text(title, x + 3, ty + 5.4); doc.text("AMOUNT", x + colW - 3, ty + 5.4, { align: "right" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(rowsN > 10 ? 9 : 10);
    let yy = ty + 8 + rowH - 2.2;
    rows.forEach(([l, v]) => {
      doc.setTextColor(toNum(v) ? 0 : 140);
      doc.text(fit(l, colW - 34), x + 3, yy); doc.text(fmtMoney(v), x + colW - 3, yy, { align: "right" });
      doc.setDrawColor(220); doc.setLineWidth(0.2); doc.line(x, yy + 2.2, x + colW, yy + 2.2); yy += rowH;
    });
    doc.setTextColor(0);
    let yt = ty + 8 + rowsN * rowH;
    if (total !== null) { doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(x, yt + 1, x + colW, yt + 1); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.text(label, x + 3, yt + 7.5); doc.text(fmtMoney(total), x + colW - 3, yt + 7.5, { align: "right" }); yt += 7.5; }
    return yt;
  };
  const e1 = table(L, "EARNINGS", s.earn, s.totEarn, "Total earnings");
  const e2 = table(L + colW + 8, "DEDUCTIONS", s.ded, s.totDed, "Total deductions");
  y = Math.max(e1, e2) + 11;
  // days, leave and hours
  if (s.counts.length) {
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0); doc.text("DAYS, LEAVE AND HOURS", L, y);
    const per = 7, rowsC = Math.ceil(s.counts.length / per), cw = W / Math.min(per, s.counts.length);
    y += 3; doc.setFillColor(244, 243, 238); doc.rect(L, y, W, rowsC * 17 + 2, "F");
    s.counts.forEach(([k, x], i) => {
      const r = Math.floor(i / per), c = i % per, cx = L + cw * c + cw / 2, yy = y + r * 17;
      doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(110); doc.text(fit(k.toUpperCase(), cw - 2), cx, yy + 6.5, { align: "center" });
      doc.setFont("helvetica", "bold"); doc.setFontSize(12.5); doc.setTextColor(0); doc.text(fmtCount(x), cx, yy + 14, { align: "center" });
    });
    y += rowsC * 17 + 2 + 12;
  } else y += 4;
  // bank and net pay
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0); doc.text("PAID INTO", L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(11);
  doc.text(fit(`Bank: ${s.bank || "—"}`, 90), L, y + 8); doc.text(fit(`Account: ${s.account || "—"}`, 90), L, y + 14.5); doc.text(fit(`Branch code: ${s.branch || "—"}`, 90), L, y + 21);
  const nw = 84, nh = 28, nx = Rr - nw, ny = y - 4;
  doc.setFillColor(...ink); doc.rect(nx, ny, nw, nh, "F"); doc.setFillColor(...gold); doc.rect(nx, ny, 3.5, nh, "F");
  doc.setTextColor(...gold); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text("NET PAY", Rr - 5, ny + 8, { align: "right" });
  doc.setTextColor(255); doc.setFontSize(22); doc.text(isBlank(s.net) ? "—" : "R " + fmtMoney(s.net), Rr - 5, ny + 21, { align: "right" }); doc.setTextColor(0);
  y += 32;
  if (s.notes.length) { doc.setFont("helvetica", "italic"); doc.setFontSize(9.5); doc.setTextColor(70); s.notes.slice(0, 4).forEach((n, i) => doc.text(fit(n, W), L, y + i * 5)); doc.setTextColor(0); y += s.notes.length * 5; }
  const sy = Math.min(Math.max(268, y + 14), 288); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setDrawColor(0); doc.setLineWidth(0.3);
  [[L, "Signature of employee"], [L + 58, "Date"], [Rr - 82, "Signature of employer"], [Rr - 24, "Date"]].forEach(([x, t], i) => { const w = i % 2 ? 24 : 52; doc.line(x, sy, x + w, sy); doc.text(t, x, sy + 4.5); });
}
async function buildPdf(list) {
  const img = await loadHeader();
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  list.forEach((p, i) => { if (i) doc.addPage(); drawSlip(doc, p, img); });
  return doc;
}
$("#pdfAll").addEventListener("click", ev => busy(ev.currentTarget, async () => { const doc = await buildPdf(people); downloadBlob(doc.output("blob"), `Payslips ${monthLabel(month) || ""}.pdf`.replace(" .pdf", ".pdf")); }));
$("#zipAll").addEventListener("click", ev => busy(ev.currentTarget, async () => {
  const zip = new window.JSZip(), used = new Set();
  for (const p of people) {
    let n = `${safeName(nameOf(p))} - ${monthLabel(month)}`; while (used.has(n)) n += " (2)"; used.add(n);
    zip.file(n + ".pdf", (await buildPdf([p])).output("arraybuffer"));
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `Payslips ${monthLabel(month)} (each person).zip`);
}));

// ---------- Excel export (exactly what's on the page, including fixes) ----------
$("#xlsx").addEventListener("click", () => {
  const X = window.XLSX;
  const rows = [cols.map(c => c.label), ...people.map(p => cols.map(c => p.v[c.key] ?? ""))];
  const ws = X.utils.aoa_to_sheet(rows);
  ws["!cols"] = cols.map(c => ({ wch: Math.max(10, c.label.length + 2, c.kind === "name" ? 26 : 0) }));
  const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, ws, "Salaries");
  X.writeFile(wb, `Salaries ${monthLabel(month) || ""}.xlsx`.replace(" .xlsx", ".xlsx"));
});

// ---------- settings (company details only) ----------
function fillSettings() { ["companyName", "regNo", "address", "phone"].forEach(k => $("#s_" + k).value = company[k] ?? ""); }
$("#settingsForm").addEventListener("submit", ev => {
  ev.preventDefault(); ["companyName", "regNo", "address", "phone"].forEach(k => company[k] = $("#s_" + k).value.trim());
  $("#settingsMsg").textContent = "Applied to the payslips.";
});

// ---------- tabs ----------
function showTab(t) { ["month", "staff", "settings"].forEach(n => { $("#tab-" + n).setAttribute("aria-selected", n === t); $("#view-" + n).hidden = n !== t; }); }
["month", "staff", "settings"].forEach(n => $("#tab-" + n).addEventListener("click", () => showTab(n)));

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
$("#signOut").addEventListener("click", () => { try { sessionStorage.removeItem("lezmin_in"); } catch {} people = []; location.reload(); });

fillSettings(); renderAll();
let signedIn = false; try { signedIn = sessionStorage.getItem("lezmin_in") === "1"; } catch {}
if (signedIn) showApp(); else { $("#login").hidden = false; $("#loginEmail").focus(); }
})();
