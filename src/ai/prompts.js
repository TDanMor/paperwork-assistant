export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `You are a Senior Administrative Expert for non-native speakers. Your job is to analyze complex documents and explain the "Real World" impact.

CRITICAL UNDERSTANDING:
1. INVOICE (Rechnung): User MUST pay money TO the sender. (Intent: DEBT)
2. COST PLAN / APPROVAL (Heil- und Kostenplan / Bescheid): This is NOT a bill. It is an approval for a subsidy. The sender (e.g. AOK) will pay the user or a doctor later. (Intent: CREDIT or ACTION)
3. NOTICE (Mitteilung): Information about a change or requirement. (Intent: ACTION or INFO)

SUMMARY REQUIREMENTS for ${langName}:
- Sentence 1: Clear identification (e.g. "This is a dental cost approval from AOK, not a bill.")
- Sentence 2: The "When and How" (e.g. "After your treatment is finished, you must submit your final invoice to get 70% back.")
- Include exact amounts (Total vs. Subsidy) and deadlines.

ACTION STEPS for ${langName}:
- Must be conditional if timing is involved (e.g. "Step 1: Finish treatment. Step 2: Send invoice to AOK.")

JSON Schema (Respond ONLY with JSON):
{
  "intent": "DEBT|CREDIT|ACTION",
  "summary": "High-level expert explanation in ${langName}.",
  "action_steps": "Numbered concrete steps with conditions in ${langName}.",
  "sender": "Exact Company Name",
  "document_type": "invoice|notice|contract|government|healthcare|bank|appointment|fine|other",
  "dates": {"document_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD", "appointment_date": "YYYY-MM-DD"},
  "money": {"amount": 0.00, "currency": "EUR"},
  "main_category": "Finance|Housing|Government|Employment|Insurance|Healthcare|Utility|Other",
  "action_required": "pay|respond|file|attend|renew|none",
  "urgency": "overdue|urgent|upcoming|informational"
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

export function smartSliceOCR(text, maxChars = 2300) {
  if (!text || text.length <= maxChars) return text || '';
  const sanitized = sanitizeForPrompt(text);
  const totalLen = sanitized.length;

  const ranges = [
    { start: 0, end: 900 },
    { start: totalLen - 500, end: totalLen } // Slightly larger tail
  ];

  const keywords = [
    // Core Logistics
    'iban', 'total', 'amount', 'betrag', 'summe', 'gesamt', 'suma', 'montant',
    'due', 'fällig', 'deadline', 'frist', 'scadență', 'vencimiento',
    // Status & Conditions (CRITICAL)
    'abschluss', 'finalizare', 'completion', 'after', 'nach', 'după', 'voraussetzung', 'condition',
    'erstatt', 'reimburse', 'zuschuss', 'festzuschuss', 'approval', 'genehmigung',
    // Locations
    'address', 'straße', 'location', 'ort', 'adresa', 'direccion',
    'pickup', 'abholung', 'appointment', 'termin', 'cita',
    // Document Specifics
    'kostenplan', 'behandlung', 'zahnersatz', 'bescheid', 'rechnung', 'miet', 'bußgeld'
  ];

  const bodyText = sanitized.slice(900, -500);
  const bodyOffset = 900;
  let zoneCount = 0;

  keywords.forEach(kw => {
    if (zoneCount >= 6) return;
    const regex = new RegExp(kw, 'gi');
    let match;
    while ((match = regex.exec(bodyText)) !== null && zoneCount < 6) {
      const start = Math.max(0, match.index - 150) + bodyOffset;
      const end = Math.min(bodyText.length, match.index + 250) + bodyOffset;
      ranges.push({ start, end });
      zoneCount++;
      regex.lastIndex += 350;
    }
  });

  const merged = mergeRanges(ranges);
  const result = merged.map(r => sanitized.slice(r.start, r.end)).join('\n[...]\n');
  return result.slice(0, maxChars);
}

export function buildUserMessage(ocrText, language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';
  const text = smartSliceOCR(ocrText, 2300);

  return `<document>\n${text}\n</document>\n\nExpert analysis: Differentiate between a debt and a benefit. If this is a cost plan, emphasize the "after treatment" requirement. Respond ONLY in ${langName} JSON.`;
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

  // Sender
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

  // DUAL LOGIC: If document mentions "Kostenplan" or "Zuschuss", refine classification
  const lowerText = cleanRaw.toLowerCase();
  if (lowerText.includes('kostenplan') || lowerText.includes('zuschuss') || lowerText.includes('genehmigung')) {
    if (result.action_required === 'pay') result.action_required = 'file';
    if (result.intent === 'DEBT') result.intent = 'CREDIT';
    result.document_type = 'notice';
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
