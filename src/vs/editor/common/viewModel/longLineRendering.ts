// Политика редактора, а не примитив tuidom: движок порог не знает, редактор передаёт его параметром.

/**
 * Аналог `editor.stopRenderingLineAfter` VS Code (дефолт тот же), в code units. Отдельная
 * ручка от токенизационного `MAX_LINE_LENGTH`, как у upstream.
 */
export const STOP_RENDERING_LINE_AFTER = 10_000;

/** Ширина входит в `contentWidth` усечённой строки, иначе горизонтальный скролл до плашки не доведёт. Все символы шириной 1. */
export const LONG_LINE_TRUNCATION_BADGE = " Long line trimmed ";
export const LONG_LINE_TRUNCATION_BADGE_WIDTH = LONG_LINE_TRUNCATION_BADGE.length;
