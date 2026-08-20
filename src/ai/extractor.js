/**
 * Paperwork Assistant - Master Level German Bureaucratic Extractor V4.0
 *
 * "Expert German Layer" Pass:
 * - Implemented Reference Number (Aktenzeichen/Kassenzeichen) extraction.
 * - VAT Math (USt/MwSt) verification for 'Confirmed Invoice' status.
 * - German Address Standard (Street + Number) for improved scoring.
 * - Legal Remedy (Widerspruch) deadline calculation (+3 days + 1 month).
 * - Expanded Dictionary (Vollstreckungsankündigung, Mitwirkungspflicht).
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
  DUE: ['fälligkeit', 'fällig', 'zahlbar', 'spätestens', 'zahlungsziel', 'frist'],
  ISSUED: ['bescheiddatum', 'datum', 'bekanntgabe', 'schreiben', 'vom'],
  DEBT: ['nachzahlung', 'forderung', 'schuld', 'zahllast', 'mahnung', 'rechnungsbetrag', 'gesamtbetrag', 'betrag'],
  CREDIT: ['guthaben', 'erstattung', 'zuschuss', 'gutschrift', 'überweisen', 'auszahlung'],
  APPT: ['termin', 'einladung', 'vorsprache', 'beratung', 'uhrzeit', 'besprechung'],
  ACTION: ['mitwirkungspflicht', 'vollstreckungsankündigung', 'widerspruch', 'bescheinigung']
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

/**
 * Validates German VAT math (19% or 7%).
 * If Net * 1.19 ≈ Gross, it's a confirmed invoice.
 */
function harvestTableMath(ocrText) {
    const amountRegex = /(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/g;
    const matches = ocrText.match(amountRegex) || [];
    const values = matches.map(parseEuro);

    for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < Math.min(i + 5, values.length); j++) {
            for (let k = j + 1; k < Math.min(j + 5, values.length); k++) {
                const v1 = values[i], v2 = values[j], v3 = values[k];
                // Check v1 + v2 = v3 (Net + Tax = Gross)
                if (Math.abs((v1 + v2) - v3) < 0.05 && v1 > 0) {
                    const ratio = v2 / v1;
                    const isVat19 = Math.abs(ratio - 0.19) < 0.01;
                    const isVat7 = Math.abs(ratio - 0.07) < 0.01;
                    if (isVat19 || isVat7) {
                      return { net: v1, tax: v2, gross: v3, confirmed: true, rate: isVat19 ? 19 : 7 };
                    }
                }
            }
        }
    }
    return null;
}

/**
 * Improved Address Harvesting for German Standards (Street + House Number).
 */
function harvestAddresses(ocrText, lines) {
    const pcRegex = /\b\d{5}\b/g;
    // Street Name + House Number (e.g. Ludwig-Erhard-Str. 16 or Gartenweg 4a or 33E)
    const streetRegex = /[A-ZÄÖÜ][a-zäöüß\s.-]+ \d+[a-zA-Z]?/;
    const results = { sender: null, sender_lines: null, recipient: null, action: null };

    const clusters = [];
    let match;
    while ((match = pcRegex.exec(ocrText)) !== null) {
        const lineIdx = ocrText.substring(0, match.index).split('\n').length - 1;
        const clusterLines = lines.slice(Math.max(0, lineIdx - 3), Math.min(lines.length, lineIdx + 2));
        clusters.push({ lineIdx, clusterLines, cluster: clusterLines.join(' ') });
    }

    for (const c of clusters) {
        let score = 0;
        if (streetRegex.test(c.cluster)) score += 5;

        // Check if this specific line is a single-line comma-separated sender (Rücksendeangabe)
        const pcLine = lines[c.lineIdx] || '';
        const isSingleLineAddress = pcLine.includes(',') && streetRegex.test(pcLine) && pcLine.length > 20;

        if (/abholort|filiale|paketshop|packstation|standort|lager/i.test(c.cluster)) {
            results.action = c.cluster;
        } else if (/absender|firma|tel:|fax:|email|ust-id|postfach/i.test(c.cluster) || isSingleLineAddress) {
            if (!results.sender) {
                results.sender = c.cluster;
                results.sender_lines = c.clusterLines;
            }
        } else if (/herr|frau|familie|z.hd.|empfänger/i.test(c.cluster)) {
            results.recipient = c.cluster;
        } else if (score > 0 && !results.recipient) {
            results.recipient = c.cluster;
        }
    }
    return results;
}

/**
 * Extracts German Reference Numbers (Aktenzeichen, Kassenzeichen, etc.)
 */
function harvestReferenceNumbers(ocrText) {
  const refs = {
    kassenzeichen: null,
    aktenzeichen: null,
    finanzamt: null,
    kundennummer: null,
    versicherungsnummer: null
  };

  // Finanzamt: 12/345/67890
  const faMatch = ocrText.match(/\b\d{2}\/\d{3}\/\d{5}\b/);
  if (faMatch) refs.finanzamt = faMatch[0];

  // Generic patterns with anchor words
  const anchors = [
    { key: 'kassenzeichen', patterns: [/(?:kassenzeichen|kassen-?nr)[:\s]+([\w/\-]+)/i] },
    { key: 'aktenzeichen', patterns: [/(?:aktenzeichen|mein zeichen|unser zeichen)[:\s]+([\w/\-]+)/i] },
    { key: 'kundennummer', patterns: [/(?:kunden-?nr|kundennummer)[:\s]+([\w/\-]+)/i] },
    { key: 'versicherungsnummer', patterns: [/(?:versicherungs-?nummer|vers.-?nr|vsnr)[:\s]+([\w/\-]+)/i] }
  ];

  for (const anchor of anchors) {
    for (const pattern of anchor.patterns) {
      const match = ocrText.match(pattern);
      if (match && match[1]) {
        refs[anchor.key] = match[1].trim();
        break;
      }
    }
  }
  return refs;
}

/**
 * Calculates the 'Last Day to Appeal' (Widerspruchsfrist).
 * Logic: Bescheiddatum + 3 days (Bekanntgabefiktion) + 1 month.
 */
function calculateWiderspruchDeadline(issuedDateStr) {
  if (!issuedDateStr) return null;
  const parts = issuedDateStr.split('.');
  if (parts.length !== 3) return null;

  let day = parseInt(parts[0], 10);
  let month = parseInt(parts[1], 10) - 1;
  let year = parseInt(parts[2], 10);
  if (year < 100) year += 2000;

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) return null;

  // 3-day delivery fiction (§ 41 II VwVfG / § 37 II SGB X)
  date.setDate(date.getDate() + 3);

  // 1-month period (§ 70 VwGO / § 84 SGG)
  const dayBefore = date.getDate();
  date.setMonth(date.getMonth() + 1);
  // Guard against month overflow (e.g. Jan 31 + 1 month ≠ Mar 3)
  if (date.getDate() !== dayBefore) {
    date.setDate(0); // Roll back to last day of previous month
  }

  return date.toLocaleDateString('de-DE');
}

// --- 3. MAIN PIPELINE ---

export function extractFacts(ocrText) {
  const lines = ocrText.split('\n');
  const fullTextLower = ocrText.toLowerCase();
  const headerText = ocrText.slice(0, 1000).toLowerCase();

  const facts = {
    sender: 'Unknown',
    ibans: (ocrText.match(/\bDE\s*(?:\d\s*){20}\b/g) || []).map(m => m.replace(/\s+/g, '')),
    reference_numbers: harvestReferenceNumbers(ocrText),
    amounts: [],
    dates: [],
    polarity_overall: 'neutral',
    actions: [],
    doc_stage: 'other',
    legal_remedy: { present: false, deadline: null, type: null },
    risk_flags: { is_court_order: false, sender_looks_official: false, critical_action: false },
    table: harvestTableMath(ocrText),
    addresses: harvestAddresses(ocrText, lines),
    attachments: [],
    nuances: [],
    is_direct_debit: false
  };

  // --- CATEGORY TAGGING (internal use only, never shown to user) ---
  const serviceKeywords = {
    Utility: ['dsl', 'internet', 'breitband', 'glasfaser', 'mobilfunk', 'handy', 'strom', 'gas', 'wasser', 'abfall', 'müll', 'telefon', 'festnetz'],
    Insurance: ['krankenversicherung', 'haftpflicht', 'beitrag', 'versicherung', 'aok', 'tk', 'barmer', 'allianz'],
    Housing: ['miete', 'nebenkosten', 'betriebskosten'],
    Finance: ['steuer', 'finanzamt', 'einkommensteuer', 'bank', 'kredit', 'darlehen', 'rechnung', 'mahnung']
  };

  for (const [cat, kws] of Object.entries(serviceKeywords)) {
    if (kws.some(kw => fullTextLower.includes(kw))) facts.nuances.push(cat);
  }

  // --- CONTEXT SENTENCE HARVESTER ---
  // Captures the full sentence around key intent phrases so the AI can tell the story
  const intentAnchors = [
    { key: 'provide_bank_details', regex: /bankverbindung|kontoverbindung|iban mitteilen|kontodaten/gi },
    { key: 'pickup_instructions', regex: /abholort|abholtermin|bereitstellung|abholung|abholen/gi },
    { key: 'reimbursement', regex: /erstattung|erstattungsbetrag|erstatten|kostenübernahme|rückzahlung/gi },
    { key: 'payment_request', regex: /zahlbetrag|gesamtbetrag|rechnungsbetrag|überweisen sie|zu zahlen/gi },
    { key: 'appointment', regex: /vorsprache|einladung zum termin|persönlich erscheinen|melden sie sich/gi },
    { key: 'return_documents', regex: /unterlagen.*(senden|einreichen|zurück)|formular.*(zurück|einreichen)|bitte.*senden.*sie|nach abschluss der behandlung/gi }
  ];

  const activeIntents = [];
  const intentIndices = [];
  const contextSentences = [];

  for (const anchor of intentAnchors) {
    let match;
    anchor.regex.lastIndex = 0;
    while ((match = anchor.regex.exec(ocrText)) !== null) {
      intentIndices.push(match.index);
      if (!activeIntents.includes(anchor.key)) activeIntents.push(anchor.key);

      // Capture the full sentence around this keyword
      const sentenceStart = Math.max(0, ocrText.lastIndexOf('.', match.index) + 1, ocrText.lastIndexOf('\n', match.index) + 1);
      const sentenceEndDot = ocrText.indexOf('.', match.index + match[0].length);
      const sentenceEndNL = ocrText.indexOf('\n', match.index + match[0].length);
      const sentenceEnd = Math.min(
        sentenceEndDot > -1 ? sentenceEndDot + 1 : ocrText.length,
        sentenceEndNL > -1 ? sentenceEndNL : ocrText.length
      );
      const sentence = ocrText.slice(sentenceStart, sentenceEnd).trim();
      if (sentence.length > 10 && sentence.length < 300 && !contextSentences.includes(sentence)) {
        contextSentences.push(sentence);
      }
    }
  }

  facts.special_intent = activeIntents.length > 0 ? activeIntents.join(', ') : null;
  facts.intent_indices = intentIndices;
  facts.context_sentences = contextSentences;

  // Build a human-readable topic string (for prompt, never raw labels)
  const topicParts = [];
  if (activeIntents.includes('provide_bank_details')) topicParts.push('requesting your bank details for a payment');
  if (activeIntents.includes('reimbursement')) topicParts.push('a reimbursement or refund');
  if (activeIntents.includes('pickup_instructions')) topicParts.push('a pickup or delivery appointment');
  if (activeIntents.includes('payment_request')) topicParts.push('a payment you need to make');
  if (activeIntents.includes('appointment')) topicParts.push('an appointment you need to attend');
  if (activeIntents.includes('return_documents')) topicParts.push('submitting documents or forms');
  facts.document_topic = topicParts.length > 0 ? topicParts.join(' and ') : null;

  // Ensure unique nuances (internal categories)
  facts.nuances = [...new Set(facts.nuances)];

  // --- SENDER SCORING ENGINE ---
  const officialSenders = ["Finanzamt", "Jobcenter", "AOK", "TK", "Barmer", "Rentenversicherung", "Beitragsservice", "Rundfunkbeitrag", "Stadtverwaltung", "Landratsamt"];
  const privateSenders = ["1&1", "Vodafone", "Telekom", "O2", "Stadtwerke", "ADAC", "Restlos", "Amazon", "IKEA", "Allianz"];

  let candidates = [];
  for (const s of [...officialSenders, ...privateSenders]) {
    const sRegex = new RegExp(`(?:^|[^\\w./])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\w-])`, 'gi');
    let matchCount = (ocrText.match(sRegex) || []).length;

    if (matchCount > 0) {
      let score = matchCount;
      if (headerText.includes(s.toLowerCase())) score += 10;
      candidates.push({ name: s, score });
    }
  }

  const bestSender = candidates.sort((a, b) => b.score - a.score)[0];
  if (bestSender) {
    facts.sender = (bestSender.name === "Rundfunkbeitrag") ? "Beitragsservice (GEZ)" : bestSender.name;
    facts.risk_flags.sender_looks_official = officialSenders.includes(bestSender.name);
  } else {
    // --- SENDER RECOVERY ---
    let recoveredSender = null;

    // 1. Generic Company Detector: Scan first 10 lines for legal forms
    for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i].trim();
        // Require uppercase start, strictly match legal forms to avoid OCR noise
        const match = line.match(/(?:^|\s)([A-ZÄÖÜ][\w\s&-]{1,40})\b(GmbH|UG|e\.K\.|AG|KG|OHG)\b/);
        if (match) {
            let potential = match[0].trim();
            potential = potential.replace(/^absender:?\s*/i, '').replace(/^[,.-]+/, '').trim();
            if (potential.length > 2 && potential.length <= 50) {
                recoveredSender = potential;
                break;
            }
        }
    }

    // 2. Fallback to Address Harvester's Sender Cluster
    if (!recoveredSender && facts.addresses.sender_lines) {
        const streetRegex = /[A-ZÄÖÜ][a-zäöüß\s.-]+ \d+[a-zA-Z]?/;
        
        // Pass 1: Look specifically for a single-line return address (Rücksendeangabe)
        for (const line of facts.addresses.sender_lines) {
            let cleanLine = line.trim().replace(/^absender:?\s*/i, '').replace(/,+$/, '').trim();
            if (cleanLine.includes(',') && /\b\d{5}\b/.test(cleanLine)) {
                recoveredSender = cleanLine.split(',')[0].trim();
                break;
            }
        }

        // Pass 2: Fallback to the first valid name-like line
        if (!recoveredSender) {
            for (const line of facts.addresses.sender_lines) {
                let cleanLine = line.trim().replace(/^absender:?\s*/i, '').replace(/,+$/, '').trim();
                
                if (/\b\d{5}\b/.test(cleanLine)) continue; // Skip standalone postal code lines
                if (streetRegex.test(cleanLine)) continue; // Skip standalone street lines
                
                if (cleanLine.length > 2) {
                    recoveredSender = cleanLine;
                    break;
                }
            }
        }
    }

    if (recoveredSender) {
        // Final Sanitization
        facts.sender = recoveredSender.replace(/,+$/, '').replace(/^absender:?\s*/i, '').trim();
    }
  }

  // Prioritize Categories based on Sender (MUST run AFTER sender is identified)
  if (facts.sender.match(/AOK|TK|Barmer|Allianz/i)) {
    facts.nuances = ['Insurance', ...facts.nuances.filter(n => n !== 'Insurance')];
  }
  if (facts.sender.match(/Restlos|Stadtwerke|Vodafone|Telekom|1&1/i)) {
    facts.nuances = ['Utility', ...facts.nuances.filter(n => n !== 'Utility')];
  }

  // --- LEGAL & STAGE LOGIC ---
  if (hasFuzzyKeyword(ocrText, ['vollstreckungsbescheid', 'mahnbescheid'])) {
    facts.doc_stage = 'mahnbescheid';
    facts.risk_flags.is_court_order = true;
  } else if (hasFuzzyKeyword(ocrText, ['vollstreckungsankündigung'])) {
    facts.doc_stage = 'vollstreckung';
    facts.risk_flags.critical_action = true;
    facts.actions.push({ key: 'critical', priority: 0, reason: 'Enforcement Warning (Vollstreckungsankündigung)' });
  } else if (hasFuzzyKeyword(ocrText, ['bescheid'])) {
    facts.doc_stage = 'bescheid';
    facts.legal_remedy.present = true;
    facts.legal_remedy.type = 'Widerspruch';
  } else if (hasFuzzyKeyword(ocrText, ['mitwirkung'])) {
    facts.doc_stage = 'mitwirkung';
    facts.actions.push({ key: 'respond', priority: 1, reason: 'Duty to cooperate (Mitwirkungspflicht)' });
  } else if (hasFuzzyKeyword(ocrText, ['bescheinigung'])) {
    facts.doc_stage = 'bescheinigung';
  } else if (facts.sender.match(/1&1|Vodafone|Telekom/i)) {
    facts.doc_stage = (fullTextLower.includes('mobil') || fullTextLower.includes('handy')) ? 'Mobile' : 'Internet';
  } else {
    facts.doc_stage = 'other';
  }

  // --- DATES & TIMES ---
  const dateRegex = /\b([0-3]?\d)\.([0-1]?\d)\.(\d{2,4})\b/g;
  const timeRegex = /\b([01]?\d|2[0-3])[:.][0-5]\d\b/g;
  let dMatch;
  while ((dMatch = dateRegex.exec(ocrText)) !== null) {
    const window = ocrText.slice(Math.max(0, dMatch.index - 120), Math.min(ocrText.length, dMatch.index + 120));
    let role = 'other';
    if (hasFuzzyKeyword(window, KEYWORDS.DUE)) role = 'due';
    else if (hasFuzzyKeyword(window, KEYWORDS.ISSUED)) role = 'issued';
    else if (hasFuzzyKeyword(window, KEYWORDS.APPT)) role = 'appointment';

    // Attempt to find time window nearby (e.g. for Restlos pickup)
    const timeMatch = window.match(/([01]?\d|2[0-3])[:.][0-5]\d/);
    const timeInfo = timeMatch ? ` at ${timeMatch[0]}` : '';

    facts.dates.push({ value: dMatch[0], role, index: dMatch.index, time: timeMatch ? timeMatch[0] : null });
  }

  // Deadline calculation for Widerspruch
  const issuedDate = facts.dates.find(d => d.role === 'issued')?.value;
  if (facts.legal_remedy.present && issuedDate) {
    facts.legal_remedy.deadline = calculateWiderspruchDeadline(issuedDate);
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

  facts.is_direct_debit = /lastschrift|abbuche|einzugsermächtigung|mandat/i.test(ocrText);

  // --- FINAL ACTION LOGIC ---
  if (facts.table?.confirmed || fullTextLower.includes('rechnung') || fullTextLower.includes('mahnung')) {
      facts.polarity_overall = 'nachzahlung';
      
      if (facts.is_direct_debit && !fullTextLower.includes('mahnung')) {
          facts.actions.push({ key: 'file', priority: 1, reason: 'Direct Debit (Lastschrift) active - automatic deduction' });
      } else {
          facts.actions.push({ key: 'pay', priority: 1, reason: facts.table?.confirmed ? 'Confirmed Invoice (VAT Match)' : 'Payment obligation detected' });
      }
  }

  if (hasFuzzyKeyword(ocrText, ['termin', 'einladung'])) facts.actions.push({ key: 'attend', priority: 1, reason: 'Appointment detected' });
  if (facts.special_intent && facts.special_intent.includes('return_documents')) facts.actions.push({ key: 'respond', priority: 1, reason: 'Document submission requested' });

  return facts;
}

export function smartSliceOCR(text, maxChars = 2800, facts = null) {
  if (!text || text.length <= maxChars) return text;
  const header = text.slice(0, 1000), tail = text.slice(-500);
  if (!facts) return header + "\n[...]\n" + tail;

  // 🛡️ Elite Slicing: Find full sentences containing our facts & keywords
  const anchors = [
    ...facts.dates.map(d => d.index),
    ...facts.amounts.map(a => a.index),
    ...(facts.intent_indices || [])
  ].filter(idx => idx > 1000 && idx < text.length - 500);

  let windows = anchors.map(idx => {
    // Look for sentence boundaries (. ! ?)
    const start = text.lastIndexOf('.', idx) + 1 || idx - 150;
    const end = text.indexOf('.', idx) + 1 || idx + 150;
    return { start: Math.max(0, start), end: Math.min(text.length, end + 50) };
  });

  if (windows.length > 0) {
    windows.sort((a, b) => a.start - b.start);
    const merged = [windows[0]];
    for (let i = 1; i < windows.length; i++) {
        let last = merged[merged.length - 1];
        if (windows[i].start <= last.end + 100) last.end = Math.max(last.end, windows[i].end);
        else merged.push(windows[i]);
    }
    windows = merged;
  }
  const middle = windows.map(w => text.slice(w.start, w.end)).join('\n[...]\n');
  return (header + "\n[...]\n" + middle + "\n[...]\n" + tail).slice(0, maxChars);
}

export function buildAttentionModel(ocrText, previousDocs = []) {
  const facts = extractFacts(ocrText);
  const primaryAction = facts.actions.sort((a, b) => a.priority - b.priority)[0]?.key || 'file';
  let urgency = 'informational';
  if (facts.risk_flags.is_court_order || facts.risk_flags.critical_action || ocrText.toLowerCase().includes('mahnung')) urgency = 'overdue';
  else if (facts.actions.some(a => a.key === 'pay' || a.key === 'attend' || a.key === 'respond')) urgency = 'urgent';

  return { facts, primaryAction, urgency };
}
