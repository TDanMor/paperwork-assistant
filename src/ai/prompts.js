export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `You are a Direct Logistics Guide. Your job is to explain documents to non-native speakers who know nothing about the document.

CRITICAL PERSONA:
- Be direct and clear.
- Use simple words.
- Focus only on what they MUST do.
- Explain the document purpose (e.g., "This is an invoice for office furniture you bought").

CRITICAL RULES:
1. Output ONLY valid JSON.
2. NO conversational filler. NO "Here is the analysis".
3. START with "{" and END with "}".

JSON Schema:
{
  "sender": "Exact Company Name",
  "document_type": "invoice|insurance|government|healthcare|bank|appointment|tax|contract|letter|other",
  "dates": {"document_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD", "appointment_date": "YYYY-MM-DD"},
  "money": {"amount": 0.00, "currency": "EUR"},
  "main_category": "Insurance|Finance|Government|Healthcare|Housing|Employment|Utility|Other",
  "sub_category": "Car|House|Tax|Bank|Visa|University|Internet|Electricity|Water|Other",
  "action_required": "pay|renew|attend|respond|file|none",
  "urgency": "overdue|urgent|upcoming|informational",
  "summary": "Explain exactly what this document is and why it matters in 2 sentences in ${langName}. Include total money, address, and date.",
  "action_steps": "1. [Verb] step one. 2. [Verb] step two. Include location and time in ${langName}."
}`;
}

export function smartSliceOCR(text, maxChars = 2500) {
  if (!text || text.length <= maxChars) return text || '';

  const header = text.slice(0, 1000);
  const remaining = text.slice(1000);

  const keywords = [
    'address', 'straße', 'strasse', 'pickup', 'abholung', 'appointment', 'termin',
    'due', 'fällig', 'iban', 'total', 'betrag', 'deadline', 'location', 'ort',
    'opening', 'öffnungszeiten', 'window', 'zeitraum', 'gesamt', 'summe',
    'abholschein', 'rechnungsnummer', 'transfer', 'überweisung', 'rechnung'
  ];

  const segments = [];
  keywords.forEach(kw => {
    const regex = new RegExp(kw, 'gi');
    let match;
    while ((match = regex.exec(remaining)) !== null && segments.length < 6) {
      const start = Math.max(0, match.index - 120);
      const end = Math.min(remaining.length, match.index + 230);
      segments.push(remaining.slice(start, end));
      regex.lastIndex += 250;
    }
  });

  const body = segments.join('\n[...]\n');
  const result = `${header}\n[... SECTION BREAK ...]\n${body}`;

  return result.slice(0, maxChars);
}

export function buildUserMessage(ocrText) {
  const text = smartSliceOCR(ocrText, 2500);
  return `Act as a guide for a non-native speaker. Analyze this text. Focus on TOTAL AMOUNT, IBAN, and EXACT PICKUP LOGISTICS. Output ONLY the JSON:\n\n${text}`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Response:", raw);
  
  if (!raw || typeof raw !== 'string') {
    throw new Error("Invalid or empty response received from AI.");
  }

  const result = getFallbackData();
  const cleanRaw = raw.replace(/\*\*/g, '').replace(/```json/g, '').replace(/```/g, '').trim();

  // 1. BASELINE EXTRACTION (Aggressive Fuzzy)
  const getFuzzy = (regex) => {
    const match = cleanRaw.match(regex);
    return match ? match[1].trim() : null;
  };

  const textAmount = getFuzzy(/(?:Total Amount|Gesamtbetrag|Total|Amount|EUR):\s*.*?(\d+[.,]\d{2,})/i);
  const textIban = getFuzzy(/IBAN:\s*([A-Z]{2}\d{2}[A-Z0-9\s]{10,34})/i);
  const textAddr = getFuzzy(/(?:Address|Location|Standort|Exact Address|Schreiberhauer):\s*([\s\S]*?)(?:\n\n|\n\*|$)/i);
  const textTime = getFuzzy(/(?:Time|Abholung|Zeitraum|Exact Time):\s*(.*?)(?:\n|$)/i);
  const textSender = getFuzzy(/(?:Sender|Company|From):\s*(.*?)(?:\n|$)/i);

  // Detect document type and categories from raw text if missing
  if (cleanRaw.toLowerCase().includes('rechnung') || cleanRaw.toLowerCase().includes('invoice')) {
    result.document_type = 'invoice';
    result.action_required = 'pay';
    result.main_category = 'Finance';
  }

  // 2. JSON EXTRACTION
  let jsonParsed = null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const cleanJson = jsonMatch[0].replace(/,\s*([}\\]])/g, '$1');
      jsonParsed = JSON.parse(cleanJson);
    }
  } catch (e) {
    console.warn("JSON block failed to parse.");
  }

  const getJsonVal = (keys) => {
    if (!jsonParsed) return null;
    for (const k of keys) {
      const normalizedK = k.toLowerCase().replace(/[\s_]/g, '');
      const foundKey = Object.keys(jsonParsed).find(p => p.toLowerCase().replace(/[\s_]/g, '') === normalizedK);
      if (foundKey) return jsonParsed[foundKey];
    }
    return null;
  };

  // 3. MERGE & HEAL
  result.sender = getJsonVal(['sender', 'company']) || textSender || result.sender;

  // Extract Summary/Steps - If AI is chatty, harvesting the preamble often works best
  const harvestedSummary = cleanRaw.match(/(?:Simplified Summary|Summary|Explanation|Analysis|speaker:)\s*([\s\S]*?)(?:Action Steps|What to do|Exact Address|JSON|$)/i);
  result.summary = getJsonVal(['summary']) || (harvestedSummary ? harvestedSummary[1].trim() : null) || cleanRaw.split('\n\n')[0].trim();

  const harvestedSteps = cleanRaw.match(/(?:Action Steps|What to do|Steps|Important Notes):\s*([\s\S]*?)(?:Exact Address|Contact|JSON|$)/i);
  result.action_steps = getJsonVal(['actionsteps', 'steps']) || (harvestedSteps ? harvestedSteps[1].trim() : null) || "Follow the details in the summary box.";

  // Data Enrichment
  const amt = getJsonVal(['amount', 'total', 'totalamount', 'gesamtbetrag']) || textAmount;
  if (amt) result.money.amount = parseFloat(String(amt).replace(',', '.').replace(/[^0-9.]/g, ''));

  const addr = getJsonVal(['address', 'location', 'pickupaddress']) || textAddr;
  const time = getJsonVal(['time', 'pickuptime']) || textTime;
  const iban = (getJsonVal(['iban']) || textIban || '').replace(/\s/g, '');

  if (addr && !result.summary.includes(String(addr))) result.summary += ` \nLocation: ${addr}`;
  if (time && !result.summary.includes(String(time))) result.summary += ` \nTime: ${time}`;
  if (iban && !result.summary.includes(iban)) result.summary += ` \nIBAN: ${iban}`;

  // Force categorization if it's currently 'other'
  if (result.document_type === 'other') {
    const docType = getJsonVal(['documenttype', 'type']);
    if (docType) result.document_type = docType;
  }

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
