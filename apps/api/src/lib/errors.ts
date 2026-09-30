// ============================================================
// errors.ts — типизированные ошибки приложения
// AppError маппится в HTTP-ответ в error-handler.
// ============================================================

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const Errors = {
  unauthorized: (msg = 'Требуется авторизация') =>
    new AppError('UNAUTHORIZED', msg, 401),
  forbidden: (msg = 'Недостаточно прав') => new AppError('FORBIDDEN', msg, 403),
  notFound: (msg = 'Не найдено') => new AppError('NOT_FOUND', msg, 404),
  conflict: (msg = 'Конфликт') => new AppError('CONFLICT', msg, 409),
  validation: (msg = 'Ошибка валидации', details?: unknown) =>
    new AppError('VALIDATION_ERROR', msg, 422, details),
  tooMany: (msg = 'Слишком много запросов') =>
    new AppError('TOO_MANY_REQUESTS', msg, 429),
  internal: (msg = 'Внутренняя ошибка') => new AppError('INTERNAL', msg, 500),
};