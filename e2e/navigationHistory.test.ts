import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Go Back / Go Forward в собранном бинаре: история помнит не вкладку, а место —
// после прыжка в другой файл Back возвращает каретку туда, откуда ушли.
// Команды повешены на alt+b / alt+n через keybindings.json: аккорд Ctrl+K Ctrl+B
// к делу отношения не имеет, а палитра увела бы фокус из редактора. Alt+F занят
// мнемоникой меню File — отсюда alt+n («next») вместо него.

const lines = (prefix: string): string => Array.from({ length: 40 }, (_, i) => `${prefix} line ${String(i)}`).join("\n");

/** «Ln N, Col M» из статус-бара. */
async function cursor(session: HeadlessSession): Promise<string> {
    const text = frameToText(await session.captureFrame());
    const m = /Ln (\d+), Col (\d+)/u.exec(text);
    expect(m, `в кадре нет позиции курсора:\n${text}`).not.toBeNull();
    return `${m![1]}:${m![2]}`;
}

describe("Навигационная история: Go Back / Go Forward", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("Back возвращает в место, откуда ушли, Forward — обратно", async () => {
        const { session } = await useHeadlessApp({
            files: { "alpha.ts": lines("alpha"), "beta.ts": lines("beta") },
            // Каталог воркспейса — чтобы Quick Open было где индексировать файлы.
            open: [".", "alpha.ts"],
            keybindings: [
                { key: "alt+b", command: "workbench.action.navigateBack" },
                { key: "alt+n", command: "workbench.action.navigateForward" },
            ],
            cols: 100,
            rows: 24,
        });
        await session.waitForText((t) => t.includes("alpha line 0"));

        // Значимое перемещение внутри файла — оно и станет точкой возврата.
        await session.key("Ctrl+End");
        await session.waitForText((t) => /Ln 40, Col 14/u.test(t));

        // Прыжок в другой файл через Quick Open.
        await session.key("Ctrl+P");
        await session.waitForText((t) => t.includes("Go to File"));
        await session.text("beta.ts");
        await session.waitForText((t) => t.includes("beta.ts"));
        await session.key("Enter");
        await session.waitForText((t) => t.includes("beta line 0"));
        expect(await cursor(session)).toBe("1:1");

        await session.key("Alt+B");
        await session.waitForText((t) => t.includes("alpha line 39"));
        expect(await cursor(session)).toBe("40:14");

        await session.key("Alt+N");
        await session.waitForText((t) => t.includes("beta line 0"));
        expect(await cursor(session)).toBe("1:1");

        // И ни один буфер не помечен изменённым: клавиша команды никуда не
        // протекла (проверка на регресс — голый символ в аккорде уезжал в
        // документ, который команда только что покинула).
        const strip = await session.node("EditorTabStripElement");
        const tabs = (strip?.state as { tabs?: { label: string; modified: boolean }[] } | undefined)?.tabs ?? [];
        expect(tabs).not.toHaveLength(0);
        expect(tabs.filter((tab) => tab.modified)).toEqual([]);
    }, 180_000);
});
