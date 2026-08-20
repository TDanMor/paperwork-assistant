/**
 * Paperwork Assistant - Deterministic Extraction Layer (The "Fact Hunter")
 *
 * Job: Establish the "Ground Truth" facts (numbers, dates, polarity, actions, tables, addresses)
 * before the AI model starts. This ensures 100% reliability for non-native speakers.
 */

// --- 1. UTILITIES & FUZZY MATCHING ---

function levenshtein(a, b) {
  const m = [];
  for (let i = 0; i <= a.length; i++) m[i] = [i];
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return m[a.length][b.length];
}

const ADMIN_DICTIONARY = [
  'fälligkeit', 'bescheiddatum', 'bekanntgabe', 'einspruch', 'widerspruch',
  'nachzahlung', 'guthaben', 'erstattung', 'abholort', 'termin', 'vorsprache',
  'mahnung', 'mitwirkung', 'rechtsbehelfsbelehrung', 'vollstreckungsbescheid',
  'zahlbetrag', 'rechnungsdatum', 'aktenzeichen', 'kassenzeichen'
];

function fuzzyMatch(token) {
  if (!token || token.length < 4) return null;
  const t = token.toLowerCase().replace(/8/g, 'b').replace(/1|\|/g, 'l').replace(/0/g, 'o');
  let best = { kw: null, dist: Infinity };
  for (const kw of ADMIN_DICTIONARY) {
    const d = levenshtein(t, kw);
    const ratio = d / Math.max(t.length, kw.length);
    if (ratio <= 0.15 && d < best.dist) best = { kw, dist: d };
  }
  return best.kw;
}

// --- 2. DATA NORMALIZATION ---

export function parseEuro(raw) {
  if (!raw) return 0;
  const num = raw.replace(/\s+/g, '').replace(/[^\d.,-]/g, '');
  const lastComma = num.lastIndexOf(',');
  const lastDot = num.lastIndexOf('.');

  if (lastComma > lastDot) {
    return parseFloat(num.replace(/\./g, '').replace(',', '.'));
  }
  return parseFloat(num.replace(/,/g, ''));
}

export function normalizeDate(raw) {
  const m = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/) || raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  if (m[3] && m[3].length === 4) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return m[0];
}

// --- 3. ADVANCED HARVESTERS ---

/**
 * Mathematical Table Harvester: A + B = C
 * Identifies Net, VAT, and Gross relationship.
 */
function harvestTableMath(ocrText) {
    const amountRegex = /(?:\d{1,3}(?:\.\d{3})*(?:,\d{2}))/g;
    const matches = ocrText.match(amountRegex) || [];
    const values = matches.map(parseEuro);

    for (let i = 0; i < values.length - 2; i++) {
        const a = values[i], b = values[i+1], c = values[i+2];
        // Check if A + B = C (allowing 2 cent rounding margin)
        if (Math.abs((a + b) - c) < 0.03 && a > 0 && b > 0) {
            return { net: a, tax: b, gross: c, confidence: 'high' };
        }
    }
    return null;
}

/**
 * Address Scorer: Clusters around postcodes.
 * Distinguishes Sender, Recipient, and Action Location (Warehouse).
 */
function harvestAddresses(ocrText, lines) {
    const pcRegex = /\b\d{5}\b/g;
    const results = { sender: null, recipient: null, action: null };
    let match;

    while ((match = pcRegex.exec(ocrText)) !== null) {
        const lineIdx = ocrText.substring(0, match.index).split('\n').length - 1;
        const cluster = lines.slice(Math.max(0, lineIdx - 3), Math.min(lines.length, lineIdx + 1)).join(' ');
        const clusterLower = cluster.toLowerCase();

        let score = { sender: 0, recipient: 0, action: 0 };

        if (/absender|firma|tel:|fax:|email:|ust-id/i.test(cluster)) score.sender += 3;
        if (/herr|frau|familie/i.test(cluster)) score.recipient += 3;
        if (/abholort|filiale|paketshop|packstation|standort|lager/i.test(clusterLower)) score.action += 5;

        if (score.action >= 5) results.action = cluster;
        else if (score.sender > score.recipient) results.sender = cluster;
        else if (score.recipient > score.sender) results.recipient = cluster;
    }
    return results;
}

// --- 4. CORE EXTRACTION ---

export function extractFacts(ocrText) {
  const lines = ocrText.split('\n');
  const fullTextLower = ocrText.toLowerCase();

  const facts = {
    sender: 'Unknown',
    ibans: [],
    amounts: [],
    dates: [],
    reference_numbers: [],
    polarity_overall: 'neutral',
    actions: [],
    locations: [],
    doc_stage: 'other',
    legal_remedy: { present: false, type: null },
    attachments: [],
    risk_flags: { is_court_order: false, sender_looks_official: false },
    table: harvestTableMath(ocrText),
    addresses: harvestAddresses(ocrText, lines)
  };

  // A. ENTITIES (IBAN, EMAIL, PHONE)
  facts.ibans = (ocrText.match(/\bDE\s*(?:\d\s*){20}\b/g) || []).map(m => m.replace(/\s+/g, ''));
  const emails = ocrText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g) || [];
  const phones = ocrText.match(/(?:\+49|0049|0)[1-9][0-9\s\-/]{7,15}/g) || [];

  // B. FUZZY SENDER & OFFICIAL CHECK
  const commonSenders = ["AOK", "TK", "Barmer", "Finanzamt", "Jobcenter", "Vodafone", "Telekom", "Stadtwerke", "Beitragsservice", "Rundfunkbeitrag", "Deutsche Rentenversicherung"];
  for (const s of commonSenders) {
    if (fullTextLower.includes(s.toLowerCase())) {
      facts.sender = (s === "Rundfunkbeitrag") ? "Beitragsservice (GEZ)" : s;
      facts.risk_flags.sender_looks_official = true;
      break;
    }
  }

  // C. DOCUMENT TYPE & LEGAL STAGE (WITH FUZZY SUPPORT)
  const tokens = fullTextLower.split(/\W+/);
  for (const token of tokens) {
    const match = fuzzyMatch(token);
    if (match === 'vollstreckungsbescheid' || match === 'mahnbescheid') {
        facts.doc_stage = 'mahnbescheid';
        facts.risk_flags.is_court_order = true;
    } else if (match === 'bescheid') facts.doc_stage = 'bescheid';
    else if (match === 'anhörung') facts.doc_stage = 'anhoerung';
    else if (match === 'mitwirkung') facts.doc_stage = 'aufforderung_mitwirkung';
    else if (match === 'mahnung') facts.doc_stage = 'mahnung';
  }

  // D. LEGAL REMEDY
  if (fullTextLower.includes('rechtsbehelfsbelehrung') || fullTextLower.includes('rechtsmittelbelehrung')) {
    facts.legal_remedy.present = true;
    if (fullTextLower.includes('widerspruch')) facts.legal_remedy.type = 'widerspruch';
    else if (fullTextLower.includes('einspruch')) facts.legal_remedy.type = 'einspruch';
  }

  // E. DATES & ROLES (PROXIMITY BASED)
  const dateRegex = /\b([0-3]?\d)\.([0-1]?\d)\.(\d{2,4})\b/g;
  const dueAnchors = /fällig am|zu zahlen bis|spätestens am|zahlungsziel/i;
  let dMatch;
  while ((dMatch = dateRegex.exec(ocrText)) !== null) {
    const context = ocrText.slice(Math.max(0, dMatch.index - 80), Math.min(ocrText.length, dMatch.index + 80));
    let role = 'other';
    if (dueAnchors.test(context)) role = 'due';
    else if (/bescheiddatum|datum|bekanntgabe/i.test(context)) role = 'issued';
    else if (/termin|uhrzeit/i.test(context)) role = 'appointment';

    facts.dates.push({ value: normalizeDate(dMatch[0]), role, raw: dMatch[0], index: dMatch.index });
  }

  // F. AMOUNTS & POLARITY
  const amountRegex = /(?:EUR|€)\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))|(\d{1,3}(?:\.\d{3})*(?:,\d{2}))\s*(?:EUR|€)/g;
  const debitWords = /nachzahlung|zahllast|forderung|schuld|überweisen sie/i;
  const creditWords = /guthaben|erstattung|zuschuss|gutschrift/i;
  while ((dMatch = amountRegex.exec(ocrText)) !== null) {
    const val = parseEuro(dMatch[0]);
    if (val === 0) continue;
    const context = ocrText.slice(Math.max(0, dMatch.index - 100), Math.min(ocrText.length, dMatch.index + 100));
    let polarity = debitWords.test(context) ? 'debit' : creditWords.test(context) ? 'credit' : 'neutral';
    facts.amounts.push({ value: val, raw: dMatch[0], polarity, index: dMatch.index });
  }

  // G. POLARITY SCORE & MULTI-ACTION
  let score = { debit: (ocrText.match(debitWords) || []).length, credit: (ocrText.match(creditWords) || []).length };

  // Rule: Jobcenter "Nachzahlung von Leistungen" is a CREDIT
  if (facts.sender === 'Jobcenter' && fullTextLower.includes('nachzahlung von leistungen')) {
      score.credit += 5;
  }

  facts.polarity_overall = score.debit > score.credit ? 'nachzahlung' : score.credit > score.debit ? 'guthaben' : 'neutral';

  if (facts.polarity_overall === 'nachzahlung' || fullTextLower.includes('mahnung')) facts.actions.push({ key: 'pay', priority: 1, reason: 'Payment due' });
  if (fullTextLower.includes('termin')) facts.actions.push({ key: 'attend', priority: 1, reason: 'Appointment' });
  if (facts.doc_stage === 'aufforderung_mitwirkung') facts.actions.push({ key: 'respond', priority: 2, reason: 'Submit documents' });

  // Rule: Nebenkostenabrechnung 12-month barred check
  if (fullTextLower.includes('nebenkostenabrechnung') && facts.polarity_overall === 'nachzahlung') {
      const yearMatch = ocrText.match(/20\d{2}/);
      if (yearMatch) {
          const billingYear = parseInt(yearMatch[0]);
          const currentYear = new Date().getFullYear();
          if (currentYear - billingYear > 1) {
              facts.actions.push({ key: 'check_details', priority: 1, reason: 'Potential limitation period (Verjährung) - check if more than 12 months late.' });
          }
      }
  }

  return facts;
}

/**
 * Smart Slicing v3: Anchor-Based Context Windows.
 */
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

/**
 * Generates an "Attention Model" that merges hard facts with AI instructions.
 */
export function buildAttentionModel(ocrText, previousDocs = []) {
  const facts = extractFacts(ocrText);
  const primaryAction = facts.actions.sort((a, b) => a.priority - b.priority)[0]?.key || 'file';

  // Historical Comparison Logic
  let amountChanged = false;
  if (facts.amounts.length > 0 && previousDocs.length > 0) {
      const prev = previousDocs.find(d => d.sender === facts.sender);
      if (prev && prev.money?.amount && Math.abs(prev.money.amount - facts.amounts[0].value) > 1.0) amountChanged = true;
  }

  return {
    facts,
    primaryAction,
    amountChanged,
    urgency: facts.risk_flags.is_court_order ? 'overdue' : (facts.actions.some(a => a.priority === 1) ? 'urgent' : 'informational')
  };
}
