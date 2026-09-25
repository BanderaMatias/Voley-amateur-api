import { Body, Controller, Get, Post, Patch, Param, Query, Req, UseGuards, ForbiddenException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CommunityService } from './community.service.js';
import { payerKeys } from './community-domain.mjs';
import { Db } from './db.js';
import { AuthGuard, AuthRequest } from './auth.js';
import { parse, z, teamSchema, profileSchema, tournamentSchema, matchSchema, recruitmentSchema, ratingSchema } from './validation.js';
import { splitCost, registrationStatus, normalizeName } from './domain.mjs';
const player = { id: true, name: true, avatar: true, profile: true } as const;
@Controller()
@UseGuards(AuthGuard)
export class AppController {
  constructor(private db: Db, private community: CommunityService) {}
  async leader(teamId: string, userId: string) {
    const m = await this.db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } } });
    if (m?.role !== 'LEADER') throw new ForbiddenException('Solo el líder puede realizar esta acción');
  }
  admin(req: AuthRequest) { if (!req.user.admin) throw new ForbiddenException('Solo administradores'); }
  @Get('me') me(@Req() req: AuthRequest) {
    const { id, name, avatar, profile, admin, recruitmentAlerts, replacementPreferences } = req.user;
    return { id, name, avatar, profile, admin, recruitmentAlerts, replacementPreferences };
  }
  @Patch('me') async profile(@Req() req: AuthRequest, @Body() body: unknown) {
    const { name, recruitmentAlerts, ...profile } = parse(profileSchema, body);
    await this.db.user.update({ where: { id: req.user.id }, data: { name, recruitmentAlerts, profile } });
    return { ok: true };
  }
  @Get('players') async players(@Req() req: AuthRequest, @Query('q') q = '') {
    const hidden = await this.community.hiddenIds(req.user.id);
    return this.db.user.findMany({ where: { suspended: false, id: { notIn: hidden }, name: { contains: q.slice(0, 100), mode: 'insensitive' } }, select: player, take: 50, orderBy: { name: 'asc' } });
  }
  @Get('players/:id') async player(@Param('id') id: string, @Req() req: AuthRequest) {
    const user = await this.db.user.findUnique({ where: { id }, select: { ...player, memberships: { select: { team: { select: { id: true, name: true } } } } } });
    if (!user) throw new NotFoundException();
    const ratings = await this.db.playerRating.aggregate({ where: { targetId: id }, _avg: { attack: true, reception: true, defense: true, jump: true }, _count: { _all: true } });
    const mine = await this.db.playerRating.findUnique({ where: { authorId_targetId: { authorId: req.user.id, targetId: id } }, select: { attack: true, reception: true, defense: true, jump: true } });
    return { ...user, ratings: ratings._avg, ratingCount: ratings._count._all, mine };
  }
  @Post('players/:id/ratings') async rate(@Param('id') id: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const values = parse(ratingSchema, body);
    await this.community.interact(req.user.id, id);
    if (id === req.user.id) throw new BadRequestException('No podés puntuarte a vos mismo');
    const shared = await this.db.match.findFirst({ where: { status: 'COMPLETED', participants: { some: { userId: id, attended: true } }, AND: { participants: { some: { userId: req.user.id, attended: true } } } } });
    if (!shared) throw new ForbiddenException('Deben haber asistido a un mismo partido finalizado');
    return this.db.playerRating.upsert({ where: { authorId_targetId: { authorId: req.user.id, targetId: id } }, create: { authorId: req.user.id, targetId: id, ...values }, update: values });
  }
  @Get('teams') teams(@Req() req: AuthRequest) {
    return this.db.team.findMany({ where: { members: { some: { userId: req.user.id } } }, include: { members: { select: { role: true, user: { select: player } } }, registrations: { include: { tournament: true } } }, orderBy: { name: 'asc' } });
  }
  @Post('teams') team(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.db.team.create({ data: { ...parse(teamSchema, body), members: { create: { userId: req.user.id, role: 'LEADER' } } } });
  }
  @Patch('teams/:id') async editTeam(@Param('id') id: string, @Req() req: AuthRequest, @Body() body: unknown) {
    await this.leader(id, req.user.id);
    return this.db.team.update({ where: { id }, data: parse(teamSchema, body) });
  }
  @Get('tournaments') tournaments() { return this.db.tournament.findMany({ orderBy: { name: 'asc' } }); }
  @Post('tournaments') tournament(@Req() req: AuthRequest, @Body() body: unknown) {
    this.admin(req); return this.db.tournament.create({ data: parse(tournamentSchema, body) });
  }
  @Post('teams/:id/tournaments') async register(@Param('id') teamId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    await this.leader(teamId, req.user.id);
    const { tournamentId } = parse(z.object({ tournamentId: z.string().min(1) }).strict(), body);
    return this.db.tournamentRegistration.upsert({ where: { teamId_tournamentId: { teamId, tournamentId } }, create: { teamId, tournamentId }, update: {} });
  }
  @Get('registrations') registrations(@Req() req: AuthRequest) {
    this.admin(req); return this.db.tournamentRegistration.findMany({ include: { team: true, tournament: true } });
  }
  @Patch('registrations/:id') mapping(@Param('id') id: string, @Req() req: AuthRequest, @Body() body: unknown) {
    this.admin(req);
    const data = parse(z.object({ externalName: z.string().trim().min(1).max(100), division: z.string().max(100) }).strict(), body);
    return this.db.tournamentRegistration.update({ where: { id }, data: { externalName: normalizeName(data.externalName), division: normalizeName(data.division) } });
  }
  @Get('recruitments') async recruitments(@Req() req: AuthRequest) {
    const hidden = await this.community.hiddenIds(req.user.id);
    return this.db.recruitmentPost.findMany({ where: { status: 'OPEN', team: { members: { none: { role: 'LEADER', userId: { in: hidden } } } } }, include: { team: true }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  @Post('teams/:id/recruitments') async recruit(@Param('id') teamId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    await this.leader(teamId, req.user.id);
    const data = parse(recruitmentSchema, body);
    return this.db.$transaction(async tx => {
      const post = await tx.recruitmentPost.create({ data: { teamId, ...data }, include: { team: true } });
      // Database fan-out in the same transaction; no externally sent messages.
      const message = `${post.team.name} busca jugadores: ${post.title}`;
      await tx.$executeRaw`INSERT INTO "Notification" ("id", "userId", "message", "link", "read", "createdAt") SELECT md5(${post.id} || "id"), "id", ${message}, ${'/recruitments/' + post.id}, false, NOW() FROM "User" u WHERE u."recruitmentAlerts" = true AND u."suspended" = false AND NOT EXISTS (SELECT 1 FROM "UserBlock" b WHERE (b."blockerId" = ${req.user.id} AND b."blockedId" = u."id") OR (b."blockedId" = ${req.user.id} AND b."blockerId" = u."id"))`;
      return post;
    });
  }
  @Patch('recruitments/:id/close') async closeRecruitment(@Param('id') id: string, @Req() req: AuthRequest) {
    const post = await this.db.recruitmentPost.findUniqueOrThrow({ where: { id } });
    await this.leader(post.teamId, req.user.id);
    return this.db.recruitmentPost.update({ where: { id }, data: { status: 'CLOSED' } });
  }
  @Post('recruitments/:id/apply') apply(@Param('id') postId: string, @Req() req: AuthRequest) {
    return this.db.serial(async tx => {
      const post = await tx.recruitmentPost.findUnique({ where: { id: postId } });
      if (!post || post.status !== 'OPEN') throw new BadRequestException('Búsqueda cerrada');
      for (const leader of await tx.teamMember.findMany({ where: { teamId: post.teamId, role: 'LEADER' } })) await this.community.interact(req.user.id, leader.userId, tx);
      if (await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: post.teamId, userId: req.user.id } } })) throw new ConflictException('Ya sos parte del equipo');
      return tx.recruitmentApplication.upsert({ where: { postId_userId: { postId, userId: req.user.id } }, create: { postId, userId: req.user.id }, update: {} });
    });
  }
  @Get('teams/:id/applications') async applications(@Param('id') teamId: string, @Req() req: AuthRequest) {
    await this.leader(teamId, req.user.id);
    return this.db.recruitmentApplication.findMany({ where: { post: { teamId }, status: 'PENDING' }, include: { user: { select: player }, post: true } });
  }
  @Post('recruitments/:id/applications/:userId') async decide(@Param('id') postId: string, @Param('userId') userId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { accept } = parse(z.object({ accept: z.boolean() }).strict(), body);
    if (accept) await this.community.interact(req.user.id, userId);
    const post = await this.db.recruitmentPost.findUniqueOrThrow({ where: { id: postId } });
    await this.leader(post.teamId, req.user.id);
    return this.db.serial(async tx => {
      const changed = await tx.recruitmentApplication.updateMany({ where: { postId, userId, status: 'PENDING' }, data: { status: accept ? 'ACCEPTED' : 'REJECTED' } });
      if (!changed.count) throw new ConflictException('Postulación ya resuelta');
      if (accept) await tx.teamMember.upsert({ where: { teamId_userId: { teamId: post.teamId, userId } }, create: { teamId: post.teamId, userId }, update: {} });
      await tx.notification.create({ data: { userId, message: accept ? 'Tu postulación fue aceptada' : 'Tu postulación no fue aceptada', link: '/teams' } });
      return { ok: true };
    });
  }
  matchWhere(userId: string) {
    return { OR: [{ visibility: 'PUBLIC', organizer: { suspended: false, blocksMade: { none: { blockedId: userId } }, blocksReceived: { none: { blockerId: userId } } } }, { organizerId: userId }, { team: { members: { some: { userId } } } }, { participants: { some: { userId } } }] };
  }
  @Get('matches') matches(@Req() req: AuthRequest) {
    return this.db.match.findMany({ where: this.matchWhere(req.user.id), include: { team: true, guests: { where: { active: true, linkedUserId: null }, select: { id: true } }, participants: { select: { userId: true, status: true } } }, orderBy: { startsAt: 'asc' }, take: 200 });
  }
  @Get('matches/:id') async detail(@Param('id') id: string, @Req() req: AuthRequest) {
    const match = await this.db.match.findFirst({ where: { id, ...this.matchWhere(req.user.id) }, include: { team: true, guests: true, participants: { include: { user: { select: player } } } } });
    if (!match) throw new NotFoundException();
    return { ...match, costs: match.closedCost || splitCost(match.priceCents, payerKeys(match)) };
  }
  @Post('matches') async createMatch(@Req() req: AuthRequest, @Body() body: unknown) {
    const data = parse(matchSchema, body);
    if (new Date(data.startsAt) <= new Date()) throw new BadRequestException('La fecha debe ser futura');
    if (data.teamId) await this.leader(data.teamId, req.user.id);
    if (data.type === 'TOURNAMENT') {
      if (!data.teamId || !data.tournamentId) throw new BadRequestException('Falta equipo o torneo');
      const registration = await this.db.tournamentRegistration.findUnique({ where: { teamId_tournamentId: { teamId: data.teamId, tournamentId: data.tournamentId } } });
      if (!registration) throw new BadRequestException('El equipo no está inscripto en este torneo');
    } else if (data.tournamentId) throw new BadRequestException('El torneo solo corresponde a partidos de torneo');
    return this.db.match.create({ data: { ...data, startsAt: new Date(data.startsAt), organizerId: req.user.id } });
  }
  @Patch('matches/:id/price') async price(@Param('id') id: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { priceCents } = parse(z.object({ priceCents: z.number().int().min(0).max(100000000) }).strict(), body);
    const changed = await this.db.match.updateMany({ where: { id, organizerId: req.user.id, status: 'OPEN' }, data: { priceCents } });
    if (!changed.count) throw new ForbiddenException('Solo el organizador con inscripción abierta');
    return { ok: true };
  }
  @Post('matches/:id/call-up') callUp(@Param('id') matchId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { userIds } = parse(z.object({ userIds: z.array(z.string().min(1)).max(100).default([]) }).strict(), body);
    return this.db.serial(async tx => {
      const match = await tx.match.findUnique({ where: { id: matchId } });
      if (!match || match.organizerId !== req.user.id) throw new ForbiddenException();
      if (match.status !== 'OPEN') throw new BadRequestException('Inscripción cerrada');
      const ids = new Set(userIds);
      if (match.teamId) for (const member of await tx.teamMember.findMany({ where: { teamId: match.teamId } })) ids.add(member.userId);
      for (const userId of ids) {
        if (await this.community.blocked(req.user.id, userId, tx)) continue;
        const target = await tx.user.findUnique({ where: { id: userId }, select: { suspended: true } });
        if (!target || target.suspended) continue;
        const existing = await tx.matchParticipant.findUnique({ where: { matchId_userId: { matchId, userId } } });
        if (existing) continue;
        await tx.matchParticipant.create({ data: { matchId, userId } });
        await tx.notification.create({ data: { userId, message: `Convocatoria: ${match.title}`, link: `/matches/${matchId}` } });
      }
      return { ok: true };
    });
  }
  @Post('matches/:id/respond') respond(@Param('id') matchId: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { status, allowConflict } = parse(z.object({ status: z.enum(['CONFIRMED', 'REJECTED', 'MAYBE']), allowConflict: z.boolean().default(false) }).strict(), body);
    return this.db.serial(async tx => {
      const userId = req.user.id;
      const match = await tx.match.findFirst({ where: { id: matchId, ...this.matchWhere(userId) } });
      if (!match) throw new NotFoundException();
      if (match.status !== 'OPEN' || match.startsAt <= new Date()) throw new BadRequestException('Inscripción cerrada');
      const old = await tx.matchParticipant.findUnique({ where: { matchId_userId: { matchId, userId } } });
      if (status !== 'REJECTED') await this.community.interact(userId, match.organizerId, tx);
      if (status === 'CONFIRMED') await this.community.checkConflicts(userId, match, tx, allowConflict);
      const count = await tx.matchParticipant.count({ where: { matchId, status: 'CONFIRMED', userId: { not: userId } } }) + await tx.matchGuest.count({ where: { matchId, active: true, linkedUserId: null } });
      const next = status === 'CONFIRMED' ? registrationStatus(count, match.capacity) : status;
      const result = await tx.matchParticipant.upsert({ where: { matchId_userId: { matchId, userId } }, create: { matchId, userId, status: next }, update: { status: next, ...(old?.status !== 'WAITLIST' && next === 'WAITLIST' ? { joinedAt: new Date() } : {}) } });
      await tx.match.update({ where: { id: matchId }, data: { balancedTeams: Prisma.DbNull } });
      if (old?.status === 'CONFIRMED' && next !== 'CONFIRMED') await this.community.promote(match, tx);
      return result;
    });
  }
  @Post('matches/:id/status') status(@Param('id') id: string, @Req() req: AuthRequest, @Body() body: unknown) {
    const { status, attendedIds, attendedGuestIds } = parse(z.object({ status: z.enum(['CLOSED', 'CANCELLED', 'COMPLETED']), attendedIds: z.array(z.string()).max(100).default([]), attendedGuestIds: z.array(z.string()).max(100).default([]) }).strict(), body);
    return this.db.serial(async tx => {
      const match = await tx.match.findUnique({ where: { id }, include: { participants: true, guests: true } });
      if (!match || match.organizerId !== req.user.id) throw new ForbiddenException();
      if (['COMPLETED', 'CANCELLED'].includes(match.status)) throw new BadRequestException('Partido finalizado');
      if (status !== 'CANCELLED' && match.priceCents === null) throw new BadRequestException('Definí el precio de la cancha antes de cerrar; ingresá 0 si es gratuita');
      if (status === 'COMPLETED' && match.startsAt > new Date()) throw new BadRequestException('El partido todavía no comenzó');
      const confirmed = match.participants.filter(p => p.status === 'CONFIRMED').map(p => p.userId);
      if (attendedIds.some(x => !confirmed.includes(x))) throw new BadRequestException('Solo se puede marcar asistencia de jugadores confirmados');
      if (status === 'COMPLETED') await tx.matchParticipant.updateMany({ where: { matchId: id, userId: { in: attendedIds } }, data: { attended: true } });
      const activeGuests = match.guests.filter(g => g.active && !g.linkedUserId).map(g => g.id);
      if (attendedGuestIds.some(id => !activeGuests.includes(id))) throw new BadRequestException('Invitado inválido');
      if (status === 'COMPLETED') await tx.matchGuest.updateMany({ where: { matchId: id, id: { in: attendedGuestIds } }, data: { attended: true } });
      const costs = match.closedCost || splitCost(match.priceCents, payerKeys(match));
      await tx.replacementRequest.updateMany({ where: { matchId: id }, data: { status: 'CLOSED' } });
      await tx.notification.createMany({ data: match.participants.map(p => ({ userId: p.userId, message: `${match.title}: ${status === 'CANCELLED' ? 'cancelado' : status === 'COMPLETED' ? 'finalizado' : 'inscripción cerrada'}`, link: `/matches/${id}` })) });
      return tx.match.update({ where: { id }, data: { status, revision: { increment: 1 }, ...(costs ? { closedCost: costs } : {}) } });
    });
  }
  @Get('notifications') notifications(@Req() req: AuthRequest) {
    return this.db.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
  @Patch('notifications/:id/read') read(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.db.notification.updateMany({ where: { id, userId: req.user.id }, data: { read: true } });
  }
}
