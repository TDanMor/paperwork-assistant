export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Expert Administrative Guide. Output FLAT JSON in ${langName}.

REQUIRED FIELDS:
- intent: "DEBT" (you pay), "CREDIT" (you receive), "ACTION" (just respond/file).
- summary: Max 2 direct sentences. No labels like "Location:". (e.g., "AOK approved 70% dental subsidy. Submit final invoice after treatment.")
- action_steps: Array of concrete tasks. (e.g., ["Finish treatment", "Mail invoice to AOK"])
- sender: Exact company name (e.g., "AOK Bayern").
- document_type: "invoice", "notice", "contract", "government_letter", "healthcare", "bank", "appointment", "fine", "other"
- main_category: "Finance", "Housing", "Government", "Employment", "Insurance", "Healthcare", "Utility", "Other"
- action_required: "pay", "respond", "file", "attend", "renew", "none"
- urgency: "overdue", "urgent", "upcoming", "informational"

CRITICAL:
- "Heil- und Kostenplan" or "Zuschuss" = intent: "CREDIT", action_required: "file".
- NEVER include instructions, logic, or labels in field values.
- Respond ONLY with the JSON object.`;
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

export function smartSliceOCR(text, maxChars = 2500) {
  if (!text || text.length <= maxChars) return text || '';
  const sanitized = sanitizeForPrompt(text);
  const totalLen = sanitized.length;

  const ranges = [
    { start: 0, end: 900 },
    { start: totalLen - 400, end: totalLen }
  ];

  const keywords = [
    'abholung', 'pickup', 'nach abschluss', 'voraussetzung', 'termin', 'appointment',
    'address', 'straße', 'location', 'ort', 'standort', 'iban', 'erstatt', 'zuschuss',
    'festzuschuss', 'genehmigung', 'bescheid', 'due', 'fällig', 'deadline', 'total', 'betrag'
  ];

  const bodyText = sanitized.slice(900, -400);
  const bodyOffset = 900;
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
  const text = smartSliceOCR(ocrText, 2500);

  return `<document>\n${text}\n</document>\n\nOutput ${langName} JSON. No labels. Direct values only.`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Response:", raw);
  if (!raw || typeof raw !== 'string') throw new Error("Empty response.");

  const result = getFallbackData();
  const lowerRaw = raw.toLowerCase();

  // 🛡️ PRE-PARSER FIXES: Ensure AOK isn't lost
  if (lowerRaw.includes("aok bayern")) result.sender = "AOK Bayern";
  else if (lowerRaw.includes("aok")) result.sender = "AOK";

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

  // 1. SENDER
  const rawSender = findKeyInObj(jsonParsed, ['sender', 'company', 'companyname', 'from']);
  if (rawSender && typeof rawSender === 'object') {
    result.sender = rawSender.company_name || rawSender.name || Object.values(rawSender)[0] || result.sender;
  } else if (rawSender) {
    result.sender = rawSender;
  } else {
    result.sender = getFuzzy(/(?:Sender|Company|From):\s*"?([^"\n,]+)"?/i) || result.sender;
  }

  // 2. SUMMARY
  const rawSummary = findKeyInObj(jsonParsed, ['summary', 'explanation']) || getFuzzy(/(?:Summary|Explanation|Analysis):\s*([\s\S]*?)(?:Action Steps|What to do|JSON|$)/i) || cleanRaw.split('\n\n')[0].trim();
  let summary = Array.isArray(rawSummary) ? rawSummary.join(' ') : String(rawSummary);
  // Strip AI labels/logic
  summary = summary.replace(/(Logic|Analysis|Output|Rules|Note|Schema|Location|Time|Context):\s*[\s\S]*$/gi, '').trim();
  result.summary = summary || "No summary available.";

  // 3. ACTION STEPS
  const rawSteps = findKeyInObj(jsonParsed, ['actionsteps', 'steps']) || getFuzzy(/(?:Action Steps|What to do|Steps|Important Notes):\s*([\s\S]*?)(?:Exact Address|Contact|JSON|$)/i);
  let steps = Array.isArray(rawSteps) ? rawSteps.join(' ') : (rawSteps ? String(rawSteps) : "");
  steps = steps.replace(/(Logistics|Conditions):\s*[\s\S]*$/gi, '').trim();
  if (!steps || steps.toLowerCase().includes("check the document")) {
     if (lowerRaw.includes("abschluss")) steps = "1. Finish treatment. 2. Submit documents to sender.";
     else steps = "Check the document for instructions.";
  }
  result.action_steps = steps;

  // 4. METADATA
  result.intent = findKeyInObj(jsonParsed, ['intent']) || result.intent;
  result.document_type = findKeyInObj(jsonParsed, ['documenttype', 'type']) || (lowerRaw.includes('rechnung') ? 'invoice' : result.document_type);
  result.main_category = findKeyInObj(jsonParsed, ['maincategory', 'category']) || result.main_category;

  const rawAction = findKeyInObj(jsonParsed, ['actionrequired', 'action']) || result.action_required;
  const validActions = ["pay", "respond", "file", "attend", "renew", "none"];
  let act = String(rawAction).toLowerCase();
  if (!validActions.includes(act)) {
    if (act.includes('pay')) act = 'pay';
    else if (act.includes('respond') || act.includes('submit') || act.includes('send')) act = 'respond';
    else if (act.includes('attend') || act.includes('appointment')) act = 'attend';
    else if (act.includes('file') || act.includes('save')) act = 'file';
    else act = 'none';
  }
  result.action_required = act;

  // 🛡️ REFINEMENT: If it's a subsidy/credit, fix categories
  if (lowerRaw.includes('kostenplan') || lowerRaw.includes('zuschuss') || lowerRaw.includes('genehmigung')) {
    result.intent = 'CREDIT';
    result.action_required = (act === 'pay') ? 'file' : act;
    result.document_type = 'notice';
    result.main_category = 'Insurance';
  }

  // 5. MONEY & DATES
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
