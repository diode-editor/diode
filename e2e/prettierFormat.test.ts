import { beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { MESSY_JSON, MESSY_MD, PRETTIER_ID } from "../src/TestUtils/prettierFixture.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * Сьют же — гейт загрузки ESM-расширений на собранном бинаре: prettier с 12.x —
 * `"type": "module"`, и под SEA прямой `import()` из вшитого main перехватывается
 * embedder-хуком. Юнитом это не проверить.
 */

// Только Linux: extension host (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — стоковый prettier.vsix (формат markdown и json)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("markdown: Ctrl+K Ctrl+E приводит заголовок и список к формату prettier", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: { "doc.md": MESSY_MD },
                installVsix: [PRETTIER_ID],
                open: ["doc.md"],
            });
            await session.waitForNode("EditorElement");
            // Статус-бар prettier появляется в конце activate() — это и есть
            // readiness: провайдеры к этому моменту уже зарегистрированы.
            await session.waitForText((text) => text.includes("Prettier"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });

            const before = frameToText(await session.captureFrame());
            expect(before).toContain("#   Hello");
            expect(before).toContain("*  item one");

            await session.key("Ctrl+K");
            await session.key("Ctrl+E");

            await session.waitForText((text) => text.includes("- item one") && text.includes("- item two"), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
            const after = frameToText(await session.captureFrame());
            expect(after).toContain("# Hello");
            expect(after).not.toContain("#   Hello");
        });

        it("json: Ctrl+K Ctrl+E расставляет пробелы по prettier", { timeout: 300_000 }, async () => {
            const { session } = await useHeadlessApp({
                files: { "data.json": MESSY_JSON },
                installVsix: [PRETTIER_ID],
                open: ["data.json"],
            });
            await session.waitForNode("EditorElement");
            await session.waitForText((text) => text.includes("Prettier"), {
                timeoutMs: 120_000,
                intervalMs: 500,
            });

            expect(frameToText(await session.captureFrame())).toContain('{"a":1,');

            await session.key("Ctrl+K");
            await session.key("Ctrl+E");

            await session.waitForText((text) => text.includes('{ "a": 1, "b": [1, 2, 3] }'), {
                timeoutMs: 60_000,
                intervalMs: 500,
            });
        });
    },
);
