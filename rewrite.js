/**
 * rewrite.js — sends chapter text through Gemini for de-slopping.
 * No site/crawling knowledge lives here on purpose — this module only
 * knows how to turn an array of paragraphs into a cleaned-up chapter.
 */

const { sleep, fetchWithRetry } = require('./lib/http');

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

const SYSTEM_PROMPT_PASS1 = `You are a prose editor. You fix bad AI-writing habits in web novel chapters while preserving everything else exactly.

The three specific habits to fix, with real examples of what NOT to do and what to do instead:

1. "Not X, but Y" constructions.
   BAD: "And they cursed him. Not with spells, not with magic, but with emotion."
   GOOD: "And they cursed him, not with magic, but with pure emotion."
   (Use at most ONE "not X, but Y" per chapter. Every other instance must become a plain direct sentence.)

2. Rule-of-three fragments (three short clauses/sentences in a row for "dramatic" effect).
   BAD: "They moaned, they screamed, they whispered." / "Pure, unfiltered rage. Crushing sorrow. Jealousy so deep it could cut through the fabric of existence."
   GOOD: "They moaned and screamed and whispered all at once." / "Pure rage, crushing sorrow, and a jealousy so deep it could cut through the fabric of existence."
   (Fold triplets into one flowing sentence instead of three separate beats. Use this construction at most ONCE per chapter.)

3. One/two-word sentence fragments used as a dramatic pause.
   BAD: "Not one, but many." / "He had not seen him move. No rush of air, no blur — just a god, suddenly near."
   GOOD: Fold these into the surrounding sentence instead of isolating them: "Millions of souls: old and young, men and women, newborns who never breathed." / "He hadn't even seen him move; there was no rush of air, no blur, just a god suddenly near."

General rules:
- Do NOT make the prose fancier, more formal, or more "polished" than the original — the goal is naturalness, not elevation.
- Do NOT lean on em dashes as your default fix for the patterns above. Overusing em dashes is its own AI-writing tell. Prefer plain commas, periods, semicolons, or just rewording the sentence. An occasional em dash is fine if the original had one; introducing new ones in most of your rewrites is not.
- Keep the plot, dialogue, character voice, tone, and any non-native-English phrasing/quirks completely intact. Do not correct grammar quirks that are part of the author's voice, only the three habits above.
- Do not summarize, shorten, expand, or add anything. Every paragraph in the input must map to a paragraph in the output, in the same order.
- The input paragraphs are separated by a blank line. Preserve that exact structure: same number of paragraphs, same order, separated by a blank line, nothing merged or split.
- Output ONLY the rewritten chapter text. No preamble, no notes, no markdown formatting, no commentary.`;

const SYSTEM_PROMPT_PASS2 = `You are doing a second editing pass on text that was already partially cleaned up. Your ONLY job is to find and fix any REMAINING instances of these four specific patterns — do not touch anything else.

Pattern A: "not X, but Y" sentence constructions (e.g. "not to threaten, but to examine").
Pattern B: three short clauses/fragments in a row used for dramatic rhythm (e.g. "The earth remembered him. The air honored him. The curse sang his name.").
Pattern C: isolated one-or-two-word sentence fragments used as a dramatic beat (e.g. "To understand." as its own sentence).
Pattern D: em dashes used as a dramatic-pause crutch (more than one or two per chapter is a sign of this).

For each instance you find, rewrite ONLY that sentence into a single natural, direct sentence that keeps the same meaning — fold fragments together, turn "not X but Y" into a plain statement, replace crutch em dashes with a comma, period, or reworded sentence. Do not rewrite, rephrase, or "improve" any sentence that doesn't contain one of these four patterns — leave it byte-for-byte identical.

If a chapter genuinely has zero remaining instances, return it completely unchanged.

Output ONLY the full chapter text with just those specific fixes applied. Same paragraph count and order as the input, separated by blank lines. No preamble, no notes, no commentary.`;

let lastCallAt = 0;
async function throttleLLMCalls() {
  const wait = lastCallAt + MIN_MS_BETWEEN_LLM_CALLS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

async function callGemini(text, systemPrompt) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY environment variable is not set. See README.md for how to get a free key.'
    );
  }

  await throttleLLMCalls();

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      maxOutputTokens: 4096,
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
  const output = candidate?.content?.parts?.map((p) => p.text).join('').trim();

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

async function rewriteChapter(paragraphs) {
  const inputText = paragraphs.join('\n\n');

  console.log(`  rewriting pass 1/2 (${paragraphs.length} paragraphs) ...`);
  const firstPass = await callGemini(inputText, SYSTEM_PROMPT_PASS1);

  console.log(`  rewriting pass 2/2 (hunting remaining slop) ...`);
  const rewritten = await callGemini(firstPass, SYSTEM_PROMPT_PASS2);

  return rewritten;
}

module.exports = { rewriteChapter };