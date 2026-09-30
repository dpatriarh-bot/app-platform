// ============================================================
// subjects/schemas.ts — Zod-схемы дисциплин
// + фильтр по классу.
// ============================================================

import { z } from 'zod';

const slugRegex = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const createSubjectSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(slugRegex, 'Только латиница, цифры и дефис'),
  title: z.string().min(2).max(128),
  description: z.string().max(2000).optional().or(z.literal('')),
  icon: z.string().max(64).optional().or(z.literal('')),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Цвет в формате #RRGGBB')
    .optional()
    .or(z.literal('')),
  grades: z
    .array(z.coerce.number().int().min(1).max(11))
    .max(11)
    .optional()
    .default([]),
  gradeMin: z.coerce.number().int().min(1).max(11).optional(),
  gradeMax: z.coerce.number().int().min(1).max(11).optional(),
  ageMin: z.coerce.number().int().min(3).max(20).optional(),
  ageMax: z.coerce.number().int().min(3).max(20).optional(),
  orderIndex: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const updateSubjectSchema = createSubjectSchema.partial();

export const listSubjectsQuerySchema = z.object({
  q: z.string().max(128).optional(),
  active: z.enum(['0', '1']).optional(),
  forChildId: z.string().uuid().optional(),
  /** Фильтр «только дисциплины, изучаемые в этом классе» */
  grade: z.coerce.number().int().min(1).max(11).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const subjectsByGradeQuerySchema = z.object({
  active: z.enum(['0', '1']).optional(),
});

export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;
export type ListSubjectsQuery = z.infer<typeof listSubjectsQuerySchema>;