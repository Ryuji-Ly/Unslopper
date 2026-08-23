/**
 * lib/http.js — shared fetch-with-retry helper.
 *
 * Used both for fetching novel chapter pages and for calling the Gemini
 * API, since both need the same backoff behavior: patient long waits for
 * 503 ("overloaded") and 429 ("rate limited"), fail-fast on 404 (retrying
 * a real not-found never helps), normal short backoff for anything else.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, { retries = 3, timeoutMs = 60000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        const err = new Error(`HTTP ${res.status}: ${bodyText}`);
        err.status = res.status;
        throw err;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      console.warn(`  attempt ${attempt}/${retries} failed for ${url}: ${err.message}`);

      // A genuine 404 never resolves itself by waiting — fail immediately
      // instead of burning through the retry budget.
      if (err.status === 404) throw err;

      if (attempt === retries) throw err;

      const needsLongBackoff = err.status === 503 || err.status === 429;
      const base = needsLongBackoff ? 15000 : 2000;
      const backoff = base * attempt + Math.floor(Math.random() * 1000);
      console.warn(`  waiting ${(backoff / 1000).toFixed(1)}s before retry...`);
      await sleep(backoff);
    }
  }
}

module.exports = { sleep, fetchWithRetry };