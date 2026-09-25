import 'reflect-metadata';
import { config } from 'dotenv';
config();
import { NestFactory } from '@nestjs/core';
import { Module, Controller, Get, Catch, ArgumentsHost, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { CommunityService } from './community.service.js';
import { CommunityController } from './community.controller.js';
import { JobsController, JobsService } from './jobs.js';
import { Db } from './db.js';
import { AuthController, AuthGuard } from './auth.js';
import { AppController } from './app.controller.js';
import { PodioController, PodioService } from './podio.js';
@Controller('health') class Health { @Get() health() { return { status: 'ok' }; } }
@Catch() class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (error instanceof HttpException) return response.status(error.getStatus()).json(error.getResponse());
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') return response.status(404).json({ message: 'Registro no encontrado' });
      if (error.code === 'P2002' || error.code === 'P2034') return response.status(409).json({ message: 'Conflicto: actualizá e intentá nuevamente' });
      if (error.code === 'P2003') return response.status(400).json({ message: 'Referencia inválida' });
    }
    new Logger('API').error(error instanceof Error ? error.message : 'Error desconocido');
    response.status(500).json({ message: 'No se pudo completar la operación' });
  }
}
@Module({ imports: [ScheduleModule.forRoot()], controllers: [Health, AuthController, AppController, CommunityController, JobsController, PodioController], providers: [Db, AuthGuard, PodioService, CommunityService, JobsService] }) class AppModule {}
async function bootstrap() {
  for (const key of ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'WEB_ORIGIN']) if (!process.env[key]) throw new Error(`Falta ${key}`);
  const app = await NestFactory.create(AppModule);
  app.use(helmet()); app.use(cookieParser());
  app.use(rateLimit({ windowMs: 60000, limit: 200, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use('/auth', rateLimit({ windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use((_req: unknown, res: any, next: () => void) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 4000), '0.0.0.0');
}
bootstrap().catch(error => { console.error(error.message); process.exit(1); });
