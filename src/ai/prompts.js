import { smartSliceOCR } from './extractor.js';

/**
 * Paperwork Assistant - Master Level Prompting V4.0
 *
 * Integrates deterministic German bureaucratic facts to constrain LLM hallucinations.
 */

export function buildSystemPrompt(language, attentionModel) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  const facts = attentionModel.facts;

  // Reference Numbers for LLM guidance
  const refStr = Object.entries(facts.reference_numbers || {})
    .filter(([_, v]) => v)
    .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
    .join(", ") || "None detected";

  const ibanStr = (facts.ibans && facts.ibans.length > 0) ? facts.ibans[0] : "None detected";
  const deadlineStr = facts.legal_remedy?.deadline || "N/A";
  const confirmedInvoice = facts.table?.confirmed ? "YES (VAT Math verified)" : "No (Deterministic verification failed)";

  return `You are an expert Senior Administrative Assistant specializing in German bureaucracy.
Target Language: ${langName}.

I have already verified these CORE FACTS via deterministic parsing. DO NOT CONTRADICT THEM:
- Sender: ${facts.sender}
- Reference Numbers: ${refStr}
- IBAN detected: ${ibanStr}
- Confirmed Invoice: ${confirmedInvoice}
- Primary Action: ${attentionModel.primaryAction}
- Main Topic: ${facts.nuances.join(", ") || 'General Correspondence'}
- Amount: ${facts.amounts[0]?.value || 'N/A'} EUR
- Legal Remedy Deadline: ${deadlineStr}

YOUR MISSION:
Explain this document to the user in a professional, information-dense summary.
1. Use the <document_snippets> to find the SPECIFIC REASON for this document (e.g. "Tax Assessment 2023", "Internet Bill for August").
2. Write a comprehensive summary in ${langName}.
3. Mention the Reference Numbers (Aktenzeichen/Kassenzeichen) so the user can easily find them.
4. If a 'Legal Remedy Deadline' (Widerspruchsfrist) is provided above, EXPLICITLY state it as the final date for action.
5. Provide concrete, numbered action steps based on the verified facts.

Output ONLY a JSON object: { "summary": "...", "action_steps_explanation": ["..."], "reference_id_highlight": "..." }`;
}

export function buildUserMessage(ocrText, language, attentionModel) {
  const text = smartSliceOCR(ocrText, 3000, attentionModel.facts);
  return `<document_snippets>\n${text}\n</document_snippets>\n\nExplain the document based on the injected bureaucratic facts. JSON format with English keys, values in ${language}.`;
}

export function parseAIResponse(raw, attentionModel) {
  console.log("Master Level AI Response:", raw);
  let jsonParsed = {};
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonParsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn("AI explanation failed to parse. Falling back to deterministic summary.");
  }

  const facts = attentionModel.facts;

  // Merge Deterministic Facts with AI-generated narrative
  return {
    sender: facts.sender,
    reference_numbers: facts.reference_numbers,
    summary: jsonParsed.summary || `Document from ${facts.sender} regarding ${facts.nuances.join(', ') || 'general matters'}.`,
    action_steps: jsonParsed.action_steps_explanation || facts.actions.map(a => a.reason),
    document_type: facts.polarity_overall === 'nachzahlung' ? 'invoice' : (facts.legal_remedy.present ? 'notice' : 'other'),
    main_category: facts.nuances[0] || 'Finance',
    sub_category: facts.doc_stage,
    money: {
      amount: facts.amounts[0]?.value || null,
      currency: 'EUR',
      is_vat_verified: !!facts.table?.confirmed
    },
    dates: {
      document_date: facts.dates.find(d => d.role === 'issued')?.value || null,
      due_date: facts.dates.find(d => d.role === 'due')?.value || null,
      appointment_date: facts.dates.find(d => d.role === 'appointment')?.value || null,
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
    summary: 'System was unable to perform deep analysis. Please check reference numbers manually.',
    action_steps: ["Read the document carefully", "Check for any deadlines"],
    reference_numbers: {}
  };
}
