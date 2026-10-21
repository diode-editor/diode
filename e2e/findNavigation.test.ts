import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import type { HeadlessSession } from "./helpers/headlessSession.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// F3 works with the widget closed too — as in VS Code, where "Find Next" depends on
// editor focus (`EditorContextKeys.focus`), not on widget visibility.

const files = { "notes.txt": "alpha\nbeta\nalpha\ngamma\nalpha\n" };

async function cursor(session: HeadlessSession): Promise<string> {
    const text = frameToText(await session.captureFrame());
    const m = /Ln (\d+), Col (\d+)/u.exec(text);
    expect(m, `в кадре нет позиции курсора:\n${text}`).not.toBeNull();
    return `${m![1]}:${m![2]}`;
}

describe("Find: навигация по совпадениям", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("F3 ищет дальше после закрытия виджета", async () => {
        const { session } = await useHeadlessApp({ files, open: ["notes.txt"], cols: 100, rows: 24 });
        await session.waitForText((t) => t.includes("gamma"));
        expect(await cursor(session)).toBe("1:1");

        // The usual path: Ctrl+F, query, Escape. Escape leaves the cursor on the current
        // match — the first "alpha" (line 1).
        await session.key("Ctrl+F");
        await session.text("alpha");
        await session.key("Escape");
        expect(await cursor(session)).toBe("1:6");

        // The widget is closed — F3 still steps through the last query.
        await session.key("F3");
        await session.waitForText((t) => /Ln 3, Col 6/u.test(t));
        expect(await cursor(session)).toBe("3:6");

        await session.key("F3");
        await session.waitForText((t) => /Ln 5, Col 6/u.test(t));

        // Shift+F3 goes back.
        await session.key("Shift+F3");
        await session.waitForText((t) => /Ln 3, Col 6/u.test(t));
    }, 120_000);

    // Ctrl+Backspace arrives only in CSI-u form: the legacy byte 0x08 is indistinguishable from
    // Ctrl+H, so the binding itself is behind a tier gate, and the path that works everywhere is
    // Alt+Backspace (`ESC 0x7f`). The e2e environment is pinned to tier=legacy.
    it("Alt+Backspace стирает слово в поле поиска", async () => {
        const { session } = await useHeadlessApp({ files, open: ["notes.txt"], cols: 100, rows: 24 });
        await session.waitForText((t) => t.includes("gamma"));

        await session.key("Ctrl+F");
        await session.text("alpha beta");
        await session.waitForText((t) => t.includes("alpha beta"));

        await session.key("Alt+Backspace");
        await session.waitForText((t) => t.includes("alpha ") && !t.includes("alpha beta"));
    }, 120_000);

    it("F3 без запроса берёт выделенное слово", async () => {
        const { session } = await useHeadlessApp({ files, open: ["notes.txt"], cols: 100, rows: 24 });
        await session.waitForText((t) => t.includes("gamma"));

        // Select "alpha" on the first line and search for it without opening the widget.
        for (let i = 0; i < 5; i++) await session.key("Shift+ArrowRight");
        await session.key("F3");

        await session.waitForText((t) => /Ln 3, Col 6/u.test(t));
    }, 120_000);
});
