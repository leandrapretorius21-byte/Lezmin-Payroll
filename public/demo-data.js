// Made-up staff used only in demo mode (when config.js is empty).
// Real staff live in your Supabase database, never in this file.
window.DEMO_DATA = {
  settings: {
    companyName: "LEZMIN 2358 CC",
    address: "MO 1 Ormonde Shopping Centre, 18 Crownwood St, Ormonde, Johannesburg, 2091",
    regNo: "2003/014149/23",
    phone: "(011) 496 – 1916 / 2348 / 1702",
    hourlyRate: 30.23, workingDays: 26, uifPct: 1, sundayFactor: 0.5, otFactor: 1.5, deductLate: false,
    sites: { O: { name: "Ormonde", hours: 7.5 }, X: { name: "Xavier", hours: 7 } }
  },
  staff: [
    { id: "d1", emp_no: "CAM001", name: "Example Person One", known_as: "Amo", occupation: "Cleaner", site: "O", start_date: "2021-03-01", uif: true,  pb_pct: 90, bank: "Capitec", account: "0000000001", branch: "470010", status: "active", sort_order: 1 },
    { id: "d2", emp_no: "CBK002", name: "Example Person Two", known_as: "",    occupation: "Cleaner", site: "X", start_date: "2019-07-01", uif: true,  pb_pct: 80, bank: "FNB",     account: "0000000002", branch: "250655", status: "active", sort_order: 2 },
    { id: "d3", emp_no: "CTN003", name: "Example Person Three", known_as: "", occupation: "Cleaner/Gardener", site: "X", start_date: "2016-10-01", uif: false, pb_pct: 90, bank: "Mukuru", account: "0000000003", branch: "410506", status: "active", sort_order: 3 },
    { id: "d4", emp_no: "CLM004", name: "Example Person Four", known_as: "", occupation: "Cleaner", site: "O", start_date: "2026-01-01", uif: true,  pb_pct: 90, bank: "Nedbank", account: "0000000004", branch: "", status: "active", sort_order: 4 }
  ],
  runs: {
    current: { month: "current", period: "2026-09", pay_date: "2026-10-02", entries: {
      d1: { sundays: 2, ph: 1, lateMin: 15 },
      d2: { unpaid: 1 },
      d4: { annual: 1, sundays: 3, otHours: 4.5 }
    } }
  }
};
