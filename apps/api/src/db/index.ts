// ============================================================
// index.ts — barrel для модуля db
// ============================================================

export * from './schema.js';
export * from './schema-helpers.js';
export { db, pingDatabase, closeDatabase, type DB } from './client.js';