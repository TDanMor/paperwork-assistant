/**
 * Generates a Google Calendar "TEMPLATE" URL for a document.
 * This allows one-click event creation without OAuth.
 */
export function generateGoogleCalendarUrl(doc) {
  if (!doc) return null;

  // 1. Determine the best date
  const rawDate = doc.dates?.appointment_date || doc.dates?.due_date;
  if (!rawDate) return null;

  // 🛡️ Date Validation: Ensure it's a valid YYYY-MM-DD string
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    console.warn("Skipping calendar URL generation: Invalid date format", rawDate);
    return null;
  }

  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return null;

  // Format: YYYYMMDD
  const dateStr = rawDate.replace(/-/g, '');

  // 2. Build Title: [ACTION] Sender
  const action = (doc.action_required || 'Task').toUpperCase();
  const title = `[${action}] ${doc.sender || 'Paperwork Task'}`.substring(0, 200);

  // 3. Build Description (Summary + Steps)
  // 🛡️ Claude Audit Implementation: Capped length to prevent URL injection/bloat
  const MAX_DESC = 1000;
  let description = `${doc.summary || ''}\n\nSteps:\n${doc.action_steps || ''}`;
  if (description.length > MAX_DESC) {
    description = description.slice(0, MAX_DESC) + '... (truncated)';
  }

  // 4. Try to find a location in the summary or OCR
  let location = '';
  const locMatch = doc.summary?.match(/Location:\s*(.*?)(?:\n|$)/i) || doc.ocr_text?.match(/Standort:\s*(.*?)(?:\n|$)/i);
  if (locMatch) {
    location = locMatch[1].trim();
  }

  // Google Calendar URL construction
  // action=TEMPLATE
  // text=Event Title
  // dates=START/END (YYYYMMDD/YYYYMMDD for all-day)
  // details=Description
  // location=Location

  const nextDay = new Date(rawDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const endDayStr = nextDay.toISOString().split('T')[0].replace(/-/g, '');

  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  return `${base}&text=${encodeURIComponent(title)}&dates=${encodeURIComponent(dateStr)}/${encodeURIComponent(endDayStr)}&details=${encodeURIComponent(description)}&location=${encodeURIComponent(location)}`;
}
