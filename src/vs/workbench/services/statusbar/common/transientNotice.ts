import type { StatusBarService } from "./statusBarService.ts";

/**
 * Короткое сообщение в статус-баре, снимающее себя само. Тостов в проекте нет,
 * а модальный диалог ради «получилось/не получилось» — перебор: сообщение
 * живёт слева в статус-баре несколько секунд и исчезает.
 */

/** Сколько держать сообщение на экране. */
export const TRANSIENT_NOTICE_MS = 4000;

export function showTransientNotice(statusBar: StatusBarService, id: string, text: string): void {
    const handle = statusBar.addEntry({ id, text, alignment: "left", priority: 100 });
    setTimeout(() => {
        handle.dispose();
    }, TRANSIENT_NOTICE_MS);
}
