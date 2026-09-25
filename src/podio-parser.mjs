import { normalizeName } from './domain.mjs';
// Conservative adapter: only accept complete rows and an explicit venue directory.
// pdftotext -layout keeps column gaps; the PDF layout must be confirmed before auto mode.
export function parsePodio(text) {
  const venues = new Map(), candidates = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const venue = line.match(/^CANCHA\s+([A-Z0-9-]+)\s*[:|]\s*(.{8,300})$/i);
    if (venue) venues.set(normalizeName(venue[1]), venue[2]);
  }
  for (const line of lines) {
    const cols = line.split(/\s*\|\s*|\s{2,}/).map(v => v.trim());
    // Explicit date | time | home | away | court | division (optional).
    if (cols.length < 5 || cols.length > 6) continue;
    const [date, time, home, away, court, division = ''] = cols;
    const d = date.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (!d || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !home || !away) continue;
    const iso = `${d[3]}-${d[2]}-${d[1]}T${time}:00-03:00`;
    const parsed = new Date(iso);
    if (isNaN(parsed.getTime()) || parsed.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) !== `${d[3]}-${d[2]}-${d[1]}`) continue;
    const address = venues.get(normalizeName(court));
    if (!address) continue;
    candidates.push({ startsAt: iso, home, away, courtCode: court, address, division });
  }
  return candidates;
}
