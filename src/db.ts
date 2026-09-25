import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
@Injectable()
export class Db extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
  async serial<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15000 }); }
      catch (e) { if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2034' || attempt >= 3) throw e; }
    }
  }
}
