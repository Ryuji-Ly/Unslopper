/**
 * extension/parsers/novelping.js
 *
 * Browser port of the Node-side parsers/novelping.js. Same matching and
 * slug logic, but getParagraphElements works against the live document.
 *
 * Registers itself on window.NovelDeslopParsers, which parsers/index.js
 * (loaded next, per manifest.json's content_scripts order) reads from.
 */

(function () {
  function hostnameOf(url) {
    return new URL(url).hostname.replace(/^www\./, '');
  }

  window.NovelDeslopParsers = window.NovelDeslopParsers || [];
  window.NovelDeslopParsers.push({
    id: 'novelping.com',

    matches(url) {
      return hostnameOf(url) === 'novelping.com';
    },

    getNovelSlug(url) {
      const match = new URL(url).pathname.match(/\/book\/([^/]+)\//);
      return match ? match[1] : null;
    },

    // .../chapter-2-the-place-where-everything-fell-down -> "2"
    getChapterSlug(url) {
      const match = new URL(url).pathname.match(/\/chapter-(\d+)(?:-[^/]*)?\/?$/i);
      return match ? match[1] : null;
    },

    // Same filtering as the Node-side extractChapter (direct <p> children
    // of #chr-content, skip empty) so the count lines up with the rewrite.
    getParagraphElements(doc) {
      const content = doc.querySelector('#chr-content');
      if (!content) return [];
      return Array.from(content.querySelectorAll(':scope > p')).filter(
        (el) => el.textContent.replace(/\s+/g, ' ').trim()
      );
    },
  });
})();
