export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Senior Administrative Master-Brain. Task: Process German docs for non-native speakers.
Output ONLY a FLAT JSON object in ${langName}.

COGNITIVE PROTOCOL:
1. Identify the literal Subject Line (Betreffzeile) in German.
2. Identify the main Command Verb (e.g. Überweisen, Erscheinen, Einreichen).
3. Check for Negative Polarity: Words like "Guthaben", "Haben", or "-" sign cancel "DEBT".
4. Map to Action Class:
   - Bill/Fine -> Action: "pay", Intent: "DEBT"
   - Subsidy/Approval -> Action: "file", Intent: "CREDIT"
   - Appointment/Summons -> Action: "attend", Intent: "ACTION"
   - Information/Cert -> Action: "file", Intent: "ACTION"

MASTER KNOWLEDGE INDEX (German DNA):
- Bußgeldbescheid / Verwarngeld: Fine. Pay/Appeal.
- KFZ-Steuer / Grundsteuer: Taxes. Pay.
- Kindergeld / BAföG / Elterngeld: Grants. Credit.
- Ladung / Einladung / Termin: Summons/Appointment. Attend.
- Mitwirkung / Nachweis: Duty to cooperate. Respond.
- Rechtsbehelfsbelehrung: Legal right to appeal (usually 1 month).

RULES:
- summary: "This is [Type] from [Sender]. [Conditions]. [Primary Action]."
- summary: NO labels, NO chatter. Translate ALL terms (e.g. "Dentist" not "Zahnarzt").
- action_steps: Simple tasks. Differentiate "Now" from "After event".
- sender: Company/Office only. NEVER the user's name.

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

/**
 * Smart Slicing v2: DIN 5008 Optimized.
 * Captures Sender Window, Subject Line, and Legal Footers.
 */
export function smartSliceOCR(text, maxChars = 2500) {
  if (!text || text.length <= maxChars) return text || '';
  const sanitized = sanitizeForPrompt(text);
  const totalLen = sanitized.length;

  // Header (0-1100): Captures Address Window & Subject Line
  const headerRange = { start: 0, end: 1100 };
  // Tail (End-400): Captures Footers & IBANs
  const tailRange = { start: totalLen - 400, end: totalLen };

  const keywords = [
    // Deadlines & Critical DNA
    'rechtsbehelfsbelehrung', 'widerspruch', 'einspruch', 'vollstreckung', 'pfändung', 'pfüb',
    // Subject/Intent Triggers
    'bußgeldbescheid', 'verwarngeld', 'steuerbescheid', 'bewilligung', 'aufhebung', 'ablehnung',
    'kündigung', 'mieterhöhung', 'nebenkosten', 'abschlagsplan', 'termin', 'meldeaufforderung',
    // Command Verbs
    'überweisen', 'zahlen', 'erscheinen', 'einreichen', 'mitwirkung', 'nachweisen',
    // Polarity
    'guthaben', 'erstattung', 'auszahlung', 'zuschuss', 'festzuschuss', 'iban'
  ];

  const MAX_MATCHES_PER_KEYWORD = 1;
  const MAX_TOTAL_ZONES = 12;
  const bodyText = sanitized.slice(1100, -400);
  const bodyOffset = 1100;
  const hotZoneRanges = [];

  keywords.forEach(kw => {
    if (hotZoneRanges.length >= MAX_TOTAL_ZONES) return;
    const regex = new RegExp(kw, 'gi');
    let match;
    let count = 0;
    while ((match = regex.exec(bodyText)) !== null && count < MAX_MATCHES_PER_KEYWORD && hotZoneRanges.length < MAX_TOTAL_ZONES) {
      const start = Math.max(0, match.index - 100) + bodyOffset;
      const end = Math.min(bodyText.length, match.index + 200) + bodyOffset;
      hotZoneRanges.push({ start, end });
      count++;
      regex.lastIndex += 300;
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
  return `<document>\n${smartSliceOCR(ocrText, 2500)}\n</document>\n\nOutput ${langName} JSON. Identify Subject & Command Verb. Focus on deadlines.`;
}

export function parseAIResponse(raw, ocrText = '') {
  console.log("Raw AI Response:", raw);
  if (!raw || typeof raw !== 'string') throw new Error("Empty response.");
  const result = getFallbackData();
  const factText = (ocrText || raw).toLowerCase();

  // 🛡️ PRE-PARSER SENDER ANCHORS
  const commonSenders = ["AOK", "TK", "Barmer", "Finanzamt", "Jobcenter", "Vodafone", "Telekom", "Stadtwerke", "Beitragsservice", "Rundfunkbeitrag", "Deutsche Rentenversicherung", "Business Solutions", "Hausverwaltung", "Schulamt", "Familienkasse"];
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
  // Hard Filter: If Sender is User's name, reset for fallback
  if (result.sender.toLowerCase().includes("tony") || result.sender.toLowerCase().includes("ralte")) {
      result.sender = "Unknown";
      for (const s of commonSenders) { if (factText.includes(s.toLowerCase())) { result.sender = s; break; } }
  }

  // 2. SUMMARY & 3. ACTION STEPS
  const rawSum = findKeyInObj(jsonParsed, ['summary', 'explanation']) || getFuzzy(/(?:Summary|Explanation|Analysis):\s*([\s\S]*?)(?:Action Steps|What to do|JSON|$)/i);
  let summary = Array.isArray(rawSum) ? rawSum.join(' ') : String(rawSum || "");
  summary = summary.replace(/(Logic|Analysis|Output|Rules|Note|Schema|Context|Location|Time):\s*[\s\S]*$/gi, '').trim();
  result.summary = summary || "Review document details below.";

  const rawSteps = findKeyInObj(jsonParsed, ['actionsteps', 'steps']) || getFuzzy(/(?:Action Steps|What to do|Steps|Important Notes):\s*([\s\S]*?)(?:Exact Address|Contact|JSON|$)/i);
  let steps = Array.isArray(rawSteps) ? rawSteps : (rawSteps ? String(rawSteps).split(/(?<=[.!?])\s+/) : []);
  result.action_steps = steps.map(i => {
      let s = (typeof i === 'string') ? i : (i.description || i.step || i.action || JSON.stringify(i));
      return s.replace(/(Logistics|Conditions|Note):\s*[\s\S]*$/gi, '').trim();
  }).filter(s => s.length > 5);

  // 4. METADATA & CRITICAL DNA OVERRIDES
  result.intent = findKeyInObj(jsonParsed, ['intent']) || result.intent;
  result.document_type = findKeyInObj(jsonParsed, ['documenttype', 'type']) || result.document_type;
  result.main_category = findKeyInObj(jsonParsed, ['maincategory', 'category']) || result.main_category;

  let act = String(findKeyInObj(jsonParsed, ['actionrequired', 'action']) || result.action_required).toLowerCase();

  // Mapping
  if (act.includes('pay') || act.includes('bußgeld') || act.includes('zahlung')) act = 'pay';
  else if (act.includes('attend') || act.includes('termin') || act.includes('erscheinen')) act = 'attend';
  else if (act.includes('respond') || act.includes('mitwirkung') || act.includes('widerspruch')) act = 'respond';
  else if (act.includes('file') || act.includes('save') || act.includes('erledigt')) act = 'file';
  else act = 'none';

  // 🛡️ MASTER DNA OVERRIDES (Deterministic Fact-Checking)

  // A. POLARITY CHECK: If document is a refund/credit
  if (factText.includes('guthaben') || factText.includes('erstattung') || factText.includes('auszahlung') || factText.includes('gutschrift')) {
      result.intent = 'CREDIT';
      act = 'file';
      if (factText.includes('nebenkosten')) result.main_category = 'Housing';
  }

  // B. APPOINTMENTS
  if (factText.includes('termin') || factText.includes('uhr') || factText.includes('einladung')) {
      act = 'attend';
      result.urgency = 'urgent';
  }

  // C. LEGAL REMEDY
  if (factText.includes('rechtsbehelfsbelehrung') || factText.includes('widerspruch') || factText.includes('einspruch')) {
      result.urgency = 'urgent';
      if (act === 'file' || act === 'none') act = 'respond';
  }

  // D. TRANSPORT/FINES
  if (factText.includes('bußgeld') || factText.includes('verwarngeld') || factText.includes('anhörung')) {
      result.intent = 'DEBT';
      act = 'pay';
      result.main_category = 'Government';
      result.urgency = 'urgent';
  }

  // E. SUBSIDIES (AOK/Etc)
  if (factText.includes('kostenplan') || factText.includes('zuschuss')) {
      result.intent = 'CREDIT';
      act = 'file';
      result.main_category = 'Healthcare';
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
