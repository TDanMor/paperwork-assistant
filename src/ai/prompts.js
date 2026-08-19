export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Senior Admin Expert for non-native speakers. Output FLAT JSON in ${langName}.

GERMAN BUREAUCRACY MASTER INDEX:
1. "Heil- und Kostenplan" / "Zuschuss": Subsidy approval. NOT A BILL. Intent: CREDIT. Action: file. Note: Act ONLY after treatment.
2. "Steuerbescheid" / "Nebenkosten": AMBIGUOUS. Check "Nachzahlung" (DEBT, pay) vs "Erstattung/Guthaben" (CREDIT, file).
3. "Aufhebungsbescheid" / "Sanktion" / "Ablehnung": CRITICAL. Benefits stopped or denied. Intent: ACTION. Action: respond.
4. "Mahnung" / "Vollstreckung" / "Pfändung": CRITICAL. Overdue/Enforcement. Action: pay or consult expert.
5. "Rechtsmittelbelehrung" / "Widerspruch": High priority. Explains your 1-month right to appeal.
6. "Aufforderung zur Mitwirkung" / "Meldeaufforderung": Action required. Submit docs or attend meeting.

FIELD RULES:
- summary: 1-2 direct sentences. Translate ALL technical terms. Explicitly mention deadlines if found.
- action_steps: Array of concrete tasks. Differentiate between "Now" and "After [Condition]".
- sender: Exact office (e.g. "Jobcenter", "Finanzamt", "TK", "Deutsche Rentenversicherung").
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

  // 🔍 ELITE KEYWORDS (Audit Optimized): Catching critical German admin DNA
  const keywords = [
    // Deadlines & Legal
    'rechtsbehelfsbelehrung', 'rechtsmittelbelehrung', 'widerspruch', 'einspruch', 'frist', 'nachzahlung',
    'erstattung', 'guthaben', 'voraussetzung', 'nach abschluss', 'nach eingang', 'vorbehaltlich',
    // Enforcement (Critical)
    'vollstreckung', 'mahnbescheid', 'pfändung', 'pfüb', 'räumungsklage', 'gerichtsvollzieher',
    // High-Risk Status
    'aufhebung', 'ablehnung', 'sanktion', 'minderung', 'einstellung', 'rückforderung',
    // Authority Specifics
    'jobcenter', 'arbeitsagentur', 'finanzamt', 'familienkasse', 'rentenversicherung', 'krankenkasse',
    // Common Logistics
    'abholung', 'termin', 'meldeaufforderung', 'mitwirkung', 'iban', 'gesamtbetrag'
  ];

  const bodyText = sanitized.slice(900, -400);
  const bodyOffset = 900;
  let zoneCount = 0;

  keywords.forEach(kw => {
    if (zoneCount >= 8) return;
    const regex = new RegExp(kw, 'gi');
    let match;
    while ((match = regex.exec(bodyText)) !== null && zoneCount < 8) {
      const start = Math.max(0, match.index - 100) + bodyOffset;
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
  return `<document>\n${smartSliceOCR(ocrText, 2500)}\n</document>\n\nAnalyze doc. Output ${langName} JSON. Differentiate DEBT (User pays) from CREDIT (User receives). Focus on Deadlines & Conditions.`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Response:", raw);
  if (!raw || typeof raw !== 'string') throw new Error("Empty response.");

  const result = getFallbackData();
  const lowerRaw = raw.toLowerCase();

  // 🛡️ PRE-PARSER SENDER ANCHORS (Higher Reliability than AI)
  if (lowerRaw.includes("jobcenter")) result.sender = "Jobcenter";
  else if (lowerRaw.includes("finanzamt")) result.sender = "Finanzamt";
  else if (lowerRaw.includes("aok bayern")) result.sender = "AOK Bayern";
  else if (lowerRaw.includes("deutsche rentenversicherung") || lowerRaw.includes(" drv ")) result.sender = "Deutsche Rentenversicherung";
  else if (lowerRaw.includes("familienkasse")) result.sender = "Familienkasse";
  else if (lowerRaw.includes("rundfunkbeitrag") || lowerRaw.includes("beitragsservice")) result.sender = "Beitragsservice (GEZ)";

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
  const rawSender = findKeyInObj(jsonParsed, ['sender', 'company', 'from']);
  if (rawSender && typeof rawSender === 'object') {
    result.sender = rawSender.company_name || rawSender.name || Object.values(rawSender)[0] || result.sender;
  } else if (rawSender) {
    result.sender = rawSender;
  }

  // 2. SUMMARY (Aggressive Chatter Stripping)
  const rawSummary = findKeyInObj(jsonParsed, ['summary', 'explanation']) || getFuzzy(/(?:Summary|Explanation|Analysis):\s*([\s\S]*?)(?:Action Steps|What to do|JSON|$)/i) || cleanRaw.split('\n\n')[0].trim();
  let summary = Array.isArray(rawSummary) ? rawSummary.join(' ') : String(rawSummary);

  const chatter = ["here is the output", "in english json", "json format", "logic:", "output:", "analysis:", "location:", "time:", "context:"];
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

  // 4. DETERMINISTIC OVERRIDES (Audit Driven)
  const validActions = ["pay", "respond", "file", "attend", "renew", "none"];
  const rawAction = findKeyInObj(jsonParsed, ['actionrequired', 'action']) || result.action_required;
  let act = String(rawAction).toLowerCase();

  // A. Mapping fuzzy actions to keys
  if (!validActions.includes(act)) {
    if (act.includes('pay')) act = 'pay';
    else if (act.includes('respond') || act.includes('submit') || act.includes('widerspruch') || act.includes('appeal')) act = 'respond';
    else if (act.includes('attend') || act.includes('appointment')) act = 'attend';
    else if (act.includes('file') || act.includes('save')) act = 'file';
    else act = 'none';
  }

  // B. Legal Remedies & Urgency
  if (lowerRaw.includes("rechtsbehelfsbelehrung") || lowerRaw.includes("rechtsmittelbelehrung") || lowerRaw.includes("widerspruch")) {
    result.urgency = "urgent";
    if (act === "file" || act === "none") act = "respond"; // High priority review needed
  }

  // C. Enforcement / Legal Danger
  if (lowerRaw.includes("vollstreckung") || lowerRaw.includes("pfändung") || lowerRaw.includes("gerichtsvollzieher") || lowerRaw.includes("räumungsklage")) {
    result.urgency = "overdue";
    act = "respond";
    result.summary = "⚠️ LEGAL ACTION DETECTED. " + result.summary;
  }

  // D. Disambiguation (Guthaben vs Nachzahlung)
  if (lowerRaw.includes("nebenkosten") || lowerRaw.includes("jahresabrechnung") || lowerRaw.includes("steuerbescheid")) {
    if (lowerRaw.includes("guthaben") || lowerRaw.includes("erstattung")) {
        result.intent = "CREDIT";
        act = "file";
    } else if (lowerRaw.includes("nachzahlung") || lowerRaw.includes("fordern wir") || lowerRaw.includes("zahlen sie bitte")) {
        result.intent = "DEBT";
        act = "pay";
    }
  }

  // E. Jobcenter / Benefit specific
  if (lowerRaw.includes("jobcenter") || lowerRaw.includes("agentur für arbeit")) {
    result.main_category = "Government";
    if (lowerRaw.includes("aufhebung") || lowerRaw.includes("sanktion") || lowerRaw.includes("minderung")) {
        result.urgency = "overdue";
        act = "respond";
    } else if (lowerRaw.includes("bewilligung")) {
        result.intent = "CREDIT";
        act = "file";
    }
  }

  // F. Rentenversicherung
  if (lowerRaw.includes("rentenversicherung")) {
    result.main_category = "Finance"; // or dedicated Pension if added
    act = lowerRaw.includes("bescheid") ? "file" : act;
  }

  // G. Immigration
  if (lowerRaw.includes("ausländerbehörde") || lowerRaw.includes("bamf")) {
    result.main_category = "Government";
    result.urgency = lowerRaw.includes("ablehnung") ? "overdue" : "urgent";
    act = "respond";
  }

  result.action_required = act;

  // 5. MONEY & DATES
  const moneyObj = findKeyInObj(jsonParsed, ['money']);
  if (moneyObj && typeof moneyObj === 'object') {
    result.money = { ...result.money, ...moneyObj };
    if (typeof result.money.amount === 'string') result.money.amount = parseFloat(result.money.amount.replace(/[^0-9.]/g, ''));
    if (result.money.currency) result.money.currency = result.money.currency.replace(/EUR/g, '').trim() || 'EUR';
  } else {
    const amt = getFuzzy(/(?:Total Amount|Gesamtbetrag|Total|Amount|EUR):\s*.*?(\d+[.,]\d{2,})/i);
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
