import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
    ensureGopls,
    findGoBinary,
    GO_ID,
    GO_SESSION_ENV,
    GO_TOOLS_BIN,
    goSampleFiles,
    goToolchainMissing,
} from "../src/TestUtils/goFixture.ts";
import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Go от НАСТОЯЩЕГО стокового golang.go в SEA-бинаре: расширение ставится штатным
 * `--install-extension golang.go` из магазина (последняя опубликованная версия), клиент внутри расширения поднимает gopls по stdio. Ассерты
 * ждут текст, которого НЕТ в буфере (doc-комментарий из другого пакета,
 * отформатированная строка), а диск сверяется с буфером — контракт onSave.
 *
 * Настройки сохранения не задаются: formatOnSave и organize imports приезжают
 * из `configurationDefaults` `[go]` самого расширения — ровно как у человека.
 */

/** Squiggle рисуется undercurl'ом (StyleFlags.Undercurl === 8) на диапазоне ошибки. */
const UNDERCURL = 8;

const skipReason = goToolchainMissing();
if (skipReason !== undefined) console.warn(skipReason);

/** Кэши Go хоста: в изолированном HOME они пустые, и сборка gopls шла бы с нуля по сети. */
function hostGoCaches(): Record<string, string> {
    const go = findGoBinary();
    if (go === undefined) return { ...GO_SESSION_ENV };
    const [modCache = "", buildCache = ""] = execFileSync(go, ["env", "GOMODCACHE", "GOCACHE"], { encoding: "utf-8" })
        .trim()
        .split("\n");
    return { ...GO_SESSION_ENV, GOMODCACHE: modCache, GOCACHE: buildCache };
}

async function waitForGopls(session: { captureFrame: () => Promise<{ cells: { style: number }[] }> }, timeoutMs: number) {
    await waitUntil(
        () => session.captureFrame(),
        (frame) => frame.cells.some((cell) => (cell.style & UNDERCURL) !== 0),
        { describe: "undercurl squiggle от gopls", timeoutMs, intervalMs: 500 },
    );
}

// Extension-host subprocess + спавн сервера — Linux-only, как pythonLsp/eslintLsp
// (см. docs/TODO/E2E.md); без сети и без Go toolchain сьют пропускается.
describe.skipIf(
    process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE || skipReason !== undefined,
)("SEA binary — стоковый golang.go (gopls)", () => {
    let caches: Record<string, string>;

    beforeAll(async () => {
        await getBinaryPath();
        ensureGopls();
        caches = hostGoCaches();
    }, 900_000);

    it("hover с doc-комментарием из другого пакета и F12 в него", { timeout: 300_000 }, async () => {
        const { session } = await useHeadlessApp({
            files: goSampleFiles(),
            installVsix: [GO_ID],
            open: ["main.go"],
            env: { ...caches, GOBIN: GO_TOOLS_BIN },
        });
        await session.waitForNode("EditorElement");
        await waitForGopls(session, 180_000);

        // Каретка на `Hello` в `greet.Hello("world")` (строка 10, символ 15; таб — один символ).
        for (let i = 0; i < 10; i++) await session.key("ArrowDown");
        for (let i = 0; i < 15; i++) await session.key("ArrowRight");
        await session.key("Ctrl+K");
        await session.key("Ctrl+U");
        await session.waitForText((text) => text.includes("Hello returns a greeting"), {
            timeoutMs: 60_000,
            intervalMs: 500,
        });

        await session.key("Escape");
        await session.key("F12");
        await session.waitForText((text) => text.includes('return "Hello, " + strings.ToUpper(name)'), {
            timeoutMs: 60_000,
            intervalMs: 500,
        });
    });

    it("Ctrl+S: organize imports и gofmt из configurationDefaults [go] — в буфере и на диске", { timeout: 300_000 }, async () => {
        const app = await useHeadlessApp({
            files: goSampleFiles(),
            installVsix: [GO_ID],
            open: ["main.go"],
            env: { ...caches, GOBIN: GO_TOOLS_BIN },
        });
        const { session } = app;
        await session.waitForNode("EditorElement");
        await waitForGopls(session, 180_000);
        expect(frameToText(await session.captureFrame())).toContain("fmt.Println( msg,broken )");

        await session.key("Ctrl+S");
        await session.waitForText((text) => text.includes("fmt.Println(msg, broken)") && !text.includes('"os"'), {
            timeoutMs: 60_000,
            intervalMs: 500,
        });
        const onDisk = readFileSync(join(app.env.workspaceDir, "main.go"), "utf-8");
        expect(onDisk).toContain("fmt.Println(msg, broken)");
        expect(onDisk).not.toContain('"os"');
    });

    // Путь человека без gopls: расширение само зовёт `go install gopls@latest` в
    // GOBIN и поднимает свежесобранный сервер. Один тест на весь путь — сборка
    // gopls дорогая даже с кэшами модулей и сборки хоста.
    it("без gopls расширение ставит его само и поднимает сервер", { timeout: 900_000 }, async () => {
        const gobin = mkdtempSync(join(tmpdir(), "diode-go-gobin-"));
        try {
            const { session } = await useHeadlessApp({
                files: goSampleFiles(),
                installVsix: [GO_ID],
                open: ["main.go"],
                env: { ...caches, GOBIN: gobin },
            });
            await session.waitForNode("EditorElement");
            await waitForGopls(session, 840_000);
            expect(existsSync(join(gobin, "gopls"))).toBe(true);
        } finally {
            rmSync(gobin, { recursive: true, force: true });
        }
    });
});
