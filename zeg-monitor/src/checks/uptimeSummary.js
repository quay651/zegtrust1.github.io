/**
 * Optional: pulls current monitor statuses from UptimeRobot's API so the
 * daily digest can show uptime alongside the other checks in one place.
 * If no UPTIMEROBOT_API_KEY is set, this is skipped entirely (UptimeRobot's
 * own alerting still works independently — this is just for the combined report).
 *
 * Returns null if skipped, otherwise { ok, monitors: [{name, status, ok}] }
 */
export async function runUptimeSummary(env) {
  if (!env.UPTIMEROBOT_API_KEY) return null;

  try {
    const res = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        api_key: env.UPTIMEROBOT_API_KEY,
        format: "json",
      }),
    });
    const data = await res.json();
    const monitors = (data.monitors || []).map((m) => ({
      name: m.friendly_name,
      status: statusLabel(m.status),
      ok: m.status === 2, // 2 = up in UptimeRobot's status codes
    }));
    return { ok: monitors.every((m) => m.ok), monitors };
  } catch (err) {
    return { ok: false, monitors: [], error: err.message };
  }
}

function statusLabel(code) {
  const map = { 0: "paused", 1: "not checked yet", 2: "up", 8: "seems down", 9: "down" };
  return map[code] || `unknown (${code})`;
}
