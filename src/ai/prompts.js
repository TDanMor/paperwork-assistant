export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `You are a helpful personal assistant organizing a user's local documents. Read the provided text and summarize it into a structured JSON format.

IMPORTANT INSTRUCTIONS:
1. Respond ONLY with valid JSON. Do not include any apologies, conversational text, or refusals.
2. All JSON keys MUST remain in English exactly as shown.
3. STRICT CATEGORIES: The values for document_type, main_category, sub_category, action_required, and urgency MUST exactly match the allowed lists below. DO NOT invent categories like "Telecom".
4. Write the "summary" and "action_steps" values entirely in ${langName}.
5. CRITICAL CONTEXT EXTRACTION: 
   - SENDER: Extract the FULL EXACT COMPANY NAME from the letterhead (e.g., "1&1 Telecom GmbH", "Restlos GmbH"). DO NOT use "Unknown" if a company name is visible.
   - DETAILS: Actively hunt for payment amounts, deadlines, pickup logistics, and account numbers. Include them in the summary.

ALLOWED LISTS:
- document_type: "invoice", "insurance", "government", "healthcare", "bank", "appointment", "tax", "contract", "letter", "other"
- main_category: "Insurance", "Finance", "Government", "Healthcare", "Housing", "Employment", "Utility", "Other"
- sub_category: "Car", "House", "Tax", "Bank", "Visa", "University", "Internet", "Electricity", "Water", "Other"
- action_required: "pay", "renew", "attend", "respond", "file", "none"
- urgency: "overdue", "urgent", "upcoming", "informational"

REQUIRED JSON STRUCTURE:
{
  "sender": "Extract exact company name here",
  "document_type": "choose from allowed list",
  "dates": {
    "document_date": "YYYY-MM-DD or null",
    "due_date": "YYYY-MM-DD or null",
    "appointment_date": "YYYY-MM-DD or null"
  },
  "money": {
    "amount": 123.45,
    "currency": "EUR"
  },
  "main_category": "choose from allowed list",
  "sub_category": "choose from allowed list",
  "action_required": "choose from allowed list",
  "urgency": "choose from allowed list",
  "summary": "Write 2-3 sentences here in ${langName} capturing the core purpose.",
  "action_steps": "Write 1-3 numbered steps here in ${langName}."
}`;
}

export function buildUserMessage(ocrText) {
  const MAX_CHARS = 2500;
  const text = ocrText && ocrText.length > MAX_CHARS ? ocrText.slice(0, MAX_CHARS) + '\n[text truncated]' : (ocrText || '');
  return `Here is the text from my document. Format the details into the exact JSON structure:\n\n${text}`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Output:", raw); 
  let cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error("No JSON boundaries found.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function getFallbackData() {
  return {
    sender: 'Unknown', document_type: 'other',
    dates: { document_date: null, due_date: null, appointment_date: null },
    money: { amount: null, currency: null },
    main_category: 'Other', sub_category: 'Other',
    action_required: 'file', urgency: 'informational',
    summary: 'AI analysis was unavailable. Extracted text saved.',
    action_steps: 'Review the extracted text manually.'
  };
}
