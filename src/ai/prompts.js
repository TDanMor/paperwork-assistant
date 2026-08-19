export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Expert Doc Analyzer. Target: ${langName}.
Rules:
1. Intent: DEBT(User pays), CREDIT(User receives/Subsidy), ACTION(User responds).
2. Summary: 2 simple sentences. Identify document (e.g. AOK dental subsidy). Detail timing/conditions (e.g. "After treatment, submit invoice").
3. Logic: Heil- und Kostenplan is CREDIT, not DEBT.
4. Output: Valid FLAT JSON only. Translate values to ${langName}. Keys in English.
Schema: {intent, summary, action_steps, sender, document_type, dates, money, main_category, action_required, urgency}`;
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

export function smartSliceOCR(text, maxChars = 2800) {
  if (!text || text.length <= maxChars) return text || '';
  const sanitized = sanitizeForPrompt(text);
  const totalLen = sanitized.length;

  // Header & Tail are mandatory
  const ranges = [
    { start: 0, end: 1000 },
    { start: totalLen - 400, end: totalLen }
  ];

  const keywords = [
    'abholung', 'pickup', 'finalizare', 'nach abschluss', 'voraussetzung', 'termin', 'appointment',
    'address', 'straße', 'location', 'ort', 'standort', 'iban', 'erstatt', 'zuschuss',
    'festzuschuss', 'genehmigung', 'bescheid', 'due', 'fällig', 'deadline', 'total', 'betrag'
  ];

  const bodyText = sanitized.slice(1000, -500);
  const bodyOffset = 1000;
  let zoneCount = 0;

  keywords.forEach(kw => {
    if (zoneCount >= 6) return;
    const regex = new RegExp(kw, 'gi');
    let match;
    while ((match = regex.exec(bodyText)) !== null && zoneCount < 6) {
      const start = Math.max(0, match.index - 100) + bodyOffset;
      const end = Math.min(bodyText.length, match.index + 200) + bodyOffset;
      ranges.push({ start, end });
      zoneCount++;
      regex.lastIndex += 400;
    }
  });

  const merged = mergeRanges(ranges);
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
  const text = smartSliceOCR(ocrText, 3500);

  return `<document>\n${text}\n</document>\n\nAnalyze doc. Intent DEBT vs CREDIT? Focus LOGISTICS (Location, Time, Conditions). JSON in ${langName}.`;
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
