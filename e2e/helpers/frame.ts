import type { GridSnapshot } from "@tuidom/all/rendering/gridSnapshot";

// Плоские представления захваченного кадра. Живут отдельным модулем, чтобы и
// сессия (предикаты по тексту), и диагностика (дамп при падении) брали их из
// одного места без циклического импорта.

/** Одна строка кадра по индексу (без обрезки). */
export function frameLine(frame: GridSnapshot, y: number): string {
    let line = "";
    for (let x = 0; x < frame.cols; x++) line += frame.cells[y * frame.cols + x].char;
    return line;
}

/** Кадр как текст, склеенный переводами строк (trailing-пробелы обрезаны). */
export function frameToText(frame: GridSnapshot): string {
    const lines: string[] = [];
    for (let y = 0; y < frame.rows; y++) lines.push(frameLine(frame, y).replace(/\s+$/u, ""));
    return lines.join("\n");
}

/** Дамп кадра с номерами строк — читаемый при падении теста. */
export function dumpFrame(frame: GridSnapshot): string {
    const lines: string[] = [];
    for (let y = 0; y < frame.rows; y++) lines.push(`${String(y).padStart(2, " ")}|${frameLine(frame, y)}`);
    return lines.join("\n");
}

/**
 * Ячейка первого вхождения `needle` в кадр (0-based x/y начала подстроки), или
 * `null`. Контентный локатор: кликаем по тексту, а не по магической координате.
 */
export function findTextCell(frame: GridSnapshot, needle: string): { x: number; y: number } | null {
    for (let y = 0; y < frame.rows; y++) {
        const x = frameLine(frame, y).indexOf(needle);
        if (x >= 0) return { x, y };
    }
    return null;
}
