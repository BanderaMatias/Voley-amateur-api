import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
const db = new PrismaClient(), base = 'http://localhost:4000';
async function actor(name, admin = false) {
  const u = await db.user.create({ data: { googleSub: randomBytes(16).toString('hex'), email: `${name}@example.test`, name, admin, profile: { skillLevel: 3, position: 'Central' } } });
  const token = randomBytes(32).toString('hex');
  await db.session.create({ data: { id: createHash('sha256').update(token).digest('hex'), userId: u.id, expiresAt: new Date(Date.now() + 3600000) } });
  return { ...u, token };
}
async function call(u, path, method = 'GET', body, expected) {
  const res = await fetch(`${base}/${path}`, { method, headers: { Cookie: `session=${u.token}`, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json();
  if (expected) assert.equal(res.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return { status: res.status, data };
}
const future = (days, minutes = 0) => new Date(Date.now() + days * 86400000 + minutes * 60000).toISOString();
async function game(owner, days, extra = {}) {
  return (await call(owner, 'matches', 'POST', { title: 'Comunidad', startsAt: future(days), address: 'Cancha de prueba 123', priceCents: 10001, capacity: 4, durationMinutes: 90, type: 'RECREATIONAL', visibility: 'PUBLIC', ...extra }, 201)).data;
}

test('Comunidad: pagos, invitados, series, agenda, reemplazos y moderación', async () => {
  const owner = await actor('community-owner'), a = await actor('community-a'), b = await actor('community-b'), c = await actor('community-c'), outsider = await actor('community-outsider'), admin = await actor('community-admin', true);
  try {
    const m = await game(owner, 2, { capacity: 2 });
    const guest = (await call(owner, `matches/${m.id}/guests`, 'POST', { name: 'Invitado', level: 4 }, 201)).data;
    await call(a, `matches/${m.id}/respond`, 'POST', { status: 'CONFIRMED' }, 201);
    assert.equal((await call(b, `matches/${m.id}/respond`, 'POST', { status: 'CONFIRMED' }, 201)).data.status, 'WAITLIST');
    await call(owner, `matches/${m.id}/guests`, 'POST', { name: 'Sin lugar' }, 409);
    const detail = (await call(a, `matches/${m.id}`, 'GET', undefined, 200)).data;
    assert.equal(Object.values(detail.costs).reduce((a, b) => a + b), 10001);
    assert.ok(Object.hasOwn(detail.costs, `guest:${guest.id}`));
    await call(a, `matches/${m.id}/payments/${a.id}`, 'POST', { status: 'REPORTED' }, 400);
    await call(owner, `matches/${m.id}/guests/${guest.id}/remove`, 'POST', {}, 201);
    assert.equal((await db.matchParticipant.findUnique({ where: { matchId_userId: { matchId: m.id, userId: b.id } } })).status, 'CONFIRMED');
    const proposal = (await call(owner, `matches/${m.id}/balance`, 'POST', {}, 201)).data;
    assert.equal(proposal.teams.flat().length, 2);
    await call(owner, `matches/${m.id}/balance`, 'PATCH', { teams: [[a.id, a.id], []] }, 400);
    await call(owner, `matches/${m.id}/balance`, 'PATCH', { teams: [[b.id], [a.id]] }, 200);
    await call(owner, `matches/${m.id}/status`, 'POST', { status: 'CLOSED' }, 201);
    await call(a, `matches/${m.id}/payments/${a.id}`, 'POST', { status: 'CONFIRMED' }, 403);
    await call(a, `matches/${m.id}/payments/${a.id}`, 'POST', { status: 'REPORTED', note: 'transferencia' }, 201);
    await call(owner, `matches/${m.id}/payments/${a.id}`, 'POST', { status: 'CONFIRMED' }, 201);
    await call(a, `matches/${m.id}/payments/${a.id}`, 'POST', { status: 'REPORTED' }, 400);
    await call(outsider, `matches/${m.id}/payments`, 'GET', undefined, 403);
    const ledger = (await call(owner, `matches/${m.id}/payments`, 'GET', undefined, 200)).data;
    assert.equal(ledger.rows.reduce((s, p) => s + p.amountCents, 0), 10001);

    const unpriced = await game(owner, 12, { priceCents: null });
    await call(owner, `matches/${unpriced.id}/status`, 'POST', { status: 'CLOSED' }, 400);
    await call(owner, `matches/${unpriced.id}/price`, 'PATCH', { priceCents: 0 }, 200);
    await call(owner, `matches/${unpriced.id}/status`, 'POST', { status: 'CLOSED' }, 201);

    const linked = await game(owner, 3);
    const g = (await call(owner, `matches/${linked.id}/guests`, 'POST', { name: 'Soy A' }, 201)).data;
    await call(owner, `matches/${linked.id}/guests/${g.id}/invite`, 'POST', { userId: a.id }, 201);
    await call(b, `matches/${linked.id}/guests/${g.id}/claim`, 'POST', {}, 403);
    await call(a, `matches/${linked.id}/guests/${g.id}/claim`, 'POST', {}, 201);
    const linkedDetail = (await call(a, `matches/${linked.id}`)).data;
    assert.equal(Object.keys(linkedDetail.costs).length, 1);
    assert.ok(Object.hasOwn(linkedDetail.costs, a.id));

    const clash = await game(owner, 3, { startsAt: linked.startsAt });
    await call(a, `matches/${clash.id}/respond`, 'POST', { status: 'CONFIRMED' }, 409);
    await call(a, `matches/${clash.id}/respond`, 'POST', { status: 'CONFIRMED', allowConflict: true }, 201);
    const x = await game(owner, 4), y = await game(owner, 4, { startsAt: x.startsAt });
    const attempts = await Promise.all([x, y].map(m => call(b, `matches/${m.id}/respond`, 'POST', { status: 'CONFIRMED' })));
    assert.deepEqual(attempts.map(r => r.status).sort(), [201, 409]);

    const series = (await call(owner, 'series', 'POST', { title: 'Miércoles', startsAt: future(5), address: 'Cancha 123', priceCents: 12000, capacity: 12, type: 'RECREATIONAL', visibility: 'PRIVATE', occurrences: 3 }, 201)).data;
    const dates = await db.match.findMany({ where: { seriesId: series.id }, orderBy: { startsAt: 'asc' } });
    assert.equal(dates.length, 3); assert.equal(dates[1].startsAt - dates[0].startsAt, 7 * 86400000);
    await call(a, `series/${series.id}/stop`, 'POST', {}, 403);
    await call(owner, `series/${series.id}/stop`, 'POST', {}, 201);
    assert.equal(await db.match.count({ where: { seriesId: series.id, status: 'CANCELLED' } }), 3);

    await call(c, 'me/replacements', 'PATCH', { enabled: true, zone: 'CABA', position: 'Central', weekdays: [0,1,2,3,4,5,6], from: '00:00', to: '23:59' }, 200);
    const urgentDate = new Date(Date.now() + 6 * 86400000); urgentDate.setUTCHours(18, 0, 0, 0);
    const urgent = await game(owner, 6, { startsAt: urgentDate.toISOString(), visibility: 'PRIVATE' });
    const request = (await call(owner, `matches/${urgent.id}/replacement`, 'POST', { zone: 'CABA', position: 'Central', description: 'Falta un jugador' }, 201)).data;
    assert.equal(request.notified, 1);
    await call(owner, `matches/${urgent.id}/replacement`, 'POST', { zone: 'CABA', position: 'Central', description: 'Falta un jugador' }, 201);
    assert.equal(await db.notification.count({ where: { userId: c.id, dedupKey: `replacement:${request.id}:${c.id}` } }), 1);
    const publicRequest = (await call(c, 'replacements')).data.find(r => r.id === request.id);
    assert.equal(Object.hasOwn(publicRequest.match, 'address'), false);
    await call(c, `matches/${urgent.id}`, 'GET', undefined, 404);
    await call(c, `replacements/${request.id}/apply`, 'POST', {}, 201);
    await call(owner, `replacements/${request.id}/applications/${c.id}`, 'POST', { accept: true }, 201);
    await call(c, `matches/${urgent.id}/respond`, 'POST', { status: 'CONFIRMED' }, 201);

    const calendar = (await call(c, 'me/calendar', 'POST', { enabled: true }, 201)).data;
    const feedPath = new URL(calendar.url).pathname.replace('/api', '');
    const response = await fetch(base + feedPath); assert.equal(response.status, 200);
    const feed = await response.text(); assert.ok(feed.includes(`UID:${urgent.id}@voley-amateur`)); assert.ok(!feed.includes(`UID:${m.id}@voley-amateur`));
    await call(c, 'me/calendar', 'POST', { enabled: false }, 201);
    assert.equal((await fetch(base + feedPath)).status, 404);

    const reminder = await game(owner, 0, { startsAt: future(0, 60), visibility: 'PRIVATE' });
    await call(owner, `matches/${reminder.id}/call-up`, 'POST', { userIds: [outsider.id] }, 201);
    await call(admin, 'ops/run-reminders', 'POST', {}, 201);
    await call(admin, 'ops/run-reminders', 'POST', {}, 201);
    assert.equal(await db.notification.count({ where: { userId: outsider.id, dedupKey: { startsWith: `reminder:${reminder.id}:` } } }), 1);
    await call(a, 'ops/run-reminders', 'POST', {}, 403);

    await call(c, `players/${owner.id}/block`, 'POST', { block: true }, 201);
    const blockedGame = await game(owner, 8);
    await call(c, `matches/${blockedGame.id}/respond`, 'POST', { status: 'CONFIRMED' }, 404);
    await call(owner, `matches/${blockedGame.id}/call-up`, 'POST', { userIds: [c.id] }, 201);
    assert.equal(await db.matchParticipant.count({ where: { matchId: blockedGame.id, userId: c.id } }), 0);
    await call(c, `players/${owner.id}/block`, 'POST', { block: false }, 201);

    await db.playerRating.create({ data: { authorId: b.id, targetId: a.id, attack: 1, reception: 1, defense: 1, jump: 1 } });
    const report = (await call(a, `players/${b.id}/report`, 'POST', { kind: 'RATING', reason: 'Valoración denunciada de prueba' }, 201)).data;
    await call(owner, `reports/${report.id}/resolve`, 'POST', { action: 'REMOVE_RATING', resolution: 'Revisado por administrador' }, 403);
    await call(admin, `reports/${report.id}/resolve`, 'POST', { action: 'REMOVE_RATING', resolution: 'Revisado por administrador' }, 201);
    assert.equal(await db.playerRating.count({ where: { authorId: b.id, targetId: a.id } }), 0);
    const abuse = (await call(a, `players/${b.id}/report`, 'POST', { kind: 'USER', reason: 'Comportamiento denunciado de prueba' }, 201)).data;
    await call(admin, `reports/${abuse.id}/resolve`, 'POST', { action: 'SUSPEND', resolution: 'Suspensión en prueba' }, 201);
    await call(b, 'me', 'GET', undefined, 401);
    await call(admin, `players/${b.id}/restore`, 'POST', {}, 201);
    assert.equal((await db.user.findUnique({ where: { id: b.id } })).suspended, false);

    await db.match.update({ where: { id: m.id }, data: { startsAt: new Date(Date.now() - 3600000) } });
    await call(owner, `matches/${m.id}/status`, 'POST', { status: 'COMPLETED', attendedIds: [a.id, b.id] }, 201);
    await call(owner, `matches/${m.id}/result`, 'PATCH', { sets: [{ home: 25, away: 20 }, { home: 25, away: 19 }] }, 200);
    const history = (await call(a, 'history')).data;
    assert.ok(history.matches.some(h => h.id === m.id && h.results.home === 2)); assert.ok(history.attended >= 1);

    const tournament = (await call(admin, 'tournaments', 'POST', { name: 'Podio sintético', season: 'test', provider: 'PODIO' }, 201)).data;
    const team = (await call(owner, 'teams', 'POST', { name: 'TEST GUERREROS' }, 201)).data;
    const registration = (await call(owner, `teams/${team.id}/tournaments`, 'POST', { tournamentId: tournament.id }, 201)).data;
    await call(admin, `registrations/${registration.id}`, 'PATCH', { externalName: 'TEST GUERREROS', division: 'TEST' }, 200);
    const row = { startsAt: future(10).slice(0, 10) + 'T15:00:00.000Z', home: 'TEST GUERREROS', away: 'RIVAL TEST', courtCode: 'T1', address: 'Dirección sintética 123', division: 'TEST' };
    const makeRun = () => db.importExecution.create({ data: { hash: randomBytes(20).toString('hex'), url: 'https://podio.org.ar/test.pdf', pdf: new Uint8Array(), rawText: 'Fixture sintético, no PDF real', candidates: [] } });
    const run = await makeRun();
    await call(admin, `podio/imports/${run.id}/approve`, 'POST', { candidates: [row] }, 201);
    const imported = await db.match.findFirst({ where: { teamId: team.id, source: 'PODIO' } });
    await call(owner, `matches/${imported.id}/call-up`, 'POST', { userIds: [a.id] }, 201);
    const revised = { ...row, startsAt: new Date(new Date(row.startsAt).getTime() + 30 * 60000).toISOString(), address: 'Nueva dirección sintética 456' };
    const run2 = await makeRun();
    await call(admin, `podio/imports/${run2.id}/approve`, 'POST', { candidates: [revised] }, 201);
    assert.equal(await db.match.count({ where: { teamId: team.id, source: 'PODIO' } }), 1);
    assert.equal(await db.matchChange.count({ where: { matchId: imported.id } }), 1);
    assert.ok(await db.notification.count({ where: { userId: a.id, link: `/matches/${imported.id}`, message: { contains: 'Cambio' } } }));
    const moved = { ...revised, startsAt: new Date(new Date(revised.startsAt).getTime() + 86400000).toISOString() };
    const run3 = await makeRun();
    await call(admin, `podio/imports/${run3.id}/approve`, 'POST', { candidates: [moved] }, 400);
    await call(admin, `podio/matches/${imported.id}/reschedule`, 'POST', { startsAt: moved.startsAt, address: moved.address, courtCode: moved.courtCode }, 201);
    await call(admin, `podio/imports/${run3.id}/approve`, 'POST', { candidates: [moved] }, 201);
    assert.equal(await db.match.count({ where: { teamId: team.id, source: 'PODIO' } }), 1);
  } finally { await db.$disconnect(); }
});
