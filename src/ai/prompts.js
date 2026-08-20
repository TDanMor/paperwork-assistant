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

  return `You are a Senior Administrative Assistant for documents in Germany.
Target Language: ${langName}.

I have already verified these CORE FACTS. You MUST use them to brief the user:
- Sender: ${facts.sender}
- Reference: ${refStr}
- Action: ${attentionModel.primaryAction}
- Reason/Topic: ${facts.nuances.join(", ") || 'General Correspondence'}
- Amount: ${facts.amounts[0]?.value || 'N/A'} EUR

YOUR MISSION:
Brief the user about this document in a professional way.
1. SUMMARY: Write 3-4 detailed sentences explaining EXACTLY what this is.
   - For AOK: Look specifically for reimbursement details and if BANK DETAILS/IBAN need to be submitted.
   - For RESTLOS: Look for specific PICKUP WINDOWS (Date and Time range).
2. ACTION STEPS: Provide a list of short, concrete commands (e.g. "Send IBAN to AOK", "Place container outside by 09:00").
3. Use the <document_snippets> to find specific details like time windows, service periods, or account IDs.

Output ONLY a JSON object: { "summary": "Detailed narrative here", "action_steps_explanation": ["Step 1", "Step 2"], "reference_id_highlight": "..." }`;
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
  const mainCat = (facts.nuances && facts.nuances[0]) ? facts.nuances[0] : 'Finance';

  // Merge Deterministic Facts with AI-generated narrative
  return {
    sender: facts.sender,
    reference_numbers: facts.reference_numbers,
    summary: jsonParsed.summary || `Document from ${facts.sender} regarding ${facts.nuances.join(', ') || 'general matters'}.`,
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
