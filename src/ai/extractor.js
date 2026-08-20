/**
 * Paperwork Assistant - Elite Deterministic Extraction Layer V3.3
 *
 * "Bulletproof Sender" Pass:
 * - Implemented Sender Scoring (counts occurrences instead of first-match).
 * - Added URL/Email protection (ignores matches inside web addresses).
 * - Weighted Header detection (matches in the first 800 chars get priority).
 */

// --- 1. FUZZY & UTILS ---

function levenshtein(a, b) {
  const m = [];
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(m[i-1][j]+1, m[i][j-1]+1, m[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    }
  }
  return m[a.length][b.length];
}

const KEYWORDS = {
  DUE: ['fälligkeit', 'fällig', 'zahlbar', 'spätestens', 'zahlungsziel'],
  ISSUED: ['bescheiddatum', 'datum', 'bekanntgabe', 'schreiben'],
  DEBT: ['nachzahlung', 'forderung', 'schuld', 'zahllast', 'mahnung', 'rechnungsbetrag', 'gesamtbetrag'],
  CREDIT: ['guthaben', 'erstattung', 'zuschuss', 'gutschrift', 'überweisen'],
  APPT: ['termin', 'einladung', 'vorsprache', 'beratung', 'uhrzeit']
};

function hasFuzzyKeyword(text, keywordList) {
  const tokens = text.toLowerCase().split(/\W+/);
  for (const token of tokens) {
    if (token.length < 4) continue;
    const t = token.replace(/8/g, 'b').replace(/1|\|/g, 'l').replace(/0/g, 'o');
    for (const kw of keywordList) {
      if (levenshtein(t, kw) / Math.max(t.length, kw.length) <= 0.18) return true;
    }
  }
  return false;
}

// --- 2. HARVESTERS ---

export function parseEuro(raw) {
  if (!raw) return 0;
  const num = raw.replace(/\s+/g, '').replace(/[^\d.,-]/g, '');
  const lastComma = num.lastIndexOf(',');
  const lastDot = num.lastIndexOf('.');
  return (lastComma > lastDot) ? parseFloat(num.replace(/\./g, '').replace(',', '.')) : parseFloat(num.replace(/,/g, ''));
}

function harvestTableMath(ocrText) {
    const amountRegex = /(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/g;
    const matches = ocrText.match(amountRegex) || [];
    const values = matches.map(parseEuro);
    for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < Math.min(i + 5, values.length); j++) {
            for (let k = j + 1; k < Math.min(j + 5, values.length); k++) {
                if (Math.abs((values[i] + values[j]) - values[k]) < 0.05 && values[i] > 0) return { net: values[i], tax: values[j], gross: values[k] };
            }
        }
    }
    return null;
}

function harvestAddresses(ocrText, lines) {
    const pcRegex = /\b\d{5}\b/g;
    const results = { sender: null, recipient: null, action: null };
    let match;
    while ((match = pcRegex.exec(ocrText)) !== null) {
        const lineIdx = ocrText.substring(0, match.index).split('\n').length - 1;
        const cluster = lines.slice(Math.max(0, lineIdx - 3), Math.min(lines.length, lineIdx + 1)).join(' ');
        if (/abholort|filiale|paketshop|packstation|standort|lager/i.test(cluster)) results.action = cluster;
        else if (/absender|firma|tel:|fax:|email|ust-id/i.test(cluster)) results.sender = cluster;
        else if (/herr|frau|familie/i.test(cluster)) results.recipient = cluster;
    }
    return results;
}

// --- 3. MAIN PIPELINE ---

export function extractFacts(ocrText) {
  const lines = ocrText.split('\n');
  const fullTextLower = ocrText.toLowerCase();
  const headerText = ocrText.slice(0, 1000).toLowerCase();

  const facts = {
    sender: 'Unknown',
    ibans: (ocrText.match(/\bDE\s*(?:\d\s*){20}\b/g) || []).map(m => m.replace(/\s+/g, '')),
    amounts: [],
    dates: [],
    polarity_overall: 'neutral',
    actions: [],
    doc_stage: 'other',
    legal_remedy: { present: false, type: null },
    risk_flags: { is_court_order: false, sender_looks_official: false },
    table: harvestTableMath(ocrText),
    addresses: harvestAddresses(ocrText, lines),
    attachments: [],
    nuances: []
  };

  // --- NUANCE HUNTING ---
  const serviceKeywords = {
    Internet: ['dsl', 'internet', 'breitband', 'glasfaser'],
    Mobile: ['mobilfunk', 'handy', 'sim-karte', 'lte', '5g'],
    Insurance: ['krankenversicherung', 'haftpflicht', 'beitrag', 'versicherung'],
    Utilities: ['strom', 'gas', 'wasser', 'abfall', 'müll'],
    Rent: ['miete', 'nebenkosten', 'betriebskosten']
  };
  for (const [cat, kws] of Object.entries(serviceKeywords)) {
    if (kws.some(kw => fullTextLower.includes(kw))) facts.nuances.push(cat);
  }

  // --- SENDER SCORING ENGINE ---
  const officialSenders = ["AOK", "TK", "Barmer", "Finanzamt", "Jobcenter", "Rentenversicherung", "Beitragsservice", "Rundfunkbeitrag"];
  const privateSenders = ["1&1", "Vodafone", "Telekom", "O2", "Stadtwerke", "ADAC", "Restlos", "Amazon", "IKEA"];

  let candidates = [];
  for (const s of [...officialSenders, ...privateSenders]) {
    // Strict whole word check that ignores URL components
    const sRegex = new RegExp(`(?:^|[^\\w./])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\w-])`, 'gi');
    let matchCount = (ocrText.match(sRegex) || []).length;

    if (matchCount > 0) {
      let score = matchCount;
      // Triple points if found in the header/letterhead
      if (headerText.includes(s.toLowerCase())) score += 10;
      candidates.push({ name: s, score });
    }
  }

  const bestSender = candidates.sort((a, b) => b.score - a.score)[0];
  if (bestSender) {
    facts.sender = (bestSender.name === "Rundfunkbeitrag") ? "Beitragsservice (GEZ)" : bestSender.name;
    facts.risk_flags.sender_looks_official = officialSenders.includes(bestSender.name);
  }

  // --- LEGAL LOGIC ---
  if (hasFuzzyKeyword(ocrText, ['vollstreckungsbescheid', 'mahnbescheid'])) {
    facts.doc_stage = 'mahnbescheid';
    facts.risk_flags.is_court_order = true;
  } else if (hasFuzzyKeyword(ocrText, ['bescheid'])) facts.doc_stage = 'bescheid';
  else if (hasFuzzyKeyword(ocrText, ['anhörung'])) facts.doc_stage = 'anhoerung';
  else if (hasFuzzyKeyword(ocrText, ['mitwirkung'])) facts.doc_stage = 'mitwirkung';

  // --- DATES ---
  const dateRegex = /\b([0-3]?\d)\.([0-1]?\d)\.(\d{2,4})\b/g;
  let dMatch;
  while ((dMatch = dateRegex.exec(ocrText)) !== null) {
    const window = ocrText.slice(Math.max(0, dMatch.index - 80), Math.min(ocrText.length, dMatch.index + 80));
    let role = 'other';
    if (hasFuzzyKeyword(window, KEYWORDS.DUE)) role = 'due';
    else if (hasFuzzyKeyword(window, KEYWORDS.ISSUED)) role = 'issued';
    else if (hasFuzzyKeyword(window, KEYWORDS.APPT)) role = 'appointment';
    facts.dates.push({ value: dMatch[0], role, index: dMatch.index });
  }

  // --- AMOUNTS ---
  const amountRegex = /(?:EUR|€)\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))|(\d{1,3}(?:\.\d{3})*(?:,\d{2}))\s*(?:EUR|€)/g;
  while ((dMatch = amountRegex.exec(ocrText)) !== null) {
    const val = parseEuro(dMatch[0]);
    if (val < 0.1) continue;
    const window = ocrText.slice(Math.max(0, dMatch.index - 100), Math.min(ocrText.length, dMatch.index + 100));
    let polarity = hasFuzzyKeyword(window, KEYWORDS.DEBT) ? 'debit' : hasFuzzyKeyword(window, KEYWORDS.CREDIT) ? 'credit' : 'neutral';
    facts.amounts.push({ value: val, role: polarity, index: dMatch.index });
  }

  // --- FINAL ACTION LOGIC ---
  let score = { debit: (facts.amounts.filter(a => a.role === 'debit').length), credit: (facts.amounts.filter(a => a.role === 'credit').length) };

  if (facts.table || score.debit > 0 || fullTextLower.includes('rechnung') || fullTextLower.includes('mahnung')) {
      facts.polarity_overall = 'nachzahlung';
      facts.actions.push({ key: 'pay', priority: 1, reason: 'Invoice or payment obligation detected' });
  } else if (score.credit > score.debit) {
      facts.polarity_overall = 'guthaben';
  }

  if (hasFuzzyKeyword(ocrText, ['termin', 'einladung'])) facts.actions.push({ key: 'attend', priority: 1, reason: 'Appointment' });

  return facts;
}

export function smartSliceOCR(text, maxChars = 2500, facts = null) {
  if (!text || text.length <= maxChars) return text;
  const header = text.slice(0, 800), tail = text.slice(-400);
  if (!facts) return header + "\n[...]\n" + tail;
  const anchors = [...facts.dates.map(d => d.index), ...facts.amounts.map(a => a.index)].filter(idx => idx > 800 && idx < text.length - 400);
  let windows = anchors.map(idx => ({ start: Math.max(0, idx - 200), end: Math.min(text.length, idx + 200) }));
  if (windows.length > 0) {
    windows.sort((a, b) => a.start - b.start);
    const merged = [windows[0]];
    for (let i = 1; i < windows.length; i++) {
        let last = merged[merged.length - 1];
        if (windows[i].start <= last.end) last.end = Math.max(last.end, windows[i].end);
        else merged.push(windows[i]);
    }
    windows = merged;
  }
  return (header + "\n[...]\n" + windows.map(w => text.slice(w.start, w.end)).join('\n[...]\n') + "\n[...]\n" + tail).slice(0, maxChars);
}

export function buildAttentionModel(ocrText, previousDocs = []) {
  const facts = extractFacts(ocrText);
  const primaryAction = facts.actions.sort((a, b) => a.priority - b.priority)[0]?.key || 'file';
  let urgency = 'informational';
  if (facts.risk_flags.is_court_order || ocrText.toLowerCase().includes('mahnung')) urgency = 'overdue';
  else if (facts.actions.some(a => a.key === 'pay' || a.key === 'attend')) urgency = 'urgent';

  return { facts, primaryAction, urgency };
}
