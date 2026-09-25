import { Body, Controller, Get, Post, Req, Res, Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { User } from '@prisma/client';
import { Db } from './db.js';
export type AuthRequest = Request & { user: User };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const options = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' });
export function requireOrigin(req: Request) {
  if (req.headers.origin !== process.env.WEB_ORIGIN) throw new ForbiddenException('Origen no permitido');
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private db: Db) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) requireOrigin(req);
    const token = req.cookies?.session;
    if (typeof token !== 'string') throw new UnauthorizedException();
    const session = await this.db.session.findUnique({ where: { id: hash(token) }, include: { user: true } });
    if (!session || session.user.suspended || session.expiresAt < new Date()) throw new UnauthorizedException();
    req.user = session.user;
    return true;
  }
}
@Controller('auth')
export class AuthController {
  constructor(private db: Db) {}
  @Get('nonce') nonce(@Res({ passthrough: true }) res: Response) {
    const nonce = randomBytes(32).toString('hex');
    res.setHeader('Cache-Control', 'no-store');
    res.cookie('login_nonce', nonce, { ...options(), maxAge: 10 * 60 * 1000 });
    return { nonce };
  }
  @Post('google') async login(@Req() req: Request, @Body() body: { credential?: unknown }, @Res({ passthrough: true }) res: Response) {
    requireOrigin(req);
    if (!body || typeof body.credential !== 'string' || body.credential.length > 12000) throw new UnauthorizedException();
    let payload;
    try { payload = (await new OAuth2Client(process.env.GOOGLE_CLIENT_ID).verifyIdToken({ idToken: body.credential, audience: process.env.GOOGLE_CLIENT_ID })).getPayload(); }
    catch { throw new UnauthorizedException('No se pudo validar Google'); }
    const nonce = (payload as typeof payload & { nonce?: string })?.nonce;
    const expected = req.cookies?.login_nonce;
    if (!payload?.sub || !payload.email_verified || !payload.email || typeof nonce !== 'string' || typeof expected !== 'string' || nonce.length !== expected.length || !timingSafeEqual(Buffer.from(nonce), Buffer.from(expected))) throw new UnauthorizedException('Sesión de Google inválida');
    res.clearCookie('login_nonce', options());
    const user = await this.db.user.upsert({ where: { googleSub: payload.sub }, update: { email: payload.email }, create: { googleSub: payload.sub, email: payload.email, name: payload.name || 'Jugador', avatar: payload.picture, admin: payload.sub === process.env.ADMIN_GOOGLE_SUB } });
    if (user.suspended) throw new ForbiddenException('Cuenta suspendida');
    const token = randomBytes(32).toString('hex');
    await this.db.session.create({ data: { id: hash(token), userId: user.id, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    res.cookie('session', token, { ...options(), maxAge: 7 * 86400000 });
    return { id: user.id, name: user.name };
  }
  @Post('logout') async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    requireOrigin(req);
    if (typeof req.cookies?.session === 'string') await this.db.session.deleteMany({ where: { id: hash(req.cookies.session) } });
    res.clearCookie('session', options());
    return { ok: true };
  }
}
