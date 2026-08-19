export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Expert German Admin Guide. Translate to ${langName}.
Output ONLY a FLAT JSON object.

STRUCTURAL PATTERNS:
1. RECHNUNG (Bill): "Zahlbetrag", "Fälligkeit", "Bankverbindung". -> Action: "pay", Intent: "DEBT".
2. BESCHEID (Decision): "Rechtsbehelfsbelehrung", "Widerspruch", "Bewilligung". -> Action: "respond" or "file", Intent: "ACTION" or "CREDIT".
3. MITTEILUNG (Notice): "Information", "Änderung", "Beitragsanpassung". -> Action: "file", Intent: "ACTION".

RULES:
- Translate ALL concepts. Never use "Bescheid", "Mahnung", "Praxis". Use "Decision", "Reminder", "Clinic".
- Identify DEADLINES. Look for "frist", "bis zum", "innerhalb".
- Summary: 2 direct sentences. "This is [Type] from [Sender]. [Condition]. [Final Action]."

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

  // 🔍 UNIVERSAL GERMAN ADMIN ANCHORS
  const keywords = [
    'rechtsbehelfsbelehrung', 'rechtsmittelbelehrung', 'widerspruch', 'einspruch', 'bescheid', 'rechnung',
    'mahnung', 'frist', 'fällig', 'nachzahlung', 'erstattung', 'guthaben', 'zuschuss', 'festzuschuss',
    'mitwirkung', 'meldeaufforderung', 'termin', 'abschluss', 'iban', 'gesamtbetrag'
  ];

  const bodyText = sanitized.slice(900, -400);
  const bodyOffset = 900;
  let zoneCount = 0;
  keywords.forEach(kw => {
    if (zoneCount >= 8) return;
    const regex = new RegExp(kw, 'gi');
    let match;
    while ((match = regex.exec(bodyText)) !== null && zoneCount < 8) {
      const start = Math.max(0, match.index - 120) + bodyOffset;
      const end = Math.min(bodyText.length, match.index + 250) + bodyOffset;
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
  return `<document>\n${smartSliceOCR(ocrText, 2500)}\n</document>\n\nApply Bureaucracy Patterns. Output ${langName} JSON. Translate technical terms.`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Response:", raw);
  if (!raw || typeof raw !== 'string') throw new Error("Empty response.");

  const result = getFallbackData();
  const lowerRaw = raw.toLowerCase();

  // 🛡️ UNIVERSAL SENDER SCANNER (Fallback Heuristics)
  const commonSenders = ["AOK", "TK", "Barmer", "Finanzamt", "Jobcenter", "Vodafone", "Telekom", "Stadtwerke", "Beitragsservice", "Rundfunkbeitrag"];
  for (const s of commonSenders) {
      if (lowerRaw.includes(s.toLowerCase())) {
          result.sender = (s === "Rundfunkbeitrag") ? "Beitragsservice (GEZ)" : s;
          break;
      }
  }

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
      if (jsonStr.split('{').length > jsonStr.split('}').length) jsonStr += '}'.repeat(jsonStr.split('{').length - jsonStr.split('}').length);
      try { jsonParsed = JSON.parse(jsonStr); } catch(e) { jsonParsed = JSON.parse(jsonStr.replace(/,\s*([}\]])/g, '$1')); }
    }
  } catch (e) { console.warn("JSON parse fail"); }

  const getFuzzy = (regex) => {
    const match = cleanRaw.match(regex);
    return match ? match[1].trim() : null;
  };

  // 1. SENDER
  const rawSender = findKeyInObj(jsonParsed, ['sender', 'company', 'from']);
  if (rawSender && typeof rawSender === 'object') {
    result.sender = rawSender.organization || rawSender.company_name || rawSender.company || rawSender.name || Object.values(rawSender)[0] || result.sender;
    // If the sender name matched the user's name (common AI mistake), try organization
    if (result.sender.toLowerCase().includes("tony") && rawSender.organization) {
      result.sender = rawSender.organization;
    }
  } else if (rawSender) {
    result.sender = rawSender;
  }
  if (result.sender === "Unknown") {
      const lines = cleanRaw.split('\n').map(l => l.trim()).filter(l => l.length > 3);
      if (lines.length > 0) result.sender = lines[0].substring(0, 50);
  }

  // 2. SUMMARY (Safe cleaning)
  const rawSummary = findKeyInObj(jsonParsed, ['summary', 'explanation']) || getFuzzy(/(?:Summary|Explanation|Analysis):\s*([\s\S]*?)(?:Action Steps|What to do|JSON|$)/i);
  let summary = Array.isArray(rawSummary) ? rawSummary.join(' ') : (rawSummary ? String(rawSummary) : "");

  summary = summary
    .replace(/^.*?here is the.*?output.*?:/gi, '')
    .replace(/(Logic|Analysis|Output|Rules|Note|Schema|Context):\s*[\s\S]*$/gi, '')
    .trim();

  // 🛡️ RECOVERY HEURISTICS
  if (!summary) {
    if (lowerRaw.includes("rechnung") || lowerRaw.includes("invoice")) {
      summary = `Invoice from ${result.sender}. Please review the amount and pay by the due date.`;
    } else if (lowerRaw.includes("bescheid") || lowerRaw.includes("bewilligung")) {
      summary = `Official decision or approval from ${result.sender}. Review the details and file for your records.`;
    }
  }
  result.summary = summary || "Document processed. Review extracted text for specific instructions.";

  // 3. ACTION STEPS
  const rawSteps = findKeyInObj(jsonParsed, ['actionsteps', 'steps']) || getFuzzy(/(?:Action Steps|What to do|Steps|Important Notes):\s*([\s\S]*?)(?:Exact Address|Contact|JSON|$)/i);
  let steps = Array.isArray(rawSteps) ? rawSteps : (rawSteps ? String(rawSteps).split(/(?<=[.!?])\s+/) : []);
  result.action_steps = steps
    .map(item => {
      // 🛡️ Fix: Handle objects or strings safely
      let s = (typeof item === 'string') ? item : (item.description || item.step || item.action || JSON.stringify(item));
      return s.replace(/(Logistics|Conditions|Note):\s*[\s\S]*$/gi, '').trim();
    })
    .filter(s => s.length > 5);

  if (result.action_steps.length === 0) {
    if (lowerRaw.includes("rechnung")) result.action_steps = ["Verify invoice details.", "Pay the total amount to the provided IBAN."];
    else if (lowerRaw.includes("abschluss")) result.action_steps = ["Finish the current treatment or process.", "Submit final documentation to the sender."];
    else result.action_steps = ["Check the document for instructions."];
  }

  // 4. METADATA & REFINEMENT
  result.intent = findKeyInObj(jsonParsed, ['intent']) || result.intent;
  result.document_type = findKeyInObj(jsonParsed, ['documenttype', 'type']) || result.document_type;
  result.main_category = findKeyInObj(jsonParsed, ['maincategory', 'category']) || result.main_category;

  const rawAction = findKeyInObj(jsonParsed, ['actionrequired', 'action']) || result.action_required;
  const validActions = ["pay", "respond", "file", "attend", "renew", "none"];
  let act = String(rawAction).toLowerCase();

  if (!validActions.includes(act)) {
    if (act.includes('pay') || act.includes('zahle')) act = 'pay';
    else if (act.includes('respond') || act.includes('submit') || act.includes('widerspruch')) act = 'respond';
    else if (act.includes('file') || act.includes('save')) act = 'file';
    else act = 'none';
  }
  result.action_required = act;

  // 🛡️ UNIVERSAL BUREAUCRACY OVERRIDES
  if (lowerRaw.includes('kostenplan') || lowerRaw.includes('zuschuss') || lowerRaw.includes('bewilligung')) {
    result.intent = 'CREDIT';
    result.action_required = 'file';
    if (result.main_category === 'Other') result.main_category = 'Healthcare';
  }
  if (lowerRaw.includes('rechtsbehelfsbelehrung') || lowerRaw.includes('widerspruch')) {
    result.urgency = 'urgent';
    if (result.action_required === 'none') result.action_required = 'respond';
  }
  if (lowerRaw.includes('rechnung') || lowerRaw.includes('mahnung')) {
    result.intent = 'DEBT';
    result.action_required = 'pay';
    if (result.main_category === 'Other') result.main_category = 'Finance';
  }

  // 5. MONEY & DATES
  const moneyObj = findKeyInObj(jsonParsed, ['money']);
  if (moneyObj && typeof moneyObj === 'object') {
    result.money = { ...result.money, ...moneyObj };
    if (typeof result.money.amount === 'string') result.money.amount = parseFloat(result.money.amount.replace(/[^0-9.]/g, ''));
    if (result.money.currency) result.money.currency = result.money.currency.replace(/EUR/g, '').trim() || 'EUR';
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
    summary: '',
    action_steps: []
  };
}
