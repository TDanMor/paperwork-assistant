import { smartSliceOCR } from './extractor.js';

/**
 * Paperwork Assistant - Human Storyteller Prompting V5.1
 *
 * Philosophy: The deterministic layer (extractor.js) finds the WHAT.
 * This prompt layer tells the AI to explain the WHY in plain language.
 * Optimized for Llama-3.2-1B/3B: short, direct instructions with examples.
 *
 * V5.1: Aggressive JSON Hunter + deepCleanRescue to guarantee zero
 *        technical leakage (no XML tags, no JSON keys, no brackets).
 */

export function buildSystemPrompt(language, attentionModel) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  const facts = attentionModel.facts;

  // Build a concise fact sheet the AI can anchor to
  const amount = facts.amounts[0]?.value ? `${facts.amounts[0].value} EUR` : null;
  const topic = facts.document_topic || 'general correspondence';

  // Feed context sentences so the AI can read the real story
  const contextBlock = (facts.context_sentences && facts.context_sentences.length > 0)
    ? `\nKey sentences from the document:\n${facts.context_sentences.map(s => `- "${s}"`).join('\n')}`
    : '';

  return `You explain German letters to regular people. Write in ${langName}.

VERIFIED FACTS (use these, do not guess):
- From: ${facts.sender}
- About: ${topic}${amount ? `\n- Amount: ${amount}` : ''}${contextBlock}

INSTRUCTIONS:
Write a JSON object with these keys:
1. "summary": 3-4 friendly sentences explaining what this letter means and why it was sent. Example: "Your health insurance AOK is confirming they will reimburse you 234.50 EUR for your recent dental treatment. To receive the money, you need to send them your bank account details."
2. "action_steps_explanation": a list of 1-3 short actions. Example: ["Send your IBAN to AOK by mail or phone", "Keep this letter for your records"]
3. "reference_id_highlight": any reference number you find, or null.

RULES:
- Be specific: use exact amounts, dates, and names from the text.
- Never say "check the document" — YOU are the one reading it for the user.
- Respond ONLY with the JSON object. Do NOT add any tags, headers, or explanations outside of the JSON. No XML, no markdown, no code blocks. Just the raw JSON object starting with { and ending with }.`;
}

export function buildUserMessage(ocrText, language, attentionModel) {
  const text = smartSliceOCR(ocrText, 3000, attentionModel.facts);
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';
  return `<document_snippets>\n${text}\n</document_snippets>\n\nRespond with ONLY the JSON object. Values in ${langName}.`;
}

/**
 * Converts German date format (DD.MM.YYYY) to ISO (YYYY-MM-DD).
 * Passes through dates already in ISO format or null values.
 */
function germanDateToISO(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!parts) return dateStr; // Already ISO or unknown format, pass through
  let [, d, m, y] = parts;
  if (y.length === 2) y = '20' + y;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Deep Clean Rescue — strips ALL technical artifacts from an AI response
 * so only human-readable narrative text remains.
 *
 * Removes (recursively until stable):
 *  - XML/HTML tags (<document_summary>, </anything>, <br/>, etc.)
 *  - JSON key patterns ("summary":, "action_steps_explanation":, etc.)
 *  - Markdown code fences (```json ... ```)
 *  - Stray JSON brackets, braces, colons, and quotes
 *  - Common LLM prefixes ("Here is the summary:", "Summary:", etc.)
 */
function deepCleanRescue(raw) {
  if (!raw || raw.trim().length < 20) return null;

  let text = raw;
  let prev = '';

  // Recursive cleaning — repeat until output stabilizes
  while (text !== prev) {
    prev = text;
    text = text
      // 1. Kill ALL XML/HTML tags (opening, closing, self-closing)
      .replace(/<\/?[a-zA-Z_][\w.-]*(?:\s[^>]*)?\/?>/g, '')
      // 2. Kill markdown code fences
      .replace(/```[\s\S]*?```/g, '')
      .replace(/```/g, '')
      // 3. Kill JSON key patterns: "key": or "key" :
      .replace(/"(?:summary|action_steps_explanation|action_steps|reference_id_highlight|reference_id|steps|actions|explanation|document_summary|briefing)"\s*:\s*/gi, '')
      // 4. Kill leading/trailing braces and brackets
      .replace(/^\s*[{[\]},]+/g, '')
      .replace(/[{[\]},]+\s*$/g, '')
      // 5. Kill orphaned JSON array markers inside text
      .replace(/^\s*\[\s*/gm, '')
      .replace(/\s*\]\s*$/gm, '')
      // 6. Kill stray quotes at line boundaries
      .replace(/^\s*"+\s*/gm, '')
      .replace(/\s*"+\s*$/gm, '')
      // 7. Kill common LLM prefixes/suffixes
      .replace(/^(Here is|Here's|Below is|The following is|I hope this helps|Let me know)[^.]*[.:]\s*/i, '')
      .replace(/^(Summary|Briefing|Description|Document Summary|Explanation)\s*[:]\s*/i, '')
      .trim();
  }

  // Final quality gate: must have enough readable content
  if (text.length < 20) return null;

  // Take up to 3 clean sentences
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);
  return sentences.length > 0 ? sentences.slice(0, 4).join(' ') : text.substring(0, 500);
}

/**
 * Aggressive JSON Hunter — finds the outermost { ... } in the AI response,
 * repairs common LLM mistakes, and parses it.
 */
function aggressiveJSONParse(raw) {
  if (!raw) return null;

  // Find the FIRST { and the LAST } in the entire response
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  let candidate = raw.substring(firstBrace, lastBrace + 1);

  // Repair common LLM JSON mistakes
  candidate = candidate
    .replace(/,\s*([\]}])/g, '$1')           // Trailing commas
    .replace(/'/g, '"')                       // Single quotes → double quotes (only in JSON context)
    .replace(/(\w)"(\w)/g, '$1\\"$2')         // Unescaped quotes inside strings (e.g. can"t)
    .replace(/\n/g, '\\n')                    // Raw newlines inside strings
    .replace(/\\n\s*"/g, '\\n"')              // Clean up newline+quote
    .replace(/\\n\s*}/g, '\\n"}');            // Clean up newline+brace

  // Attempt 1: Direct parse
  try {
    return JSON.parse(candidate);
  } catch (e) { /* continue */ }

  // Attempt 2: Re-extract with a more targeted regex (handles nested content)
  try {
    const reMatch = raw.match(/\{\s*"summary"\s*:\s*"([\s\S]*?)"\s*,\s*"action_steps_explanation"\s*:\s*\[([\s\S]*?)\]/);
    if (reMatch) {
      const summary = reMatch[1].replace(/\\"/g, '"').replace(/"/g, '\\"');
      const stepsRaw = reMatch[2];
      const steps = stepsRaw.match(/"([^"]*)"/g)?.map(s => s.replace(/"/g, '')) || [];
      return { summary: JSON.parse(`"${summary}"`), action_steps_explanation: steps };
    }
  } catch (e) { /* continue */ }

  return null;
}

/**
 * Resilient AI Response Parser V5.1
 * Priority: Aggressive JSON > Deep Clean Rescue > Human-friendly fallback
 * Guarantee: Zero technical leakage to the user.
 */
export function parseAIResponse(raw, attentionModel) {
  console.log("AI Response:", raw);

  // --- STAGE 1: Aggressive JSON Hunter ---
  const jsonParsed = aggressiveJSONParse(raw) || {};

  // --- STAGE 2: Deep Clean Rescue (if JSON had no summary) ---
  let rescueSummary = null;
  if (!jsonParsed.summary) {
    rescueSummary = deepCleanRescue(raw);
  }

  // Clean the parsed summary too (in case JSON values contain tags/leakage)
  if (jsonParsed.summary) {
    jsonParsed.summary = deepCleanRescue(jsonParsed.summary) || jsonParsed.summary;
  }

  // Clean action steps if they contain technical artifacts
  if (Array.isArray(jsonParsed.action_steps_explanation)) {
    jsonParsed.action_steps_explanation = jsonParsed.action_steps_explanation
      .map(step => typeof step === 'string' ? step.replace(/<[^>]*>/g, '').trim() : String(step))
      .filter(step => step.length > 0);
  }

  const facts = attentionModel.facts;
  const mainCat = (facts.nuances && facts.nuances[0]) ? facts.nuances[0] : 'Finance';

  // --- STAGE 3: Human-friendly deterministic fallback ---
  const summaryFallback = buildHumanFallback(facts);

  return {
    sender: facts.sender,
    reference_numbers: facts.reference_numbers,
    summary: jsonParsed.summary || rescueSummary || summaryFallback,
    action_steps: jsonParsed.action_steps_explanation || facts.actions.map(a => a.reason),
    document_type: facts.polarity_overall === 'nachzahlung' ? 'invoice' : (facts.legal_remedy.present ? 'notice' : 'other'),
    main_category: mainCat,
    sub_category: facts.doc_stage || 'other',
    money: {
      amount: facts.amounts[0]?.value || null,
      currency: 'EUR',
      is_vat_verified: !!facts.table?.confirmed
    },
    dates: {
      document_date: germanDateToISO(facts.dates.find(d => d.role === 'issued')?.value),
      due_date: germanDateToISO(facts.dates.find(d => d.role === 'due')?.value),
      appointment_date: germanDateToISO(facts.dates.find(d => d.role === 'appointment')?.value),
      legal_deadline: facts.legal_remedy.deadline
    },
    urgency: attentionModel.urgency,
    action_required: attentionModel.primaryAction,
    actions: facts.actions,
    ref_highlight: jsonParsed.reference_id_highlight || null
  };
}

/**
 * Builds a human-friendly fallback summary from deterministic facts.
 * Uses document_topic (human-readable) instead of raw category labels.
 */
function buildHumanFallback(facts) {
  const sender = facts.sender || 'the sender';
  const amount = facts.amounts[0]?.value ? ` for ${facts.amounts[0].value} EUR` : '';

  // Use the human-readable topic if available
  if (facts.document_topic) {
    return `You received a letter from ${sender} about ${facts.document_topic}${amount}. Please review the details below.`;
  }

  // Context-sentence based fallback
  if (facts.context_sentences && facts.context_sentences.length > 0) {
    return `You received a letter from ${sender}${amount}. The document mentions: "${facts.context_sentences[0]}"`;
  }

  // Bare minimum fallback (no raw labels like "Insurance, Finance")
  if (facts.table?.confirmed) {
    return `You received an invoice from ${sender}${amount}. The VAT has been verified as correct.`;
  }

  return `You received a letter from ${sender}${amount}. Please review the action steps below for what to do next.`;
}

export function getFallbackData() {
  return {
    sender: 'Unknown',
    document_type: 'other',
    dates: { document_date: null, due_date: null, appointment_date: null, legal_deadline: null },
    money: { amount: null, currency: 'EUR', is_vat_verified: false },
    main_category: 'other',
    sub_category: 'other',
    action_required: 'file',
    urgency: 'informational',
    summary: 'We couldn\'t fully analyze this document automatically. Please take a quick look at the original to check for any deadlines or amounts.',
    action_steps: ["Open the document image and check for any deadlines", "Look for payment amounts or reference numbers"],
    reference_numbers: {}
  };
}
