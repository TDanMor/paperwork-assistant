export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Analyze this document. Output ONLY a FLAT valid JSON object.
Respond ONLY with JSON. No prose. No "document" wrapper key.

REQUIRED SCHEMA (Order is Critical):
{
  "intent": "DEBT|CREDIT|ACTION",
  "summary": "2 simple sentences in ${langName} explaining what this is and what to do.",
  "action_steps": "Numbered steps in ${langName}.",
  "sender": "Exact Company Name",
  "document_type": "invoice|notice|contract|government|healthcare|bank|appointment|fine|other",
  "dates": {"document_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD", "appointment_date": "YYYY-MM-DD"},
  "money": {"amount": 0.00, "currency": "EUR"},
  "main_category": "Finance|Housing|Government|Employment|Insurance|Healthcare|Utility|Other",
  "action_required": "pay|respond|file|attend|renew|none",
  "urgency": "overdue|urgent|upcoming|informational"
}
If a fact is missing, use null. Translate summary and steps into ${langName}.`;
}

function sanitizeForPrompt(text) {
  return text
    .replace(/ignore (all |previous |above )?instructions?/gi, '[REDACTED]')
    .replace(/you are (now |a )?assistant/gi, '[REDACTED]')
    .replace(/system prompt/gi, '[REDACTED]')
    .replace(/<\/document>/gi, '');
}

/**
 * Merges overlapping text ranges to avoid redundant content in the prompt.
 */
function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged;
}

export function smartSliceOCR(text, maxChars = 2300) {
  if (!text || text.length <= maxChars) return text || '';

  const sanitized = sanitizeForPrompt(text);
  const totalLen = sanitized.length;

  const ranges = [
    { start: 0, end: 900 },
    { start: totalLen - 400, end: totalLen }
  ];

  const keywords = [
    'iban', 'total', 'amount', 'betrag', 'summe', 'gesamt', 'suma', 'montant',
    'due', 'fällig', 'deadline', 'frist', 'scadență', 'echeance', 'vencimiento',
    'address', 'straße', 'location', 'ort', 'adresa', 'direccion',
    'pickup', 'abholung', 'appointment', 'termin', 'programare', 'cita',
    'miet', 'rent', 'chirie', 'alquiler', 'loyer',
    'fine', 'bußgeld', 'amendă', 'multa', 'amende',
    'festzuschuss', 'zuschuss', 'kostenplan', 'genehmigung', 'bescheid'
  ];

  const bodyText = sanitized.slice(900, -400);
  const bodyOffset = 900;
  let zoneCount = 0;

  keywords.forEach(kw => {
    if (zoneCount >= 5) return;
    const regex = new RegExp(kw, 'gi');
    let match;
    while ((match = regex.exec(bodyText)) !== null && zoneCount < 5) {
      const start = Math.max(0, match.index - 150) + bodyOffset;
      const end = Math.min(bodyText.length, match.index + 250) + bodyOffset;
      ranges.push({ start, end });
      zoneCount++;
      regex.lastIndex += 300;
    }
  });

  const merged = mergeRanges(ranges);
  const result = merged
    .map(r => sanitized.slice(r.start, r.end))
    .join('\n[...]\n');

  return result.slice(0, maxChars);
}

export function buildUserMessage(ocrText, language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';
  const text = smartSliceOCR(ocrText, 2300);

  return `<document>\n${text}\n</document>\n\nAnalyze the document above. Respond ONLY in ${langName} using the JSON schema.`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Response:", raw);
  
  if (!raw || typeof raw !== 'string') {
    throw new Error("Invalid or empty response received from AI.");
  }

  const result = getFallbackData();
  let cleanRaw = raw.replace(/\*\*/g, '').replace(/```json/g, '').replace(/```/g, '').trim();

  // Helper to find a key anywhere in a potentially nested object
  const findKeyInObj = (obj, targetKeys) => {
    if (!obj || typeof obj !== 'object') return null;
    for (const target of targetKeys) {
      const normalizedTarget = target.toLowerCase().replace(/[\s_]/g, '');
      const foundKey = Object.keys(obj).find(k => k.toLowerCase().replace(/[\s_]/g, '') === normalizedTarget);
      if (foundKey) return obj[foundKey];
    }
    for (const k in obj) {
      if (typeof obj[k] === 'object') {
        const deepMatch = findKeyInObj(obj[k], targetKeys);
        if (deepMatch) return deepMatch;
      }
    }
    return null;
  };

  let jsonParsed = null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];
      if (jsonStr.split('{').length > jsonStr.split('}').length) {
        jsonStr += '}'.repeat(jsonStr.split('{').length - jsonStr.split('}').length);
      }
      try {
        jsonParsed = JSON.parse(jsonStr);
      } catch(e) {
        const repaired = jsonStr.replace(/,\s*([}\]])/g, '$1');
        jsonParsed = JSON.parse(repaired);
      }
    }
  } catch (e) {
    console.warn("JSON parsing failed, falling back to regex.");
  }

  const getFuzzy = (regex) => {
    const match = cleanRaw.match(regex);
    return match ? match[1].trim() : null;
  };

  result.sender = findKeyInObj(jsonParsed, ['sender', 'company']) || getFuzzy(/(?:Sender|Company|From):\s*(.*?)(?:\n|$)/i) || result.sender;
  result.summary = findKeyInObj(jsonParsed, ['summary', 'explanation']) || getFuzzy(/(?:Summary|Explanation|Analysis):\s*([\s\S]*?)(?:Action Steps|What to do|JSON|$)/i) || cleanRaw.split('\n\n')[0].trim();
  result.action_steps = findKeyInObj(jsonParsed, ['actionsteps', 'steps']) || getFuzzy(/(?:Action Steps|What to do|Steps|Important Notes):\s*([\s\S]*?)(?:Exact Address|Contact|JSON|$)/i) || "Check the document for instructions.";

  result.intent = findKeyInObj(jsonParsed, ['intent']) || result.intent;
  result.document_type = findKeyInObj(jsonParsed, ['documenttype', 'type']) || (cleanRaw.toLowerCase().includes('rechnung') ? 'invoice' : result.document_type);
  result.main_category = findKeyInObj(jsonParsed, ['maincategory', 'category']) || result.main_category;
  result.action_required = findKeyInObj(jsonParsed, ['actionrequired', 'action']) || result.action_required;
  result.urgency = findKeyInObj(jsonParsed, ['urgency', 'priority']) || result.urgency;

  const moneyObj = findKeyInObj(jsonParsed, ['money']);
  if (moneyObj && typeof moneyObj === 'object') {
    result.money = { ...result.money, ...moneyObj };
  } else {
    const amt = findKeyInObj(jsonParsed, ['amount', 'total', 'gesamtbetrag']) || getFuzzy(/(?:Total Amount|Gesamtbetrag|Total|Amount|EUR):\s*.*?(\d+[.,]\d{2,})/i);
    if (amt) result.money.amount = parseFloat(String(amt).replace(',', '.').replace(/[^0-9.]/g, ''));
  }

  const datesObj = findKeyInObj(jsonParsed, ['dates']);
  if (datesObj && typeof datesObj === 'object') {
    result.dates = { ...result.dates, ...datesObj };
  }

  const textAddr = getFuzzy(/(?:Address|Location|Standort|Exact Address|Schreiberhauer):\s*([\s\S]*?)(?:\n\n|\n\*|$)/i);
  const textTime = getFuzzy(/(?:Time|Abholung|Zeitraum|Exact Time):\s*(.*?)(?:\n|$)/i);
  const textIban = getFuzzy(/IBAN:\s*([A-Z]{2}\d{2}[A-Z0-9\s]{10,34})/i);

  if (textAddr && !result.summary.includes(String(textAddr))) result.summary += ` \nLocation: ${textAddr}`;
  if (textTime && !result.summary.includes(String(textTime))) result.summary += ` \nTime: ${textTime}`;
  if (textIban && !result.summary.includes(textIban)) result.summary += ` \nIBAN: ${textIban}`;

  return result;
}

export function getFallbackData() {
  return {
    sender: 'Unknown', document_type: 'other',
    dates: { document_date: null, due_date: null, appointment_date: null },
    money: { amount: null, currency: 'EUR' },
    main_category: 'Other', sub_category: 'Other',
    action_required: 'file', urgency: 'informational',
    summary: 'AI analysis was unavailable. Review manually.',
    action_steps: 'Check the document for instructions.'
  };
}
