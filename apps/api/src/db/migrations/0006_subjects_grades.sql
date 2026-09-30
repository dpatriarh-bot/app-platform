-- ============================================================
-- 0006_subjects_grades.sql
-- Добавляем в subjects массив классов 1..11,
-- в которых изучается дисциплина.
-- Пример: математика = {1,2,3,4,5,6},
-- алгебра = {7,8,9,10,11}.
-- ============================================================

ALTER TABLE "subjects"
  ADD COLUMN IF NOT EXISTS "grades" smallint[] NOT NULL DEFAULT '{}'::smallint[];
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "subjects_grades_gin"
  ON "subjects" USING GIN ("grades");
--> statement-breakpoint

COMMENT ON COLUMN "subjects"."grades" IS
  'Классы 1..11, в которых изучается дисциплина. Пустой массив = без ограничений.';