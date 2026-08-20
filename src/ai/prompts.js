import { smartSliceOCR } from './extractor.js'; // We'll move the slicer there for better logic

export function buildSystemPrompt(language, attentionModel) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  const facts = attentionModel.facts;
  const actionsStr = attentionModel.facts.actions.map(a => a.key).join(", ");

  return `Expert Admin Guide. Target: ${langName}.
Factual Context:
- Sender: ${facts.sender}
- Polarity: ${facts.polarity_overall}
- Primary Action: ${attentionModel.primaryAction}
- Multiple Obligations: [${actionsStr}]

Your job is only to EXPLAIN these facts to the user in simple ${langName}.
Rules:
1. Explain WHAT this is (e.g. AOK subsidy approval).
2. Explain WHEN to act based on the facts (Now? After event?).
3. Do NOT invent new numbers or dates.
4. Output ONLY a FLAT JSON object.

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
    main_category: 'Other', action_required: 'file', urgency: 'informational',
    summary: 'System processing was limited. Review extracted text manually.',
    action_steps: []
  };
}
