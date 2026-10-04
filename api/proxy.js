// Vercel Serverless Function: EPUB indirme proxy'si (Gutenberg ve Internet Archive).
// Sadece izin verilen sitelere gider; tarayıcıdaki CORS engelini aşmak için vardır.
const { Readable } = require("stream");

const ALLOWED = [/(^|\.)gutenberg\.org$/i, /(^|\.)archive\.org$/i];
const okHost = (u) => u.protocol === "https:" && ALLOWED.some((re) => re.test(u.hostname));

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  let target;
  try {
    target = new URL(String(req.query.url || ""));
  } catch {
    return res.status(400).json({ error: "A valid url parameter is required." });
  }

  try {
    let r;
    // Yönlendirmeleri elle izle ve her adımda sunucu adını kontrol et.
    for (let hop = 0; hop < 5; hop++) {
      if (!okHost(target)) return res.status(403).json({ error: "Host not allowed." });
      r = await fetch(target, {
        redirect: "manual",
        headers: { "User-Agent": "PolyglotReader-Proxy/3.0" },
        signal: AbortSignal.timeout(20000),
      });
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) { target = new URL(loc, target); continue; }
      break;
    }
    if (r.status >= 300 && r.status < 400) return res.status(502).json({ error: "Too many redirects." });
    if (!r.ok) return res.status(r.status).json({ error: `Upstream returned ${r.status}` });

    res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "public, s-maxage=86400");
    res.status(200);
    Readable.fromWeb(r.body).pipe(res); // ham ikili veri olarak aktar, EPUB bozulmasın
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(502).json({ error: "Failed to fetch upstream." });
  }
};
