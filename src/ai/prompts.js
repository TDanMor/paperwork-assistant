import { smartSliceOCR } from './extractor.js'; // We'll move the slicer there for better logic

export function buildSystemPrompt(language, attentionModel) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  const facts = attentionModel.facts;
  const actionsStr = attentionModel.facts.actions.map(a => a.key).join(", ");
  const remedyStr = facts.legal_remedy.present ? `Yes (${facts.legal_remedy.type})` : "No";

  return `You are a Senior Administrative Assistant for documents in Germany.
Target Language: ${langName}.

I have already verified these core facts (DO NOT CONTRADICT THEM):
- Sender: ${facts.sender}
- Primary Action: ${attentionModel.primaryAction}
- Topic: ${facts.nuances.join(", ") || 'General correspondence'}
- Amount: ${facts.amounts[0]?.value || 'N/A'} EUR

YOUR MISSION:
Explain this document to the user in a professional, information-dense summary.
1. Use the <document_snippets> to find the SPECIFIC REASON (e.g. "DSL Monthly Bill", "Health Insurance Refund").
2. Write a comprehensive summary in ${langName}.
3. Provide concrete action steps based on the verified facts.
4. If it's a bill, mention the service period if found in the snippets.

Output ONLY a JSON object: { "summary": "...", "action_steps_explanation": ["..."] }`;
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
