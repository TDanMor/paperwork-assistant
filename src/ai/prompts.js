export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Expert Doc Analyzer for non-native speakers. Output FLAT JSON in ${langName}.

CRITICAL PERSONA:
- Translate EVERY German term into simple ${langName}.
- Never use terms like "Heil- und Kostenplan" or "zahnärztliche Praxis". Use "Dental Cost Plan" and "Dentist".
- Be honest about TIMING. If action depends on a future event (like finishing treatment), say so.

SCHEMA RULES:
- summary: "This is [Document Type] from [Sender]. [Condition for action]. [What to do]."
- action_steps: Array of simple translated tasks.

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
  const keywords = ['abholung', 'pickup', 'nach abschluss', 'voraussetzung', 'termin', 'address', 'iban', 'erstatt', 'zuschuss', 'festzuschuss', 'genehmigung', 'total', 'betrag'];
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
  return `<document>\n${smartSliceOCR(ocrText, 2500)}\n</document>\n\nJSON in ${langName}. No labels. Direct facts only.`;
}

export function parseAIResponse(raw) {
  console.log("Raw AI Response:", raw);
  if (!raw || typeof raw !== 'string') throw new Error("Empty response.");

  const result = getFallbackData();
  const lowerRaw = raw.toLowerCase();

  // 🛡️ PRE-PARSER SENDER FIX
  if (lowerRaw.includes("aok bayern") || lowerRaw.includes("aok - postfach")) result.sender = "AOK Bayern";
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

  // 🧹 CLEAN PREAMBLES & LABELS
  const chatter = ["here is the output", "in english json", "json format", "logic:", "output:", "analysis:", "location:", "time:", "context:"];
  chatter.forEach(phrase => {
    const regex = new RegExp(`^.*?${phrase.replace(':', '\\:')}.*?(\\n|\\:|$)`, 'gi');
    summary = summary.replace(regex, '');
  });
  result.summary = summary.replace(/\{[\s\S]*?\}|\[[\s\S]*?\]/g, '').trim() || "No summary available.";

  // 3. ACTION STEPS
  const rawSteps = findKeyInObj(jsonParsed, ['actionsteps', 'steps']) || getFuzzy(/(?:Action Steps|What to do|Steps|Important Notes):\s*([\s\S]*?)(?:Exact Address|Contact|JSON|$)/i);
  let steps = Array.isArray(rawSteps) ? rawSteps.join(' ') : (rawSteps ? String(rawSteps) : "");
  result.action_steps = steps.replace(/(Logistics|Conditions|Note):\s*[\s\S]*$/gi, '').trim() || "Check the document for instructions.";

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

  // 🛡️ SUBSIDY/HEALTHCARE OVERRIDE (DETERMINISTIC)
  if (lowerRaw.includes('kostenplan') || lowerRaw.includes('zuschuss') || lowerRaw.includes('genehmigung') || result.sender.includes('AOK')) {
    result.intent = 'CREDIT';
    result.action_required = (act === 'pay' || act === 'none') ? 'file' : act;
    result.document_type = lowerRaw.includes('kostenplan') ? 'cost_approval' : 'notice';
    result.main_category = 'Healthcare';
    result.sub_category = 'Other';
  }

  // 5. MONEY & DATES
  const moneyObj = findKeyInObj(jsonParsed, ['money']);
  if (moneyObj && typeof moneyObj === 'object') {
    result.money = { ...result.money, ...moneyObj };
    // 🛡️ UI Fix: Strip redundant currency from the number if the AI put it there
    if (typeof result.money.amount === 'string') {
        result.money.amount = parseFloat(result.money.amount.replace(/[^0-9.]/g, ''));
    }
    // Clean up currency string (remove EUR EUR issues)
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
    action_steps: 'Check the document for instructions.'
  };
}
