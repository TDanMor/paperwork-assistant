/**
 * Generates a Google Calendar "TEMPLATE" URL for a document.
 * This allows one-click event creation without OAuth.
 */
export function generateGoogleCalendarUrl(doc) {
  if (!doc) return null;

  // 1. Determine the best date
  const rawDate = doc.dates?.appointment_date || doc.dates?.due_date;
  if (!rawDate) return null;

  // Format: YYYYMMDD
  const dateStr = rawDate.replace(/-/g, '');

  // 2. Build Title: [ACTION] Sender
  const action = (doc.action_required || 'Task').toUpperCase();
  const title = encodeURIComponent(`[${action}] ${doc.sender || 'Paperwork Task'}`);

  // 3. Build Description (Summary + Steps)
  let description = `${doc.summary || ''}\n\nSteps:\n${doc.action_steps || ''}`;
  description = encodeURIComponent(description.trim());

  // 4. Try to find a location in the summary or OCR
  let location = '';
  const locMatch = doc.summary?.match(/Location:\s*(.*?)(?:\n|$)/i) || doc.ocr_text?.match(/Standort:\s*(.*?)(?:\n|$)/i);
  if (locMatch) {
    location = encodeURIComponent(locMatch[1].trim());
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

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dateStr}/${endDayStr}&details=${description}&location=${location}`;
}
