import { smartSliceOCR } from './extractor.js';

/**
 * Paperwork Assistant - Human Storyteller Prompting V5.0
 *
 * Philosophy: The deterministic layer (extractor.js) finds the WHAT.
 * This prompt layer tells the AI to explain the WHY in plain language.
 * Optimized for Llama-3.2-1B/3B: short, direct instructions with examples.
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
- Never say "check the document" — YOU are the one reading it for the user.
- Respond ONLY with the JSON object. Do NOT use markdown code blocks or XML tags like <document_summary>.`;
}

export function buildUserMessage(ocrText, language, attentionModel) {
  const text = smartSliceOCR(ocrText, 3000, attentionModel.facts);
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';
  return `<document_snippets>\n${text}\n</document_snippets>\n\nExplain this letter to the user. Write the JSON with values in ${langName}.`;
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
 * Resilient AI Response Parser
 * Priority: Valid JSON > Rescued JSON > Rescued plain text > Human-friendly fallback
 */
export function parseAIResponse(raw, attentionModel) {
  console.log("AI Response:", raw);
  let jsonParsed = {};
  let rescueSummary = null;

  // --- STAGE 1: Try clean JSON extraction ---
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      // Fix common LLM JSON mistakes: trailing commas
      const cleaned = jsonMatch[0].replace(/,\s*([\]}])/g, '$1');
      jsonParsed = JSON.parse(cleaned);
    }
  } catch (e) {
    console.warn("JSON parse failed, attempting rescue...");
  }

  // --- STAGE 2: Rescue natural language if JSON failed ---
  if (!jsonParsed.summary && raw && raw.trim().length > 30) {
    // Strip any partial JSON fragments or XML tags
    const plainText = raw
      .replace(/<[^>]*>?/gm, '')         // Remove XML/HTML tags
      .replace(/```[\s\S]*?```/g, '')   // Remove code blocks
      .replace(/\{[\s\S]*$/g, '')        // Remove broken JSON at end
      .replace(/^[\s\S]*?\}/g, '')       // Remove broken JSON at start
      .replace(/^(Summary|Briefing|Description):\s*/i, '') // Remove prefixes
      .replace(/"(summary|action_steps_explanation|reference_id_highlight)":\s*/gi, '') // Remove internal key names
      .replace(/"/g, '')                 // Remove stray quotes
      .trim();

    if (plainText.length > 30) {
      // Take up to the first 2-3 meaningful sentences
      const sentences = plainText.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);
      rescueSummary = sentences.slice(0, 3).join(' ');
    } else {
      // Last resort: use the raw text directly
      rescueSummary = raw.trim().substring(0, 400);
    }
  }

  const facts = attentionModel.facts;
  const mainCat = (facts.nuances && facts.nuances[0]) ? facts.nuances[0] : 'Finance';

  // --- STAGE 3: Human-friendly deterministic fallback ---
  // Only used if both AI JSON and rescue failed
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
