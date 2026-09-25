import test from 'node:test';
import assert from 'node:assert/strict';
import { splitCost, normalizeName, registrationStatus, canSeeMatch } from '../src/domain.mjs';
import { parsePodio } from '../src/podio-parser.mjs';
test('El reparto conserva todos los centavos y es determinista', () => {
  assert.deepEqual(splitCost(10000, ['c', 'b', 'a']), { a: 3334, b: 3333, c: 3333 });
  assert.equal(Object.values(splitCost(10000, ['a', 'b', 'c'])).reduce((a,b) => a+b), 10000);
  assert.equal(splitCost(10000, []), null); assert.equal(splitCost(null, ['a']), null);
  assert.deepEqual(splitCost(0, ['a']), { a: 0 }); assert.throws(() => splitCost(-1, ['a']));
});
test('Cupo lleno usa lista de espera', () => {
  assert.equal(registrationStatus(11, 12), 'CONFIRMED');
  assert.equal(registrationStatus(12, 12), 'WAITLIST');
});
test('Partido privado solo visible para organizador, miembros e invitados', () => {
  const match = { visibility: 'PRIVATE', organizerId: 'a', participants: [{ userId: 'b' }] };
  assert.equal(canSeeMatch(match, 'c', false), false);
  assert.equal(canSeeMatch(match, 'b', false), true);
  assert.equal(canSeeMatch(match, 'a', false), true);
  assert.equal(canSeeMatch(match, 'c', true), true);
});
test('Nombres externos toleran acentos y espacios, no coincidencias parciales', () => {
  assert.equal(normalizeName('  Vóltryx  A '), 'VOLTRYX A');
  assert.notEqual(normalizeName('Voltryx A'), normalizeName('Voltryx B'));
});
test('PDF sintético resuelve dirección a partir de código al final', () => {
  const text = '26/09/2026 | 18:30 | GUERREROS | VOLTRYX | C1 | MIXTO\nCANCHA C1: Avenida Ejemplo 123, CABA';
  const rows = parsePodio(text);
  assert.equal(rows.length, 1); assert.equal(rows[0].address, 'Avenida Ejemplo 123, CABA');
  assert.equal(rows[0].startsAt, '2026-09-26T18:30:00-03:00');
});
test('No inventa dirección ni acepta fechas inválidas', () => {
  assert.deepEqual(parsePodio('26/09/2026 | 18:30 | A | B | C1'), []);
  assert.deepEqual(parsePodio('31/02/2026 | 18:30 | A | B | C1\nCANCHA C1: Avenida Ejemplo 123'), []);
  assert.deepEqual(parsePodio('26/09/2026 | 29:30 | A | B | C1\nCANCHA C1: Avenida Ejemplo 123'), []);
});
