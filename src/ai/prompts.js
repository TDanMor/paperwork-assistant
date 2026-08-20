import { smartSliceOCR } from './extractor.js'; // We'll move the slicer there for better logic

export function buildSystemPrompt(language, attentionModel) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  const facts = attentionModel.facts;
  const actionsStr = attentionModel.facts.actions.map(a => a.key).join(", ");
  const remedyStr = facts.legal_remedy.present ? `Yes (${facts.legal_remedy.type})` : "No";

  return `Expert Admin Guide. Target: ${langName}.
Factual Context:
- Sender: ${facts.sender} (${facts.risk_flags.sender_looks_official ? 'Official Authority' : 'Private'})
- Legal Stage: ${facts.doc_stage}
- Polarity: ${facts.polarity_overall}
- Primary Action: ${attentionModel.primaryAction}
- Multiple Obligations: [${actionsStr}]
- Appeal Possible: ${remedyStr}
- Attachments found: ${facts.attachments?.length || 0}
- Historical Change: ${attentionModel.amountChanged ? 'Yes (Amount has changed from previous doc)' : 'No'}
- Action Location: ${facts.addresses.action || 'Not specified'}

Your job is only to EXPLAIN these facts to the user in simple ${langName}.
CRITICAL: You MUST use the facts provided. Do NOT hallucinate a different Sender or Action.
Rules:
1. Explain WHAT this is (e.g. ${facts.doc_stage} from ${facts.sender}).
2. Explain the legal weight and required action (${attentionModel.primaryAction}).
3. Mention any attachments or action locations found.
4. If it's a bill, remind the user of the amount: ${facts.amounts[0]?.value || 'see details'}.
5. Do NOT change the actions or numbers.
5. Output ONLY a FLAT JSON object.

JSON Schema: {summary, action_steps_explanation}`;
}

export function buildUserMessage(ocrText, language, attentionModel) {
  // Use the indices from the attentionModel to grab context windows
  const text = smartSliceOCR(ocrText, 2500, attentionModel.facts);
  return `<document_snippets>\n${text}\n</document_snippets>\n\nExplain the document based on the injected facts. JSON in English keys, values in target language.`;
}

export function parseAIResponse(raw, attentionModel) {
  console.log("Raw AI Explainer Response:", raw);
  let jsonParsed = {};
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonParsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn("AI explanation failed to parse.");
  }

  // Combine Deterministic Facts with AI Explanations
  return {
    sender: attentionModel.facts.sender,
    summary: jsonParsed.summary || "Summary generated based on document facts.",
    action_steps: jsonParsed.action_steps_explanation || attentionModel.facts.actions.map(a => a.reason),
    document_type: attentionModel.facts.polarity_overall === 'nachzahlung' ? 'invoice' : 'notice',
    main_category: attentionModel.facts.sender.includes('AOK') ? 'Healthcare' : 'Finance',
    sub_category: 'Other',
    money: {
      amount: attentionModel.facts.amounts[0]?.value || null,
      currency: 'EUR'
    },
    dates: {
      document_date: attentionModel.facts.dates.find(d => d.role === 'issued')?.value || null,
      due_date: attentionModel.facts.dates.find(d => d.role === 'due')?.value || null,
      appointment_date: attentionModel.facts.dates.find(d => d.role === 'appointment')?.value || null
    },
    urgency: attentionModel.urgency,
    action_required: attentionModel.primaryAction,
    actions: attentionModel.facts.actions
  };
}

export function getFallbackData() {
  return {
    sender: 'Unknown', document_type: 'other',
    dates: { document_date: null, due_date: null, appointment_date: null },
    money: { amount: null, currency: 'EUR' },
    main_category: 'Other', sub_category: 'Other', action_required: 'file', urgency: 'informational',
    summary: 'System processing was limited. Review extracted text manually.',
    action_steps: []
  };
}
