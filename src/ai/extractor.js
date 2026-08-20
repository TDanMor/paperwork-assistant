/**
 * Paperwork Assistant - Elite Deterministic Extraction Layer V3.1
 *
 * Final Audit Fixes:
 * 1. Fuzzy Anchor Detection (OCR-Heal) integrated into all role loops.
 * 2. Mathematical Table cross-validation (A+B=C).
 * 3. Geographic Address Collision scoring.
 */

// --- 1. FUZZY CORE ---

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

const KEYWORDS = {
  DUE: ['fälligkeit', 'fällig', 'zahlbar', 'spätestens', 'zahlungsziel'],
  ISSUED: ['bescheiddatum', 'datum', 'bekanntgabe', 'schreiben'],
  DEBT: ['nachzahlung', 'forderung', 'schuld', 'zahllast', 'mahnung'],
  CREDIT: ['guthaben', 'erstattung', 'zuschuss', 'gutschrift', 'überweisen'],
  APPT: ['termin', 'einladung', 'vorsprache', 'beratung', 'uhrzeit']
};

function hasFuzzyKeyword(text, keywordList) {
  const tokens = text.toLowerCase().split(/\W+/);
  for (const token of tokens) {
    if (token.length < 4) continue;
    // Normalized check for common OCR swaps (1/l, 8/b, 0/o)
    const t = token.replace(/8/g, 'b').replace(/1|\|/g, 'l').replace(/0/g, 'o');
    for (const kw of keywordList) {
      const d = levenshtein(t, kw);
      if (d / Math.max(t.length, kw.length) <= 0.18) return true;
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
    // Sliding window of 5 to find A+B=C even with text in between
    for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < Math.min(i + 4, values.length); j++) {
            for (let k = j + 1; k < Math.min(j + 4, values.length); k++) {
                const a = values[i], b = values[j], c = values[k];
                if (Math.abs((a + b) - c) < 0.05 && a > 0 && b > 0) return { net: a, tax: b, gross: c };
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
    attachments: []
  };

  // Attachment Detection
  if (hasFuzzyKeyword(ocrText, ['anlage', 'anlagen', 'beigefügt', 'anhang'])) {
    lines.forEach(line => {
      if (line.toLowerCase().includes('anlage') || line.toLowerCase().includes('anhang')) {
        if (line.length < 80) facts.attachments.push(line.trim());
      }
    });
  }

  // Sender Logic
  const commonSenders = ["AOK", "TK", "Barmer", "Finanzamt", "Jobcenter", "Vodafone", "Telekom", "Stadtwerke", "Beitragsservice", "Rundfunkbeitrag", "Rentenversicherung", "ADAC", "Restlos"];
  for (const s of commonSenders) {
    if (fullTextLower.includes(s.toLowerCase())) {
      facts.sender = (s === "Rundfunkbeitrag") ? "Beitragsservice (GEZ)" : s;
      facts.risk_flags.sender_looks_official = ["Finanzamt", "Jobcenter", "AOK", "TK", "Beitragsservice", "Rundfunkbeitrag", "Rentenversicherung"].includes(s);
      break;
    }
  }

  // Fuzzy Stage detection
  if (hasFuzzyKeyword(ocrText, ['vollstreckungsbescheid', 'mahnbescheid'])) {
    facts.doc_stage = 'mahnbescheid';
    facts.risk_flags.is_court_order = true;
  } else if (hasFuzzyKeyword(ocrText, ['bescheid'])) facts.doc_stage = 'bescheid';
  else if (hasFuzzyKeyword(ocrText, ['anhörung'])) facts.doc_stage = 'anhoerung';
  else if (hasFuzzyKeyword(ocrText, ['mitwirkung'])) facts.doc_stage = 'mitwirkung';

  // Legal Remedy
  if (hasFuzzyKeyword(ocrText, ['rechtsbehelfsbelehrung', 'rechtsmittelbelehrung'])) {
    facts.legal_remedy.present = true;
    facts.legal_remedy.type = fullTextLower.includes('widerspruch') ? 'widerspruch' : 'einspruch';
  }

  // Dates with Fuzzy Role Anchors
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

  // Amounts with Fuzzy Polarity
  const amountRegex = /(?:EUR|€)\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))|(\d{1,3}(?:\.\d{3})*(?:,\d{2}))\s*(?:EUR|€)/g;
  while ((dMatch = amountRegex.exec(ocrText)) !== null) {
    const val = parseEuro(dMatch[0]);
    if (val < 0.1) continue;
    const window = ocrText.slice(Math.max(0, dMatch.index - 100), Math.min(ocrText.length, dMatch.index + 100));
    let polarity = hasFuzzyKeyword(window, KEYWORDS.DEBT) ? 'debit' : hasFuzzyKeyword(window, KEYWORDS.CREDIT) ? 'credit' : 'neutral';
    facts.amounts.push({ value: val, role: polarity, index: dMatch.index });
  }

  // Scoring & Actions
  let score = { debit: (facts.amounts.filter(a => a.role === 'debit').length * 2), credit: (facts.amounts.filter(a => a.role === 'credit').length * 2) };
  if (facts.sender === 'Jobcenter' && fullTextLower.includes('nachzahlung von leistungen')) score.credit += 10;
  facts.polarity_overall = score.debit > score.credit ? 'nachzahlung' : score.credit > score.debit ? 'guthaben' : 'neutral';

  if (facts.polarity_overall === 'nachzahlung' || facts.doc_stage === 'mahnbescheid') facts.actions.push({ key: 'pay', priority: 1, reason: 'Payment Due' });
  if (hasFuzzyKeyword(ocrText, ['termin', 'einladung'])) facts.actions.push({ key: 'attend', priority: 1, reason: 'Appointment' });
  if (facts.doc_stage === 'mitwirkung') facts.actions.push({ key: 'respond', priority: 2, reason: 'Provide Information' });

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
  let amountChanged = false;
  if (facts.amounts.length > 0 && previousDocs.length > 0) {
      const prev = previousDocs.find(d => d.sender === facts.sender);
      if (prev && prev.money?.amount && Math.abs(prev.money.amount - facts.amounts[0].value) > 1.0) amountChanged = true;
  }
  return {
    facts, primaryAction, amountChanged,
    urgency: facts.risk_flags.is_court_order ? 'overdue' : (facts.actions.some(a => a.priority === 1) ? 'urgent' : 'informational')
  };
}
