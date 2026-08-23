import { smartSliceOCR } from './extractor.js';
import { activeModelId, MODELS } from './engine.js';

/**
 * Paperwork Assistant - Master Brain V5.5 (Opus-Level Resilience)
 *
 * Philosophy: Format-Adaptive Prompting.
 * - PRO (3B): Uses Strict JSON Contract (best for complex reasoning).
 * - LITE (0.5B): Uses Marker-Delimited Text (best for ultra-small models).
 */

export function buildSystemPrompt(language, attentionModel) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';
  const facts = attentionModel.facts;
  const isLite = activeModelId === MODELS.lite;

  // 🛡️ Master Brain V5.7: Opus-Level Fact Injection
  const amount = facts.amounts[0]?.value ? `${facts.amounts[0].value} EUR` : 'N/A';
  const dueDate = facts.dates.find(d => d.role === 'due')?.value;
  const deadline = facts.legal_remedy?.deadline;
  const expirationDate = facts.dates.find(d => d.role === 'expires')?.value;
  const servicePeriod = facts.service_period ? `from ${facts.service_period.start} to ${facts.service_period.end}` : null;

  // Direction Guard (Role Reversal Fix - Pronouns Removed)
  let relationship = '';
  if (facts.polarity_overall === 'nachzahlung') {
    relationship = `\n- Fact: The recipient of this document owes ${amount} to ${facts.sender}.`;
  } else if (facts.polarity_overall === 'erstattung') {
    relationship = `\n- Fact: ${facts.sender} owes money to the recipient of this document.`;
  }

  // Dictionary guard to prevent terminology hallucinations (e.g. "Viertelsteuer")
  const vatTerms = { en: 'VAT', de: 'MwSt', es: 'IVA', fr: 'TVA', ro: 'TVA' };
  const vatLabel = vatTerms[language] || 'Tax';

  const basePrompt = `THINK AND WRITE ONLY IN ${langName.toUpperCase()}.
You are a professional administrative assistant. Explain this document to a ${langName} speaker.

VERIFIED FACTS (Immutable):
- Sender: ${facts.sender}
- Topic: ${facts.document_topic || 'Correspondence'}
- Amount: ${amount} (${vatLabel} included)${relationship}
${dueDate ? `- Payment Due: ${dueDate}` : ''}
${deadline ? `- Legal Deadline to Appeal: ${deadline} (Strict)` : ''}
${servicePeriod ? `- Billing Period: ${servicePeriod}` : ''}
${expirationDate ? `- Document Expires On: ${expirationDate}` : ''}

RULES:
- NEVER invent dates or tax terms. Use "${vatLabel}" for taxes.
- NEVER mention an "appointment" unless the Topic explicitly says so.
- Translate all German meaning into ${langName} immediately.
- DO NOT omit important conditions or prerequisites (e.g., "after treatment is completed", "within 14 days").${expirationDate ? `\n- PROACTIVE ADVICE: This document expires on ${expirationDate}. Advise the user when they should start the renewal or cancellation process based on standard German rules (e.g., 8 weeks for IDs, 3 months for Visas, 1 month for TÜV, or warn them about typical 1-3 month cancellation notice periods 'Kündigungsfrist' for subscriptions and insurances).` : ''}`;

  if (isLite) {
    // 🪶 LITE STRATEGY: Zero-Shot Simple Formatting (Perplexity Architecture)
    
    let explicitSteps = `Give the most important action the reader should take based on the document.`;
    if (facts.is_direct_debit) {
      explicitSteps = `Translate this exact text into ${langName}: "No manual payment required. The money will be deducted automatically."`;
    } else if (facts.polarity_overall === 'nachzahlung') {
      explicitSteps = `Translate this exact text into ${langName}: "Please pay ${amount} manually to ${facts.sender}."`;
    }

    return `Explain the document for a ${langName}-speaking user. 
Do not invent information. Use only the document text and verified data.

VERIFIED FACTS:
- Sender: ${facts.sender}
- Amount: ${amount}
${relationship}

SUMMARY: Give a short factual explanation of what the letter means in ${langName}.
STEPS: ${explicitSteps}
REF: Extract the reference number, or write N/A.`;
  }

  // Direct Debit Armor (For PRO only, as LITE uses explicit string injection)
  let proPaymentRule = '';
  if (facts.is_direct_debit) {
    proPaymentRule = `\n- MANDATORY RULE: This invoice is paid via Direct Debit (Lastschrift). The user does NOT need to transfer money manually. Tell them it will be deducted automatically.`;
  } else if (facts.polarity_overall === 'nachzahlung') {
    proPaymentRule = `\n- MANDATORY RULE: Tell the user they need to pay the amount manually.`;
  }

  // 💎 PRO STRATEGY: Use full JSON contract.
  return `${basePrompt}${proPaymentRule}

INSTRUCTIONS:
Respond with a JSON object exactly like this: {"summary": "...", "steps": "...", "ref": "..."}.
- "summary": Detailed narrative explanation in ${langName}.
- "steps": Semicolon-separated commands.
- "ref": Reference number.
RULES: No markdown, no "json" tags. Translate everything.`;
}

export function buildUserMessage(ocrText, language, attentionModel) {
  const langMap = { en: 'English', de: 'German', es: 'Spanish', fr: 'French', ro: 'Romanian' };
  const langName = langMap[language] || 'English';
  
  const text = smartSliceOCR(ocrText, 2500, attentionModel.facts);
  const contextBlock = (attentionModel.facts.context_sentences || [])
    .map(s => `- "${s}"`).join('\n');

  return `SOURCE DATA:
<snippets>
${text}
</snippets>

${contextBlock ? `CRITICAL CONTEXT SENTENCES (Make sure to include these details!):\n${contextBlock}` : ''}

Summarize and translate the content above into ${langName}.`;
}

/**
 * Opus-Level Rescue Parser
 * Handles both the JSON response (Pro) and the Delimited Text (Lite).
 */
export function parseAIResponse(raw, attentionModel, language = 'en') {
  console.log("Opus-Level Raw Response:", raw);
  if (!raw || raw.trim().length < 5) return getFallbackData(attentionModel.facts, language);

  let summary = null;
  let steps = [];
  let ref = null;

  // PASS 1: Try JSON (Pro mode)
  try {
    const start = raw.indexOf('{');
    let end = raw.lastIndexOf('}');
    
    // If no closing brace, try parsing what we have by faking it (to catch truncated JSON)
    let jsonStr = raw.substring(start, end > start ? end + 1 : raw.length);
    if (end <= start) jsonStr += '"}'; 
    
    // Simple sanitization
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');
    const json = JSON.parse(jsonStr);
    
    summary = json.summary;
    steps = typeof json.steps === 'string' 
      ? json.steps.split(/\n|;/).map(s => s.replace(/^-\s*/, '').trim()).filter(s => s.length > 3)
      : json.steps;
    ref = json.ref;
  } catch (e) {}

  // PASS 2: Try Marker-Delimited (Lite mode / Rescue)
  if (!summary) {
    const sumMatch = raw.match(/"?SUMMARY"?\s*:?\s*([\s\S]*?)(?="?STEPS"?\s*:?|$)/i);
    const stepMatch = raw.match(/"?STEPS"?\s*:?\s*([\s\S]*?)(?="?REF"?\s*:?|$)/i);
    const refMatch = raw.match(/"?REF"?\s*:?\s*(.*)/i);

    if (sumMatch) summary = sumMatch[1].replace(/["{}]/g, '').replace(/,$/, '').trim();
    if (stepMatch) {
      let rawSteps = stepMatch[1].replace(/["{}]/g, '');
      // First try to split by newline or semicolon
      steps = rawSteps.split(/[\n;]/).map(s => s.replace(/^-\s*/, '').trim()).filter(s => s.length > 5);
      // If it only found 1 block, it might be a flat numbered list string like "1. Do X 2. Do Y"
      if (steps.length <= 1 && /\d\./.test(rawSteps)) {
        steps = rawSteps.split(/(?=\d\.)/).map(s => s.trim()).filter(s => s.length > 5);
      }
    }
    if (refMatch) ref = refMatch[1].replace(/["{}]/g, '').trim();
  }

  // PASS 3: Deep Clean
  const finalSummary = deepClean(summary || raw, attentionModel.facts.sender);

  return {
    sender: attentionModel.facts.sender,
    summary: finalSummary,
    action_steps: (steps && steps.length > 0) ? steps : attentionModel.facts.actions.map(a => getLocalizedAction(a, language)),
    document_type: attentionModel.facts.polarity_overall === 'nachzahlung' ? 'invoice' : 'notice',
    main_category: attentionModel.facts.nuances[0] || 'Finance',
    sub_category: attentionModel.facts.doc_stage,
    money: {
      amount: attentionModel.facts.amounts[0]?.value || null,
      currency: 'EUR'
    },
    dates: {
      document_date: germanDateToISO(attentionModel.facts.dates.find(d => d.role === 'issued')?.value),
      due_date: germanDateToISO(attentionModel.facts.dates.find(d => d.role === 'due')?.value),
      appointment_date: germanDateToISO(attentionModel.facts.dates.find(d => d.role === 'appointment')?.value),
      legal_deadline: attentionModel.facts.legal_remedy.deadline
    },
    urgency: attentionModel.urgency,
    action_required: attentionModel.primaryAction,
    ref_highlight: ref
  };
}

function deepClean(text, sender) {
  return text
    .replace(/<[^>]*>?/gm, '') // Remove tags
    .replace(/^(SUMMARY|sentences|summarization):\s*/gi, '') // Remove markers
    .replace(/["*{}\[\]]/g, '') // Remove symbols
    .replace(new RegExp(`${sender} regarding.*`, 'i'), '') // Kill generic echo
    .trim();
}

function getLocalizedFallbackMessage(facts, language) {
  const amount = facts.amounts[0]?.value ? `${facts.amounts[0].value} EUR` : '';
  const sender = facts.sender !== 'Unknown' ? facts.sender : '';
  
  if (language === 'de') return `Neues Dokument${sender ? ` von ${sender}` : ''}${amount ? ` über ${amount}` : ''}. Lokale KI-Verarbeitung derzeit nicht verfügbar.`;
  if (language === 'es') return `Nuevo documento${sender ? ` de ${sender}` : ''}${amount ? ` por ${amount}` : ''}. Procesamiento local de IA no disponible.`;
  if (language === 'fr') return `Nouveau document${sender ? ` de ${sender}` : ''}${amount ? ` de ${amount}` : ''}. Traitement local de l'IA indisponible.`;
  if (language === 'ro') return `Document nou${sender ? ` de la ${sender}` : ''}${amount ? ` pentru ${amount}` : ''}. Procesarea locală AI indisponibilă.`;
  return `New document${sender ? ` from ${sender}` : ''}${amount ? ` for ${amount}` : ''}. Local AI processing currently unavailable.`;
}

function getLocalizedAction(action, language) {
  if (language === 'de') {
    if (action.key === 'pay') return 'Zahlung erforderlich';
    if (action.key === 'file') return 'Zur Aufbewahrung';
    if (action.key === 'attend') return 'Termin beachten';
    if (action.key === 'critical') return 'Wichtig: Sofort prüfen';
    return 'Bitte prüfen';
  }
  if (language === 'es') {
    if (action.key === 'pay') return 'Pago requerido';
    if (action.key === 'file') return 'Archivar';
    if (action.key === 'attend') return 'Asistir a la cita';
    if (action.key === 'critical') return 'Importante: Revisar ahora';
    return 'Por favor revisar';
  }
  // Default to english keys for simplicity if unsupported language
  return action.reason || 'Review required';
}

function germanDateToISO(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : dateStr;
}

export function getFallbackData(facts, language = 'en') {
  if (!facts) return { sender: 'Unknown', summary: 'Analysis failed.', action_steps: [] };
  
  return {
    sender: facts.sender,
    summary: getLocalizedFallbackMessage(facts, language),
    action_steps: facts.actions.map(a => getLocalizedAction(a, language)),
    document_type: facts.polarity_overall === 'nachzahlung' ? 'invoice' : 'notice',
    main_category: facts.nuances[0] || 'Finance',
    sub_category: facts.doc_stage,
    money: {
      amount: facts.amounts[0]?.value || null,
      currency: 'EUR'
    },
    dates: {
      document_date: germanDateToISO(facts.dates.find(d => d.role === 'issued')?.value),
      due_date: germanDateToISO(facts.dates.find(d => d.role === 'due')?.value),
      appointment_date: germanDateToISO(facts.dates.find(d => d.role === 'appointment')?.value),
      legal_deadline: facts.legal_remedy?.deadline || null
    },
    urgency: facts.actions.some(a => a.priority === 0) ? 'high' : 'normal',
    action_required: facts.actions.sort((a, b) => a.priority - b.priority)[0]?.key || 'file',
    ref_highlight: facts.reference_numbers[0] || null
  };
}
