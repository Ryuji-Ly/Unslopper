/**
 * content.js
 *
 * Runs on pages matched in manifest.json's content_scripts. For the
 * current chapter page: asks the background script whether a pre-rewritten
 * version exists locally (via output/index.json), and if so, swaps the
 * on-page paragraph text for it. If nothing's found — site not supported,
 * novel never batch-processed, or this specific chapter not done yet — it
 * does nothing and leaves the page exactly as it was.
 */

(async function main() {
  const url = location.href;
  const parser = findParser(url);
  if (!parser) return; // shouldn't happen given manifest matches, but safe

  const novelSlug = parser.getNovelSlug(url);
  const chapterSlug = parser.getChapterSlug(url);
  if (!novelSlug || !chapterSlug) {
    console.log('Novel De-slopper: could not determine novel/chapter from URL, skipping.');
    return;
  }

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: 'CHECK_CHAPTER',
      siteId: parser.id,
      novelSlug,
      chapterSlug,
    });
  } catch (e) {
    console.log('Novel De-slopper: background script unreachable —', e.message);
    return;
  }

  if (!response || !response.exists) {
    console.log(
      `Novel De-slopper: no local rewrite found for ${novelSlug} chapter-${chapterSlug} ` +
      `(reason: ${response?.reason || 'unknown'}) — leaving page as-is.`
    );
    return;
  }

  const { paragraphs } = parseMarkdownChapter(response.markdown);
  const pElements = parser.getParagraphElements(document);

  if (pElements.length !== paragraphs.length) {
    console.warn(
      `Novel De-slopper: paragraph count mismatch (page has ${pElements.length}, ` +
      `rewrite has ${paragraphs.length}) — leaving page as-is.`
    );
    return;
  }

  pElements.forEach((el, i) => {
    el.textContent = paragraphs[i];
  });

  console.log(
    `Novel De-slopper: replaced ${paragraphs.length} paragraphs for ` +
    `${novelSlug} chapter-${chapterSlug}.`
  );
  markAsDeslopped();
})();

function parseMarkdownChapter(markdown) {
  const lines = markdown.split('\n');
  let title = '';
  let bodyStart = 0;
  if (lines[0] && lines[0].startsWith('# ')) {
    title = lines[0].slice(2).trim();
    bodyStart = 1;
  }
  const body = lines.slice(bodyStart).join('\n').trim();
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return { title, paragraphs };
}

function markAsDeslopped() {
  // Small, unobtrusive confirmation that the swap happened. Safe to delete
  // this function (and its call above) if you'd rather it be silent.
  const badge = document.createElement('div');
  badge.textContent = 'De-slopped \u2713';
  badge.style.cssText =
    'position:fixed;bottom:12px;right:12px;background:#222;color:#eee;' +
    'font:12px sans-serif;padding:4px 8px;border-radius:4px;opacity:0.85;' +
    'z-index:999999;pointer-events:none;';
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 4000);
}