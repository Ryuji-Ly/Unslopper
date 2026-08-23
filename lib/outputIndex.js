/**
 * lib/outputIndex.js
 *
 * Maintains output/index.json — a small lookup table of what's already
 * been rewritten, shaped like:
 *
 *   { "novelphoenix.com": { "the-guardian-gods": ["500", "501", "502"] } }
 *
 * This exists so the browser extension can answer "has this chapter
 * already been rewritten?" with one small fetch instead of trying to list
 * a local directory from a content script (browsers don't support that
 * cleanly for file:// URLs).
 */

const fs = require('fs');
const path = require('path');

function indexPathFor(outputBaseDir) {
  return path.join(outputBaseDir, 'index.json');
}

function loadIndex(outputBaseDir) {
  const p = indexPathFor(outputBaseDir);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {}; // corrupt/empty file — treat as fresh rather than crash the run
  }
}

function addChapterToIndex(outputBaseDir, siteId, novelSlug, chapterSlug) {
  const index = loadIndex(outputBaseDir);
  index[siteId] = index[siteId] || {};
  index[siteId][novelSlug] = index[siteId][novelSlug] || [];
  if (!index[siteId][novelSlug].includes(chapterSlug)) {
    index[siteId][novelSlug].push(chapterSlug);
  }
  fs.writeFileSync(indexPathFor(outputBaseDir), JSON.stringify(index, null, 2), 'utf8');
}

module.exports = { loadIndex, addChapterToIndex };