/**
 * slopScan.js — crude regex scanner for AI-prose patterns, based on
 * https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing (the parts
 * that apply to fiction).
 *
 * Used two ways:
 *   - rewrite.js uses it to point pass 2 at the exact sentences that still
 *     need fixing, and to log a before/after score per chapter.
 *   - From the command line, to score files you already have:
 *       node lib/slopScan.js output/novelphoenix.com/the-guardian-gods/chapter-505.md
 *
 * It's deliberately simple and will have false positives/negatives; it's a
 * pointer for the model and a rough yardstick, not a judge. Dialogue (text
 * inside quotation marks) is ignored, since people talk in fragments.
 */

// Tag names here must match the tag descriptions in rewrite.js's pass 2 prompt.
const NEGATIVE_PARALLELISM = [
  // "not with spells, not with magic, but with emotion", "not to threaten, but to examine"
  /\bnot\s+(?:with|from|by|for|to|in|on|of|a|an|the|because|out of|one|as|just|only|merely|simply|even)\b[^.!?;]{0,80}?,?\s+but\b/i,
  // "not just X, but also Y", "not only ..."
  /\bnot\s+(?:just|only|merely|simply)\b/i,
  // "no rush of air, no blur, just a god"
  /\bno\s+[^,.!?;—-]{1,30},\s*(?:and\s+)?no\s+[^,.!?;—-]{1,30}(?:,\s*|\s*(?:—|--|–)\s*|\s+)(?:just|only|but|simply)\b/i,
  // "no longer wrathful, but calculating"
  /\bno longer\b[^.!?;]{0,60}?,?\s+but\b/i,
  // "Y rather than X"
  /\brather than\b/i,
  // sentence that opens with the denial: "Not one, but many." / "Not with spells."
  /^(?:and\s+|but\s+)?not\b/i,
];

// Era word lists from the wiki page's "AI vocabulary" section, minus words
// that are ordinary in fiction (e.g. literal "landscape", "steady", "echoed").
const AI_WORDS = /\b(?:tapestry|testament|intricate(?:ly)?|intricac(?:y|ies)|vibrant|profound(?:ly)?|pivotal|crucial|delv(?:e|es|ed|ing)|underscor(?:e|es|ed|ing)|showcas(?:e|es|ed|ing)|highlight(?:s|ed|ing)?|foster(?:s|ed|ing)?|enduring|resonat(?:e|es|ed|ing)|multifaceted|meticulous(?:ly)?|interplay|garner(?:s|ed|ing)?|bolstered|indelible|nestled|unwavering|palpable)\b/i;

const COPULA_AVOIDANCE = /\b(?:serv(?:e|es|ed|ing)|stand(?:s|ing)?|stood|function(?:s|ed|ing)?)\s+as\s+(?:a|an|the|his|her|their|its)\b|\bboast(?:s|ed|ing)?\b/i;

// Superficial analysis tacked onto the end of a sentence.
const SIGNIFICANCE = [
  /,\s*(?:a|an)\s+(?:testament|reminder|symbol|sign|promise|monument|tribute)\s+(?:to|of|that)\b/i,
  /,\s*(?:highlighting|underscoring|emphasizing|reflecting|symbolizing|showcasing|signaling|signifying|marking|cementing)\b/i,
  /\bmark(?:s|ed|ing)?\s+(?:a|the)\s+(?:turning point|new era|beginning of|end of|pivotal)\b/i,
];

const STIFF_WORDS = /\b(?:utiliz(?:e|es|ed|ing)|relocat(?:e|es|ed|ing)|commenc(?:e|es|ed|ing)|endeavou?r(?:s|ed|ing)?|passed away|authored)\b/i;

const DASH = /—|--|\s–\s/g;

// Openers that are normal to repeat in narration ("He ... He ...").
const COMMON_OPENERS = new Set(['he', 'she', 'they', 'i', 'it', 'the', 'his', 'her', 'their', 'and', 'but', 'a', 'we', 'you']);

/**
 * Returns the paragraph with every character inside quotation marks
 * replaced by a space, so dialogue doesn't trigger narration checks.
 * Tracks quote state across the whole paragraph because dialogue often
 * spans several sentences.
 */
function maskDialogue(paragraph) {
  let inQuote = false;
  let out = '';
  for (const ch of paragraph) {
    if (ch === '“') { inQuote = true; out += ' '; continue; }
    if (ch === '”') { inQuote = false; out += ' '; continue; }
    if (ch === '"') { inQuote = !inQuote; out += ' '; continue; }
    out += inQuote ? ' ' : ch;
  }
  return out;
}

/** Splits into sentences, returning [start, end) offsets so the masked and original text stay aligned. */
function sentenceSpans(text) {
  const spans = [];
  const re = /[^.!?…]+(?:[.!?…]+["”’)]*|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim()) spans.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return spans;
}

const wordCount = (s) => (s.match(/[\p{L}\p{N}'’-]+/gu) || []).length;

/**
 * Scans chapter text (paragraphs separated by blank lines).
 * Returns { counts: {tag: n}, total, flagged: [{ sentence, tags: [...] }] }.
 */
function scanText(text) {
  const counts = {};
  const flaggedMap = new Map(); // sentence -> Set(tags), keeps first-seen order
  const flag = (sentence, tag) => {
    counts[tag] = (counts[tag] || 0) + 1;
    if (!flaggedMap.has(sentence)) flaggedMap.set(sentence, new Set());
    flaggedMap.get(sentence).add(tag);
  };

  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let dashTotal = 0;
  const dashSentences = [];

  for (const para of paragraphs) {
    if (para.startsWith('#')) continue; // title line in saved .md files
    const masked = maskDialogue(para);
    const sentences = sentenceSpans(para).map(([a, b]) => ({
      orig: para.slice(a, b).trim(),
      narr: masked.slice(a, b).replace(/\s+/g, ' ').trim(),
    })).filter((s) => wordCount(s.narr) > 0); // skip pure dialogue

    sentences.forEach((s, i) => {
      const { orig, narr } = s;
      if (NEGATIVE_PARALLELISM.some((re) => re.test(narr))) flag(orig, 'negative-parallelism');
      if (SIGNIFICANCE.some((re) => re.test(narr))) flag(orig, 'significance');
      if (AI_WORDS.test(narr)) flag(orig, 'ai-word');
      if (COPULA_AVOIDANCE.test(narr)) flag(orig, 'copula');
      if (STIFF_WORDS.test(narr)) flag(orig, 'stiff-word');

      // Rule of three inside one sentence: "they moaned, they screamed, they whispered"
      if (/\b(\w+)\s+\w+(?:\s+\w+)?,\s+\1\s+\w+(?:\s+\w+)?,\s+(?:and\s+)?\1\b/i.test(narr)) {
        flag(orig, 'repetition');
      }
      // Anaphora across sentences: "Perhaps for Keles. Perhaps only for himself."
      const opener = narr.match(/^[\p{L}']+/u)?.[0].toLowerCase();
      const prevOpener = sentences[i - 1]?.narr.match(/^[\p{L}']+/u)?.[0].toLowerCase();
      // Common openers only count when both sentences are short and parallel:
      // "The earth remembered him. The air honored him."
      const bothShort = wordCount(narr) <= 6 && wordCount(sentences[i - 1]?.narr || '') <= 6;
      if (opener && opener === prevOpener && (bothShort || !COMMON_OPENERS.has(opener))) {
        flag(sentences[i - 1].orig, 'repetition');
        flag(orig, 'repetition');
      }

      // Ellipsis used as a dramatic pause in narration: "A fetus... cursing".
      // The splitter breaks on ellipses, so in narration one always ends a span.
      if (narr === orig && /(?:\.\.\.|…)$/.test(narr)) flag(orig, 'staccato');

      const dashes = (narr.match(DASH) || []).length;
      if (dashes) { dashTotal += dashes; dashSentences.push(orig); }
    });

    // Staccato: lone 1-2 word fragments, or 3+ very short sentences in a row.
    let run = [];
    const flushRun = () => {
      if (run.length >= 3) run.forEach((s) => flag(s.orig, 'staccato'));
      run = [];
    };
    for (const s of sentences) {
      const n = wordCount(s.narr);
      if (n <= 2 && s.narr === s.orig) flag(s.orig, 'staccato');
      if (n <= 5 && s.narr === s.orig) run.push(s); else flushRun();
    }
    flushRun();
  }

  // A couple of dashes per chapter is normal; past that, every one is a crutch.
  if (dashTotal > 2) dashSentences.forEach((s) => flag(s, 'dash'));

  const flagged = [...flaggedMap].map(([sentence, tags]) => ({ sentence, tags: [...tags] }));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total, flagged };
}

/** One-line summary, e.g. "31 (negative-parallelism 6, staccato 12, dash 9, ai-word 4)". */
function formatCounts({ counts, total }) {
  const parts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`);
  return parts.length ? `${total} (${parts.join(', ')})` : '0';
}

module.exports = { scanText, formatCounts };

if (require.main === module) {
  const fs = require('fs');
  const files = process.argv.slice(2);
  const verbose = files[0] === '-v' && files.shift();
  if (!files.length) {
    console.log('usage: node lib/slopScan.js [-v] <file.md> [more files...]');
    process.exit(1);
  }
  for (const file of files) {
    const result = scanText(fs.readFileSync(file, 'utf8'));
    console.log(`${file}: ${formatCounts(result)}`);
    if (verbose) result.flagged.forEach((f) => console.log(`  [${f.tags.join(', ')}] ${f.sentence}`));
  }
}
