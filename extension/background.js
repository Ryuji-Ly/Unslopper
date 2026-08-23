/**
 * background.js
 *
 * Reads from the local output/ folder (a file:// URL you set via the
 * popup). This lives in the background service worker rather than the
 * content script because file:// fetches need the "Allow access to file
 * URLs" permission granted to the extension as a whole — centralizing it
 * here keeps that concern in one place.
 *
 * Requires: chrome://extensions -> this extension -> "Allow access to
 * file URLs" toggled on. That's a manual step, nothing in the manifest
 * can turn it on automatically.
 */

async function getOutputBaseUrl() {
  const { outputBaseUrl } = await chrome.storage.local.get('outputBaseUrl');
  return outputBaseUrl || null;
}

async function fetchIndex(base) {
  try {
    const res = await fetch(`${base}/index.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('Novel De-slopper: could not read index.json —', e.message);
    return null;
  }
}

async function fetchChapterMarkdown(base, siteId, novelSlug, chapterSlug) {
  const url = `${base}/${siteId}/${novelSlug}/chapter-${chapterSlug}.md`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    console.warn('Novel De-slopper: could not read chapter file —', e.message);
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'CHECK_CHAPTER') return false;

  (async () => {
    const base = await getOutputBaseUrl();
    if (!base) {
      sendResponse({ exists: false, reason: 'no-output-folder-configured' });
      return;
    }

    const index = await fetchIndex(base);
    if (!index) {
      sendResponse({ exists: false, reason: 'no-index' });
      return;
    }

    const chapters = index[msg.siteId]?.[msg.novelSlug];
    if (!chapters || !chapters.includes(msg.chapterSlug)) {
      sendResponse({ exists: false, reason: 'not-in-index' });
      return;
    }

    const markdown = await fetchChapterMarkdown(base, msg.siteId, msg.novelSlug, msg.chapterSlug);
    if (!markdown) {
      sendResponse({ exists: false, reason: 'file-missing' });
      return;
    }

    sendResponse({ exists: true, markdown });
  })();

  return true; // keep the message channel open for the async work above
});