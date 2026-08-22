import { smartSliceOCR } from './extractor.js';

/**
 * Paperwork Assistant - Human Storyteller Prompting V5.3
 *
 * Philosophy: The deterministic layer (extractor.js) finds the WHAT.
 * This prompt layer tells the AI to explain the WHY in plain language.
 * Compatible with Qwen2.5-0.5B (Ultra-Stable) and Phi-3.5-Mini (Pro).
 *
 * V5.3: Prompt Lockdown for tiny models.
 *        - Language command is the FIRST line (anchors 0.5B attention).
 *        - Flat 3-key JSON only (summary, steps, ref).
 *        - Explicit markdown ban to prevent code-fence leakage.
 *        - Storyteller rule: translate German meaning, never echo German.
 *        - Aggressive JSON Hunter + deepCleanRescue to guarantee zero
 *          technical leakage (no XML tags, no JSON keys, no brackets).
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

  // V5.0: Inject RV-Nummer and BG-Nummer if found (deterministic, never AI-guessed)
  const refs = facts.reference_numbers || {};
  const idLines = [];
  if (refs.rv_nummer)      idLines.push(`- RV-Nummer (Pension ID): ${refs.rv_nummer}`);
  if (refs.bg_nummer)      idLines.push(`- BG-Nummer (Jobcenter Case): ${refs.bg_nummer}`);
  if (refs.steuernummer)   idLines.push(`- Steuernummer: ${refs.steuernummer}`);
  if (refs.aktenzeichen)   idLines.push(`- Aktenzeichen: ${refs.aktenzeichen}`);
  if (refs.kassenzeichen)  idLines.push(`- Kassenzeichen: ${refs.kassenzeichen}`);
  const idBlock = idLines.length > 0 ? '\n' + idLines.join('\n') : '';

  // V5.0: Critical Action tone override — forces serious, urgent AI tone
  let criticalBlock = '';
  if (facts.risk_flags?.critical_action && facts.risk_flags?.critical_keywords?.length > 0) {
    const threats = facts.risk_flags.critical_keywords.join(', ');
    criticalBlock = `\n\nCRITICAL ALERT — THIS DOCUMENT CONTAINS: ${threats.toUpperCase()}
- Use a very serious, urgent tone. This is NOT a routine letter.
- Emphasize that IMMEDIATE action is required — the user's finances or benefits are at direct risk.
- Clearly state what the threat is (e.g. account seizure, benefit suspension, sanctions) in plain language.
- Recommend the user seek professional help (Schuldnerberatung, lawyer, Jobcenter) if applicable.`;
  }

  /* ─── V5.4 Prompt Lockdown ──────────────────────────────────────
   * Line 1 = Language anchor (critical for 0.5B attention span).
   * Flat 3-key JSON prevents the tiny model from hallucinating
   * complex nested structures it cannot reliably close.
   * Markdown ban stops ```json leakage on Qwen-0.5B.
   * Storyteller rule prevents raw German echo.
   * ────────────────────────────────────────────────────────────── */
  return `You are a ${langName} storytelling assistant. NEVER write German sentences in the summary. Translate the intent immediately.

VERIFIED FACTS (use these, do not guess):
- From: ${facts.sender}
- About: ${topic}${amount ? `\n- Amount: ${amount}` : ''}${idBlock}${contextBlock}

INSTRUCTIONS:
Reply with a flat JSON object with exactly 3 keys:
{"summary": "...", "steps": "...", "ref": "..."}

- "summary": 3-4 friendly sentences explaining what this letter means and why it was sent. Be specific: use exact amounts, dates, and names.
- "steps": 1-3 short actions the person should take, separated by semicolons.
- "ref": any reference number you find, or null.

RULES:
- Never say "check the document" — YOU are the one reading it for the user.${facts.is_direct_debit ? '\n- MANDATORY: This bill uses Direct Debit (Lastschrift). Tell the user the amount is deducted automatically and they do NOT need to act.' : ''}${facts.polarity_overall === 'nachzahlung' ? '\n- MANDATORY: The user OWES this money. Never say they will "receive money".' : ''}${criticalBlock}
- Do NOT use markdown code blocks (\`\`\`). Do NOT start your answer with the word "json". Output ONLY the raw curly brackets {}.`;
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
 * V5.3 additions:
 *  - Surgically removes leading "json" word (Qwen-0.5B habit)
 *  - Strips stray backticks before any other processing
 *  - Handles the new flat keys: summary, steps, ref
 */
function deepCleanRescue(raw) {
  if (!raw || raw.trim().length < 20) return null;

  let text = raw;
  let prev = '';

  // Recursive cleaning — repeat until output stabilizes
  while (text !== prev) {
    prev = text;
    text = text
      // 0. V5.3: Kill stray backticks and leading "json" word FIRST
      .replace(/`/g, '')
      .replace(/^\s*json\s*/i, '')
      // 1. Kill ALL XML/HTML tags (opening, closing, self-closing)
      .replace(/<\/?[a-zA-Z_][\w.-]*(?:\s[^>]*)?\/?>/g, '')
      // 2. Kill markdown code fences (triple backtick blocks already stripped above)
      // 3. Kill JSON key patterns (V5.3: added flat-schema keys: steps, ref)
      .replace(/"(?:summary|action_steps_explanation|action_steps|reference_id_highlight|reference_id|steps|actions|explanation|document_summary|briefing|ref)"?\s*:\s*/gi, '')
      // 3b. V5.3: Kill UNQUOTED key patterns (0.5B sometimes omits quotes)
      .replace(/\b(?:summary|steps|ref|action_steps_explanation|reference_id_highlight)\s*:\s*/gi, '')
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
      .replace(/^(Here is|Here's|Below is|The following is|I hope this helps|Let me know)[^.]*[.:]?\s*/i, '')
      .replace(/^(Summary|Briefing|Description|Document Summary|Explanation)\s*[:]\s*/i, '')
      .trim();
  }

  // V5.4 Anti-Leakage Truncation
  // Stop narrative if the AI started dumping arrays or unclosed JSON properties mid-string
  const leakIndex1 = text.indexOf('", [');
  const leakIndex2 = text.indexOf('["');
  const leakIndex3 = text.indexOf('", "');
  
  const minIndex = Math.min(
    leakIndex1 > -1 ? leakIndex1 : Infinity,
    leakIndex2 > -1 ? leakIndex2 : Infinity,
    leakIndex3 > -1 ? leakIndex3 : Infinity
  );

  if (minIndex !== Infinity) {
    text = text.substring(0, minIndex).trim();
  }

  // V5.4: Force-kill common German legal footer leakage
  const footerMatch = text.match(/Einzelhäftsführer|Amtsgericht|USt-IdNr|HRB /i);
  if (footerMatch && footerMatch.index) {
    text = text.substring(0, footerMatch.index).trim();
  }

  // Final quality gate: must have enough readable content
  if (text.length < 20) return null;

  // Take up to 4 clean sentences
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);
  return sentences.length > 0 ? sentences.slice(0, 4).join(' ') : text.substring(0, 500);
}

/**
 * Aggressive JSON Hunter V5.3
 * Finds the outermost { ... } in the AI response, repairs common LLM
 * mistakes, and parses it. Now handles both the legacy 3-key schema
 * (summary, action_steps_explanation, reference_id_highlight) AND the
 * new flat schema (summary, steps, ref).
 *
 * V5.3: Pre-strips "json" prefix and backticks before brace search.
 *       Fixes unquoted keys (summary: "..." → "summary": "...").
 */
function aggressiveJSONParse(raw) {
  if (!raw) return null;

  // V5.3: Pre-clean — strip backticks and leading "json" word
  let cleaned = raw
    .replace(/`/g, '')
    .replace(/^\s*json\s*/i, '');

  // Find the FIRST { and the LAST } in the entire response
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return null;

  let candidate = cleaned.substring(firstBrace, lastBrace + 1);

  // V5.3: Fix unquoted keys — summary: → "summary":
  candidate = candidate
    .replace(/(?<=\{|,)\s*(summary|steps|ref|action_steps_explanation|action_steps|reference_id_highlight|reference_id)\s*:/gi,
      (_, key) => `"${key.toLowerCase()}":`)

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
    const parsed = JSON.parse(candidate);
    return normalizeKeys(parsed);
  } catch (e) { /* continue */ }

  // Attempt 2: Re-extract with a more targeted regex (handles nested content)
  // Supports both old schema (action_steps_explanation) and new flat schema (steps)
  try {
    const reMatch = cleaned.match(/\{\s*"summary"\s*:\s*"([\s\S]*?)"\s*,\s*"(?:steps|action_steps_explanation)"\s*:\s*(?:"([\s\S]*?)"|\[([\s\S]*?)\])/);
    if (reMatch) {
      const summary = reMatch[1].replace(/\\"/g, '"').replace(/"/g, '\\"');
      const stepsStr = reMatch[2];  // flat string format
      const stepsArr = reMatch[3];  // array format

      let steps;
      if (stepsStr) {
        // Flat string: split by semicolons
        steps = stepsStr.split(/;\s*/).filter(s => s.trim().length > 0);
      } else if (stepsArr) {
        steps = stepsArr.match(/"([^"]*)"/g)?.map(s => s.replace(/"/g, '')) || [];
      } else {
        steps = [];
      }

      return { summary: JSON.parse(`"${summary}"`), action_steps_explanation: steps };
    }
  } catch (e) { /* continue */ }

  return null;
}

/**
 * V5.3: Normalize flat-schema keys to the canonical internal schema.
 * Maps "steps" → "action_steps_explanation" and "ref" → "reference_id_highlight".
 * Also splits semicolon-delimited steps into arrays.
 */
function normalizeKeys(parsed) {
  // Map "steps" → "action_steps_explanation"
  if (parsed.steps && !parsed.action_steps_explanation) {
    if (typeof parsed.steps === 'string') {
      // Split semicolon-delimited steps into an array
      parsed.action_steps_explanation = parsed.steps.split(/;\s*/).filter(s => s.trim().length > 0);
    } else if (Array.isArray(parsed.steps)) {
      parsed.action_steps_explanation = parsed.steps;
    }
    delete parsed.steps;
  }

  // Map "ref" → "reference_id_highlight"
  if (parsed.ref !== undefined && !parsed.reference_id_highlight) {
    parsed.reference_id_highlight = parsed.ref;
    delete parsed.ref;
  }

  return parsed;
}

/**
 * Resilient AI Response Parser V5.3
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
  if (typeof jsonParsed.action_steps_explanation === 'string') {
    try {
      const parsed = JSON.parse(jsonParsed.action_steps_explanation);
      if (Array.isArray(parsed)) jsonParsed.action_steps_explanation = parsed;
      else jsonParsed.action_steps_explanation = [jsonParsed.action_steps_explanation];
    } catch (e) {
      jsonParsed.action_steps_explanation = [jsonParsed.action_steps_explanation];
    }
  }

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
