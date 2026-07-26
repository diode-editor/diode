/**
 * Политика редактора для экстремально длинных строк и текст плашки обрезки.
 *
 * Живёт в editor-слое (а не в tuidom): это **политика/копирайт редактора**, не
 * общий примитив. tuidom-механизмы (`DisplayLine.stopAfter`, `measureTextWidth`)
 * порог не знают — редактор передаёт его параметром. См.
 * [docs/TODO/TuidomExtraction.md](../../../../../docs/TODO/TuidomExtraction.md).
 */

/**
 * Порог, после которого редактор перестаёт полноценно разбирать строку —
 * аналог `editor.stopRenderingLineAfter` в VS Code (там дефолт тоже 10 000).
 *
 * За порогом `DisplayLine` сегментирует только префикс, а измеритель ширины
 * (`measureTextWidth`) обрывает подсчёт. Это отдельная ручка от токенизационного
 * лимита (`MAX_LINE_LENGTH = 20 000`), ровно как в VS Code
 * `maxTokenizationLineLength` живёт независимо от `stopRenderingLineAfter`.
 *
 * Значение — в code units (JS string length), как и у upstream.
 */
export const STOP_RENDERING_LINE_AFTER = 10_000;

/**
 * Кнопка-плашка, рисуемая в конце усечённой строки (см. `EditorElement`), и её
 * ширина в колонках. Подписанная («Long line trimmed»), чтобы сразу читалось,
 * что строка урезана. Ширина учитывается в `contentWidth` усечённой строки, иначе
 * плашка встала бы ровно на `contentWidth` (эксклюзивный конец) и горизонтальный
 * скролл никогда не довёл бы до неё. Все символы шириной 1 → длина строки равна
 * ширине в колонках.
 */
export const LONG_LINE_TRUNCATION_BADGE = " Long line trimmed ";
export const LONG_LINE_TRUNCATION_BADGE_WIDTH = LONG_LINE_TRUNCATION_BADGE.length;
