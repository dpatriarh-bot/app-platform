// ============================================================
// tests/schemas.ts — Zod-схемы тестов
// ============================================================

import { z } from 'zod';

export const testStatusSchema = z.enum(['draft', 'review', 'published', 'archived']);

export const createTestSchema = z.object({
  subjectId: z.string().uuid(),
  title: z.string().min(3).max(255),
  description: z.string().max(5000).optional().or(z.literal('')),
  timeLimitSec: z.coerce.number().int().min(30).max(7200).optional().default(600),
  gradeMin: z.coerce.number().int().min(1).max(11).optional(),
  gradeMax: z.coerce.number().int().min(1).max(11).optional(),
  ageMin: z.coerce.number().int().min(3).max(20).optional(),
  ageMax: z.coerce.number().int().min(3).max(20).optional(),
  pointsFixed: z.coerce.number().int().min(0).max(1000).optional().default(10),
  pointsPerCorrect: z.coerce.number().int().min(0).max(100).optional().default(2),
  pointsPenaltyWrong: z.coerce.number().int().min(0).max(100).optional().default(0),
  shuffleQuestions: z.boolean().optional().default(false),
  shuffleOptions: z.boolean().optional().default(false),
  allowRetake: z.boolean().optional().default(true),
  rewardOnRetake: z.boolean().optional().default(false),
});

export const updateTestSchema = createTestSchema.partial().omit({ subjectId: true });

export const publishTestSchema = z.object({
  status: testStatusSchema,
  comment: z.string().max(500).optional(),
});

export const testQuestionItemSchema = z.object({
  questionId: z.string().uuid(),
  orderIndex: z.coerce.number().int().min(0),
  pointsOverride: z.coerce.number().int().min(0).max(100).optional(),
});

export const setTestQuestionsSchema = z.object({
  items: z.array(testQuestionItemSchema).max(200),
});

export const importQuestionsSchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  subjectId: z.string().uuid(),
  data: z.string().min(1), // base64 или raw CSV
  dryRun: z.boolean().optional().default(false),
});

export const listTestsQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  status: testStatusSchema.optional(),
  q: z.string().max(200).optional(),
  gradeMin: z.coerce.number().int().min(1).max(11).optional(),
  gradeMax: z.coerce.number().int().min(1).max(11).optional(),
  forChildId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type CreateTestInput = z.infer<typeof createTestSchema>;
export type UpdateTestInput = z.infer<typeof updateTestSchema>;
export type ListTestsQuery = z.infer<typeof listTestsQuerySchema>;
export type SetTestQuestionsInput = z.infer<typeof setTestQuestionsSchema>;
export type ImportQuestionsInput = z.infer<typeof importQuestionsSchema>;