import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MARKETPLACE_OFFLINE } from "../src/TestUtils/marketplaceEnv.ts";
import { type HeadlessApp, startHeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import {
    CLAUDE_CODE_ID,
    claudeCodeSessionEnv,
    IdeProbe,
    type IIdeLock,
    type IToolResult,
    waitForIdeLock,
} from "./helpers/claudeIde.ts";
import { findTextCell, frameToText } from "./helpers/frame.ts";
import { waitUntil } from "./helpers/waitFor.ts";

/**
 * Стоковый Anthropic.claude-code из магазина в SEA-бинаре. Настоящий CLI не
 * запускается (подписка, сеть): вместо него пробный клиент ide-сервера (`IdeProbe`)
 * и подставной `claude` в PATH — ровно то, по чему CLI находит IDE.
 * Кейсы идут по одной сессии последовательно (расширение 130 МБ ставится раз
 * на сьют): контекст — пока фокус в редакторе, терминалы — в конце.
 */

const MAIN_TS = 'const reply: number = "hi";\nexport { reply };\n';
const PROPOSED_TS = 'const reply: string = "hello";\nexport { reply };\n';
const CHECK = "\u{eab2}";
const DISCARD = "\u{eae2}";

// Только Linux: extension host + подставной `claude` на sh (docs/TODO/E2E.md).
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
            "openDiff: дифф-вкладка с ✓/↺; правка + Ctrl+S — FILE_SAVED с правленым текстом, Ctrl+W — DIFF_REJECTED",
            { timeout: 120_000 },
            async () => {
                const { probe } = await IdeProbe.connect(lock);
                const proposeDiff = (tabName: string): Promise<IToolResult> =>
                    probe.callTool("openDiff", {
                        old_file_path: mainFile,
                        new_file_path: mainFile,
                        new_file_contents: PROPOSED_TS,
                        tab_name: tabName,
                    });
                // Кнопки ✓/↺ — по ключу `claude-code.viewingProposedDiff`, он считается по видимой стороне.
                const waitForDiffTab = (title: string): Promise<unknown> =>
                    app.session.waitForText((t) => t.includes(title) && t.includes(CHECK) && t.includes(DISCARD), {
                        timeoutMs: 30_000,
                    });
                try {
                    // Правка правой стороны прямо в диффе и Ctrl+S — принятие с правками человека.
                    const saved = proposeDiff("[Claude Code] main.ts (save) ⧉");
                    const frame = await waitForDiffTab("main.ts (save)");
                    const right = findTextCell(frame, '"hello"');
                    expect(right).not.toBeNull();
                    await app.session.click(right?.x ?? 0, right?.y ?? 0);
                    await app.session.key("End");
                    await app.session.sendText(" // ok");
                    await app.session.key("Ctrl+S");
                    expect(await saved).toEqual({
                        isError: false,
                        text: `FILE_SAVED${PROPOSED_TS.replace('"hello";', '"hello"; // ok')}`,
                    });
                    // CLI закрывает вкладку сам: сохранение стороны + tabGroups.close, без диалога.
                    expect(
                        (await probe.callTool("close_tab", { tab_name: "[Claude Code] main.ts (save) ⧉" })).text,
                    ).toBe("TAB_CLOSED");
                    await app.session.waitForText((t) => !t.includes("main.ts (save)") && !t.includes(CHECK));

                    // Закрытие вкладки — отклонение; кнопки уходят вместе с ключом.
                    const closed = proposeDiff("[Claude Code] main.ts (close) ⧉");
                    await waitForDiffTab("main.ts (close)");
                    await app.session.key("Ctrl+W");
                    expect(await closed).toEqual({
                        isError: false,
                        text: "DIFF_REJECTED[Claude Code] main.ts (close) ⧉",
                    });
                    await app.session.waitForText((t) => !t.includes("main.ts (close)") && !t.includes(CHECK));
                } finally {
                    probe.close();
                }
            },
        );

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
