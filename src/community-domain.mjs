import { normalizeName } from './domain.mjs';
export function overlaps(a, b) {
  const startA = new Date(a.startsAt).getTime(), startB = new Date(b.startsAt).getTime();
  return startA < startB + b.durationMinutes * 60000 && startB < startA + a.durationMinutes * 60000;
}
export function weeklyDates(start, count) {
  if (!Number.isInteger(count) || count < 2 || count > 52) throw new Error('Entre 2 y 52 fechas');
  return Array.from({ length: count }, (_, i) => new Date(new Date(start).getTime() + i * 7 * 86400000));
}
export function payerKeys(match) {
  return [...match.participants.filter(p => p.status === 'CONFIRMED').map(p => p.userId), ...match.guests.filter(g => g.active && !g.linkedUserId).map(g => `guest:${g.id}`)];
}
export function replacementFits(preferences, request, startsAt) {
  if (!preferences?.enabled) return false;
  if (preferences.zone && normalizeName(preferences.zone) !== normalizeName(request.zone)) return false;
  if (preferences.position && normalizeName(preferences.position) !== normalizeName(request.position)) return false;
  const local = new Date(new Date(startsAt).getTime() - 3 * 3600000);
  const time = local.toISOString().slice(11, 16);
  return (!preferences.weekdays?.length || preferences.weekdays.includes(local.getUTCDay())) && (!preferences.from || time >= preferences.from) && (!preferences.to || time < preferences.to);
}
export function balancedTeams(players) {
  // Position distribution first, then total skill, keeping size difference <= 1.
  const teams = [[], []], scores = [0, 0];
  for (const p of [...players].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))) {
    let candidates = [0, 1].filter(i => teams[i].length < Math.ceil(players.length / 2));
    candidates.sort((a, b) => {
      const pos = team => team.filter(x => x.position && normalizeName(x.position) === normalizeName(p.position || '')).length;
      return pos(teams[a]) - pos(teams[b]) || scores[a] - scores[b] || teams[a].length - teams[b].length || a - b;
    });
    const i = candidates[0]; teams[i].push(p); scores[i] += p.score;
  }
  return { teams, scores };
}
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export function calendarIcs(matches) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Voley Amateur//Agenda//ES', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Vóley Amateur'];
  for (const m of matches) lines.push('BEGIN:VEVENT', `UID:${m.id}@voley-amateur`, `DTSTAMP:${stamp(m.updatedAt)}`, `LAST-MODIFIED:${stamp(m.updatedAt)}`, `SEQUENCE:${m.revision}`, `DTSTART:${stamp(m.startsAt)}`, `DTEND:${stamp(new Date(m.startsAt).getTime() + m.durationMinutes * 60000)}`, `SUMMARY:${esc(m.title)}`, `LOCATION:${esc(m.address)}`, `STATUS:${m.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  lines.push('END:VCALENDAR');
  // RFC 5545: fold by UTF-8 octets, without splitting a code point.
  return lines.map(line => { let result = '', bytes = 0; for (const char of line) { const size = Buffer.byteLength(char); if (bytes + size > 75) { result += '\r\n '; bytes = 1; } result += char; bytes += size; } return result; }).join('\r\n') + '\r\n';
}
