import { Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from './db.js';
import { overlaps } from './community-domain.mjs';
@Injectable()
export class CommunityService {
  constructor(private db: Db) {}
  async blocked(a: string, b: string, tx: Prisma.TransactionClient = this.db) {
    return !!await tx.userBlock.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
  }
  async interact(a: string, b: string, tx: Prisma.TransactionClient = this.db) {
    const user = await tx.user.findUnique({ where: { id: b }, select: { suspended: true } });
    if (!user || user.suspended || await this.blocked(a, b, tx)) throw new ForbiddenException('No se puede interactuar con este usuario');
  }
  async hiddenIds(userId: string) {
    const rows = await this.db.userBlock.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    return rows.map(r => r.blockerId === userId ? r.blockedId : r.blockerId);
  }
  async view(id: string, userId: string, tx: Prisma.TransactionClient = this.db) {
    const match = await tx.match.findUnique({ where: { id }, include: { participants: true, guests: true, team: { include: { members: true } } } });
    const owner = match ? await tx.user.findUnique({ where: { id: match.organizerId }, select: { suspended: true } }) : null;
    if (!match || (match.organizerId !== userId && !match.participants.some(p => p.userId === userId) && !match.team?.members.some(m => m.userId === userId) && (match.visibility !== 'PUBLIC' || owner?.suspended || await this.blocked(userId, match.organizerId, tx)))) throw new NotFoundException();
    return match;
  }
  async organize(id: string, userId: string, tx: Prisma.TransactionClient = this.db) {
    const match = await this.view(id, userId, tx);
    if (match.organizerId !== userId) throw new ForbiddenException('Solo el organizador');
    return match;
  }
  async conflicts(userId: string, match: { id: string; startsAt: Date; durationMinutes: number }, tx: Prisma.TransactionClient = this.db) {
    const candidates = await tx.match.findMany({ where: { id: { not: match.id }, status: { in: ['OPEN', 'CLOSED'] }, startsAt: { gt: new Date(match.startsAt.getTime() - 360 * 60000), lt: new Date(match.startsAt.getTime() + match.durationMinutes * 60000) }, participants: { some: { userId, status: 'CONFIRMED' } } }, select: { id: true, title: true, startsAt: true, durationMinutes: true } });
    return candidates.filter(m => overlaps(m, match));
  }
  async checkConflicts(userId: string, match: { id: string; startsAt: Date; durationMinutes: number }, tx: Prisma.TransactionClient = this.db, allow = false) {
    const conflicts = await this.conflicts(userId, match, tx);
    if (conflicts.length && !allow) throw new ConflictException({ message: 'El horario se superpone con otro partido confirmado. Revisalo y confirmá expresamente si querés anotarte igual.', code: 'SCHEDULE_CONFLICT', conflicts });
  }
  async promote(match: { id: string; organizerId: string; startsAt: Date; durationMinutes: number }, tx: Prisma.TransactionClient) {
    const waiting = await tx.matchParticipant.findMany({ where: { matchId: match.id, status: 'WAITLIST', user: { suspended: false } }, orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] });
    for (const p of waiting) {
      if (await this.blocked(p.userId, match.organizerId, tx)) continue;
      if ((await this.conflicts(p.userId, match, tx)).length) {
        await tx.notification.createMany({ data: [{ userId: p.userId, message: 'Hay un lugar disponible, pero tenés otro partido superpuesto. Revisá tu agenda para confirmar.', link: `/matches/${match.id}`, dedupKey: `conflict:${match.id}:${p.userId}:${match.startsAt.toISOString()}` }], skipDuplicates: true });
        continue;
      }
      await tx.matchParticipant.update({ where: { matchId_userId: { matchId: match.id, userId: p.userId } }, data: { status: 'CONFIRMED' } });
      await tx.match.update({ where: { id: match.id }, data: { balancedTeams: Prisma.DbNull } });
      await tx.notification.create({ data: { userId: p.userId, message: 'Se liberó un lugar: tu asistencia quedó confirmada.', link: `/matches/${match.id}` } });
      break;
    }
  }
}
