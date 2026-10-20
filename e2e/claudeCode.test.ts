import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { type HeadlessApp, startHeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { CLAUDE_CODE_ID, claudeCodeSessionEnv, IdeProbe, type IIdeLock, waitForIdeLock } from "./helpers/claudeIde.ts";
import { findTextCell, frameToText } from "./helpers/frame.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * НАСТОЯЩИЙ стоковый Anthropic.claude-code в SEA-бинаре, поставленный штатным
 * `--install-extension Anthropic.claude-code` из магазина (последняя
 * опубликованная версия, платформенный vsix). Терминальный режим
 * (`claudeCode.useTerminal` — курируемая инъекция): расширение поднимает
 * ide-сервер, к которому подключается `claude`.
 *
 * Настоящий CLI не запускается (подписка, сеть). Вместо него — пробный клиент
 * ide-сервера (`IdeProbe`: порт и токен из лока, MCP `initialize`) и подставной
 * `claude` в PATH, который печатает порт из окружения и `ideName` из лока, —
 * ровно то, по чему CLI находит IDE.
 *
 * Расширение ставится один раз на сьют (130 МБ), кейсы идут по одной сессии
 * последовательно: контекст — пока фокус в редакторе, терминалы — в конце.
 */

const MAIN_TS = 'const reply: number = "hi";\nexport { reply };\n';

// Extension-host subprocess + подставной `claude` на sh — Linux, как goLsp/eslintLsp
// (docs/TODO/E2E.md); без сети (установка из магазина) сьют пропускается.
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — стоковый Anthropic.claude-code (терминальный режим)",
    () => {
        let app: HeadlessApp;
        let lock: IIdeLock;
        let mainFile: string;

        beforeAll(async () => {
            await getBinaryPath();
            app = await startHeadlessApp({
                files: { "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }), "main.ts": MAIN_TS },
                installVsix: [CLAUDE_CODE_ID],
                // Папкой воркспейса и файлом в ней — как проект, где запускают `claude`.
                open: [".", "main.ts"],
                env: claudeCodeSessionEnv(),
                cols: 160,
                rows: 36,
            });
            mainFile = join(app.env.workspaceDir, "main.ts");
        }, 600_000);

        afterAll(async () => {
            await app.dispose();
        });

        it(
            "активация: пункт «✻ Claude Code», лок ide-сервера с ideName Diode, MCP initialize",
            { timeout: 120_000 },
            async () => {
                await app.session.waitForText((t) => t.includes("✻ Claude Code"), { timeoutMs: 60_000 });
                lock = await waitForIdeLock(app.env.home);
                expect(lock).toMatchObject({
                    ideName: "Diode",
                    transport: "ws",
                    workspaceFolders: [app.env.workspaceDir],
                });
                const { probe, serverInfo } = await IdeProbe.connect(lock);
                probe.close();
                // Имя сервера расширение собирает из `env.appName`.
                expect(serverInfo.name).toBe("Claude Code Diode MCP");
            },
        );

        it(
            "контекст: выделение уходит selection_changed, Ctrl+Alt+K — at_mentioned со строками",
            { timeout: 60_000 },
            async () => {
                const { probe } = await IdeProbe.connect(lock);
                try {
                    await app.session.key("Shift+End");
                    const selection = await probe.waitForNotification(
                        "selection_changed",
                        (p) => p.text === 'const reply: number = "hi";',
                    );
                    expect(selection).toMatchObject({ filePath: mainFile, fileUrl: pathToFileURL(mainFile).href });
                    await app.session.key("Ctrl+Alt+K");
                    const mention = await probe.waitForNotification("at_mentioned", () => true);
                    expect(mention).toEqual({ filePath: mainFile, lineStart: 0, lineEnd: 0 });
                } finally {
                    probe.close();
                }
            },
        );

        it("getDiagnostics отдаёт ошибку TypeScript, которую видит редактор", { timeout: 120_000 }, async () => {
            const { probe } = await IdeProbe.connect(lock);
            try {
                const result = await waitUntil(
                    () => probe.callTool("getDiagnostics", { uri: pathToFileURL(mainFile).href }),
                    (r) => r.text.includes("Type 'string' is not assignable to type 'number'."),
                    {
                        describe: "ошибка TS в getDiagnostics",
                        timeoutMs: 90_000,
                        intervalMs: 1000,
                        diagnose: (r) => JSON.stringify(r),
                    },
                );
                expect(result.isError).toBe(false);
                expect(JSON.parse(result.text)).toEqual([
                    expect.objectContaining({
                        uri: pathToFileURL(mainFile).href,
                        diagnostics: [
                            expect.objectContaining({ severity: "Error", source: "typescript", code: "2322" }),
                        ],
                    }),
                ]);
            } finally {
                probe.close();
            }
        });

        it(
            "клик по «✻ Claude Code» открывает claude вкладкой справа, CLI видит порт и лок",
            { timeout: 60_000 },
            async () => {
                const frame = await app.session.captureFrame();
                const item = findTextCell(frame, "✻ Claude Code");
                expect(item).not.toBeNull();
                await app.session.click((item?.x ?? 0) + 2, item?.y ?? 0);
                const text = frameToText(
                    await app.session.waitForText(
                        (t) => t.includes("Claude Code ×") && t.includes('fake-claude lock "ideName":"Diode"'),
                        { timeoutMs: 30_000 },
                    ),
                );
                expect(text).toContain(`fake-claude port=${String(lock.port)}`);
                // Вкладка — в группе справа от файла: в строке вкладок main.ts левее.
                const tabs = text.split("\n").find((line) => line.includes("Claude Code ×"));
                expect(tabs?.indexOf("main.ts ×")).toBeGreaterThanOrEqual(0);
                expect(tabs?.indexOf("main.ts ×")).toBeLessThan(tabs?.indexOf("Claude Code ×") ?? 0);
            },
        );

        it(
            "CLAUDE_CODE_SSE_PORT — в окружении и терминала панели (claude, набранный руками)",
            { timeout: 60_000 },
            async () => {
                await app.session.executeCommand("workbench.action.terminal.new");
                await app.session.waitForText((t) => t.includes("TERMINAL"), { timeoutMs: 15_000 });
                // Набор до промпта не теряется: pty буферизует, шелл прочтёт его, поднявшись.
                await app.session.sendText('echo "sse=$CLAUDE_CODE_SSE_PORT"\r');
                await app.session.waitForText((t) => t.includes(`sse=${String(lock.port)}`), { timeoutMs: 15_000 });
            },
        );
    },
);
