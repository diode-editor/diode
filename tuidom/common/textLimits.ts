/**
 * Порог, после которого редактор перестаёт полноценно разбирать строку —
 * аналог `editor.stopRenderingLineAfter` в VS Code (там дефолт тоже 10 000).
 *
 * За порогом `DisplayLine` сегментирует только префикс, а измеритель ширины
 * ({@link measureTextWidth}) обрывает подсчёт. Это отдельная ручка от
 * токенизационного лимита (`MAX_LINE_LENGTH = 20 000`), ровно как в VS Code
 * `maxTokenizationLineLength` живёт независимо от `stopRenderingLineAfter`.
 *
 * Значение — в code units (JS string length), как и у upstream.
 */
export const STOP_RENDERING_LINE_AFTER = 10_000;
