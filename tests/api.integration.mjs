import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
const db = new PrismaClient();
const base = 'http://localhost:4000';
const actors = [];
async function user(name, admin = false) {
  const u = await db.user.create({ data: { googleSub: randomBytes(16).toString('hex'), email: `${name}@example.test`, name, admin } });
  const token = randomBytes(32).toString('hex');
  await db.session.create({ data: { id: createHash('sha256').update(token).digest('hex'), userId: u.id, expiresAt: new Date(Date.now() + 3600000) } });
  const actor = { ...u, token }; actors.push(actor); return actor;
}
async function call(actor, path, method='GET', body) {
  const response = await fetch(base + '/' + path, { method, headers: { Cookie: `session=${actor.token}`, Origin: 'http://localhost:3000', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
test('Permisos, privacidad, cupos concurrentes, reclutamiento y valoraciones', async () => {
  try {
    const leader = await user('leader'), a = await user('a'), b = await user('b'), c = await user('c');
    assert.equal((await call(a, 'tournaments', 'POST', { name:'Privado', season:'2026', provider:'MANUAL' })).status, 403);
    const team = (await call(leader, 'teams', 'POST', { name:'Equipo', zone:'CABA', description:'' })).data;
    assert.ok(team.id);
    const post = (await call(leader, `teams/${team.id}/recruitments`, 'POST', { title:'Central', description:'Sábados', position:'Central', level:'Intermedio' })).data;
    assert.equal((await call(a, `recruitments/${post.id}/apply`, 'POST', {})).status, 201);
    assert.equal((await call(b, `recruitments/${post.id}/applications/${a.id}`, 'POST', { accept:true })).status, 403);
    assert.equal((await call(leader, `recruitments/${post.id}/applications/${a.id}`, 'POST', { accept:true })).status, 201);
    assert.ok(await db.teamMember.findUnique({ where:{ teamId_userId:{ teamId:team.id,userId:a.id } } }));
    assert.ok((await call(a,'notifications')).data.length > 0);
    const input = { title:'Recreativo', startsAt:new Date(Date.now()+86400000).toISOString(), address:'Cancha 123', priceCents:10001, capacity:2, type:'RECREATIONAL', visibility:'PRIVATE' };
    const privateMatch = (await call(leader, 'matches', 'POST', input)).data;
    assert.equal((await call(b, `matches/${privateMatch.id}`)).status,404);
    assert.equal((await call(b, `matches/${privateMatch.id}/respond`, 'POST', { status:'CONFIRMED' })).status,404);
    const match = (await call(leader, 'matches', 'POST', {...input,visibility:'PUBLIC'})).data;
    const result = await Promise.all([a,b,c].map(u=>call(u,`matches/${match.id}/respond`,'POST',{status:'CONFIRMED'})));
    assert.ok(result.every(r=>r.status===201));
    const rows = await db.matchParticipant.findMany({where:{matchId:match.id}});
    assert.equal(rows.filter(r=>r.status==='CONFIRMED').length,2);
    assert.equal(rows.filter(r=>r.status==='WAITLIST').length,1);
    const leaving = actors.find(u=>u.id===rows.find(r=>r.status==='CONFIRMED').userId);
    await call(leaving,`matches/${match.id}/respond`,'POST',{status:'REJECTED'});
    assert.equal(await db.matchParticipant.count({where:{matchId:match.id,status:'CONFIRMED'}}),2);
    const rating = {attack:4,reception:3,defense:4,jump:5};
    assert.equal((await call(a,`players/${b.id}/ratings`,'POST',rating)).status,403);
    const confirmed = await db.matchParticipant.findMany({where:{matchId:match.id,status:'CONFIRMED'}});
    await db.match.update({where:{id:match.id},data:{startsAt:new Date(Date.now()-3600000)}});
    await call(leader,`matches/${match.id}/status`,'POST',{status:'COMPLETED',attendedIds:confirmed.map(p=>p.userId)});
    const author = actors.find(u=>u.id===confirmed[0].userId), target = confirmed[1].userId;
    assert.equal((await call(author,`players/${target}/ratings`,'POST',rating)).status,201);
    assert.equal((await call(author,`players/${author.id}/ratings`,'POST',rating)).status,400);
    assert.equal((await call(author,`players/${target}/ratings`,'POST',{...rating,jump:6})).status,400);
    assert.equal((await call(a,`matches/${match.id}/respond`,'POST',{status:'CONFIRMED'})).status,400);
  } finally { await db.$disconnect(); }
});
