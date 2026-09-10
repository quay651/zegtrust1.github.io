import { createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";

const STATE_PATH = new URL("../../state/page-hashes.json", import.meta.url);

/**
 * Fetches each monitored page, hashes a normalized version of the HTML
 * (whitespace-collapsed, so unrelated whitespace changes don't false-alarm),
 * and compares against the last known-good hash committed in the repo.
 *
 * First run for any page just records a baseline (nothing to compare against).
 * A changed hash means the page content changed since the last run — could be
 * a legitimate content update OR unauthorized defacement, so it's flagged for
 * human review rather than auto-resolved.
 *
 * Returns { ok: boolean, pages: [{path, changed, ok}] }
 */
export async function runDefacementCheck(env) {
  const pages = env.MONITORED_PAGES.split(",").map((p) => p.trim());
  const baseUrl = env.SITE_BASE_URL.replace(/\/$/, "");

  let previousHashes = {};
  try {
    previousHashes = JSON.parse(await readFile(STATE_PATH, "utf-8"));
  } catch {
    previousHashes = {}; // no state file yet — first run
  }

  const newHashes = {};
  const results = [];

  for (const path of pages) {
    try {
      const res = await fetch(baseUrl + path, { redirect: "follow" });
      const html = await res.text();
      const normalized = html.replace(/\s+/g, " ").trim();
      const hash = createHash("sha256").update(normalized).digest("hex");
      newHashes[path] = hash;

      const previous = previousHashes[path];
      const isFirstRun = !previous;
      const changed = !isFirstRun && previous !== hash;

      results.push({
        path,
        changed,
        ok: !changed, // a change is flagged, not auto-failed — human reviews it
        detail: isFirstRun
          ? "baseline recorded"
          : changed
          ? "content hash differs from last known-good — review for unauthorized changes"
          : "unchanged",
      });
    } catch (err) {
      results.push({ path, changed: false, ok: false, detail: `fetch failed: ${err.message}` });
      // Keep previous hash on fetch failure so a transient network blip
      // doesn't wipe the baseline.
      if (previousHashes[path]) newHashes[path] = previousHashes[path];
    }
  }

  await writeFile(STATE_PATH, JSON.stringify(newHashes, null, 2));

  return { ok: results.every((r) => r.ok), pages: results };
}
