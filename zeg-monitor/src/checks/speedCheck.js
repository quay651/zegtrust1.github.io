/**
 * Pulls Core Web Vitals + performance score from Google's free PageSpeed
 * Insights API for each monitored page (mobile strategy, since that's
 * what most students will use).
 *
 * Returns { ok: boolean, pages: [{path, score, lcp, cls, ok, detail}] }
 */
const THRESHOLDS = {
  performanceScore: 70, // out of 100
  lcpMs: 2500, // Largest Contentful Paint target
  clsScore: 0.1, // Cumulative Layout Shift target
};

export async function runSpeedCheck(env) {
  const pages = env.MONITORED_PAGES.split(",").map((p) => p.trim());
  const baseUrl = env.SITE_BASE_URL.replace(/\/$/, "");
  const results = [];

  for (const path of pages) {
    const url = baseUrl + path;
    try {
      const apiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
      apiUrl.searchParams.set("url", url);
      apiUrl.searchParams.set("strategy", "mobile");
      apiUrl.searchParams.set("category", "performance");
      if (env.PAGESPEED_API_KEY) apiUrl.searchParams.set("key", env.PAGESPEED_API_KEY);

      const res = await fetch(apiUrl.toString());
      if (!res.ok) throw new Error(`PageSpeed API returned ${res.status}`);
      const data = await res.json();

      const perfScore = Math.round((data.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
      const lcpMs = data.lighthouseResult?.audits?.["largest-contentful-paint"]?.numericValue ?? null;
      const cls = data.lighthouseResult?.audits?.["cumulative-layout-shift"]?.numericValue ?? null;

      const ok =
        perfScore >= THRESHOLDS.performanceScore &&
        (lcpMs === null || lcpMs <= THRESHOLDS.lcpMs) &&
        (cls === null || cls <= THRESHOLDS.clsScore);

      results.push({
        path,
        score: perfScore,
        lcpMs: lcpMs ? Math.round(lcpMs) : null,
        cls: cls ?? null,
        ok,
        detail: ok
          ? "within target"
          : `below target (score=${perfScore}, LCP=${lcpMs ? Math.round(lcpMs) + "ms" : "n/a"}, CLS=${cls ?? "n/a"})`,
      });
    } catch (err) {
      results.push({ path, score: null, lcpMs: null, cls: null, ok: false, detail: `check failed: ${err.message}` });
    }
  }

  return { ok: results.every((r) => r.ok), pages: results };
}
