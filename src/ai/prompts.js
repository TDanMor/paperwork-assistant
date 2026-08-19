export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Analyze this document. Output ONLY valid JSON. All values in ${langName}.
Keys MUST be: "sender", "document_type", "dates", "money", "main_category", "action_required", "urgency", "summary", "action_steps".
If a fact is missing, use null. No prose.`;
}

function sanitizeForPrompt(text) {
  return text
    .replace(/ignore (all |previous |above )?instructions?/gi, '[REDACTED]')
    .replace(/you are (now |a )?assistant/gi, '[REDACTED]')
    .replace(/system prompt/gi, '[REDACTED]')
    .replace(/<\/document>/gi, ''); // Prevent tag escaping
}

export function smartSliceOCR(text, maxChars = 2300) {
  if (!text || text.length <= maxChars) return text || '';

  const sanitized = sanitizeForPrompt(text);
  const header = sanitized.slice(0, 800);
  const tail = sanitized.slice(-400);
  const body = sanitized.slice(800, -400);

  const keywords = [
    // Multi-language anchors (DE, EN, ES, FR, RO)
    'iban', 'total', 'amount', 'betrag', 'summe', 'gesamt', 'suma', 'montant',
    'due', 'fällig', 'deadline', 'frist', 'scadență', 'echeance', 'vencimiento',
    'address', 'straße', 'location', 'ort', 'adresa', 'direccion',
    'pickup', 'abholung', 'appointment', 'termin', 'programare', 'cita',
    'miet', 'rent', 'chirie', 'alquiler', 'loyer',
    'fine', 'bußgeld', 'amendă', 'multa', 'amende'
  ];

  const segments = [];
  keywords.forEach(kw => {
    const regex = new RegExp(kw, 'gi');
    let match;
    // Limit to 4 windows to stay within budget
    while ((match = regex.exec(body)) !== null && segments.length < 4) {
      const start = Math.max(0, match.index - 100);
      const end = Math.min(body.length, match.index + 200);
      segments.push(body.slice(start, end));
      regex.lastIndex += 300;
    }
  });

  const result = `${header}\n[...]\n${segments.join('\n[...]\n')}\n[...]\n${tail}`;
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
  const cleanRaw = raw.replace(/\*\*/g, '').replace(/```json/g, '').replace(/```/g, '').trim();

  // 1. baseline extraction from plain text (Fuzzy)
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

  // 2. JSON extraction
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
