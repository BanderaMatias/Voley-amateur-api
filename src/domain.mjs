export function splitCost(total, userIds) {
  if (total === null || !userIds.length) return null;
  if (!Number.isInteger(total) || total < 0) throw new Error('Invalid amount');
  const ids = [...userIds].sort();
  const base = Math.floor(total / ids.length), rest = total % ids.length;
  return Object.fromEntries(ids.map((id, i) => [id, base + (i < rest ? 1 : 0)]));
}
export function normalizeName(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
}
export function registrationStatus(confirmed, capacity) {
  return confirmed < capacity ? 'CONFIRMED' : 'WAITLIST';
}
export function canSeeMatch(match, userId, member) {
  return match.visibility === 'PUBLIC' || match.organizerId === userId || member || match.participants.some(p => p.userId === userId);
}
