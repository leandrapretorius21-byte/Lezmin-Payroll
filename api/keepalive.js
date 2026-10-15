// Called once a day by Vercel (see "crons" in vercel.json).
// Free Supabase projects go to sleep when nobody uses them for a while,
// and payroll is only used once a month, so this small daily visit keeps it awake.
// Needs SUPABASE_URL and SUPABASE_ANON_KEY in Vercel > Settings > Environment Variables.
module.exports = async function handler(req, res) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return res.status(200).json({ ok: false, reason: "SUPABASE_URL / SUPABASE_ANON_KEY not set in Vercel" });
  try {
    const r = await fetch(`${url}/rest/v1/settings?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    return res.status(200).json({ ok: true, status: r.status });
  } catch (e) {
    return res.status(200).json({ ok: false, reason: String(e) });
  }
}
