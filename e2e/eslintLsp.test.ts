import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
    ensureEslintLibrary,
    ESLINT_FLAT_CONFIG,
    ESLINT_ID,
    LINT_JS,
    linkEslintLibrary,
} from "../src/TestUtils/eslintFixture.ts";
import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { waitForEslintDiagnostics } from "./helpers/eslintReady.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * JS-линт и fix-on-save от НАСТОЯЩЕГО стокового vscode-eslint в SEA-бинаре:
 * расширение ставится ИЗ МАГАЗИНА штатным `--install-extension <id>`,
 * библиотека eslint приезжает в воркспейс фикстурой (расширение её не бандлит).
 * Ассерты ждут текст, которого НЕТ в буфере (грабля «слабый ассерт» из
 * docs/TODO/Suggest.md), а диск сверяется с буфером — контракт onSave.
 */

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

// Extension-host subprocess + спавн сервера — Linux-only, как pythonLsp
// (см. docs/TODO/E2E.md); без сети сьют пропускается.
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — стоковый vscode-eslint.vsix (JS-линт, fix on save)",
    () => {
        beforeAll(async () => {
            await getBinaryPath();
        }, 300_000);

        it("Ctrl+S с codeActionsOnSave чинит no-extra-semi в буфере и на диске", { timeout: 300_000 }, async () => {
            // Воркспейс с библиотекой eslint — коммитнутой фикстурой быть не
            // может (node_modules) и сохраняется, поэтому temp-каталог.
            const sampleDir = mkdtempSync(join(tmpdir(), "diode-eslint-e2e-"));
            const lintFile = join(sampleDir, "lint.js");
            writeFileSync(join(sampleDir, "eslint.config.mjs"), ESLINT_FLAT_CONFIG);
            writeFileSync(lintFile, LINT_JS);
            linkEslintLibrary(sampleDir, ensureEslintLibrary());

            const { session } = await useHeadlessApp({
                open: [sampleDir, lintFile],
                installVsix: [ESLINT_ID],
                settings: { "editor.codeActionsOnSave": { "source.fixAll": true } },
            });
            await session.waitForNode("EditorElement");

            // Дождаться диагностик именно eslint (undercurl — ложный сигнал:
            // builtin TS-клиент линтит .js тоже, см. helpers/eslintReady.ts);
            // после этого save не упрётся в холодный старт сервера.
            await waitForEslintDiagnostics({
                key: (name) => session.sendKey(name),
                text: (value) => session.sendText(value),
                waitForText: (predicate, opts) => session.waitForText(predicate, opts),
            });
            await waitUntil(
                () => session.captureFrame(),
                (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
                { describe: "undercurl squiggle от eslint", timeoutMs: 30_000, intervalMs: 500 },
            );
            expect(frameToText(await session.captureFrame())).toContain("const unused = 1;;");

            // Один Ctrl+S: source.fixAll.eslint убирает лишнюю `;` ДО записи.
            await session.key("Ctrl+S");
            await session.waitForText((text) => !text.includes(";;"), { timeoutMs: 60_000, intervalMs: 500 });

            // На диск ушёл уже поправленный текст; неавтофиксный no-unused-vars остался в буфере.
            expect(readFileSync(lintFile, "utf-8")).toBe("const unused = 1;\n");
        });
    },
);
