/**
 * Paperwork Assistant - Deterministic Extraction Layer (The "Fact Hunter")
 *
 * Job: Establish the "Ground Truth" facts (numbers, dates, polarity, actions)
 * before the AI model starts. This ensures 100% reliability for non-native speakers.
 */

// --- 1. UTILITIES & FUZZY MATCHING ---

/**
 * Tiny Levenshtein implementation for OCR-Heal.
 * Handles up to 15% noise (e.g., 'Fä11igkeit' -> 'Fälligkeit').
 */
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
  'mahnung', 'mitwirkung', 'rechtsbehelfsbelehrung', 'vollstreckungsbescheid'
];

function fuzzyMatch(token) {
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
    // German format: 1.248,50
    return parseFloat(num.replace(/\./g, '').replace(',', '.'));
  }
  // English/Standard: 1,248.50 or plain
  return parseFloat(num.replace(/,/g, ''));
}

export function normalizeDate(raw) {
  // Try to match DD.MM.YYYY or YYYY-MM-DD
  const m = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/) || raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  if (m[3].length === 4) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return m[0]; // fallback
}

// --- 3. EXTRACTION LOGIC ---

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
    locations: []
  };

  // A. IBAN & SENDER ANCHORS
  const ibanRegex = /\bDE\s*(?:\d\s*){20}\b/g;
  const ibanMatches = ocrText.match(ibanRegex) || [];
  facts.ibans = ibanMatches.map(m => m.replace(/\s+/g, ''));

  const commonSenders = ["AOK", "TK", "Barmer", "Finanzamt", "Jobcenter", "Vodafone", "Telekom", "Stadtwerke", "Beitragsservice", "Rundfunkbeitrag", "Deutsche Rentenversicherung"];
  for (const s of commonSenders) {
    if (fullTextLower.includes(s.toLowerCase())) {
      facts.sender = (s === "Rundfunkbeitrag") ? "Beitragsservice (GEZ)" : s;
      break;
    }
  }

  // B. DATES & ROLES
  const dateRegex = /\b([0-3]?\d)\.([0-1]?\d)\.(\d{2,4})\b/g;
  const issuedAnchors = /bescheiddatum|datum|bekanntgabe|schreiben vom/i;
  const dueAnchors = /fällig am|zu zahlen bis|spätestens am|zahlungsziel/i;
  const apptAnchors = /termin|einladung|uhrzeit/i;

  let match;
  while ((match = dateRegex.exec(ocrText)) !== null) {
    const context = ocrText.slice(Math.max(0, match.index - 80), Math.min(ocrText.length, match.index + 80));
    let role = 'other';
    if (dueAnchors.test(context)) role = 'due';
    else if (issuedAnchors.test(context)) role = 'issued';
    else if (apptAnchors.test(context)) role = 'appointment';

    facts.dates.push({
      value: normalizeDate(match[0]),
      role,
      raw: match[0],
      index: match.index
    });
  }

  // C. AMOUNTS & POLARITY
  const amountRegex = /(?:EUR|€)\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))|(\d{1,3}(?:\.\d{3})*(?:,\d{2}))\s*(?:EUR|€)/g;
  const debitWords = /nachzahlung|zahllast|forderung|schuld|überweisen sie/i;
  const creditWords = /guthaben|erstattung|zuschuss|gutschrift/i;

  while ((match = amountRegex.exec(ocrText)) !== null) {
    const val = parseEuro(match[0]);
    if (val === 0) continue;

    const context = ocrText.slice(Math.max(0, match.index - 100), Math.min(ocrText.length, match.index + 100));
    let polarity = 'neutral';
    if (debitWords.test(context)) polarity = 'debit';
    else if (creditWords.test(context)) polarity = 'credit';

    facts.amounts.push({ value: val, raw: match[0], polarity, index: match.index });
  }

  // D. DETERMINISTIC POLARITY SCORE
  let debitScore = (ocrText.match(debitWords) || []).length * 2;
  let creditScore = (ocrText.match(creditWords) || []).length * 2;
  if (debitScore > creditScore) facts.polarity_overall = 'nachzahlung';
  else if (creditScore > debitScore) facts.polarity_overall = 'guthaben';

  // E. MULTI-ACTION & OVERRIDES
  // 1. Pay Action
  if (facts.polarity_overall === 'nachzahlung' || fullTextLower.includes('mahnung')) {
    facts.actions.push({ key: 'pay', priority: 1, reason: 'Payment obligation detected' });
  }
  // 2. Attend Action
  if (fullTextLower.includes('termin') || fullTextLower.includes('uhr')) {
    facts.actions.push({ key: 'attend', priority: 1, reason: 'Appointment detected' });
  }
  // 3. Subsidy Approval
  if (fullTextLower.includes('kostenplan') || fullTextLower.includes('zuschuss')) {
    facts.actions.push({ key: 'file', priority: 2, reason: 'Subsidy approval' });
    facts.polarity_overall = 'guthaben';
  }
  // 4. Respond Action
  if (fullTextLower.includes('mitwirkung') || fullTextLower.includes('rechtsbehelfsbelehrung')) {
    facts.actions.push({ key: 'respond', priority: 2, reason: 'Official cooperation or appeal window' });
  }

  return facts;
}

/**
 * Smart Slicing v3: Anchor-Based Context Windows.
 * Grabs 400-char windows around each detected fact.
 */
export function smartSliceOCR(text, maxChars = 2500, facts = null) {
  if (!text) return '';
  if (text.length <= maxChars) return text;

  const header = text.slice(0, 800);
  const tail = text.slice(-400);

  if (!facts) return header + "\n[...]\n" + tail;

  // Collect indices of all facts
  const anchors = [
    ...facts.dates.map(d => d.index),
    ...facts.amounts.map(a => a.index)
  ].filter(idx => idx !== undefined && idx > 800 && idx < text.length - 400);

  // Generate windows around anchors
  let windows = anchors.map(idx => {
    return { start: Math.max(0, idx - 200), end: Math.min(text.length, idx + 200) };
  });

  // Merge overlapping windows
  if (windows.length > 0) {
    windows.sort((a, b) => a.start - b.start);
    const merged = [windows[0]];
    for (let i = 1; i < windows.length; i++) {
        let last = merged[merged.length - 1];
        if (windows[i].start <= last.end) {
            last.end = Math.max(last.end, windows[i].end);
        } else {
            merged.push(windows[i]);
        }
    }
    windows = merged;
  }

  let middle = windows.map(w => text.slice(w.start, w.end)).join('\n[...]\n');

  // Final assembly capped at maxChars
  const final = header + "\n[...]\n" + middle + "\n[...]\n" + tail;
  return final.slice(0, maxChars);
}

/**
 * Generates an "Attention Model" that merges hard facts with LLM instructions.
 */
export function buildAttentionModel(ocrText) {
  const facts = extractFacts(ocrText);

  // Set primary action based on priority
  const sortedActions = [...facts.actions].sort((a, b) => a.priority - b.priority);
  const primaryAction = sortedActions[0]?.key || 'file';

  return {
    facts,
    primaryAction,
    urgency: (ocrText.toLowerCase().includes('mahnung') || ocrText.toLowerCase().includes('vollstreckung')) ? 'overdue' :
             (facts.actions.some(a => a.key === 'attend' || a.key === 'respond')) ? 'urgent' : 'informational'
  };
}
