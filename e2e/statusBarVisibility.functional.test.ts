import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { resolveUserDataPaths } from "../src/vs/platform/environment/node/userDataPaths.ts";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Настраиваемый состав статус-бара (как в VS Code): правый клик по полосе даёт
// переключатель с галочками, снятая галочка убирает сегмент, и выбор переживает
// рестарт — он глобальный, а не по-проектный.

const FILES = { "app.ts": 'export const a = "one";\n' };

/** Кликает по пункту открытого меню, найдя его текст в кадре. */
async function clickMenuItem(session: HeadlessApp["session"], label: string): Promise<void> {
    const frame = await session.waitForText((t) => t.includes(label));
    const lines = frameToText(frame).split("\n");
    const row = lines.findIndex((l) => l.includes(label));
    const col = lines[row].indexOf(label);
    await session.click(col + 1, row);
}

/** Правый клик по сегменту статус-бара — открывает переключатель видимости. */
async function openVisibilityMenu(session: HeadlessApp["session"], selector: string): Promise<void> {
    const segment = await session.waitForNode(selector);
    const x = segment.box.x + 1;
    const y = segment.box.y;
    await session.sendMouse({ action: "press", button: "right", x, y });
    await session.sendMouse({ action: "release", button: "right", x, y });
}

/** Ждёт, пока debounce StateService уронит скрытые id в globalState.json. */
async function waitForHiddenPersisted(root: string, entryId: string): Promise<void> {
    const paths = resolveUserDataPaths({ userDataDir: join(root, "user-data-dir"), homedir: homedir() });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        try {
            if (readFileSync(paths.globalStateFile, "utf-8").includes(entryId)) return;
        } catch {
            // файла ещё нет
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`"${entryId}" не доехал до ${paths.globalStateFile}`);
}

describe("Статус-бар: настраиваемый состав (functional e2e)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    it("переключатель снимает сегмент, и выбор переживает рестарт", async () => {
        const first = await useHeadlessApp({ files: FILES, open: ["app.ts"], keepRoot: true });
        const root = first.env.root;

        await first.session.waitForText((t) => t.includes("UTF-8"));
        await openVisibilityMenu(first.session, "#statusBarItem-status-editor-encoding");
        // Пункт под курсором — «Hide 'Editor Encoding'», как в VS Code.
        await clickMenuItem(first.session, "Hide 'Editor Encoding'");
        await first.session.waitForText((t) => !t.includes("UTF-8"));
        await waitForHiddenPersisted(root, "status.editor.encoding");
        await first.session.dispose(); // корень НЕ удаляем (keepRoot)

        // Рестарт на том же user-data-dir: сегмент так и скрыт.
        app = await useHeadlessApp({ root, open: ["app.ts"] });
        const frame = await app.session.waitForText((t) => t.includes("Ln 1, Col 1"), { timeoutMs: 30_000 });
        expect(frameToText(frame)).not.toContain("UTF-8");

        // И возвращается из того же меню — галочки у скрытой записи нет.
        await openVisibilityMenu(app.session, "#statusBarItem-status-editor-mode");
        await clickMenuItem(app.session, "Editor Encoding");
        await app.session.waitForText((t) => t.includes("UTF-8"));
    }, 180_000);
});
