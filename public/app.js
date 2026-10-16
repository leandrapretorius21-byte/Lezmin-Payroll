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
let deptFilter = "", keyInfo = { hourlyRate: null, siteHours: {}, workingDays: null };
const deptOf = p => String(p.v["dept|dept"] ?? val(p, "dept") ?? "").trim();
const shown = () => people.filter(p => !deptFilter || deptOf(p) === deptFilter);
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
const letters = s => norm(s).replace(/[^a-z0-9一-鿿]/g, "");
function classifyHeader(h) {
  const t = norm(h);
  if (!t) return null;
  if (/^(no\.?|nr\.?|#|部门编号|count|item)$/.test(t)) return "skip";
  if (/^(name|names|full name|employee name|employee|employees|name and surname|name & surname|names and surnames|naam|staff|staff name|worker|worker name)$/.test(t)) return "name";
  if (/^(first name|firstname|first names|name\(s\))$/.test(t)) return "first";
  if (/^(surname|last name|lastname)$/.test(t)) return "last";
  if (/known as|nickname/.test(t)) return "known";
  if (/^(emp\.? ?no\.?|employee ?(no\.?|number|code|nr)|emp ?(number|code)|staff ?(no\.?|number|code)|number|code|clock ?(no|number))$/.test(t)) return "emp";
  if (/^(id|i\.?d\.?( no\.?| number)?|id ?(no|number|nr)\.?|identity( number)?|passport( no\.?| number)?)$/.test(t)) return "id";
  if (/birth|^dob$/.test(t)) return "dob";
  if (/^(occupation|position|job( title)?|role|title)$/.test(t)) return "occ";
  if (/^(department|dept|section|division)$/.test(t)) return "dept";
  if (/ormonde|xavier|^site$|^location$|^workplace$|^area$/.test(t)) return "site";
  if (/start/.test(t)) return "start";
  if (/^(bank|bank list|bank name|banck|bank details|banck details)$/.test(t)) return "bank";
  if (/account|acc ?no|acc\.? number/.test(t)) return "account";
  if (/branch/.test(t)) return "branch";
  if (/^(phone|cell|cellphone|cell no|contact( no)?|tel)$/.test(t)) return "phone";
  if (/^(notes?|comments?|remarks?|reason)$/.test(t)) return "note";
  if (/money transfer|net ?pay|^nett?( pay| salary| amount| wage)?$|take ?home|amount (paid|to pay)|^to pay$|^transfer$|^payout$/.test(t)) return "net";
  if (/total deduction/.test(t)) return "totDed";
  if (/^(total|totals|total earnings|total payments|gross|gross (pay|salary|earnings)|total (salary|pay|income))$/.test(t)) return "totEarn";
  if (/%/.test(t)) return "text";
  return "number?";   // decided from the values below
}
const DED_WORDS = /uif|paye|tax|deduct|loan|advance|unpaid|absent|late|medical|pension|garnish|union|fine|shortage|damage|less|repay|owing/;
const MONEY_WORDS = /pay|salary|wage|amount|deduct|bonus|commission|allowance|uif|paye|tax|loan|advance|rand|\(r\)|^r$|fee|incentive/;
const COUNT_WORDS = /day|leave|absent|sunday|holiday|hour|hrs|minute|\bmin\b|\(min|late|ph\b|shift|times|overtime|\bot\b/;
function decideNumberKind(header, values) {
  const t = norm(header);
  const nums = values.map(toNum).filter(n => n !== null && n !== 0);
  const texts = values.filter(v => !isBlank(v) && toNum(v) === null);
  if (texts.length > nums.length) return "text";
  if (MONEY_WORDS.test(t)) return DED_WORDS.test(t) ? "ded" : "earn";
  if (/hour|hrs|minute|\bmin\b|\(min/.test(t)) return "count";
  if (COUNT_WORDS.test(t) && nums.every(n => Math.abs(n) <= 60 && Number.isInteger(n * 2))) return "count";
  if (!nums.length && COUNT_WORDS.test(t)) return "count";
  return DED_WORDS.test(t) ? "ded" : "earn";
}
const tidyCase = s => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s && s === s.toUpperCase() && /[A-Z]{3,}/.test(s) && !/\d/.test(s) ? s.toLowerCase().replace(/(^|[\s\-(/])\S/g, c => c.toUpperCase()) : s; };
// "R30.23   MAINTENANCE DEPARTMENT" -> "Maintenance Department"
const cleanSection = s => tidyCase(String(s).replace(/^\s*(r\s?)?[\d.,]+\s+/i, ""));

function findHeaderRow(rows) {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const kinds = (rows[r] || []).map(classifyHeader);
    if (kinds.includes("name") || (kinds.includes("first") && kinds.includes("last"))) return r;
  }
  return -1;
}
function splitKnownAs(raw) {
  const s = String(raw || "").trim(); let known = "";
  const m = s.match(/\(([^)]+)\)/); if (m) known = m[1].trim();
  const clean = s.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  return { name: tidyCase(clean), known: known && known.length > 2 ? tidyCase(known) : "" };
}
const nameKey = s => splitKnownAs(s).name.toLowerCase().replace(/[^a-z]/g, "");
function parseDateish(v) {
  if (isBlank(v)) return "";
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^([A-Za-z]{3})[A-Za-z]*[.,\s-]+(\d{4})$/);       // AUG.2023, APR,2026
  if (m) { const i = MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === m[1].toLowerCase()); if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, "0")}`; }
  return s;
}

// Read one tab: every column, every person row, and the section (department) each person sits under.
function readTab(rows, tabName) {
  const hr = findHeaderRow(rows); if (hr < 0) return null;
  const header = rows[hr] || [];
  const nameIdx = header.findIndex(h => classifyHeader(h) === "name");
  const firstIdx = header.findIndex(h => classifyHeader(h) === "first"), lastIdx = header.findIndex(h => classifyHeader(h) === "last");
  const leftMost = nameIdx >= 0 ? nameIdx : Math.min(...[firstIdx, lastIdx].filter(i => i >= 0));
  // a title just above the headings (e.g. "SECURITY DEPARTMENT") is the default section; otherwise the tab name
  let title = "";
  for (let r = hr - 1; r >= 0 && !title; r--) { const cells = (rows[r] || []).filter(c => !isBlank(c)); if (cells.length === 1 && toNum(cells[0]) === null) title = String(cells[0]); }
  let section = title && !/\d/.test(title) ? cleanSection(title) : tidyCase(tabName);
  const body = [], keyRows = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const filled = row.map((c, j) => [c, j]).filter(([c]) => !isBlank(c));
    if (!filled.length) continue;
    if (filled.some(([c]) => /^key$/i.test(String(c).trim()))) {                 // the rates/key box at the bottom: read it, then stop
      rows.slice(r + 1).forEach(kr => { const cells = (kr || []).filter(c => !isBlank(c)); const num = cells.map(toNum).find(n => n !== null), txt = cells.filter(c => toNum(c) === null).map(String);
        if (num != null && txt.length) keyRows.push({ code: txt.find(t => /^[A-Z]$/.test(t.trim())) || "", label: txt.filter(t => !/^[A-Z]$/.test(t.trim())).join(" "), value: num }); });
      break;
    }
    const raw = nameIdx >= 0 ? row[nameIdx] : [row[firstIdx], row[lastIdx]].filter(x => !isBlank(x)).join(" ");
    const nm = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!nm || toNum(nm) !== null) {
      // a row with only one piece of text is a section heading, e.g. OFFICE STAFF or WESSEL ROAD
      if (filled.length === 1 && toNum(filled[0][0]) === null && !/total/i.test(filled[0][0])) section = cleanSection(filled[0][0]);
      continue;
    }
    if (/^(total|totals|grand total|sub ?total)$/i.test(nm)) continue;
    if (classifyHeader(nm) === "name") continue;                                  // a repeated heading row
    if (filled.length === 1 && filled[0][1] === nameIdx && /^[A-Z0-9 &'.-]+$/.test(nm) && rows.slice(r + 1).some(x => !isBlank(x?.[nameIdx]))) {
      // a section heading typed in the name column (all capitals, nothing else on the row)
      const after = rows[r + 1] || []; if (isBlank(after[nameIdx]) || after.filter(c => !isBlank(c)).length > 1) { section = cleanSection(nm); continue; }
    }
    body.push({ r, row, nm, section });
  }
  if (!body.length) return null;
  const out = [];
  let bankIdx = -1;
  const width = Math.max(header.length, ...body.map(b => b.row.length));
  for (let j = 0; j < width; j++) {
    const h = header[j];
    let kind = classifyHeader(h);
    if (kind === "bank") bankIdx = j;
    const values = body.map(b => b.row[j]);
    if (values.every(isBlank)) continue;                                           // nothing in this column
    let label = tidyCase(h).replace(/\b(uif|paye|pb|ph|id|ot)\b/gi, w => w.toUpperCase());
    if (kind === null) {                                                            // a column with no heading but with data in it
      if (j < leftMost) continue;                                                   // running numbers in front of the names
      if (bankIdx >= 0 && j === bankIdx + 1 && !header.some(x => classifyHeader(x) === "account")) { kind = "account"; label = "Account"; }
      else if (bankIdx >= 0 && j === bankIdx + 2 && !header.some(x => classifyHeader(x) === "branch")) { kind = "branch"; label = "Branch code"; }
      else {
        const nums = values.map(toNum).filter(n => n !== null && n !== 0), texts = values.filter(v => !isBlank(v) && toNum(v) === null);
        if (texts.length >= nums.length) { kind = "text"; label = "Note"; }
        else if (nums.every(n => n < 0)) { kind = "ded"; label = "Deductions"; }
        else { kind = "earn"; label = "Other amount"; }
      }
    }
    if (kind === "skip" || kind === "first" || kind === "last" || kind === "name") continue;
    if (kind === "number?") kind = decideNumberKind(h, values);
    if (kind === "note") kind = "text";
    if ((kind === "earn" || kind === "ded") && values.every(isZeroOrBlank)) continue;   // all zero: leave off
    out.push({ j, label: label || "Other", kind });
  }
  const noIdx = header.findIndex((h, j) => classifyHeader(h) === "skip" && j < leftMost + 1);
  const people = body.map(b => {
    const sk = splitKnownAs(b.nm), vals = {};
    out.forEach((c, i) => { let x = b.row[c.j]; if (c.kind === "start" || c.kind === "dob") x = parseDateish(x); if (typeof x === "string") x = x.trim(); vals[i] = x; });
    return { rowNo: noIdx >= 0 ? toNum(b.row[noIdx]) : null, rawName: b.nm, name: sk.name, known: sk.known, key: nameKey(b.nm), section: b.section, vals };
  });
  return { tab: tabName, keyRows, cols: out, people, hasNet: out.some(c => c.kind === "net") };
}

function similarLabel(a, b) {
  a = letters(a); b = letters(b); if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= 2;
}
const words = s => splitKnownAs(s).name.toLowerCase().split(/[\s-]+/).map(w => w.replace(/[^a-z]/g, "")).filter(w => w.length > 3);
const SECTION_FILLER = /^(department|departments|dept|staff|section|division|team|workers|employees|road|street|site)$/;
function sameSection(a, b) {
  const sw = s => norm(s).split(/[^a-z]+/).filter(w => w.length > 3 && !SECTION_FILLER.test(w));
  const wa = sw(a), wb = sw(b);
  return wa.some(x => wb.some(y => x === y || x.startsWith(y) || y.startsWith(x)));
}
// How sure are we that two rows (on different tabs) are the same person?
function matchScore(p, q) {
  let n = 0;
  const keys = [p.key, ...(p.altKeys || [])];
  if (keys.includes(q.key)) n = 4;
  else if (keys.some(k => k && q.key && (k.includes(q.key) || q.key.includes(k)) && Math.min(k.length, q.key.length) >= 4)) n = 3;
  else if ((p.words || []).some(w => words(q.rawName).includes(w))) n = 2;
  else if (keys.some(k => k && q.key && k.slice(0, 5) === q.key.slice(0, 5) && q.key.length >= 5)) n = 1;
  if (q.known && (p.words || []).includes(q.known.toLowerCase())) n = Math.max(n, 3);
  const row = p.rowNos.some(x => x != null && x === q.rowNo), sec = p.sections.some(s => sameSection(s, q.section));
  const score = n + (row ? 2 : 0) + (sec ? 2 : 0);
  return (n >= 3 || (n >= 1 && (row || sec)) || (row && sec)) && score >= 4 ? score : 0;
}

function readWorkbook(wb) {
  const X = window.XLSX;
  const tabs = wb.SheetNames.map(n => ({ n, rows: X.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: "" }) }));
  // Pay month and pay date, if the sheet says them anywhere
  let period = "", pay = "";
  const mIdx = s => MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === s.slice(0, 3).toLowerCase()) + 1;
  tabs.forEach(({ rows }) => rows.slice(0, 60).forEach(row => row.forEach(c => {
    const s = String(c);
    const cn = s.match(/(\d{4})年(\d{1,2})月.*?(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (cn && !pay) { if (!period) period = `${cn[1]}-${cn[2].padStart(2, "0")}`; pay = `${cn[3]}-${cn[4].padStart(2, "0")}-${cn[5].padStart(2, "0")}`; }
    const en = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/i);
    if (en && !period && /salar|pay|wage/i.test(s)) period = `${en[2]}-${String(mIdx(en[1])).padStart(2, "0")}`;
  })));
  if (!period) { const m = String(wb.__fileName || "").match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(20\d{2})/i); if (m) period = `${m[2]}-${String(mIdx(m[1])).padStart(2, "0")}`; }

  const read = tabs.map(t => readTab(t.rows, t.n)).filter(Boolean);
  if (!read.length) throw new Error("Couldn't find a list of people in this file. One of the tabs needs a heading row with a NAME column.");

  // 1. One shared list of columns. Same kind + similar heading on different tabs = the same column.
  const allCols = [];
  read.forEach(t => {
    const taken = new Set();
    t.map = t.cols.map(c => {
      let g = allCols.find(x => x.kind === c.kind && similarLabel(x.label, c.label) && !taken.has(x.key));
      if (!g) { g = { key: c.label + "|" + c.kind + "|" + allCols.length, label: c.label, kind: c.kind }; allCols.push(g); }
      taken.add(g.key); return g.key;
    });
  });

  // 2. One list of people. Every row on every tab becomes a payslip; rows on different tabs for the same person are joined.
  const ppl = [];
  read.forEach((t, ti) => {
    const pri = t.hasNet ? 1 : 0;   // when two tabs disagree, the tab with the net pay column wins
    const free = ppl.filter(p => !p.tabs.has(ti));
    const pairs = [];
    t.people.forEach(q => free.forEach(p => { const s = matchScore(p, q); if (s) pairs.push([s, p, q]); }));
    pairs.sort((a, b) => b[0] - a[0]);
    const usedP = new Set(), usedQ = new Set(), matched = new Map();
    pairs.forEach(([, p, q]) => { if (usedP.has(p) || usedQ.has(q)) return; usedP.add(p); usedQ.add(q); matched.set(q, p); });
    t.people.forEach(q => {
      let p = matched.get(q);
      if (!p) { p = { id: newId(), name: q.name, known: q.known, key: q.key, altKeys: [], words: [], rowNos: [], sections: [], section: q.section, tabs: new Set(), cand: {} }; ppl.push(p); }
      p.tabs.add(ti); p.rowNos.push(q.rowNo); p.sections.push(q.section);
      p.altKeys.push(q.key); p.words.push(...words(q.rawName)); if (q.known) p.words.push(q.known.toLowerCase());
      if (q.name.split(" ").length > p.name.split(" ").length) p.name = q.name;   // keep the fuller name
      if (!p.known && q.known) p.known = q.known;
      if (p.known && p.name.toLowerCase().split(" ").includes(p.known.toLowerCase())) p.known = "";
      t.cols.forEach((c, i) => { const k = t.map[i], x = q.vals[i]; if (isBlank(x)) return; (p.cand[k] = p.cand[k] || []).push({ x, pri }); });
    });
  });

  // 3. Each person's value for each column: copied as written. If two tabs both have a (non-zero) value, the net-pay tab's wins.
  const people = ppl.map(p => {
    const v = { "name|name": p.name };
    if (p.known) v["known|known"] = p.known;
    if (p.section) v["dept|dept"] = p.section;
    Object.entries(p.cand).forEach(([k, list]) => {
      const nz = list.filter(c => !isZeroOrBlank(c.x)).sort((a, b) => b.pri - a.pri);
      v[k] = (nz[0] || list[0]).x;
    });
    return { id: p.id, v };
  });

  const result = [{ key: "name|name", label: "Name", kind: "name" }];
  if (!allCols.some(c => c.kind === "known") && people.some(p => p.v["known|known"])) result.push({ key: "known|known", label: "Known as", kind: "known" });
  if (!allCols.some(c => c.kind === "dept") && new Set(people.map(p => p.v["dept|dept"])).size > 1) result.push({ key: "dept|dept", label: "Department", kind: "dept" });
  result.push(...allCols.filter(c => people.some(p => !isBlank(p.v[c.key]))));
  const notes = [];
  if (!result.some(c => c.kind === "net")) notes.push("No net pay column was found (for example NET PAY or MONEY TRANSFER), so the payslips have no net pay amount. Add that column to the sheet, or type it in per person.");
  else { const n = people.filter(p => isBlank(p.v[result.find(c => c.kind === "net").key])).length; if (n) notes.push(`${n} ${n === 1 ? "person has" : "people have"} no net pay in the sheet. Their payslips show "—" until you type it in.`); }
  // The KEY box(es): hourly rate, hours per site, working days in the month (only used for "One day pay" and "Rate" on the payslip)
  const key = { hourlyRate: null, siteHours: {}, workingDays: null };
  read.forEach(t => t.keyRows.forEach(k => { const l = norm(k.label);
    if (/hour\w*ly rate|hourtly rate|rate per hour/.test(l)) key.hourlyRate = key.hourlyRate ?? k.value;
    else if (/working days|days in (the )?month/.test(l)) key.workingDays = key.workingDays ?? k.value;
    else if (k.code && /hour/.test(l)) key.siteHours[k.code] = k.value; }));
  return { cols: result, people, period, pay, notes, key, tabs: read.map(t => t.tab) };
}

async function importFile(file) {
  if (!file) return;
  if (!window.XLSX) { banner("The Excel reader didn't load. Check the internet connection and reload the page.", "bad"); return; }
  try {
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    wb.__fileName = file.name;
    const res = readWorkbook(wb);
    cols = res.cols; people = res.people; keyInfo = res.key || keyInfo; month = res.period || month; payDate = res.pay || ""; fileName = file.name; cseq = 0;
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
  const depts = [...new Set(people.map(deptOf).filter(Boolean))];
  if (deptFilter && !depts.includes(deptFilter)) deptFilter = "";
  $("#deptWrap").hidden = depts.length < 2;
  $("#deptFilter").innerHTML = `<option value="">All departments (${people.length})</option>` + depts.map(d => `<option value="${esc(d)}" ${d === deptFilter ? "selected" : ""}>${esc(d)} (${people.filter(p => deptOf(p) === d).length})</option>`).join("");
  let last = null;
  $("#monthList").innerHTML = shown().map(p => { const d = deptOf(p); const head = depts.length > 1 && d !== last ? `<h3 class="grouphead">${esc(d || "Other")}</h3>` : ""; last = d; return head + `<div class="row" data-id="${p.id}"><button class="rowhead">${rowHeadHTML(p)}</button></div>`; }).join("");
  const n = shown().length, lbl = deptFilter ? ` (${n})` : "";
  $("#printAll").textContent = (deptFilter ? "Print " + deptFilter : "Print all payslips") + lbl;
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
  const sum = kind => { const c = colOf(kind); if (!c) return null; return shown().reduce((a, p) => a + (toNum(p.v[c.key]) || 0), 0); };
  const net = sum("net"), gross = sum("totEarn");
  $("#totals").innerHTML = `<div><small>Payslips</small><b>${shown().length}</b></div>` + (gross !== null ? `<div><small>Total earnings (sheet)</small><b>R ${fmtMoney(gross)}</b></div>` : "") + (net !== null ? `<div class="net"><small>Total net pay (sheet)</small><b>R ${fmtMoney(net)}</b></div>` : "");
}
$("#monthList").addEventListener("click", ev => { const r = ev.target.closest(".row"); if (r) openPerson(r.dataset.id); });
$("#deptFilter").addEventListener("change", ev => { deptFilter = ev.target.value; renderMonth(); });
$("#periodInput").addEventListener("change", ev => { month = ev.target.value; renderMonth(); });
$("#payDate").addEventListener("change", ev => { payDate = ev.target.value; });
$("#clearBtn").addEventListener("click", () => $("#clearDlg").showModal());
$("#clearYes").addEventListener("click", () => { people = []; cols = []; fileName = ""; payDate = ""; deptFilter = ""; banner(""); $("#clearDlg").close(); renderAll(); toast("Cleared. Nothing was kept."); });
$("#clearNo").addEventListener("click", () => $("#clearDlg").close());
window.addEventListener("beforeunload", ev => { if (people.length) { ev.preventDefault(); ev.returnValue = ""; } });

// ---------- one person: check, fix, add (no fields are required) ----------
const GROUPS = [
  ["Details", ["name", "known", "emp", "dept", "id", "dob", "occ", "site", "start", "phone"]],
  ["Earnings", ["earn"]], ["Deductions", ["ded"]], ["Totals and net pay", ["totEarn", "totDed", "net"]],
  ["Days, leave and hours", ["count"]], ["Bank", ["bank", "account", "branch"]], ["Other", ["text"]],
];
const KIND_LABEL = { dept: "Department", name: "Name", known: "Known as", emp: "Employee number", id: "ID number", dob: "Date of birth", occ: "Occupation", site: "Site", start: "Start date", phone: "Phone", bank: "Bank", account: "Account number", branch: "Branch code", net: "Net pay", totEarn: "Total earnings", totDed: "Total deductions" };
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

// The payslip, in the Lezmin format. Only these boxes and rows are filled; anything else in the sheet is left off.
const EARN_ROWS = [
  ["Basic Salary",    /basic|salary/,              null],
  ["Sunday Overtime", /sunday/,                    /sunday/],
  ["Overtime Pay",    /overtime|^ot\b|o\/t/,       /overtime|^ot\b|o\/t/],
  ["Extra Day",       /extra/,                     /extra/],
  ["Public Holidays", /public|holiday|^ph\b/,      /public|holiday|^ph\b/],
];
const DED_ROWS = [
  ["UIF",               /uif/,                                  null],
  ["PAYE",              /paye|tax/,                             null],
  ["Others Deductions", /^(other|others)?\s*deductions?$|other.*deduct|loan|advance|fine|damage|shortage/, null],
  ["Unpaid Leave",      /unpaid/,                               /unpaid/],
  ["Absent Leave",      /absent/,                               /absent/],
  ["Late",              /late/,                                 /late|minute/],
];
// How many days of each kind this month (shown only, nothing is worked out from these)
const LEAVE_BOXES = [["Days worked", /days? worked|worked days/], ["Annual leave", /annual/], ["Sick leave", /sick/], ["Family resp. leave", /family/], ["Unpaid leave", /unpaid/], ["Absent days", /absent/], ["Public holidays", /public|holiday/]];
const money = x => { const n = toNum(x); return n === null ? null : Math.abs(n); };
function slip(p) {
  const used = new Set();
  const take = (kinds, re) => { const c = cols.find(c => kinds.includes(c.kind) && !used.has(c.key) && re.test(norm(c.label)) && !isBlank(p.v[c.key])); if (!c) return null; used.add(c.key); return p.v[c.key]; };
  const qty = re => { const c = cols.find(c => c.kind === "count" && re.test(norm(c.label)) && !isBlank(p.v[c.key])); return c ? toNum(p.v[c.key]) : null; };
  // One day pay: a "day rate" column if the sheet has one, otherwise hours for their site x hourly rate from the KEY box
  let dayRate = take(["earn", "text", "count"], /day ?rate|one day|daily|per day/);
  if (dayRate == null) { const site = String(val(p, "site") || "").trim().toUpperCase(); const h = keyInfo.siteHours[site]; if (h != null && keyInfo.hourlyRate != null) dayRate = Math.round(h * keyInfo.hourlyRate * 100) / 100; }
  const earn = EARN_ROWS.map(([label, re, qre], i) => { const amt = money(take(["earn"], re)); return { label, day: i === 0 ? toNum(dayRate) : null, qty: i === 0 ? keyInfo.workingDays : (qre ? qty(qre) : null), amt }; });
  const ded = DED_ROWS.map(([label, re, qre]) => ({ label, qty: qre ? qty(qre) : null, amt: money(take(["ded"], re)) }));
  // Any other amounts in the sheet (e.g. Performance Bonus, Commission, Loan) go on the empty lines, so the slip adds up
  cols.filter(c => c.kind === "earn" && !used.has(c.key) && !isZeroOrBlank(p.v[c.key])).forEach(c => { used.add(c.key); earn.push({ label: c.label, day: null, qty: null, amt: money(p.v[c.key]) }); });
  cols.filter(c => c.kind === "ded" && !used.has(c.key) && !isZeroOrBlank(p.v[c.key])).forEach(c => { used.add(c.key); ded.push({ label: c.label, qty: null, amt: money(p.v[c.key]) }); });
  const sum = list => Math.round(list.reduce((a, r) => a + (r.amt || 0), 0) * 100) / 100;
  const totPay = sum(earn), totDed = sum(ded);
  const netSheet = netOf(p);
  const occ = val(p, "occ") || deptOf(p);
  return {
    name: nameOf(p) + (val(p, "known") ? ` (${val(p, "known")})` : ""), number: val(p, "emp") || "",
    id: val(p, "id") || "", start: fmtDate(val(p, "start")), dob: fmtDate(val(p, "dob")),
    occ: occ || "", period: monthLabel(month) || "", tip: "Monthly", payDate: payDate ? fmtDate(payDate) : "",
    earn, ded, totPay, totDed, net: isBlank(netSheet) ? Math.round((totPay - totDed) * 100) / 100 : toNum(netSheet) ?? netSheet,
    leave: LEAVE_BOXES.map(([label, re]) => [label, qty(re) || 0]),
    bank: val(p, "bank") || "", account: val(p, "account") || "", branch: val(p, "branch") || "",
  };
}
const R$ = n => n == null || n === 0 ? "-" : "R " + fmtMoney(n);
const qtyTxt = n => n == null || n === 0 ? "" : fmtCount(n);

// ---------- printing ----------
function slipHTML(p) {
  const s = slip(p), C = company;
  const pad = (list, n, cells) => list.concat(Array.from({ length: Math.max(0, n - list.length) }, () => null)).map(r => r ? cells(r) : `<tr class="blank">${"<td>&nbsp;</td>".repeat(cells({}).match(/<td/g).length)}</tr>`).join("");
  const box = (label, value, cls = "") => `<div class="box ${cls}"><small>${esc(label)}</small><b>${esc(value) || "&nbsp;"}</b></div>`;
  return `<div class="slip fmt">
    <img class="banner" src="payslip-header.jpg" alt="Payslip — ${esc(C.companyName)}">
    <div class="co"><b>${esc(C.companyName)}</b><span>Address : ${esc(C.address)}</span><span>Registration number : ${esc(C.regNo)} · Phone : ${esc(C.phone)}</span></div>
    <div class="boxes">
      ${box("Employee", s.name, "w2")}${box("Number", s.number)}
      ${box("I.D. No.", s.id)}${box("Start work date", s.start)}${box("Date of Birth", s.dob)}
      ${box("Occupation", s.occ)}${box("Pay data", s.period)}${box("Tip", s.tip)}
    </div>
    <table class="ft"><tr><th>Earnings</th><th class="r">One day pay</th><th class="r">Rate</th><th class="r">Total</th></tr>
      ${pad(s.earn, 7, r => `<tr><td>${esc(r.label ?? "")}</td><td class="r">${r.day ? "R " + fmtMoney(r.day) : ""}</td><td class="r">${qtyTxt(r.qty)}</td><td class="r">${r.label ? R$(r.amt) : ""}</td></tr>`)}
      <tr class="tot"><td></td><td></td><td class="r">Total Payments</td><td class="r">${"R " + fmtMoney(s.totPay)}</td></tr></table>
    <table class="ft"><tr><th>Deductions</th><th class="r"></th><th class="r">Rate</th><th class="r">Total</th></tr>
      ${pad(s.ded, 6, r => `<tr><td>${esc(r.label ?? "")}</td><td></td><td class="r">${qtyTxt(r.qty)}</td><td class="r">${r.label ? R$(r.amt) : ""}</td></tr>`)}
      <tr class="tot"><td></td><td></td><td class="r">Total Deductions</td><td class="r">${"R " + fmtMoney(s.totDed)}</td></tr></table>
    <div><div class="cap">Leave this month (days)</div><div class="att">${s.leave.map(([k, n]) => `<div><small>${esc(k)}</small><b>${fmtCount(n)}</b></div>`).join("")}</div></div>
    <div class="foot">
      <div>Bank Details : <b>${esc(s.bank)}</b><br>Bank Account : <b>${esc(s.account)}</b><br>Branch Code : <b>${esc(s.branch)}</b></div>
      <div class="net"><small>NET PAY</small><b>${typeof s.net === "number" ? "R " + fmtMoney(s.net) : esc(s.net)}</b></div>
    </div>
    <div class="sigs"><div>Signature of Employee</div><div class="d">Date</div><div>Signature of Employer</div><div class="d">Date</div></div>
  </div>`;
}
function printSlips(ids) {
  const list = (ids ? people : shown()).filter(p => !ids || ids.includes(p.id));
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
  const shrink = (t, w, size, min = 7) => { doc.setFontSize(size); while (size > min && doc.getTextWidth(String(t)) > w) doc.setFontSize(size -= 0.5); return fit(t, w); };
  doc.addImage(img, "JPEG", L, 10, W, bh, "header", "FAST");
  let y = 10 + bh + 6;
  doc.setTextColor(0); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.text(C.companyName || "", L, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(70);
  doc.text(fit(`Address : ${C.address || ""}`, W), L, y + 4.5); doc.text(fit(`Registration number : ${C.regNo || ""}   ·   Phone : ${C.phone || ""}`, W), L, y + 8.5);
  y += 13;
  // the boxes: Employee | Number ; ID | Start | DOB ; Occupation | Pay data | Tip
  const g = 4, w3 = (W - 2 * g) / 3, bhx = 12;
  const box = (x, yy, w, label, value) => {
    doc.setDrawColor(150); doc.setLineWidth(0.3); doc.roundedRect(x, yy, w, bhx, 1.2, 1.2);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(110); doc.text(label.toUpperCase(), x + 2.5, yy + 4);
    doc.setFont("helvetica", "bold"); doc.setTextColor(0); doc.text(shrink(value || "", w - 5, 10.5), x + 2.5, yy + 9.5);
  };
  box(L, y, w3 * 2 + g, "Employee", s.name); box(L + 2 * (w3 + g), y, w3, "Number", s.number); y += bhx + 3;
  box(L, y, w3, "I.D. No.", s.id); box(L + w3 + g, y, w3, "Start work date", s.start); box(L + 2 * (w3 + g), y, w3, "Date of Birth", s.dob); y += bhx + 3;
  box(L, y, w3, "Occupation", s.occ); box(L + w3 + g, y, w3, "Pay data", s.period); box(L + 2 * (w3 + g), y, w3, "Tip", s.tip); y += bhx + 6;
  // tables
  const cx = [L + 3, Rr - 70, Rr - 38, Rr - 3];   // label, one day pay (right), rate (right), total (right)
  const table = (title, heads, rows, minRows, totalLabel, total) => {
    doc.setFillColor(...ink); doc.rect(L, y, W, 7.5, "F"); doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text(title, cx[0], y + 5); heads.forEach((h, i) => h && doc.text(h, cx[i + 1], y + 5, { align: "right" }));
    const n = Math.max(rows.length, minRows), rh = n > 10 ? 5.6 : 6.4;
    let yy = y + 7.5;
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      if (i % 2) { doc.setFillColor(246, 246, 243); doc.rect(L, yy, W, rh, "F"); }
      if (r) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(0);
        doc.text(fit(r.label, 95), cx[0], yy + rh - 1.8);
        if (r.day) doc.text("R " + fmtMoney(r.day), cx[1], yy + rh - 1.8, { align: "right" });
        if (qtyTxt(r.qty)) doc.text(qtyTxt(r.qty), cx[2], yy + rh - 1.8, { align: "right" });
        doc.setTextColor(r.amt ? 0 : 150); doc.text(R$(r.amt), cx[3], yy + rh - 1.8, { align: "right" }); doc.setTextColor(0);
      }
      yy += rh;
    }
    doc.setDrawColor(0); doc.setLineWidth(0.4); doc.line(L, yy, Rr, yy);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(totalLabel, cx[2], yy + 6, { align: "right" }); doc.text("R " + fmtMoney(total), cx[3], yy + 6, { align: "right" });
    y = yy + 12;
  };
  table("EARNINGS", ["ONE DAY PAY", "RATE", "TOTAL"], s.earn, 7, "Total Payments", s.totPay);
  table("DEDUCTIONS", ["", "RATE", "TOTAL"], s.ded, 6, "Total Deductions", s.totDed);
  // leave this month: number of days of each kind
  y += 4;
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(0); doc.text("LEAVE THIS MONTH (DAYS)", L, y - 2);
  const cw = W / s.leave.length; doc.setFillColor(244, 243, 238); doc.rect(L, y, W, 13, "F");
  s.leave.forEach(([k, n], i) => { const x = L + cw * i + cw / 2;
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(110); doc.text(fit(k.toUpperCase(), cw - 2), x, y + 4.5, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(n ? 0 : 160); doc.text(fmtCount(n), x, y + 10.5, { align: "center" }); });
  doc.setTextColor(0); y += 19;
  // bank details and net pay
  y += 2;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(0);
  doc.text(fit(`Bank Details : ${s.bank}`, 95), L, y + 4); doc.text(fit(`Bank Account : ${s.account}`, 95), L, y + 10.5); doc.text(fit(`Branch Code : ${s.branch}`, 95), L, y + 17);
  const nw = 80, nh = 22, nx = Rr - nw;
  doc.setFillColor(...ink); doc.rect(nx, y - 2, nw, nh, "F"); doc.setFillColor(...gold); doc.rect(nx, y - 2, 3.5, nh, "F");
  doc.setTextColor(...gold); doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.text("NET PAY", Rr - 5, y + 4.5, { align: "right" });
  doc.setTextColor(255); doc.setFontSize(19); doc.text(typeof s.net === "number" ? "R " + fmtMoney(s.net) : String(s.net), Rr - 5, y + 15, { align: "right" }); doc.setTextColor(0);
  const sy = Math.min(Math.max(274, y + 34), 288); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setDrawColor(0); doc.setLineWidth(0.3);
  [[L, "Signature of Employee"], [L + 58, "Date"], [Rr - 82, "Signature of Employer"], [Rr - 24, "Date"]].forEach(([x, t], i) => { const w = i % 2 ? 24 : 52; doc.line(x, sy, x + w, sy); doc.text(t, x, sy + 4.5); });
}
async function buildPdf(list) {
  const img = await loadHeader();
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  list.forEach((p, i) => { if (i) doc.addPage(); drawSlip(doc, p, img); });
  return doc;
}
$("#pdfAll").addEventListener("click", ev => busy(ev.currentTarget, async () => { const doc = await buildPdf(shown()); downloadBlob(doc.output("blob"), `Payslips ${deptFilter ? deptFilter + " " : ""}${monthLabel(month) || ""}.pdf`.replace(" .pdf", ".pdf")); }));
$("#zipAll").addEventListener("click", ev => busy(ev.currentTarget, async () => {
  const zip = new window.JSZip(), used = new Set();
  for (const p of shown()) {
    let n = `${safeName(nameOf(p))} - ${monthLabel(month)}`; while (used.has(n)) n += " (2)"; used.add(n);
    zip.file(n + ".pdf", (await buildPdf([p])).output("arraybuffer"));
  }
  downloadBlob(await zip.generateAsync({ type: "blob" }), `Payslips ${deptFilter ? deptFilter + " " : ""}${monthLabel(month)} (each person).zip`);
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
