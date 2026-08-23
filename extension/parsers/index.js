/**
 * extension/parsers/index.js
 *
 * Finds the right parser (from window.NovelDeslopParsers, populated by the
 * individual parser files listed before this one in manifest.json's
 * content_scripts) for the current page's URL.
 *
 * To support a new site: copy parsers/novelphoenix.js, adjust it for the
 * new site's markup/URLs, then add both its filename and its URL match
 * pattern to manifest.json's content_scripts entry. No changes needed
 * here — parsers self-register via the push() in their own file.
 */

function findParser(url) {
  return (window.NovelDeslopParsers || []).find((p) => p.matches(url)) || null;
}