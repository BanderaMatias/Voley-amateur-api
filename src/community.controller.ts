import { Body, Controller, Get, Post, Patch, Param, Query, Req, UseGuards, ForbiddenException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes, createHash } from 'node:crypto';
import { Db } from './db.js';
import { AuthGuard, AuthRequest } from './auth.js';
import { CommunityService } from './community.service.js';
import { parse, z, matchSchema } from './validation.js';
import { payerKeys, weeklyDates, balancedTeams, replacementFits } from './community-domain.mjs';
const short = z.string().trim().min(1).max(100);
const preferencesSchema = z.object({ enabled: z.boolean(), zone: z.string().trim().max(100), position: z.string().trim().max(100), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).strict().refine(p => p.from < p.to, 'La hora de fin debe ser posterior al inicio');
@Controller()
@UseGuards(AuthGuard)
export class CommunityController {
  constructor(private db: Db, private community: CommunityService) {}
  open(match: { status: string; startsAt: Date }) { if (match.status !== 'OPEN' || match.startsAt <= new Date()) throw new BadRequestException('Inscripción cerrada'); }
  admin(req: AuthRequest) { if (!req.user.admin) throw new ForbiddenException(); }

  @Post('series') async series(@Req() req: AuthRequest, @Body() body: unknown) {
    const { occurrences, ...data } = parse(matchSchema.extend({ occurrences: z.number().int().min(2).max(52) }), body);
    if (data.type === 'TOURNAMENT' || data.tournamentId) throw new BadRequestException('Las series son para recreativos o amistosos');
    if (new Date(data.startsAt) <= new Date()) throw new BadRequestException('La fecha debe ser futura');
    if (data.teamId && (await this.db.teamMember.findUnique({ where: { teamId_userId: { teamId: data.teamId, userId: req.user.id } } }))?.role !== 'LEADER') throw new ForbiddenException();
    return this.db.serial(async tx => {
      const series = await tx.matchSeries.create({ data: { organizerId: req.user.id } });
      for (const [seriesIndex, startsAt] of weeklyDates(data.startsAt, occurrences).entries()) await tx.match.create({ data: { ...data, startsAt, seriesId: series.id, seriesIndex, organizerId: req.user.id } });
      return { ...series, occurrences };
    });
  }
  @Get('series') seriesList(@Req() req: AuthRequest) { return this.db.matchSeries.findMany({ where: { organizerId: req.user.id }, include: { matches: { select: { id: true, title: true, startsAt: true, status: true }, orderBy: { startsAt: 'asc' } } }, orderBy: { createdAt: 'desc' } }); }
  @Post('series/:id/stop') stop(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.db.serial(async tx => {
      const series = await tx.matchSeries.findUnique({ where: { id } });
      if (!series || series.organizerId !== req.user.id) throw new ForbiddenException();
      const matches = await tx.match.findMany({ where: { seriesId: id, startsAt: { gt: new Date() }, status: { in: ['OPEN', 'CLOSED'] } }, include: { participants: true } });
      for (const m of matches) {
        await tx.match.update({ where: { id: m.id }, data: { status: 'CANCELLED', revision: { increment: 1 } } });
        await tx.replacementRequest.updateMany({ where: { matchId: m.id }, data: { status: 'CLOSED' } });
        await tx.notification.createMany({ data: m.participants.map(p => ({ userId: p.userId, message: `Se canceló la fecha de ${m.title}`, link: `/matches/${m.id}` })) });
      }
      return tx.matchSeries.update({ where: { id }, data: { active: false } });
    });
  }
  @Get('matches/:id/conflicts') async conflicts(@Param('id') id: string, @Req() req: AuthRequest) { return this.community.conflicts(req.user.id, await this.community.view(id, req.user.id)); }

  @Post('matches/:id/guests') guest(@Param('id') matchId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const data = parse(z.object({ name: short, position: z.string().max(100).default(''), level: z.number().int().min(1).max(5).default(3) }).strict(), body);
    return this.db.serial(async tx => {
      const match = await this.community.organize(matchId, req.user.id, tx); this.open(match);
      if (payerKeys(match).length >= match.capacity) throw new ConflictException('No hay cupo');
      await tx.match.update({ where: { id: matchId }, data: { balancedTeams: Prisma.DbNull } });
      return tx.matchGuest.create({ data: { ...data, matchId } });
    });
  }
  @Post('matches/:id/guests/:guestId/remove') removeGuest(@Param('id') id: string, @Param('guestId') guestId: string, @Req() req: AuthRequest) {
    return this.db.serial(async tx => {
      const match = await this.community.organize(id, req.user.id, tx); this.open(match);
      const guest = match.guests.find(g => g.id === guestId && g.active && !g.linkedUserId);
      if (!guest) throw new BadRequestException('Invitado no disponible');
      await tx.matchGuest.update({ where: { id: guestId }, data: { active: false } });
      await tx.match.update({ where: { id }, data: { balancedTeams: Prisma.DbNull } });
      await this.community.promote(match, tx); return { ok: true };
    });
  }
  @Post('matches/:id/guests/:guestId/invite') inviteClaim(@Param('id') id: string, @Param('guestId') guestId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { userId } = parse(z.object({ userId: short }).strict(), body);
    return this.db.serial(async tx => {
      const match = await this.community.organize(id, req.user.id, tx); this.open(match);
      const guest = match.guests.find(g => g.id === guestId && g.active && !g.linkedUserId);
      if (!guest) throw new NotFoundException();
      await this.community.interact(req.user.id, userId, tx);
      await tx.matchParticipant.upsert({ where: { matchId_userId: { matchId: id, userId } }, create: { matchId: id, userId, status: 'INVITED' }, update: {} });
      await tx.matchGuest.update({ where: { id: guestId }, data: { claimUserId: userId } });
      await tx.notification.create({ data: { userId, message: `El organizador te invita a vincular el lugar de ${guest.name} con tu cuenta. Confirmalo en el partido.`, link: `/matches/${id}` } });
      return { ok: true };
    });
  }
  @Post('matches/:id/guests/:guestId/claim') claim(@Param('id') id: string, @Param('guestId') guestId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { allowConflict } = parse(z.object({ allowConflict: z.boolean().default(false) }).strict(), body);
    return this.db.serial(async tx => {
      const match = await this.community.view(id, req.user.id, tx); this.open(match);
      const guest = match.guests.find(g => g.id === guestId && g.active && !g.linkedUserId && g.claimUserId === req.user.id);
      if (!guest) throw new ForbiddenException('El organizador debe invitarte a vincular este lugar');
      await this.community.interact(req.user.id, match.organizerId, tx);
      await this.community.checkConflicts(req.user.id, match, tx, allowConflict);
      if (match.participants.some(p => p.userId === req.user.id && p.status === 'CONFIRMED')) throw new ConflictException('Ya ocupás un lugar: pedile al organizador que retire el invitado duplicado');
      await tx.matchGuest.update({ where: { id: guestId }, data: { linkedUserId: req.user.id } });
      await tx.matchParticipant.upsert({ where: { matchId_userId: { matchId: id, userId: req.user.id } }, create: { matchId: id, userId: req.user.id, status: 'CONFIRMED' }, update: { status: 'CONFIRMED' } });
      await tx.match.update({ where: { id }, data: { balancedTeams: Prisma.DbNull } });
      return { ok: true };
    });
  }
  @Patch('matches/:id/payment-alias') async alias(@Param('id') id: string, @Req() req: AuthRequest, @Body() body: unknown) {
    await this.community.organize(id, req.user.id);
    const { paymentAlias } = parse(z.object({ paymentAlias: z.string().trim().max(100) }).strict(), body);
    return this.db.match.update({ where: { id }, data: { paymentAlias } });
  }
  @Get('matches/:id/payments') async payments(@Param('id') id: string, @Req() req: AuthRequest) {
    const match = await this.community.view(id, req.user.id);
    const organizer = match.organizerId === req.user.id;
    if (!organizer && !match.participants.some(p => p.userId === req.user.id && p.status === 'CONFIRMED')) throw new ForbiddenException();
    const costs = (match.closedCost || {}) as Record<string, number>;
    const payments = await this.db.matchPayment.findMany({ where: { matchId: id, ...(organizer ? {} : { payerKey: req.user.id }) } });
    const users = await this.db.user.findMany({ where: { id: { in: Object.keys(costs).filter(k => !k.startsWith('guest:')) } }, select: { id: true, name: true } });
    return { fixed: !!match.closedCost, paymentAlias: match.paymentAlias, cancelled: match.status === 'CANCELLED', rows: Object.entries(costs).filter(([key]) => organizer || key === req.user.id).map(([payerKey, amountCents]) => ({ payerKey, amountCents, name: payerKey.startsWith('guest:') ? match.guests.find(g => `guest:${g.id}` === payerKey)?.name : users.find(u => u.id === payerKey)?.name, status: 'PENDING', ...payments.find(p => p.payerKey === payerKey) })) };
  }
  @Post('matches/:id/payments/:payerKey') payment(@Param('id') id: string, @Param('payerKey') payerKey: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { status, note } = parse(z.object({ status: z.enum(['PENDING', 'REPORTED', 'CONFIRMED']), note: z.string().trim().max(300).default('') }).strict(), body);
    return this.db.serial(async tx => {
      const match = await this.community.view(id, req.user.id, tx), organizer = match.organizerId === req.user.id;
      if (!organizer && (payerKey !== req.user.id || status !== 'REPORTED')) throw new ForbiddenException('Solo el organizador puede confirmar pagos');
      if (!['CLOSED', 'COMPLETED'].includes(match.status) || !match.closedCost) throw new BadRequestException('Primero cerrá la inscripción con precio definido');
      const amount = (match.closedCost as Record<string, number>)[payerKey];
      if (typeof amount !== 'number') throw new BadRequestException('Jugador fuera del reparto');
      const old = await tx.matchPayment.findUnique({ where: { matchId_payerKey: { matchId: id, payerKey } } });
      if (!organizer && old?.status === 'CONFIRMED') throw new BadRequestException('El pago ya está confirmado');
      const payment = await tx.matchPayment.upsert({ where: { matchId_payerKey: { matchId: id, payerKey } }, create: { matchId: id, payerKey, amountCents: amount, status, note }, update: { status, note } });
      if (!organizer && old?.status !== 'REPORTED') await tx.notification.create({ data: { userId: match.organizerId, message: `${req.user.name} informó el pago de ${match.title}`, link: `/matches/${id}` } });
      return payment;
    });
  }
  async roster(id: string, userId: string, tx: Prisma.TransactionClient) {
    const match = await this.community.organize(id, userId, tx);
    if (match.type !== 'RECREATIONAL' || ['COMPLETED', 'CANCELLED'].includes(match.status)) throw new BadRequestException('Disponible en recreativos activos');
    const users = await tx.user.findMany({ where: { id: { in: match.participants.filter(p => p.status === 'CONFIRMED').map(p => p.userId) } }, include: { receivedRatings: true } });
    const players = users.map(u => {
      const p = u.profile as Record<string, any>;
      const reliable = u.receivedRatings.length >= 3;
      const score = reliable ? u.receivedRatings.reduce((s, r) => s + r.attack + r.reception + r.defense + r.jump, 0) / (u.receivedRatings.length * 4) : Number(p.skillLevel) || 3;
      return { id: u.id, name: u.name, position: String(p.position || ''), score };
    });
    players.push(...match.guests.filter(g => g.active && !g.linkedUserId).map(g => ({ id: `guest:${g.id}`, name: g.name, position: g.position, score: g.level })));
    if (players.length < 2) throw new BadRequestException('Se necesitan al menos dos confirmados');
    return players;
  }
  @Post('matches/:id/balance') balance(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.db.serial(async tx => {
      const result = balancedTeams(await this.roster(id, req.user.id, tx));
      await tx.match.update({ where: { id }, data: { balancedTeams: result } }); return result;
    });
  }
  @Patch('matches/:id/balance') adjust(@Param('id') id: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { teams } = parse(z.object({ teams: z.tuple([z.array(short), z.array(short)]) }).strict(), body);
    return this.db.serial(async tx => {
      const players = await this.roster(id, req.user.id, tx), ids = teams.flat();
      if (new Set(ids).size !== ids.length || ids.length !== players.length || ids.some(id => !players.some(p => p.id === id)) || Math.abs(teams[0].length - teams[1].length) > 1) throw new BadRequestException('Distribuí todos los confirmados una sola vez y con tamaños equilibrados');
      const result = { teams: teams.map(t => t.map(id => players.find(p => p.id === id)!)), scores: teams.map(t => t.reduce((s, id) => s + players.find(p => p.id === id)!.score, 0)) };
      await tx.match.update({ where: { id }, data: { balancedTeams: result } }); return result;
    });
  }
  @Patch('matches/:id/result') async result(@Param('id') id: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { sets } = parse(z.object({ sets: z.array(z.object({ home: z.number().int().min(0).max(99), away: z.number().int().min(0).max(99) }).strict().refine(s => s.home !== s.away, 'Un set no puede terminar empatado')).min(1).max(5) }).strict(), body);
    return this.db.serial(async tx => {
      const match = await this.community.organize(id, req.user.id, tx);
      if (match.status !== 'COMPLETED') throw new BadRequestException('Finalizá el partido antes de cargar el resultado');
      const home = sets.filter(s => s.home > s.away).length, away = sets.length - home;
      return tx.match.update({ where: { id }, data: { results: { sets, home, away }, revision: { increment: 1 } } });
    });
  }
  @Get('history') async history(@Req() req: AuthRequest, @Query('teamId') teamId?: string) {
    if (teamId && !await this.db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: req.user.id } } })) throw new ForbiddenException();
    const where: Prisma.MatchWhereInput = { status: 'COMPLETED', ...(teamId ? { teamId } : { OR: [{ organizerId: req.user.id }, { participants: { some: { userId: req.user.id } } }] }) };
    const [total, attended, matches] = await Promise.all([this.db.match.count({ where }), this.db.matchParticipant.count({ where: { userId: req.user.id, attended: true, match: where } }), this.db.match.findMany({ where, orderBy: { startsAt: 'desc' }, take: 200, include: { team: true, _count: { select: { participants: { where: { attended: true } }, guests: { where: { attended: true, linkedUserId: null } } } } } })]);
    return { total, attended, matches };
  }

  @Patch('me/replacements') preferences(@Req() req: AuthRequest, @Body() body: unknown) { return this.db.user.update({ where: { id: req.user.id }, data: { replacementPreferences: parse(preferencesSchema, body) }, select: { replacementPreferences: true } }); }
  @Post('matches/:id/replacement') replacement(@Param('id') matchId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const data = parse(z.object({ zone: short, position: short, description: z.string().trim().min(1).max(1000) }).strict(), body);
    return this.db.serial(async tx => {
      const match = await this.community.organize(matchId, req.user.id, tx); this.open(match);
      if (payerKeys(match).length >= match.capacity) throw new ConflictException('El partido ya está completo');
      const post = await tx.replacementRequest.upsert({ where: { matchId }, create: { matchId, ...data }, update: { ...data, status: 'OPEN' } });
      const users = await tx.user.findMany({ where: { suspended: false, id: { not: req.user.id } } });
      const recipients: string[] = [];
      for (const user of users) if (replacementFits(user.replacementPreferences, data, match.startsAt) && !match.participants.some(p => p.userId === user.id && p.status === 'CONFIRMED') && !await this.community.blocked(user.id, req.user.id, tx) && !(await this.community.conflicts(user.id, match, tx)).length) recipients.push(user.id);
      await tx.notification.createMany({ data: recipients.map(userId => ({ userId, message: `Buscan ${data.position} en ${data.zone}: ${match.title}`, link: '/replacements', dedupKey: `replacement:${post.id}:${userId}` })), skipDuplicates: true });
      return { ...post, notified: recipients.length };
    });
  }
  @Get('replacements') async replacements(@Req() req: AuthRequest) {
    const hidden = await this.community.hiddenIds(req.user.id);
    return this.db.replacementRequest.findMany({ where: { status: 'OPEN', match: { status: 'OPEN', startsAt: { gt: new Date() }, organizerId: { notIn: hidden }, organizer: { suspended: false } } }, select: { id: true, zone: true, position: true, description: true, match: { select: { id: true, title: true, startsAt: true, durationMinutes: true, priceCents: true, capacity: true, visibility: true } }, applications: { where: { userId: req.user.id }, select: { status: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  @Post('replacements/:id/apply') apply(@Param('id') requestId: string, @Req() req: AuthRequest) {
    return this.db.serial(async tx => {
      const post = await tx.replacementRequest.findUnique({ where: { id: requestId }, include: { match: true } });
      if (!post || post.status !== 'OPEN') throw new NotFoundException(); this.open(post.match);
      await this.community.interact(req.user.id, post.match.organizerId, tx);
      const existing = await tx.replacementApplication.findUnique({ where: { requestId_userId: { requestId, userId: req.user.id } } });
      if (existing) return existing;
      await this.community.checkConflicts(req.user.id, post.match, tx);
      const application = await tx.replacementApplication.create({ data: { requestId, userId: req.user.id } });
      await tx.notification.create({ data: { userId: post.match.organizerId, message: `${req.user.name} se ofreció como reemplazo`, link: `/matches/${post.matchId}` } });
      return application;
    });
  }
  @Get('matches/:id/replacement') async applications(@Param('id') matchId: string, @Req() req: AuthRequest) {
    await this.community.organize(matchId, req.user.id);
    return this.db.replacementRequest.findUnique({ where: { matchId }, include: { applications: { include: { user: { select: { id: true, name: true } } } } } });
  }
  @Post('replacements/:id/close') async close(@Param('id') id: string, @Req() req: AuthRequest) {
    const post = await this.db.replacementRequest.findUniqueOrThrow({ where: { id } }); await this.community.organize(post.matchId, req.user.id);
    return this.db.replacementRequest.update({ where: { id }, data: { status: 'CLOSED' } });
  }
  @Post('replacements/:id/applications/:userId') decide(@Param('id') requestId: string, @Param('userId') userId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { accept } = parse(z.object({ accept: z.boolean() }).strict(), body);
    return this.db.serial(async tx => {
      const post = await tx.replacementRequest.findUniqueOrThrow({ where: { id: requestId } });
      const match = await this.community.organize(post.matchId, req.user.id, tx); this.open(match);
      if (post.status !== 'OPEN') throw new BadRequestException('Búsqueda cerrada');
      if (accept) { await this.community.interact(req.user.id, userId, tx); if (payerKeys(match).length >= match.capacity) throw new ConflictException('No hay cupo'); }
      const updated = await tx.replacementApplication.updateMany({ where: { requestId, userId, status: 'PENDING' }, data: { status: accept ? 'ACCEPTED' : 'REJECTED' } });
      if (!updated.count) throw new ConflictException('Postulación resuelta');
      if (accept) await tx.matchParticipant.upsert({ where: { matchId_userId: { matchId: match.id, userId } }, create: { matchId: match.id, userId, status: 'INVITED' }, update: {} });
      await tx.notification.create({ data: { userId, message: accept ? 'Aceptaron tu postulación de reemplazo. Entrá al partido y confirmá asistencia para ocupar el lugar.' : 'Tu postulación de reemplazo fue rechazada.', link: accept ? `/matches/${match.id}` : '/replacements' } });
      return { ok: true };
    });
  }

  @Get('me/ratings') receivedRatings(@Req() req: AuthRequest) { return this.db.playerRating.findMany({ where: { targetId: req.user.id }, include: { author: { select: { id: true, name: true } } }, orderBy: { updatedAt: 'desc' } }); }
  @Get('blocks') blocks(@Req() req: AuthRequest) { return this.db.userBlock.findMany({ where: { blockerId: req.user.id }, include: { blocked: { select: { id: true, name: true } } } }); }
  @Post('players/:id/block') async block(@Param('id') blockedId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { block } = parse(z.object({ block: z.boolean() }).strict(), body);
    if (blockedId === req.user.id) throw new BadRequestException('No podés bloquearte');
    if (!block) return this.db.userBlock.deleteMany({ where: { blockerId: req.user.id, blockedId } });
    return this.db.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: req.user.id, blockedId } }, create: { blockerId: req.user.id, blockedId }, update: {} });
  }
  @Post('players/:id/report') async report(@Param('id') reportedId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const data = parse(z.object({ kind: z.enum(['USER', 'RATING']), reason: z.string().trim().min(10).max(2000) }).strict(), body);
    if (reportedId === req.user.id) throw new BadRequestException('No podés denunciarte');
    if (data.kind === 'RATING' && !await this.db.playerRating.findUnique({ where: { authorId_targetId: { authorId: reportedId, targetId: req.user.id } } })) throw new BadRequestException('No hay una valoración de este usuario hacia vos');
    return this.db.userReport.create({ data: { ...data, reporterId: req.user.id, reportedId } });
  }
  @Get('reports') reports(@Req() req: AuthRequest) { this.admin(req); return this.db.userReport.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { reporter: { select: { id: true, name: true } }, reported: { select: { id: true, name: true, suspended: true } } } }); }
  @Post('reports/:id/resolve') resolve(@Param('id') id: string, @Req() req: AuthRequest, @Body() body: unknown) {
    this.admin(req);
    const { action, resolution } = parse(z.object({ action: z.enum(['DISMISS', 'WARN', 'SUSPEND', 'REMOVE_RATING']), resolution: z.string().trim().min(5).max(1000) }).strict(), body);
    return this.db.serial(async tx => {
      const report = await tx.userReport.findUniqueOrThrow({ where: { id }, include: { reported: true } });
      if (report.status !== 'PENDING') throw new ConflictException('Denuncia resuelta');
      if (action === 'SUSPEND') {
        if (report.reported.admin || report.reportedId === req.user.id) throw new ForbiddenException('No se puede suspender a un administrador');
        await tx.user.update({ where: { id: report.reportedId }, data: { suspended: true } });
        await tx.session.deleteMany({ where: { userId: report.reportedId } });
      }
      if (action === 'REMOVE_RATING') {
        if (report.kind !== 'RATING') throw new BadRequestException('La denuncia debe ser sobre una valoración');
        await tx.playerRating.deleteMany({ where: { authorId: report.reportedId, targetId: report.reporterId } });
      }
      if (action === 'WARN') await tx.notification.create({ data: { userId: report.reportedId, message: `Moderación: ${resolution}`, link: '/profile' } });
      return tx.userReport.update({ where: { id }, data: { status: action, resolution, resolvedBy: req.user.id, resolvedAt: new Date() } });
    });
  }
  @Post('players/:id/restore') async restore(@Param('id') id: string, @Req() req: AuthRequest) { this.admin(req); await this.db.user.update({ where: { id }, data: { suspended: false } }); return { ok: true }; }
  @Post('me/calendar') async calendar(@Req() req: AuthRequest, @Body() body: unknown) {
    const { enabled } = parse(z.object({ enabled: z.boolean() }).strict(), body);
    const token = enabled ? randomBytes(32).toString('hex') : null;
    await this.db.user.update({ where: { id: req.user.id }, data: { calendarTokenHash: token ? createHash('sha256').update(token).digest('hex') : null } });
    return { url: token ? `${process.env.WEB_ORIGIN}/api/calendar/${token}.ics` : null };
  }
  @Get('matches/:id/changes') async changes(@Param('id') id: string, @Req() req: AuthRequest) { await this.community.view(id, req.user.id); return this.db.matchChange.findMany({ where: { matchId: id }, orderBy: { createdAt: 'desc' }, take: 50 }); }
}
