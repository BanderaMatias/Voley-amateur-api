import { Injectable, Controller, Get, Post, Body, Param, Req, UseGuards, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Request } from 'express';
import { Db } from './db.js';
import { AuthGuard, AuthRequest } from './auth.js';
import { parse, z } from './validation.js';
import { parsePodio } from './podio-parser.mjs';
import { normalizeName } from './domain.mjs';
const candidate = z.object({ startsAt: z.string().datetime({ offset: true }), home: z.string().trim().min(1).max(100), away: z.string().trim().min(1).max(100), courtCode: z.string().min(1).max(50), address: z.string().min(5).max(300), division: z.string().max(100).default('') }).strict();
type Candidate = z.infer<typeof candidate>;
@Injectable()
export class PodioService {
  private log = new Logger(PodioService.name);
  private running = false;
  constructor(private db: Db) {}
  @Cron('0 13,16,19 * * 1', { timeZone: 'America/Argentina/Buenos_Aires' })
  async scheduled() {
    if (process.env.PODIO_CRON_ENABLED !== 'true') return;
    try { await this.download(); } catch (error) { this.log.error(error instanceof Error ? error.message : 'Importación fallida'); }
  }
  @Cron('0 0,6,12,18 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async watch() {
    if (process.env.PODIO_WATCH_ENABLED !== 'true') return;
    try { await this.download(); } catch (error) { this.log.error(error instanceof Error ? error.message : 'Seguimiento de Podio fallido'); }
  }
  // Restrict every redirect and all discovered URLs to the public Podio host.
  async fetchSafe(input: string, maxBytes: number): Promise<{ bytes: Buffer; url: string }> {
    let url = new URL(input);
    for (let i = 0; i < 5; i++) {
      if (url.protocol !== 'https:' || !['podio.org.ar', 'www.podio.org.ar'].includes(url.hostname) || url.port || url.username || url.password) throw new BadRequestException('URL de Podio no permitida');
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(25000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw new Error('Redirección inválida');
        url = new URL(location, url); continue;
      }
      if (!response.ok || !response.body) throw new Error(`Podio respondió ${response.status}`);
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of response.body as any) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('Archivo demasiado grande');
        chunks.push(Buffer.from(chunk));
      }
      return { bytes: Buffer.concat(chunks), url: url.href };
    }
    throw new Error('Demasiadas redirecciones');
  }
  async discover(): Promise<string> {
    if (process.env.PODIO_PDF_URL) return process.env.PODIO_PDF_URL;
    const queue = ['https://podio.org.ar/']; const visited = new Set<string>();
    while (queue.length && visited.size < 5) {
      const page = queue.shift()!; if (visited.has(page)) continue; visited.add(page);
      let fetched: { bytes: Buffer; url: string };
      try { fetched = await this.fetchSafe(page, 2000000); } catch (error) { if (visited.size === 1) throw error; continue; }
      const { bytes, url } = fetched;
      const html = bytes.toString('utf8');
      for (const frame of html.matchAll(/<(?:frame|iframe)\b[^>]*src=["']([^"']+)["']/gi)) queue.push(new URL(frame[1].replace(/&amp;/g, '&'), url).href);
      const pdfs: string[] = [];
      for (const a of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        const label = normalizeName(a[2].replace(/<[^>]*>/g, ' ').replace(/&oacute;|&#243;/g, 'ó'));
        if (label.includes('PROXIMOS PARTIDOS POR CANCHA')) pdfs.push(new URL(a[1].replace(/&amp;/g, '&'), url).href);
      }
      if (pdfs.length === 1) return pdfs[0];
      if (pdfs.length > 1) throw new Error('Más de un PDF: requiere revisión');
    }
    throw new Error('No se encontró el enlace Próximos Partidos por Cancha. Configurá PODIO_PDF_URL con el enlace verificado.');
  }
  async download() {
    if (this.running) throw new BadRequestException('Importación en curso');
    this.running = true;
    let folder: string | undefined;
    try {
      const file = await this.fetchSafe(await this.discover(), 15 * 1024 * 1024);
      if (file.bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('El enlace no devolvió un PDF');
      const hash = createHash('sha256').update(file.bytes).digest('hex');
      const existing = await this.db.importExecution.findUnique({ where: { hash }, select: { id: true, status: true } });
      if (existing) return { ...existing, duplicate: true };
      folder = await mkdtemp(join(tmpdir(), 'voley-podio-'));
      await writeFile(join(folder, 'source.pdf'), file.bytes);
      await promisify(execFile)('pdftotext', ['-layout', join(folder, 'source.pdf'), join(folder, 'source.txt')], { timeout: 30000 });
      const rawText = (await readFile(join(folder, 'source.txt'), 'utf8')).slice(0, 2000000);
      const candidates = parsePodio(rawText);
      const run = await this.db.importExecution.upsert({ where: { hash }, update: {}, create: { hash, url: file.url, pdf: new Uint8Array(file.bytes), rawText, candidates, message: candidates.length ? 'Propuestas extraídas; validar formato, semana y direcciones.' : 'Formato no reconocido. Revisar texto y completar partidos.' } });
      if (run.status === 'REVIEW_REQUIRED') {
        const admins = await this.db.user.findMany({ where: { admin: true, suspended: false }, select: { id: true } });
        await this.db.notification.createMany({ data: admins.map(u => ({ userId: u.id, message: 'Nueva versión de la programación de Podio: revisá las propuestas y posibles cambios.', link: '/admin', dedupKey: `podio-review:${run.id}:${u.id}` })), skipDuplicates: true });
      }
      if (process.env.PODIO_AUTO_IMPORT === 'true' && candidates.length && run.status === 'REVIEW_REQUIRED') return this.apply(run.id, candidates);
      return { id: run.id, status: run.status, candidates: candidates.length };
    } finally { this.running = false; if (folder) await rm(folder, { recursive: true, force: true }); }
  }
  async apply(id: string, candidates: Candidate[]) {
    if (!candidates.length) throw new BadRequestException('No hay partidos para importar');
    return this.db.serial(async tx => {
      const run = await tx.importExecution.findUniqueOrThrow({ where: { id } });
      if (run.status === 'IMPORTED') return { imported: 0, duplicate: true };
      const registrations = await tx.tournamentRegistration.findMany({ where: { tournament: { provider: 'PODIO' }, externalName: { not: null } }, include: { team: { include: { members: { where: { role: 'LEADER' }, take: 1 } } } } });
      let imported = 0;
      const keys = new Set<string>();
      for (const row of candidates) {
        const date = new Date(row.startsAt);
        if (date <= new Date() || date.getTime() > Date.now() + 31 * 86400000) throw new BadRequestException('Revisá la fecha: debe estar dentro de los próximos 31 días');
        for (const side of ['home', 'away'] as const) {
          const matches = registrations.filter(r => r.externalName === normalizeName(row[side]) && r.division === normalizeName(row.division));
          if (matches.length > 1) throw new BadRequestException(`Equipo ambiguo: ${row[side]}. Revisá torneos y categorías.`);
          for (const reg of matches) {
            const leader = reg.team.members[0]; if (!leader) throw new BadRequestException('Equipo sin líder');
            const opponent = row[side === 'home' ? 'away' : 'home'];
            // Time/court changes update the same fixture. Date changes require administrator review.
            const day = date.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
            const externalKey = createHash('sha256').update(`${reg.id}|${day}|${normalizeName(opponent)}`).digest('hex');
            if (keys.has(externalKey)) throw new BadRequestException('Dos partidos con el mismo rival en un día requieren revisión manual');
            keys.add(externalKey);
            const old = await tx.match.findUnique({ where: { externalKey } });
            if (old && ['COMPLETED', 'CANCELLED'].includes(old.status)) throw new BadRequestException('El PDF modifica un partido finalizado');
            if (!old) {
              const possible = await tx.match.findMany({ where: { source: 'PODIO', teamId: reg.teamId, tournamentId: reg.tournamentId, status: { in: ['OPEN', 'CLOSED'] }, startsAt: { gte: new Date(date.getTime() - 7 * 86400000), lte: new Date(date.getTime() + 7 * 86400000) } } });
              if (possible.some(m => normalizeName(m.opponent || '') === normalizeName(opponent))) throw new BadRequestException('Posible cambio de día o doble encuentro. Revisá y reprogramá el partido existente antes de importar.');
            }
            const changed = !!old && (old.startsAt.getTime() !== date.getTime() || old.address !== row.address || old.courtCode !== row.courtCode);
            const data = { title: `${reg.team.name} vs ${opponent}`, startsAt: date, address: row.address, courtCode: row.courtCode, opponent };
            const match = await tx.match.upsert({ where: { externalKey }, create: { ...data, externalKey, source: 'PODIO', type: 'TOURNAMENT', visibility: 'PRIVATE', teamId: reg.teamId, tournamentId: reg.tournamentId, organizerId: leader.userId }, update: { ...data, ...(changed ? { revision: { increment: 1 } } : {}) } });
            if (changed) await tx.matchChange.create({ data: { matchId: match.id, source: 'PODIO', before: { startsAt: old!.startsAt.toISOString(), address: old!.address, courtCode: old!.courtCode }, after: { startsAt: date.toISOString(), address: row.address, courtCode: row.courtCode } } });
            if (!old || changed) {
              const attendees = await tx.matchParticipant.findMany({ where: { matchId: match.id, status: { not: 'REJECTED' }, user: { suspended: false } } });
              const recipients = [...new Set([leader.userId, match.organizerId, ...attendees.map(p => p.userId)])];
              await tx.notification.createMany({ data: recipients.map(userId => ({ userId, message: `${old ? 'Cambio de horario o cancha' : 'Nuevo partido'} de Podio: ${data.title}. Revisá los detalles.`, link: `/matches/${match.id}` })) });
            }
            imported++;
          }
        }
      }
      if (!imported) throw new BadRequestException('Ningún equipo coincide con los nombres y categorías vinculados');
      await tx.importExecution.update({ where: { id }, data: { status: 'IMPORTED', candidates, message: `${imported} partidos procesados` } });
      return { imported };
    });
  }
}
@Controller('podio')
export class PodioController {
  constructor(private service: PodioService, private db: Db) {}
  @Post('cron') cron(@Req() req: Request) {
    const expected = process.env.PODIO_CRON_SECRET || '';
    const token = req.headers.authorization?.replace(/^Bearer /, '') || '';
    if (expected.length < 32 || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) throw new ForbiddenException();
    return this.service.download();
  }
  @Get('matches') @UseGuards(AuthGuard) matches(@Req() req: AuthRequest) {
    if (!req.user.admin) throw new ForbiddenException();
    return this.db.match.findMany({ where: { source: 'PODIO', status: { in: ['OPEN', 'CLOSED'] }, startsAt: { gt: new Date() } }, select: { id: true, title: true, startsAt: true, address: true, courtCode: true }, orderBy: { startsAt: 'asc' }, take: 200 });
  }
  @Get('imports') @UseGuards(AuthGuard) list(@Req() req: AuthRequest) {
    if (!req.user.admin) throw new ForbiddenException();
    return this.db.importExecution.findMany({ select: { id: true, url: true, status: true, message: true, createdAt: true, candidates: true, rawText: true }, orderBy: { createdAt: 'desc' }, take: 10 });
  }
  @Post('download') @UseGuards(AuthGuard) download(@Req() req: AuthRequest) {
    if (!req.user.admin) throw new ForbiddenException(); return this.service.download();
  }
  @Post('matches/:id/reschedule') @UseGuards(AuthGuard) async reschedule(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    if (!req.user.admin) throw new ForbiddenException();
    const data = parse(z.object({ startsAt: z.string().datetime({ offset: true }), address: z.string().min(5).max(300), courtCode: z.string().min(1).max(50) }).strict(), body);
    const startsAt = new Date(data.startsAt);
    if (startsAt <= new Date()) throw new BadRequestException('La fecha debe ser futura');
    return this.db.serial(async tx => {
      const old = await tx.match.findUniqueOrThrow({ where: { id }, include: { participants: true } });
      if (old.source !== 'PODIO' || !old.teamId || !old.tournamentId || !['OPEN', 'CLOSED'].includes(old.status)) throw new BadRequestException('Partido de Podio no editable');
      const registration = await tx.tournamentRegistration.findUniqueOrThrow({ where: { teamId_tournamentId: { teamId: old.teamId, tournamentId: old.tournamentId } } });
      const day = startsAt.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
      const externalKey = createHash('sha256').update(`${registration.id}|${day}|${normalizeName(old.opponent || '')}`).digest('hex');
      const result = await tx.match.update({ where: { id }, data: { ...data, startsAt, externalKey, revision: { increment: 1 } } });
      await tx.matchChange.create({ data: { matchId: id, source: 'ADMIN_PODIO', before: { startsAt: old.startsAt.toISOString(), address: old.address, courtCode: old.courtCode }, after: data } });
      await tx.notification.createMany({ data: [...new Set([old.organizerId, ...old.participants.filter(p => p.status !== 'REJECTED').map(p => p.userId)])].map(userId => ({ userId, message: `Reprogramación de Podio: ${old.title}. Revisá tu agenda.`, link: `/matches/${id}` })) });
      return result;
    });
  }
  @Post('imports/:id/approve') @UseGuards(AuthGuard) approve(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    if (!req.user.admin) throw new ForbiddenException();
    const { candidates } = parse(z.object({ candidates: z.array(candidate).min(1).max(500) }).strict(), body);
    return this.service.apply(id, candidates);
  }
}
