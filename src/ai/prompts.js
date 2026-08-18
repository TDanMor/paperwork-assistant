export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `You are an aggressive document intelligence assistant. Your sole job is to extract high-priority actionable facts so the user never misses a deadline, payment, or requirement.

CRITICAL FORMATTING RULES:
1. You MUST output ONLY valid JSON. No markdown code blocks, no conversational filler.
2. All JSON keys MUST remain in English exactly as shown.
3. The "action_steps" field MUST be a single plain text string with clear numbered sentences, NOT an array or nested object.
4. Write the "summary" and "action_steps" values entirely in ${langName}.

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
  "summary": "Write 2-3 detailed sentences in ${langName} including exact amounts, deadlines, and locations.",
  "action_steps": "Write 1-3 concrete steps as a single plain text string in ${langName}."
}`;
}

export function buildUserMessage(ocrText) {
  const MAX_CHARS = 2500;
  const text = ocrText && ocrText.length > MAX_CHARS ? ocrText.slice(0, MAX_CHARS) + '\n[text truncated]' : (ocrText || '');
  return `Analyze this document text aggressively and extract all vital intelligence into the JSON structure:\n\n${text}`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Response:", raw);
  
  if (!raw || typeof raw !== 'string') {
    throw new Error("Invalid or empty response received from AI.");
  }

  try {
    const jsonMatch = raw.match(/```json\s?([\s\S]*?)\s?```/) || raw.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : raw;
    
    const parsed = JSON.parse(cleanJson.replace(/,\s*([}\\]])/g, '$1'));

    // 🛡️ BULLETPROOF TYPE CONVERSION 🛡️
    // Force action_steps into a clean string so React can never crash with "Objects are not valid as a React child"
    if (Array.isArray(parsed.action_steps)) {
      parsed.action_steps = parsed.action_steps
        .map((item, idx) => `${idx + 1}. ${typeof item === 'string' ? item : (item.step || JSON.stringify(item))}`)
        .join(' ');
    } else if (typeof parsed.action_steps === 'object' && parsed.action_steps !== null) {
      parsed.action_steps = Object.values(parsed.action_steps)
        .map(val => (typeof val === 'string' ? val : JSON.stringify(val)))
        .join(' ');
    }

    return parsed;
  } catch (e) {
    throw new Error("Failed to parse AI response as JSON: " + raw.substring(0, 50) + "...");
  }
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
