export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `You are a Senior Administrative Expert for non-native speakers. Your job is to analyze complex documents and explain the "Real World" impact.

CRITICAL UNDERSTANDING:
1. INVOICE (Rechnung): User MUST pay money TO the sender.
2. COST PLAN / APPROVAL (Heil- und Kostenplan / Bescheid): This is NOT a bill. It is an approval for a subsidy. The sender (e.g. AOK) will pay the user or a doctor later.
3. NOTICE (Mitteilung): Information about a change or requirement.

ALLOWED LISTS (Use ONLY these exact keys):
- document_type: "invoice", "notice", "contract", "government_letter", "employment", "healthcare", "bank", "appointment", "fine", "other"
- main_category: "Finance", "Housing", "Government", "Employment", "Insurance", "Healthcare", "Utility", "Other"
- action_required: "pay", "respond", "file", "attend", "renew", "none"
- intent: "DEBT", "CREDIT", "ACTION"

SUMMARY REQUIREMENTS for ${langName}:
- Sentence 1: Clear identification (e.g. "This is a dental cost approval from AOK, not a bill.")
- Sentence 2: The "When and How" (e.g. "After your treatment is finished, you must submit your final invoice to get 70% back.")

JSON Schema (Respond ONLY with JSON):
{
  "intent": "DEBT|CREDIT|ACTION",
  "sender": "Exact Company Name",
  "document_type": "choose from list",
  "dates": {"document_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD", "appointment_date": "YYYY-MM-DD"},
  "money": {"amount": 0.00, "currency": "EUR"},
  "main_category": "choose from list",
  "action_required": "choose from list",
  "urgency": "overdue|urgent|upcoming|informational",
  "summary": "Expert explanation in ${langName}.",
  "action_steps": "Numbered steps in ${langName}."
}
If a fact is missing, use null.`;
}

function sanitizeForPrompt(text) {
  return text
    .replace(/ignore (all |previous |above )?instructions?/gi, '[REDACTED]')
    .replace(/you are (now |a )?assistant/gi, '[REDACTED]')
    .replace(/system prompt/gi, '[REDACTED]')
    .replace(/<\/document>/gi, '');
}

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

export function smartSliceOCR(text, maxChars = 4500) {
  if (!text || text.length <= maxChars) return text || '';
  const sanitized = sanitizeForPrompt(text);
  const totalLen = sanitized.length;

  const ranges = [
    { start: 0, end: 1200 },            // Larger Header (0-1200)
    { start: totalLen - 600, end: totalLen } // Larger Tail (Last 600)
  ];

  const keywords = [
    // PRIORITY 1: Logistics & Timing
    'abholung', 'pickup', 'finalizare', 'nach abschluss', 'voraussetzung', 'termin', 'appointment', 'window', 'zeitraum',
    'address', 'straße', 'location', 'ort', 'standort',
    // PRIORITY 2: Financial/Legal Status
    'iban', 'erstatt', 'reimburse', 'zuschuss', 'festzuschuss', 'genehmigung', 'bescheid',
    'due', 'fällig', 'deadline', 'frist', 'scadență',
    // PRIORITY 3: General Metadata
    'total', 'amount', 'betrag', 'summe', 'gesamt', 'rechnung', 'invoice'
  ];

  const bodyText = sanitized.slice(1200, -600);
  const bodyOffset = 1200;
  let zoneCount = 0;

  keywords.forEach(kw => {
    if (zoneCount >= 8) return; // Allow more zones with larger budget
    const regex = new RegExp(kw, 'gi');
    let match;
    while ((match = regex.exec(bodyText)) !== null && zoneCount < 8) {
      const start = Math.max(0, match.index - 150) + bodyOffset;
      const end = Math.min(bodyText.length, match.index + 300) + bodyOffset;
      ranges.push({ start, end });
      zoneCount++;
      regex.lastIndex += 400;
    }
  });

  const merged = mergeRanges(ranges);

  // Assemble segments until we hit maxChars
  let result = "";
  for (const range of merged) {
    const chunk = sanitized.slice(range.start, range.end);
    if ((result.length + chunk.length + 10) > maxChars) break;
    result += (result ? "\n[...]\n" : "") + chunk;
  }

  return result;
}

export function buildUserMessage(ocrText, language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';
  const text = smartSliceOCR(ocrText, 4500);

  return `<document>\n${text}\n</document>\n\nExpert analysis: Differentiate between a debt and a benefit. Focus on LOGISTICS (Location, Time, Conditions). Respond ONLY in ${langName} JSON.`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Response:", raw);
  if (!raw || typeof raw !== 'string') throw new Error("Empty response.");

  const result = getFallbackData();
  let cleanRaw = raw.replace(/\*\*/g, '').replace(/```json/g, '').replace(/```/g, '').trim();

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
        jsonParsed = JSON.parse(jsonStr.replace(/,\s*([}\]])/g, '$1'));
      }
    }
  } catch (e) {
    console.warn("JSON fail.");
  }

  const getFuzzy = (regex) => {
    const match = cleanRaw.match(regex);
    return match ? match[1].trim() : null;
  };

  const rawSender = findKeyInObj(jsonParsed, ['sender', 'company', 'companyname', 'from']);
  if (rawSender && typeof rawSender === 'object') {
    result.sender = rawSender.company_name || rawSender.name || Object.values(rawSender)[0] || result.sender;
  } else {
    result.sender = rawSender || getFuzzy(/(?:Sender|Company|From):\s*(.*?)(?:\n|$)/i) || result.sender;
  }

  const rawSummary = findKeyInObj(jsonParsed, ['summary', 'explanation']) || getFuzzy(/(?:Summary|Explanation|Analysis):\s*([\s\S]*?)(?:Action Steps|What to do|JSON|$)/i) || cleanRaw.split('\n\n')[0].trim();
  result.summary = Array.isArray(rawSummary) ? rawSummary.join(' ') : rawSummary;

  const rawSteps = findKeyInObj(jsonParsed, ['actionsteps', 'steps']) || getFuzzy(/(?:Action Steps|What to do|Steps|Important Notes):\s*([\s\S]*?)(?:Exact Address|Contact|JSON|$)/i) || "Check the document for instructions.";
  result.action_steps = Array.isArray(rawSteps) ? rawSteps.join(' ') : rawSteps;

  result.intent = findKeyInObj(jsonParsed, ['intent']) || result.intent;
  result.document_type = findKeyInObj(jsonParsed, ['documenttype', 'type']) || (cleanRaw.toLowerCase().includes('rechnung') ? 'invoice' : result.document_type);
  result.main_category = findKeyInObj(jsonParsed, ['maincategory', 'category']) || result.main_category;
  result.action_required = findKeyInObj(jsonParsed, ['actionrequired', 'action']) || result.action_required;
  result.urgency = findKeyInObj(jsonParsed, ['urgency', 'priority']) || result.urgency;

  const validActions = ["pay", "respond", "file", "attend", "renew", "none"];
  let act = String(result.action_required).toLowerCase();
  if (!validActions.includes(act)) {
    if (act.includes('pay')) act = 'pay';
    else if (act.includes('respond') || act.includes('submit') || act.includes('send')) act = 'respond';
    else if (act.includes('attend') || act.includes('appointment')) act = 'attend';
    else if (act.includes('file') || act.includes('save')) act = 'file';
    else act = 'none';
  }
  result.action_required = act;

  const lowerText = cleanRaw.toLowerCase();
  if (lowerText.includes('kostenplan') || lowerText.includes('zuschuss') || lowerText.includes('genehmigung')) {
    if (result.intent === 'DEBT') result.intent = 'CREDIT';
    if (act === 'pay') result.action_required = 'file';
  }

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
