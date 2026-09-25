import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, weeklyDates, payerKeys, balancedTeams, replacementFits, calendarIcs } from '../src/community-domain.mjs';
import { splitCost } from '../src/domain.mjs';

test('Superposición considera duración y permite partidos contiguos', () => {
  const a = { startsAt: '2026-10-10T20:00:00-03:00', durationMinutes: 90 };
  assert.equal(overlaps(a, { startsAt: '2026-10-10T21:00:00-03:00', durationMinutes: 60 }), true);
  assert.equal(overlaps(a, { startsAt: '2026-10-10T21:30:00-03:00', durationMinutes: 60 }), false);
  assert.equal(overlaps(a, { startsAt: '2026-10-10T19:00:00-03:00', durationMinutes: 60 }), false);
});
test('Serie semanal conserva hora argentina al cruzar año', () => {
  const dates = weeklyDates('2026-12-30T21:00:00-03:00', 3);
  assert.equal(dates[1].toISOString(), '2027-01-07T00:00:00.000Z');
  assert.equal(new Set(dates.map(d => d.toISOString())).size, 3);
  assert.throws(() => weeklyDates(new Date(), 53));
});
test('Invitados participan del reparto sin duplicarse al vincular cuenta', () => {
  const match = { participants: [{ userId: 'a', status: 'CONFIRMED' }, { userId: 'b', status: 'WAITLIST' }], guests: [{ id: 'g', active: true, linkedUserId: null }, { id: 'linked', active: true, linkedUserId: 'a' }, { id: 'removed', active: false }] };
  assert.deepEqual(payerKeys(match), ['a', 'guest:g']);
  const costs = splitCost(10001, payerKeys(match));
  assert.equal(Object.values(costs).reduce((a, b) => a + b), 10001);
});
test('Balance asigna una vez, distribuye posiciones y mantiene cupos parejos', () => {
  const players = Array.from({ length: 11 }, (_, i) => ({ id: String(i), name: `P${i}`, score: 5 - (i % 5), position: i % 3 ? 'Central' : 'Armador' }));
  const result = balancedTeams(players), ids = result.teams.flat().map(p => p.id);
  assert.equal(new Set(ids).size, 11);
  assert.equal(Math.abs(result.teams[0].length - result.teams[1].length), 1);
  assert.equal(result.scores.reduce((a, b) => a + b), players.reduce((a, p) => a + p.score, 0));
  assert.deepEqual(balancedTeams(players), result);
});
test('Reemplazos filtran día argentino, horario, zona y posición', () => {
  const preferences = { enabled: true, zone: 'CABA', position: 'Central', weekdays: [1], from: '20:00', to: '23:59' };
  const request = { zone: 'caba', position: 'central' };
  assert.equal(replacementFits(preferences, request, '2026-10-06T01:00:00Z'), true); // Monday 22:00 in Argentina.
  assert.equal(replacementFits(preferences, request, '2026-10-06T23:00:00Z'), false);
  assert.equal(replacementFits(preferences, { ...request, position: 'Líbero' }, '2026-10-06T01:00:00Z'), false);
  assert.equal(replacementFits({ ...preferences, enabled: false }, request, '2026-10-06T01:00:00Z'), false);
});
test('Calendario conserva UID, cancelación, escape y límite UTF-8', () => {
  const m = { id: 'm1', title: 'Partido, Central;\nBEGIN:VEVENT ' + 'á'.repeat(70), address: 'Calle 123', startsAt: '2026-10-10T20:00:00-03:00', updatedAt: '2026-10-09T10:00:00Z', durationMinutes: 90, status: 'CANCELLED', revision: 2 };
  const ics = calendarIcs([m]);
  assert.ok(ics.includes('UID:m1@voley-amateur'));
  assert.ok(ics.includes('DTEND:20261011T003000Z'));
  assert.ok(ics.includes('STATUS:CANCELLED'));
  assert.ok(ics.includes('SEQUENCE:2'));
  assert.ok(ics.includes('Partido\\, Central\\;\\nBEGIN:VEVENT'));
  assert.ok(ics.split('\r\n').every(l => Buffer.byteLength(l) <= 75));
  assert.equal(ics.split('\r\nBEGIN:VEVENT').length - 1, 1);
});
