/**
 * rewrite.js — sends chapter text through Gemini for de-slopping.
 * No site/crawling knowledge lives here on purpose — this module only
 * knows how to turn an array of paragraphs into a cleaned-up chapter.
 */

const { sleep, fetchWithRetry } = require('./lib/http');
const { scanText, formatCounts } = require('./lib/slopScan');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Newer Gemini models have shipped with tighter free-tier RPM than their
// predecessors each generation. 12s between calls (5/min) is deliberately
// conservative — slower than necessary is fine for an overnight job,
// hitting 429s repeatedly isn't. Lower this if a run goes clean with zero
// 429s.
const MIN_MS_BETWEEN_LLM_CALLS = 12000;
const LLM_TIMEOUT_MS = 120000;
const LLM_RETRIES = 6;

// Pattern list is based on https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing,
// keeping the parts that apply to fiction. The "leave alone" list comes from
// that page's "Signs of human writing" section. Examples are real sentences
// from The Guardian Gods. Keep em dashes and "no X, just Y" out of the GOOD
// examples, since the model copies whatever the examples do.
const SYSTEM_PROMPT_PASS1 = `You are a line editor for a web novel. The author ran these chapters through an AI model, which layered stock "AI prose" habits on top of a good story. Your job is to take those habits back out so the chapter reads like a person wrote it, while keeping the story exactly as it is.

THE HABITS TO REMOVE, most damaging first:

1. Negative parallelism: describing something by what it is NOT, then what it is. Every form counts:
   - "not X, but Y" or "Not X. Y."
   - "not just X, but Y" / "not only X, but also Y" / "did not merely X, it Y"
   - "no X, no Y, just Z"
   - "no longer X, but Y"
   - "Y rather than X"
   BAD:  And they cursed him. Not with spells, not with magic, but with emotion.
   GOOD: And they cursed him with raw emotion.
   BAD:  No rush of air, no blur, just a god, suddenly near.
   GOOD: He felt no rush of air and saw no blur. The god was simply in front of him.
   BAD:  He spoke in sheer, exhausted acceptance rather than anger or triumph.
   GOOD: He spoke with tired acceptance.
   BAD:  Ikenga took a step forward, not to threaten, but to examine. To understand.
   GOOD: Ikenga stepped forward to take a closer look.
   Fix: state the true part directly. Drop the denied part unless it carries real information. Keep at most ONE negative parallelism in the whole chapter, and only where the contrast matters to the story.

2. Rule of three and repeated openers: triplets and anaphora used for rhythm.
   BAD:  They moaned, they screamed, they whispered.
   GOOD: They moaned and screamed and whispered over each other.
   BAD:  The earth remembered him. The air honored him. The world sang his name.
   GOOD: The earth and the air seemed to know him, and the world sang his name.
   BAD:  Perhaps for Keles. Perhaps only for himself.
   GOOD: Maybe it was meant for Keles, or maybe only for himself.
   Fix: merge into one sentence, cut to two items, or keep only the strongest one. At most one deliberate triplet per chapter.

3. Staccato pacing: runs of very short sentences, one-word fragments, and ellipses posing as dramatic beats.
   BAD:  Two eyes. Burning. Watching.
   GOOD: Two burning eyes watched him.
   BAD:  Flesh reknit. Muscle wove back into sinew.
   GOOD: His flesh reknit and the muscle wove back into sinew.
   BAD:  A fetus... cursing the very idea of its own conception.
   GOOD: Even a fetus was cursing the very idea of its own conception.
   Fix: join fragments into the sentence next to them using normal connectors (and, but, so, as, while, when, until) and subordinate clauses. Real prose mixes short and long sentences; long sentences with commas and clauses are good. A short sentence is fine when something genuinely lands hard, about once or twice a chapter.
   If a fragment is a whole paragraph by itself (like "Alone."), it must stay its own paragraph: either leave it or expand it into a full sentence ("He was alone."). Never fold it into the paragraph before or after.

4. Tacked-on significance: a phrase that tells the reader what something means instead of letting the scene show it.
   BAD:  His skin, a tapestry of divine resilience, mended silently.
   GOOD: His skin mended silently.
   Also cut endings like ", a testament to...", ", a reminder that...", ", marking the end of...", ", highlighting/underscoring/symbolizing...".

5. AI vocabulary and inflated verbs. Replace these exact words with plain ones: tapestry, testament, intricate, vibrant, profound, pivotal, crucial, delve, underscore, showcase, highlight (as a verb), foster, enduring, resonate, multifaceted, meticulous, unwavering, palpable. Use "was/is" instead of "served as / stood as / functioned as", "had" instead of "boasted", "used" instead of "utilized", "moved" instead of "relocated", "began" instead of "commenced". Only swap these listed words; do not hunt for their synonyms.

6. Dashes as a crutch: em dashes (—) and double hyphens (--) used to bolt on a dramatic aside.
   BAD:  From his vantage point, he saw them—the mages.
   GOOD: From his vantage point, he could see the mages.
   BAD:  Chaos had taken a more insidious shape—disbelief.
   GOOD: Chaos had taken a more insidious shape: disbelief.
   Fix: keep whatever came after the dash; only change the punctuation or wording around it. Rewrite the sentence, or use the punctuation a person would: a comma, colon, semicolon, parentheses, or two sentences. Keep at most two dashes in the chapter. Do not swing to the opposite extreme of only commas and periods; vary the punctuation.

LEAVE THESE ALONE (they are signs of human writing):
- Plain words and simple sentences: "was", "had", "there was", "used", "tried", "died". Never upgrade them to fancier ones.
- Hedges and intensifiers: very, perhaps, maybe, kind of, a bit, in order to.
- Repeated names and nouns. Say "Ikenga" or "the old man" again rather than cycling through "the god", "the deity", "the ancient being". Do not introduce synonyms for variety.
- The author's non-native phrasing, odd word choices, spelling, and grammar. Only touch them if they are part of a habit above.
- Dialogue (text inside quotation marks). People talk in fragments and pauses. Only fix a negative parallelism or a dash inside dialogue.
- The plot, events, information, names, terms, and the order things happen in. Do not add new imagery, metaphors, explanations, or emotions. Do not make it more formal or more poetic.

OUTPUT FORMAT:
- Every input paragraph starts with a marker like [12]. Output every marker exactly once, in the same order, each followed by its rewritten paragraph, with one blank line between paragraphs.
- Never drop a marker or move text from one marker to another, even when the paragraph is a single word. Never merge or split paragraphs.
- Output only the marked chapter text. No title, no preamble such as "Here is the rewritten chapter", no notes, no Markdown (no **, no #).`;

// Pass 2 gets a list of sentences that lib/slopScan.js flagged in pass 1's
// output. Tag names must match the ones slopScan.js emits.
const SYSTEM_PROMPT_PASS2 = `You are doing a cleanup pass on a web novel chapter that has already been edited once to remove AI-writing habits. An automatic scanner has listed the sentences that still contain those habits, each followed by the name of what it found. Fix them. The tag names are labels for you only; never write them into the chapter.

TAGS:
- negative-parallelism: "not X, but Y", "not just/merely X", "no X, no Y, just Z", "no longer X, but Y", "Y rather than X". Say the true part directly and drop the denial.
- repetition: a triplet or repeated sentence openers used for rhythm. Merge into one sentence or cut to the strongest item.
- staccato: a fragment, a run of very short sentences, or an ellipsis used as a dramatic pause. Join it into the neighbouring sentence in the same paragraph with a normal connector (and, but, as, while, when). If the fragment is a whole paragraph by itself, keep it as its own paragraph and only expand it into a full sentence.
- significance: a phrase telling the reader what something means (a testament to, a tapestry of, marking the end of). Cut the phrase and keep the event.
- ai-word: an overused AI word (tapestry, testament, vibrant, pivotal, profound...). Replace it with a plain word.
- copula: "served as / stood as / boasted" in place of "was / had". Use the plain verb.
- stiff-word: utilized, relocated, commenced, endeavored. Use the plain verb.
- dash: an em dash or "--" used for drama. Rewrite the sentence or use a comma, colon, semicolon, or parentheses, keeping whatever came after the dash. Do not turn every dash into a period.

RULES:
- Change only the flagged sentences, plus a neighbouring sentence when you need to join the two. Every other sentence must stay character-for-character identical.
- The scanner is crude. If a flagged sentence actually reads naturally (for example the one contrast that matters, or a short line that truly lands), leave it as it is.
- Keep the meaning, names, tone, dialogue, and the author's non-native phrasing. Do not add anything new, and do not make it fancier.
- Every paragraph of the chapter starts with a marker like [12]. Output every marker exactly once, in the same order, each followed by its paragraph, with one blank line between paragraphs. Never drop a marker or move text from one marker to another.
- Output only the full marked chapter text. No preamble, no list of changes, no Markdown.`;

let lastCallAt = 0;
async function throttleLLMCalls() {
  const wait = lastCallAt + MIN_MS_BETWEEN_LLM_CALLS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function callGemini(text, systemPrompt, prompt = text) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY environment variable is not set. See README.md for how to get a free key.'
    );
  }

  await throttleLLMCalls();

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      // Long chapters (50+ paragraphs) can run past 4096 tokens of output.
      maxOutputTokens: 8192,
      // Gemini's newer models spend part of maxOutputTokens on invisible
      // "thinking" before writing the actual response by default, which can
      // eat most of the budget and leave almost nothing for real output.
      // This is plain rule-based text editing, not a reasoning task, so
      // thinking is turned down as far as possible. Gemini 3.x models use
      // `thinkingLevel` (minimal/low/medium/high) rather than the older
      // `thinkingBudget` field.
      thinkingConfig: { thinkingLevel: 'minimal' },
      // NOTE: no `temperature` on purpose — this model generation deprecates
      // temperature/top_p/top_k and can return HTTP 400 if they're supplied.
    },
  };

  const res = await fetchWithRetry(
    GEMINI_API_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(body),
    },
    { retries: LLM_RETRIES, timeoutMs: LLM_TIMEOUT_MS }
  );

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const output = cleanOutput(candidate?.content?.parts?.map((p) => p.text).join('') || '');

  if (!output) {
    const reason = candidate?.finishReason || 'unknown';
    throw new Error(`Empty response from Gemini (finishReason: ${reason})`);
  }

  if (candidate.finishReason === 'MAX_TOKENS') {
    console.warn('  ⚠ response was truncated (hit maxOutputTokens) — check this chapter manually');
  }

  const ratio = output.length / text.length;
  if (ratio < 0.6 || ratio > 1.6) {
    console.warn(`  ⚠ output length ratio ${ratio.toFixed(2)}x input — check this chapter manually`);
  }

  return output;
}

/**
 * Strips chatbot wrapping the model sometimes adds despite instructions:
 * code fences, a "Here is the rewritten chapter:" preamble, Markdown bold.
 */
function cleanOutput(text) {
  return text
    .replace(/^```[a-z]*\n?|\n?```$/g, '')
    .trim()
    .replace(/^(?:here(?:'s| is)|sure|certainly|okay)\b[^\n]*:\s*\n+/i, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .trim();
}

// Paragraphs are sent as "[1] text", "[2] text"... The extension swaps text
// paragraph-by-paragraph, so the count must survive the rewrite exactly.
// Prompting alone isn't reliable for this (one-word paragraphs like "Alone."
// get folded into a neighbour), so markers let us detect and repair it.
const toNumbered = (paragraphs) => paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');

/**
 * Parses "[n] text" output back into paragraphs. Any marker the model
 * dropped is filled from `fallback` (the previous stage's paragraph).
 */
function fromNumbered(output, fallback) {
  const byIndex = new Map();
  const re = /^\[(\d+)\][ \t]*/gm;
  const marks = [...output.matchAll(re)];
  marks.forEach((m, k) => {
    const end = k + 1 < marks.length ? marks[k + 1].index : output.length;
    const text = output.slice(m.index + m[0].length, end).trim();
    // Out-of-range markers get attached to the last paragraph rather than lost.
    const idx = Math.min(Number(m[1]), fallback.length);
    if (text) byIndex.set(idx, byIndex.has(idx) ? `${byIndex.get(idx)} ${text}` : text);
  });

  const restored = [];
  const paragraphs = fallback.map((orig, i) => {
    if (byIndex.has(i + 1)) return byIndex.get(i + 1);
    restored.push(i + 1);
    return orig;
  });
  if (restored.length) {
    console.warn(`  ⚠ model dropped paragraph(s) ${restored.join(', ')}; kept the previous version of those`);
  }
  return paragraphs;
}

/** Builds pass 2's user message: the flagged sentences, then the chapter. */
function buildPass2Prompt(paragraphs, flagged) {
  // Tags go after the sentence in plain words, not in [brackets], so they
  // can't be confused with the [n] paragraph markers.
  const list = flagged.map((f, i) => `${i + 1}. ${f.sentence}  (found: ${f.tags.join(', ')})`).join('\n');
  return `FLAGGED SENTENCES:\n${list}\n\nCHAPTER:\n${toNumbered(paragraphs)}`;
}

async function rewriteChapter(paragraphs) {
  const before = scanText(paragraphs.join('\n\n'));

  console.log(`  rewriting pass 1/2 (${paragraphs.length} paragraphs) ...`);
  const numbered = toNumbered(paragraphs);
  const firstPass = fromNumbered(await callGemini(numbered, SYSTEM_PROMPT_PASS1), paragraphs);
  const afterFirst = scanText(firstPass.join('\n\n'));

  // Pass 2 only targets what the scanner can point at, so if it finds
  // nothing there's no point spending a free-tier request on it.
  let rewritten = firstPass;
  let after = afterFirst;
  if (afterFirst.flagged.length === 0) {
    console.log('  pass 2/2 skipped (scanner found nothing left to fix)');
  } else {
    console.log(`  rewriting pass 2/2 (${afterFirst.flagged.length} flagged sentences) ...`);
    const pass2Prompt = buildPass2Prompt(firstPass, afterFirst.flagged);
    rewritten = fromNumbered(await callGemini(toNumbered(firstPass), SYSTEM_PROMPT_PASS2, pass2Prompt), firstPass);
    after = scanText(rewritten.join('\n\n'));
  }

  console.log(`  slop score: ${formatCounts(before)} -> ${afterFirst.total} -> ${formatCounts(after)}`);
  return rewritten.join('\n\n');
}

module.exports = { rewriteChapter };
