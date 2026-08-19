export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Senior Admin Expert for non-native speakers. Output FLAT JSON in ${langName}.

GERMAN BUREAUCRACY DNA:
1. RECHNUNG/MAHNUNG: You owe money. Action: "pay", Intent: "DEBT".
2. KOSTENPLAN/ZUSCHUSS: You get a subsidy. Action: "file". Timing: "After treatment".
3. TERMIN/EINLADUNG: You have an appointment. Action: "attend". Category: "Housing" or "Government".
4. MITTEILUNG/BESCHEID: Official info or decision. Action: "respond" or "file".

FIELD RULES:
- summary: 1-2 direct sentences. NO labels. (e.g. "Dental subsidy approved. Submit invoice after treatment.")
- action_steps: Array of concrete tasks.
- sender: Company/Office ONLY. NEVER the user's name.
- main_category: Insurance, Finance, Government, Healthcare, Housing, Employment, Utility, Other.

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
  const headerRange = { start: 0, end: 900 };
  const tailRange = { start: totalLen - 400, end: totalLen };

  const keywords = [
    'rechtsbehelfsbelehrung', 'rechtsmittelbelehrung', 'termin', 'uhr', 'datum', 'erscheinen', 'zutritt',
    'widerspruch', 'bescheid', 'rechnung', 'mahnung', 'frist', 'fällig', 'nachzahlung', 'erstattung',
    'guthaben', 'zuschuss', 'festzuschuss', 'mitwirkung', 'abschluss', 'iban', 'gesamtbetrag'
  ];
  const MAX_MATCHES_PER_KEYWORD = 1;
  const MAX_TOTAL_ZONES = 14;
  const bodyText = sanitized.slice(900, -400);
  const bodyOffset = 900;
  const hotZoneRanges = [];
  keywords.forEach(kw => {
    if (hotZoneRanges.length >= MAX_TOTAL_ZONES) return;
    const regex = new RegExp(kw, 'gi');
    let match;
    let matchesForThisKeyword = 0;
    while ((match = regex.exec(bodyText)) !== null && matchesForThisKeyword < MAX_MATCHES_PER_KEYWORD && hotZoneRanges.length < MAX_TOTAL_ZONES) {
      const start = Math.max(0, match.index - 120) + bodyOffset;
      const end = Math.min(bodyText.length, match.index + 250) + bodyOffset;
      hotZoneRanges.push({ start, end });
      matchesForThisKeyword++;
      regex.lastIndex += 350;
    }
  });

  const tailChunk = sanitized.slice(tailRange.start, tailRange.end);
  const budgetForFront = Math.max(0, maxChars - tailChunk.length - 20);
  const frontRanges = mergeRanges([headerRange, ...hotZoneRanges]);
  let frontResult = "";
  for (const range of frontRanges) {
    const chunk = sanitized.slice(range.start, range.end);
    if ((frontResult.length + chunk.length + 10) > budgetForFront) break;
    frontResult += (frontResult ? "\n[...]\n" : "") + chunk;
  }
  return frontResult + "\n[...]\n" + tailChunk;
}

export function buildUserMessage(ocrText, language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';
  return `<document>\n${smartSliceOCR(ocrText, 2500)}\n</document>\n\nApply Bureaucracy Patterns. Output ${langName} JSON. Translate all German terms. Focus on Appointments and Deadlines.`;
}

export function parseAIResponse(raw, ocrText = '') {
  console.log("Raw AI Response:", raw);
  if (!raw || typeof raw !== 'string') throw new Error("Empty response.");
  const result = getFallbackData();
  const factText = (ocrText || raw).toLowerCase();

  // 🛡️ SENDER ANCHORS (Organization Priority)
  const commonSenders = ["AOK", "TK", "Barmer", "Finanzamt", "Jobcenter", "Vodafone", "Telekom", "Stadtwerke", "Beitragsservice", "Rundfunkbeitrag", "Deutsche Rentenversicherung", "Business Solutions", "Hausverwaltung"];
  for (const s of commonSenders) {
      if (factText.includes(s.toLowerCase())) {
          result.sender = (s === "Rundfunkbeitrag") ? "Beitragsservice (GEZ)" : s;
          break;
      }
  }

  let cleanRaw = raw.replace(/\*\*/g, '').replace(/```json/g, '').replace(/```/g, '').trim();
  const findKeyInObj = (obj, targetKeys) => {
    if (!obj || typeof obj !== 'object') return null;
    for (const target of targetKeys) {
      const norm = target.toLowerCase().replace(/[\s_]/g, '');
      const key = Object.keys(obj).find(k => k.toLowerCase().replace(/[\s_]/g, '') === norm);
      if (key) return obj[key];
    }
    for (const k in obj) { if (typeof obj[k] === 'object') { const m = findKeyInObj(obj[k], targetKeys); if (m) return m; } }
    return null;
  };

  let jsonParsed = null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0];
      if (jsonStr.split('{').length > jsonStr.split('}').length) jsonStr += '}'.repeat(jsonStr.split('{').length - jsonStr.split('}').length);
      try { jsonParsed = JSON.parse(jsonStr); } catch(e) { jsonParsed = JSON.parse(jsonStr.replace(/,\s*([}\]])/g, '$1')); }
    }
  } catch (e) {}

  const getFuzzy = (regex) => { const m = cleanRaw.match(regex); return m ? m[1].trim() : null; };

  // 1. SENDER (Organization Safety)
  const rawSender = findKeyInObj(jsonParsed, ['sender', 'company', 'from']);
  if (rawSender && typeof rawSender === 'object') {
    result.sender = rawSender.organization || rawSender.company_name || rawSender.company || rawSender.name || result.sender;
  } else if (rawSender) {
    result.sender = rawSender;
  }
  // Hard Filter: If Sender is User's name, reset to Unknown for fallback
  if (result.sender.toLowerCase().includes("tony") || result.sender.toLowerCase().includes("ralte")) {
      result.sender = "Unknown";
      for (const s of commonSenders) { if (factText.includes(s.toLowerCase())) { result.sender = s; break; } }
  }

  // 2. SUMMARY & 3. ACTION STEPS
  const rawSum = findKeyInObj(jsonParsed, ['summary', 'explanation']) || getFuzzy(/(?:Summary|Explanation|Analysis):\s*([\s\S]*?)(?:Action Steps|What to do|JSON|$)/i);
  let summary = Array.isArray(rawSum) ? rawSum.join(' ') : String(rawSum || "");
  summary = summary.replace(/(Logic|Analysis|Output|Rules|Note|Schema|Context|Location|Time):\s*[\s\S]*$/gi, '').trim();
  result.summary = summary || "Document summary available. Review extracted text for instructions.";

  const rawSteps = findKeyInObj(jsonParsed, ['actionsteps', 'steps']) || getFuzzy(/(?:Action Steps|What to do|Steps|Important Notes):\s*([\s\S]*?)(?:Exact Address|Contact|JSON|$)/i);
  let steps = Array.isArray(rawSteps) ? rawSteps : (rawSteps ? String(rawSteps).split(/(?<=[.!?])\s+/) : []);
  result.action_steps = steps.map(i => {
      let s = (typeof i === 'string') ? i : (i.description || i.step || i.action || JSON.stringify(i));
      return s.replace(/(Logistics|Conditions|Note):\s*[\s\S]*$/gi, '').trim();
  }).filter(s => s.length > 5);

  // 4. METADATA & APPOINTMENT OVERRIDES
  result.intent = findKeyInObj(jsonParsed, ['intent']) || result.intent;
  result.document_type = findKeyInObj(jsonParsed, ['documenttype', 'type']) || result.document_type;
  result.main_category = findKeyInObj(jsonParsed, ['maincategory', 'category']) || result.main_category;

  const rawAction = findKeyInObj(jsonParsed, ['actionrequired', 'action']) || result.action_required;
  let act = String(rawAction).toLowerCase();

  // Mapping
  if (act.includes('pay')) act = 'pay';
  else if (act.includes('attend') || act.includes('termin') || act.includes('cita')) act = 'attend';
  else if (act.includes('respond') || act.includes('submit')) act = 'respond';
  else if (act.includes('file') || act.includes('save')) act = 'file';
  else act = 'none';

  // 🛡️ CRITICAL OVERRIDES
  if (factText.includes('termin') || factText.includes('uhr') || factText.includes('erscheinen')) {
      act = 'attend';
      result.urgency = 'urgent';
      if (factText.includes('vermessung') || factText.includes('mieter')) result.main_category = 'Housing';
  }
  if (factText.includes('kostenplan') || factText.includes('zuschuss')) {
      result.intent = 'CREDIT';
      act = 'file';
      result.main_category = 'Healthcare';
  }
  if (factText.includes('rechnung') || factText.includes('mahnung')) {
      result.intent = 'DEBT';
      act = 'pay';
  }
  result.action_required = act;

  // 5. MONEY & DATES
  const moneyObj = findKeyInObj(jsonParsed, ['money']);
  if (moneyObj && typeof moneyObj === 'object') {
    result.money = { ...result.money, ...moneyObj };
    if (typeof result.money.amount === 'string') result.money.amount = parseFloat(result.money.amount.replace(/[^0-9.]/g, ''));
    if (result.money.currency) result.money.currency = result.money.currency.replace(/EUR/g, '').trim() || 'EUR';
  }
  const datesObj = findKeyInObj(jsonParsed, ['dates']);
  if (datesObj && typeof datesObj === 'object') { result.dates = { ...result.dates, ...datesObj }; }

  return result;
}

export function getFallbackData() {
  return {
    sender: 'Unknown', document_type: 'other',
    dates: { document_date: null, due_date: null, appointment_date: null },
    money: { amount: null, currency: 'EUR' },
    main_category: 'Other', sub_category: 'Other',
    action_required: 'file', urgency: 'informational',
    summary: '', action_steps: []
  };
}
