// ============================================================
// questions/schemas.ts — Zod-схемы для всех 7 типов вопросов
// Проверка payload в зависимости от type.
// + схемы для справочника типов (question_type_settings).
// ============================================================

import { z } from 'zod';

// -------- Полезные под-схемы --------

const optionSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(500),
  imageUrl: z.string().url().optional(),
});

const numberPayload = z.object({
  correct: z.number(),
  tolerance: z.number().min(0).optional().default(0),
  unit: z.string().max(16).optional(),
});

const textPayload = z.object({
  correct: z.array(z.string().min(1).max(500)).min(1),
  caseSensitive: z.boolean().optional().default(false),
  regex: z.string().max(500).optional(),
});

const singleChoicePayload = z.object({
  options: z.array(optionSchema).min(2).max(10),
  correct: z.string().min(1),
}).refine(
  (d) => d.options.some((o) => o.id === d.correct),
  { message: 'Правильный ответ должен быть среди вариантов', path: ['correct'] }
);

const multiChoicePayload = z.object({
  options: z.array(optionSchema).min(2).max(10),
  correct: z.array(z.string().min(1)).min(1),
  partialCredit: z.boolean().optional().default(false),
}).refine(
  (d) => d.correct.every((id) => d.options.some((o) => o.id === id)),
  { message: 'Все правильные ответы должны быть среди вариантов', path: ['correct'] }
);

const matchingPayload = z.object({
  left: z.array(z.string().min(1).max(500)).min(2).max(8),
  right: z.array(z.string().min(1).max(500)).min(2).max(8),
  correct: z.record(z.string(), z.string()),
});

const orderingPayload = z.object({
  items: z.array(z.string().min(1).max(500)).min(2).max(10),
  correct: z.array(z.number().int().min(0)).min(2),
}).refine(
  (d) => d.correct.length === d.items.length,
  { message: 'Количество элементов в correct должно совпадать с items', path: ['correct'] }
);

const formulaPayload = z.object({
  correct: z.string().min(1).max(500),
  variables: z.array(z.string().min(1).max(32)).optional(),
});

// -------- Основная схема --------

export const questionTypeSchema = z.enum([
  'input_number',
  'input_text',
  'single_choice',
  'multi_choice',
  'matching',
  'ordering',
  'formula',
]);

export const createQuestionSchema = z
  .object({
    subjectId: z.string().uuid(),
    type: questionTypeSchema,
    text: z.string().min(3).max(5000),
    imageUrl: z.string().url().optional().or(z.literal('')),
    explanation: z.string().max(5000).optional().or(z.literal('')),
    difficulty: z.coerce.number().int().min(1).max(5).optional().default(2),
    tags: z.array(z.string().min(1).max(32)).max(20).optional().default([]),
    payload: z.unknown(),
  })
  .superRefine((data, ctx) => {
    const parsed = validatePayload(data.type, data.payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: 'custom',
          path: ['payload', ...issue.path],
          message: issue.message,
        });
      }
    }
  });

export const updateQuestionSchema = z
  .object({
    type: questionTypeSchema.optional(),
    text: z.string().min(3).max(5000).optional(),
    imageUrl: z.string().url().optional().or(z.literal('')),
    explanation: z.string().max(5000).optional().or(z.literal('')),
    difficulty: z.coerce.number().int().min(1).max(5).optional(),
    tags: z.array(z.string().min(1).max(32)).max(20).optional(),
    payload: z.unknown().optional(),
    isActive: z.boolean().optional(),
  });

export const listQuestionsQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  type: questionTypeSchema.optional(),
  q: z.string().max(200).optional(),
  tag: z.string().max(32).optional(),
  active: z.enum(['0', '1']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// -------- Схемы для справочника типов --------

export const updateQuestionTypeSettingSchema = z.object({
  title: z.string().min(2).max(128).optional(),
  description: z.string().max(2000).optional().or(z.literal('')),
  icon: z.string().max(64).optional().or(z.literal('')),
  isEnabled: z.boolean().optional(),
  defaultPoints: z.coerce.number().int().min(0).max(100).optional(),
  minOptions: z.coerce.number().int().min(0).max(50).nullable().optional(),
  maxOptions: z.coerce.number().int().min(1).max(50).nullable().optional(),
  requiresImage: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
  allowedRoles: z.array(z.enum(['manager', 'curator', 'admin', 'superadmin'])).optional(),
});

export const reorderQuestionTypesSchema = z.object({
  items: z.array(z.object({
    type: questionTypeSchema,
    sortOrder: z.coerce.number().int().min(0),
  })).min(1).max(50),
});

export type QuestionTypeSettingUpdate = z.infer<typeof updateQuestionTypeSettingSchema>;

// -------- Валидатор payload --------

export function validatePayload(
  type: z.infer<typeof questionTypeSchema>,
  payload: unknown
): z.SafeParseReturnType<unknown, unknown> {
  switch (type) {
    case 'input_number':
      return numberPayload.safeParse(payload);
    case 'input_text':
      return textPayload.safeParse(payload);
    case 'single_choice':
      return singleChoicePayload.safeParse(payload);
    case 'multi_choice':
      return multiChoicePayload.safeParse(payload);
    case 'matching':
      return matchingPayload.safeParse(payload);
    case 'ordering':
      return orderingPayload.safeParse(payload);
    case 'formula':
      return formulaPayload.safeParse(payload);
  }
}

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;
export type QuestionType = z.infer<typeof questionTypeSchema>;