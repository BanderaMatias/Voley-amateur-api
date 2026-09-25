import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) throw new BadRequestException(result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}
const text = (max = 200) => z.string().trim().min(1).max(max);
export const teamSchema = z.object({ name: text(80), description: z.string().max(2000).default(''), zone: z.string().max(100).default('') }).strict();
export const profileSchema = z.object({ name: text(100), bio: z.string().max(1000), zone: z.string().max(100), position: z.string().max(80), level: z.string().max(80), availability: z.string().max(200), height: z.number().int().min(100).max(250).nullable(), reach: z.number().int().min(100).max(450).nullable(), skillLevel: z.number().int().min(1).max(5).default(3), lookingForTeam: z.boolean(), recruitmentAlerts: z.boolean() }).strict();
export const tournamentSchema = z.object({ name: text(100), season: text(80), provider: z.enum(['MANUAL', 'PODIO']) }).strict();
export const matchSchema = z.object({ title: text(160), startsAt: z.string().datetime({ offset: true }), address: text(300), priceCents: z.number().int().min(0).max(100000000).nullable(), capacity: z.number().int().min(2).max(100), durationMinutes: z.number().int().min(15).max(360).default(90), paymentAlias: z.string().trim().max(100).default(''), type: z.enum(['RECREATIONAL', 'FRIENDLY', 'TOURNAMENT']), visibility: z.enum(['PUBLIC', 'PRIVATE']), teamId: text().optional(), tournamentId: text().optional(), opponent: z.string().max(100).optional() }).strict();
export const recruitmentSchema = z.object({ title: text(120), description: text(2000), position: text(80), level: text(80) }).strict();
export const ratingSchema = z.object({ attack: z.number().int().min(1).max(5), reception: z.number().int().min(1).max(5), defense: z.number().int().min(1).max(5), jump: z.number().int().min(1).max(5) }).strict();
export { z };
