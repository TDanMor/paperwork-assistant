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

RULES:
- NEVER invent dates or tax terms. Use "${vatLabel}" for taxes.
- NEVER mention an "appointment" unless the Topic explicitly says so.
- Translate all German meaning into ${langName} immediately.`;

  if (isLite) {
    // 🪶 LITE STRATEGY: Few-Shot Pattern (Best for 0.5B models)
    
    let stepsGuidance = '';
    if (facts.is_direct_debit) {
      stepsGuidance = `\nFor the STEPS section, you MUST translate and use exactly this text: "No manual payment required. The money will be automatically deducted."`;
    } else if (facts.polarity_overall === 'nachzahlung') {
      stepsGuidance = `\nFor the STEPS section, you MUST translate and use exactly this text: "Please pay ${amount} manually to ${facts.sender}."`;
    }

    return `${basePrompt}

EXAMPLE OF A PERFECT RESPONSE IN ENGLISH:
SUMMARY:
This document is from EnergyCorp. They are informing you about a scheduled water meter replacement on October 12th between 08:00 and 12:00. You need to ensure access to the basement.
STEPS:
Add the appointment to your calendar; Ensure the basement is accessible.
REF:
499102-B

INSTRUCTIONS FOR THE REAL DOCUMENT:
Write a similar response in ${langName}. Summarize the actual content of the SOURCE DATA.
You must use the exact same format (SUMMARY:, STEPS:, REF:).${stepsGuidance}`;
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
KEY SENTENCES:
${contextBlock}

Summarize and translate the content above into ${langName}.`;
}

/**
 * Opus-Level Rescue Parser
 * Handles both the JSON response (Pro) and the Delimited Text (Lite).
 */
export function parseAIResponse(raw, attentionModel) {
  console.log("Opus-Level Raw Response:", raw);
  if (!raw || raw.trim().length < 5) return buildFallback(attentionModel.facts);

  let summary = null;
  let steps = [];
  let ref = null;

  // PASS 1: Try JSON (Pro mode)
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const json = JSON.parse(raw.substring(start, end + 1).replace(/,\s*([\]}])/g, '$1'));
      summary = json.summary;
      steps = typeof json.steps === 'string' ? json.steps.split(';') : json.steps;
      ref = json.ref;
    }
  } catch (e) {}

  // PASS 2: Try Marker-Delimited (Lite mode / Rescue)
  if (!summary) {
    const sumMatch = raw.match(/SUMMARY:\s*([\s\S]*?)(?=STEPS:|$)/i);
    const stepMatch = raw.match(/STEPS:\s*([\s\S]*?)(?=REF:|$)/i);
    const refMatch = raw.match(/REF:\s*(.*)/i);

    if (sumMatch) summary = sumMatch[1].trim();
    if (stepMatch) steps = stepMatch[1].split(/[;,\n]/).map(s => s.trim()).filter(s => s.length > 5);
    if (refMatch) ref = refMatch[1].trim();
  }

  // PASS 3: Deep Clean
  const finalSummary = deepClean(summary || raw, attentionModel.facts.sender);

  return {
    sender: attentionModel.facts.sender,
    summary: finalSummary,
    action_steps: (steps && steps.length > 0) ? steps : attentionModel.facts.actions.map(a => a.reason),
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

function buildFallback(facts) {
  return {
    sender: facts.sender,
    summary: `New document from ${facts.sender}. Please check details below.`,
    action_steps: facts.actions.map(a => a.reason),
    // ... other fields default ...
  };
}

function germanDateToISO(dateStr) {
  if (!dateStr) return null;
  const m = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : dateStr;
}

export function getFallbackData() {
  return { sender: 'Unknown', summary: 'Analysis failed. Check image.', action_steps: [] };
}
