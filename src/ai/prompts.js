export function buildSystemPrompt(language) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';

  return `Analyze this document. Output ONLY valid JSON. Respond ONLY with valid JSON.
All values in ${langName}.
JSON Schema:
{
  "intent": "DEBT|CREDIT|ACTION",
  "sender": "Exact Company Name",
  "document_type": "invoice|notice|contract|government|healthcare|bank|appointment|fine|other",
  "dates": {"document_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD", "appointment_date": "YYYY-MM-DD"},
  "money": {"amount": 0.00, "currency": "EUR"},
  "main_category": "Finance|Housing|Government|Employment|Insurance|Healthcare|Utility|Other",
  "action_required": "pay|respond|file|attend|renew|none",
  "urgency": "overdue|urgent|upcoming|informational",
  "summary": "2 simple sentences in ${langName} explaining what to do.",
  "action_steps": "Numbered steps in ${langName}."
}
If a fact is missing, use null. No prose.`;
}

function sanitizeForPrompt(text) {
  return text
    .replace(/ignore (all |previous |above )?instructions?/gi, '[REDACTED]')
    .replace(/you are (now |a )?assistant/gi, '[REDACTED]')
    .replace(/system prompt/gi, '[REDACTED]')
    .replace(/<\/document>/gi, '');
}

/**
 * Merges overlapping text ranges to avoid redundant content in the prompt.
 */
function mergeRanges(ranges) {
  if (ranges.length === 0) return [];
  // Sort by start position
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

export function smartSliceOCR(text, maxChars = 2300) {
  if (!text || text.length <= maxChars) return text || '';

  const sanitized = sanitizeForPrompt(text);
  const totalLen = sanitized.length;

  // 1. Define mandatory ranges
  const ranges = [
    { start: 0, end: 900 },            // Golden Header
    { start: totalLen - 400, end: totalLen } // Tail Capture
  ];

  // 2. Multi-language anchors
  const keywords = [
    'iban', 'total', 'amount', 'betrag', 'summe', 'gesamt', 'suma', 'montant',
    'due', 'fällig', 'deadline', 'frist', 'scadență', 'echeance', 'vencimiento',
    'address', 'straße', 'location', 'ort', 'adresa', 'direccion',
    'pickup', 'abholung', 'appointment', 'termin', 'programare', 'cita',
    'miet', 'rent', 'chirie', 'alquiler', 'loyer',
    'fine', 'bußgeld', 'amendă', 'multa', 'amende'
  ];

  // 3. Find keyword-anchored "Hot Zones"
  const bodyText = sanitized.slice(900, -400);
  const bodyOffset = 900;
  let zoneCount = 0;

  keywords.forEach(kw => {
    if (zoneCount >= 5) return;
    const regex = new RegExp(kw, 'gi');
    let match;
    while ((match = regex.exec(bodyText)) !== null && zoneCount < 5) {
      const start = Math.max(0, match.index - 150) + bodyOffset;
      const end = Math.min(bodyText.length, match.index + 250) + bodyOffset;
      ranges.push({ start, end });
      zoneCount++;
      regex.lastIndex += 300; // Skip ahead to find diverse zones
    }
  });

  // 4. Merge overlapping ranges to deduplicate content
  const merged = mergeRanges(ranges);

  // 5. Assemble final string
  const result = merged
    .map(r => sanitized.slice(r.start, r.end))
    .join('\n[...]\n');

  // Hard safety cap
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

  // JSON Guard and Regex Rescue removed in Phase 3.
  // json_object mode + system prompt instruction + intent-first pre-fill
  // guarantee syntactically valid JSON at the engine level.
  // Normalization layer below handles schema enforcement only.

  let jsonParsed = null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonParsed = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Critical: JSON parsing failed despite constrained generation.", e);
    return result;
  }

  if (!jsonParsed) return result;

  // 🛡️ NORMALIZATION (Schema Enforcement)
  const getJsonVal = (keys) => {
    for (const k of keys) {
      const normalizedK = k.toLowerCase().replace(/[\s_]/g, '');
      const foundKey = Object.keys(jsonParsed).find(p => p.toLowerCase().replace(/[\s_]/g, '') === normalizedK);
      if (foundKey) return jsonParsed[foundKey];
    }
    return null;
  };

  result.sender = getJsonVal(['sender', 'company']) || result.sender;
  result.summary = getJsonVal(['summary', 'explanation']) || result.summary;
  result.action_steps = getJsonVal(['actionsteps', 'steps']) || result.action_steps;
  result.document_type = getJsonVal(['documenttype', 'type']) || result.document_type;
  result.main_category = getJsonVal(['maincategory', 'category']) || result.main_category;
  result.action_required = getJsonVal(['actionrequired', 'action']) || result.action_required;
  result.urgency = getJsonVal(['urgency', 'priority']) || result.urgency;

  // Money Normalization
  if (jsonParsed.money && typeof jsonParsed.money === 'object') {
    result.money = { ...result.money, ...jsonParsed.money };
  } else {
    const amt = getJsonVal(['amount', 'total', 'totalamount', 'gesamtbetrag']);
    if (amt) result.money.amount = parseFloat(String(amt).replace(',', '.').replace(/[^0-9.]/g, ''));
    result.money.currency = getJsonVal(['currency', 'währung']) || 'EUR';
  }

  // Dates Normalization
  if (jsonParsed.dates && typeof jsonParsed.dates === 'object') {
    result.dates = { ...result.dates, ...jsonParsed.dates };
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
