import { smartSliceOCR } from './extractor.js';

/**
 * Paperwork Assistant - Master Brain V5.4 (Language Lockdown)
 *
 * Philosophy: Context Isolation. We move German text snippets into the 'Data' layer
 * (User Message) and keep the 'Instruction' layer (System Prompt) purely in the
 * user's target language. This forces the tiny 0.5B model to switch languages
 * before it even reads the document.
 */

export function buildSystemPrompt(language, attentionModel) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';
  const facts = attentionModel.facts;
  const amount = facts.amounts[0]?.value ? `${facts.amounts[0].value} EUR` : 'N/A';

  /* ─── The Language Hammer ──────────────────────────────────────
   * We place the language command at the absolute start of the prompt.
   * This 'primes' the tiny model's brain for the correct vocabulary.
   * ────────────────────────────────────────────────────────────── */
  return `THINK AND WRITE ONLY IN ${langName.toUpperCase()}.
You are a helpful assistant. You are explaining a German document to a user who speaks ${langName}.

VERIFIED FACTS (Use these exactly):
- Sender: ${facts.sender}
- Topic: ${facts.document_topic || 'Correspondence'}
- Amount: ${amount}

INSTRUCTIONS:
You must translate the meaning of the German text provided in the next message into ${langName}.
1. "summary": Write 3-4 natural, friendly sentences in ${langName} explaining what this is.
2. "steps": Write 1-3 short commands in ${langName} (e.g. "Pay the bill", "File away").
3. "ref": Include the reference number or null.

RULES:
- NEVER use German words in your summary unless ${langName} is German.
- NEVER echo technical arrays like ["text", "text"].
- Respond ONLY with a raw JSON object. No markdown, no "json" tags, no backticks.`;
}

export function buildUserMessage(ocrText, language, attentionModel) {
  const facts = attentionModel.facts;
  const text = smartSliceOCR(ocrText, 2500, facts);

  // 🛡️ Context Isolation: The German text is fed here as 'Data'
  const contextBlock = (facts.context_sentences && facts.context_sentences.length > 0)
    ? `\nKEY GERMAN SENTENCES TO TRANSLATE:\n${facts.context_sentences.map(s => `- "${s}"`).join('\n')}`
    : '';

  return `DOCUMENT CONTENT TO SUMMARIZE:
<snippets>
${text}
</snippets>
${contextBlock}

Please write the summary and steps in ${language === 'de' ? 'German' : 'English/Target Language'}. JSON format only.`;
}

/**
 * Deep Clean Rescue V5.4 — Aggressive 'Technical Noise' Disposal.
 * Surgically removes brackets, key names, and technical tags.
 */
function deepCleanRescue(raw) {
  if (!raw || raw.trim().length < 5) return null;

  let text = raw;

  // 1. Kill code fences and language tags
  text = text.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').replace(/^json/i, '');

  // 2. Kill technical JSON artifacts (aggressive pass)
  // This removes things like ["Summary: ..."] or {summary: "..."}
  const technicalGarbage = [
    /\{/g, /\}/g, /\[/g, /\]/g, /"/g,
    /\b(summary|steps|ref|action_steps_explanation|reference_id_highlight|description)\s*[:]\s*/gi
  ];
  technicalGarbage.forEach(pattern => { text = text.replace(pattern, ''); });

  // 3. Kill common LLM prefixes
  text = text.replace(/^(Here is|Below is|This is)[^.]*[.:]\s*/i, '').trim();

  // 4. Truncate at common leakage points
  // If the AI started outputting the next field mid-string, we cut it off.
  const stopMarkers = [", steps:", ", ref:", ", [", '", "'];
  stopMarkers.forEach(marker => {
    const idx = text.indexOf(marker);
    if (idx !== -1) text = text.substring(0, idx);
  });

  // Final trim and sentence recovery
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);
  return sentences.length > 0 ? sentences.slice(0, 4).join(' ') : text.substring(0, 400);
}

/**
 * Converts German date format (DD.MM.YYYY) to ISO (YYYY-MM-DD).
 */
function germanDateToISO(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!parts) return dateStr;
  let [, d, m, y] = parts;
  if (y.length === 2) y = '20' + y;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Resilient Parser V5.4
 */
export function parseAIResponse(raw, attentionModel) {
  console.log("Raw AI Response:", raw);
  let jsonParsed = {};

  // STAGE 1: Aggressive JSON Hunter
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const candidate = raw.substring(start, end + 1)
        .replace(/,\s*([\]}])/g, '$1') // Fix trailing commas
        .replace(/\n/g, ' ');         // Flat for parsing
      jsonParsed = JSON.parse(candidate);
    }
  } catch (e) {
    console.warn("JSON Parse failed, falling back to Rescue.");
  }

  // STAGE 2: Normalize Keys (Map flat to internal)
  if (jsonParsed.steps && !jsonParsed.action_steps_explanation) {
    jsonParsed.action_steps_explanation = typeof jsonParsed.steps === 'string' ? jsonParsed.steps.split(';') : jsonParsed.steps;
  }
  if (jsonParsed.ref && !jsonParsed.reference_id_highlight) {
    jsonParsed.reference_id_highlight = jsonParsed.ref;
  }

  // STAGE 3: Deep Clean the text
  const finalSummary = jsonParsed.summary ? deepCleanRescue(jsonParsed.summary) : deepCleanRescue(raw);

  const facts = attentionModel.facts;
  const mainCat = (facts.nuances && facts.nuances[0]) ? facts.nuances[0] : 'Finance';

  return {
    sender: facts.sender,
    reference_numbers: facts.reference_numbers,
    summary: finalSummary || `Document from ${facts.sender} regarding ${facts.nuances.join(', ') || 'matters'}.`,
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
    summary: 'System was unable to perform deep analysis. Please check original image.',
    action_steps: ["Check for deadlines", "Verify payment amounts"],
    reference_numbers: {}
  };
}
