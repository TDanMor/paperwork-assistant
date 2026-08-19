export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Senior Admin Expert for non-native speakers. Output FLAT JSON in ${langName}.

GERMAN DOCUMENT MASTER INDEX:
1. "Heil- und Kostenplan" / "Zuschuss": Subsidy approval. NOT A BILL. Intent: CREDIT. Action: file. Note: User must act ONLY after treatment.
2. "Steuerbescheid": Tax assessment. Check "Nachzahlung" (Intent: DEBT, Action: pay) vs "Erstattung" (Intent: CREDIT, Action: file).
3. "Rundfunkbeitrag": TV/Radio Tax (GEZ). Usually DEBT. Action: pay.
4. "Mahnung" / "Vollstreckung": Overdue/Enforcement. Intent: DEBT. Urgency: overdue.
5. "Bescheid" / "Mitteilung": Official decision. Intent: ACTION. Action: respond.
6. "Rechnung": Bill. Intent: DEBT. Action: pay.

FIELD RULES:
- summary: 1-2 direct sentences. Translate all terms (e.g. "Dental Plan" instead of "Kostenplan").
- action_steps: Array of simple translated tasks.
- sender: Exact company/office (e.g. "Finanzamt", "AOK", "Vodafone").
- main_category: Insurance, Finance, Government, Healthcare, Housing, Employment, Utility, Other.
- urgency: overdue, urgent, upcoming, informational.

JSON Schema: {intent, summary, action_steps, sender, document_type, dates, money, main_category, action_required, urgency}`;
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

  const ranges = [{ start: 0, end: 900 }, { start: totalLen - 400, end: totalLen }];

  // 🔍 ENHANCED KEYWORDS: Catching critical German admin labels
  const keywords = [
    'abholung', 'pickup', 'nach abschluss', 'voraussetzung', 'termin', 'fris',
    'iban', 'erstatt', 'zuschuss', 'festzuschuss', 'bescheid', 'rechnung', 'mahnung',
    'nachzahlung', 'gesamtbetrag', 'summe', 'fällig', 'überweisen', 'kassenzeichen',
    'aktenzeichen', 'steuernummer', 'rundfunkbeitrag', 'beitragsservice'
  ];

  const bodyText = sanitized.slice(900, -400);
  const bodyOffset = 900;
  let zoneCount = 0;

  keywords.forEach(kw => {
    if (zoneCount >= 7) return;
    const regex = new RegExp(kw, 'gi');
    let match;
    while ((match = regex.exec(bodyText)) !== null && zoneCount < 7) {
      const start = Math.max(0, match.index - 120) + bodyOffset;
      const end = Math.min(bodyText.length, match.index + 220) + bodyOffset;
      ranges.push({ start, end });
      zoneCount++;
      regex.lastIndex += 350;
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
  return `<document>\n${smartSliceOCR(ocrText, 2500)}\n</document>\n\nOutput ${langName} JSON. No preamble. Direct facts only.`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Response:", raw);
  if (!raw || typeof raw !== 'string') throw new Error("Empty response.");

  const result = getFallbackData();
  const lowerRaw = raw.toLowerCase();

  // 🛡️ PRE-PARSER SENDER FIX
  if (lowerRaw.includes("aok bayern") || lowerRaw.includes("aok - postfach")) result.sender = "AOK Bayern";
  else if (lowerRaw.includes("rundfunkbeitrag") || lowerRaw.includes("beitragsservice")) result.sender = "Beitragsservice (GEZ)";
  else if (lowerRaw.includes("finanzamt")) result.sender = "Finanzamt";
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
  } catch (e) { console.warn("JSON parse fail"); }

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
  }

  // 2. SUMMARY (Aggressive Chatter Stripping)
  const rawSummary = findKeyInObj(jsonParsed, ['summary', 'explanation']) || getFuzzy(/(?:Summary|Explanation|Analysis):\s*([\s\S]*?)(?:Action Steps|What to do|JSON|$)/i) || cleanRaw.split('\n\n')[0].trim();
  let summary = Array.isArray(rawSummary) ? rawSummary.join(' ') : String(rawSummary);

  const chatter = ["here is the output", "in english json", "json format", "logic:", "output:", "analysis:", "location:", "time:", "context:", "output:"];
  chatter.forEach(phrase => {
    const regex = new RegExp(`^.*?${phrase.replace(':', '\\:')}.*?(\\n|\\:|$)`, 'gi');
    summary = summary.replace(regex, '');
  });
  result.summary = summary.replace(/\{[\s\S]*?\}|\[[\s\S]*?\]/g, '').trim() || "No summary available.";

  // 3. ACTION STEPS
  const rawSteps = findKeyInObj(jsonParsed, ['actionsteps', 'steps']) || getFuzzy(/(?:Action Steps|What to do|Steps|Important Notes):\s*([\s\S]*?)(?:Exact Address|Contact|JSON|$)/i);
  let steps = Array.isArray(rawSteps) ? rawSteps : (rawSteps ? String(rawSteps).split(/(?<=[.!?])\s+/) : []);

  result.action_steps = steps
    .map(s => s.replace(/(Logistics|Conditions|Note):\s*[\s\S]*$/gi, '').trim())
    .filter(s => s.length > 5);

  if (result.action_steps.length === 0) {
     if (lowerRaw.includes("abschluss")) result.action_steps = ["Finish treatment.", "Submit documents to sender."];
     else result.action_steps = ["Check the document for instructions."];
  }

  // 4. METADATA & REFINEMENT
  result.intent = findKeyInObj(jsonParsed, ['intent']) || result.intent;
  result.document_type = findKeyInObj(jsonParsed, ['documenttype', 'type']) || (lowerRaw.includes('rechnung') ? 'invoice' : result.document_type);
  result.main_category = findKeyInObj(jsonParsed, ['maincategory', 'category']) || result.main_category;

  const rawAction = findKeyInObj(jsonParsed, ['actionrequired', 'action']) || result.action_required;
  const validActions = ["pay", "respond", "file", "attend", "renew", "none"];
  let act = String(rawAction).toLowerCase();
  if (!validActions.includes(act)) {
    if (act.includes('pay')) act = 'pay';
    else if (act.includes('respond') || act.includes('submit')) act = 'respond';
    else if (act.includes('file') || act.includes('save')) act = 'file';
    else act = 'none';
  }
  result.action_required = act;

  // 🛡️ DOMAIN-SPECIFIC REFINEMENTS (DETERMINISTIC)

  // A. AOK / Healthcare
  if (lowerRaw.includes('kostenplan') || lowerRaw.includes('zuschuss') || result.sender.includes('AOK')) {
    result.intent = 'CREDIT';
    result.action_required = 'file';
    result.document_type = lowerRaw.includes('kostenplan') ? 'cost_approval' : 'notice';
    result.main_category = 'Healthcare';
  }

  // B. Finanzamt / Taxes
  if (lowerRaw.includes('finanzamt') || lowerRaw.includes('steuerbescheid')) {
    result.main_category = 'Government';
    if (lowerRaw.includes('nachzahlung') || lowerRaw.includes('zahlen sie bitte')) {
        result.intent = 'DEBT';
        result.action_required = 'pay';
    } else if (lowerRaw.includes('erstattung') || lowerRaw.includes('guthaben')) {
        result.intent = 'CREDIT';
        result.action_required = 'file';
    }
  }

  // C. GEZ / Beitragsservice
  if (lowerRaw.includes('rundfunkbeitrag') || lowerRaw.includes('beitragsservice')) {
    result.main_category = 'Utility';
    result.action_required = lowerRaw.includes('lastschrift') ? 'file' : 'pay';
  }

  // 5. MONEY & DATES
  const moneyObj = findKeyInObj(jsonParsed, ['money']);
  if (moneyObj && typeof moneyObj === 'object') {
    result.money = { ...result.money, ...moneyObj };
    if (typeof result.money.amount === 'string') {
        result.money.amount = parseFloat(result.money.amount.replace(/[^0-9.]/g, ''));
    }
    if (result.money.currency) {
        result.money.currency = result.money.currency.replace(/EUR/g, '').trim() || 'EUR';
    }
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
    action_steps: ['Check the document for instructions.']
  };
}
