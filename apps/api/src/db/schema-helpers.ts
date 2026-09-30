// ============================================================
// schema-helpers.ts — вспомогательные типы для payload вопросов
// Используется в валидаторах и на фронтенде для типизации.
// ============================================================

export interface QuestionOption {
  id: string;
  text: string;
  imageUrl?: string;
}

export interface MatchingPair {
  left: string;
  right: string;
}

export interface QuestionPayloadNumber {
  correct: number;
  tolerance?: number;
  unit?: string;
}

export interface QuestionPayloadText {
  correct: string[];
  caseSensitive?: boolean;
  regex?: string;
}

export interface QuestionPayloadSingle {
  options: QuestionOption[];
  correct: string;
}

export interface QuestionPayloadMulti {
  options: QuestionOption[];
  correct: string[];
  partialCredit?: boolean;
}

export interface QuestionPayloadMatching {
  left: string[];
  right: string[];
  correct: Record<string, string>;
}

export interface QuestionPayloadOrdering {
  items: string[];
  correct: number[];
}

export interface QuestionPayloadFormula {
  correct: string;
  variables?: string[];
}

export type QuestionPayload =
  | QuestionPayloadNumber
  | QuestionPayloadText
  | QuestionPayloadSingle
  | QuestionPayloadMulti
  | QuestionPayloadMatching
  | QuestionPayloadOrdering
  | QuestionPayloadFormula;