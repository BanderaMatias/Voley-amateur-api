import { Controller, Get, Post, Param, Req, Res, Injectable, NotFoundException, ForbiddenException, UseGuards, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Db } from './db.js';
import { AuthGuard, AuthRequest } from './auth.js';
import { calendarIcs } from './community-domain.mjs';
@Injectable()
export class JobsService {
  constructor(private db: Db) {}
  @Cron('0 */15 * * * *') async scheduled() {
    if (process.env.JOBS_CRON_ENABLED !== 'true') return;
    try { await this.reminders(); } catch (e) { new Logger('Reminders').error(e instanceof Error ? e.message : 'Error'); }
  }
  async reminders(now = new Date()) {
    return this.db.serial(async tx => {
      const matches = await tx.match.findMany({ where: { status: { in: ['OPEN', 'CLOSED'] }, startsAt: { gt: now, lte: new Date(now.getTime() + 24 * 3600000) } }, include: { participants: { where: { status: { in: ['INVITED', 'MAYBE', 'CONFIRMED'] }, user: { suspended: false } } } } });
      let sent = 0;
      for (const match of matches) {
        const window = match.startsAt.getTime() - now.getTime() <= 2 * 3600000 ? '2h' : '24h';
        const data = match.participants.filter(p => match.status === 'OPEN' || p.status === 'CONFIRMED').map(p => ({ userId: p.userId, message: `${match.title} comienza ${window === '2h' ? 'en menos de 2 horas' : 'dentro de las próximas 24 horas'}.${p.status === 'CONFIRMED' ? ' Revisá horario y dirección.' : ' Todavía falta tu confirmación.'}`, link: `/matches/${match.id}`, dedupKey: `reminder:${match.id}:${match.startsAt.toISOString()}:${p.userId}:${window}` }));
        sent += (await tx.notification.createMany({ data, skipDuplicates: true })).count;
      }
      await tx.session.deleteMany({ where: { expiresAt: { lt: now } } });
      await tx.replacementRequest.updateMany({ where: { status: 'OPEN', match: { OR: [{ startsAt: { lte: now } }, { status: { not: 'OPEN' } }] } }, data: { status: 'CLOSED' } });
      return { sent };
    });
  }
}
@Controller()
export class JobsController {
  constructor(private jobs: JobsService, private db: Db) {}
  @Post('jobs/run') run(@Req() req: Request) {
    const expected = process.env.JOBS_CRON_SECRET || '', supplied = req.headers.authorization?.replace(/^Bearer /, '') || '';
    if (expected.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new ForbiddenException();
    return this.jobs.reminders();
  }
  @Post('ops/run-reminders') @UseGuards(AuthGuard) manual(@Req() req: AuthRequest) { if (!req.user.admin) throw new ForbiddenException(); return this.jobs.reminders(); }
  @Get('calendar/:token') async feed(@Param('token') token: string, @Res() res: Response) {
    if (!/^[a-f0-9]{64}\.ics$/.test(token)) throw new NotFoundException();
    const hash = createHash('sha256').update(token.slice(0, -4)).digest('hex');
    const user = await this.db.user.findUnique({ where: { calendarTokenHash: hash } });
    if (!user || user.suspended) throw new NotFoundException();
    const matches = await this.db.match.findMany({ where: { startsAt: { gte: new Date(Date.now() - 90 * 86400000), lte: new Date(Date.now() + 366 * 86400000) }, OR: [{ organizerId: user.id }, { participants: { some: { userId: user.id, status: 'CONFIRMED' } } }] }, orderBy: { startsAt: 'asc' } });
    res.type('text/calendar; charset=utf-8').setHeader('Content-Disposition', 'inline; filename="voley.ics"');
    res.send(calendarIcs(matches));
  }
}
