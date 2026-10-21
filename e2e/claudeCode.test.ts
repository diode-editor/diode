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
 * The stock Anthropic.claude-code extension in the SEA binary. The real CLI isn't
 * launched (subscription, network): instead, an ide-server probe client (`IdeProbe`)
 * and a fake `claude` on PATH — exactly what the CLI uses to find the IDE.
 * Cases run sequentially in one session (the 130 MB extension is installed once
 * per suite): context — while focus is in the editor, terminals — at the end.
 */

const MAIN_TS = 'const reply: number = "hi";\nexport { reply };\n';
const PROPOSED_TS = 'const reply: string = "hello";\nexport { reply };\n';
const CHECK = "\u{eab2}";
const DISCARD = "\u{eae2}";

// Linux only: extension host + a fake `claude` in sh (docs/TODO/E2E.md).
describe.skipIf(process.platform === "win32" || process.platform === "darwin" || MARKETPLACE_OFFLINE)(
    "SEA binary — stock Anthropic.claude-code (terminal mode)",
    () => {
        let app: HeadlessApp;
        let lock: IIdeLock;
        let mainFile: string;

        beforeAll(async () => {
            await getBinaryPath();
            app = await startHeadlessApp({
                files: { "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }), "main.ts": MAIN_TS },
                installVsix: [CLAUDE_CODE_ID],
                // A workspace folder and a file in it — like a project where `claude` is run.
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
            "activation: '✻ Claude Code' item, IDE server lock with ideName Diode, MCP initialize",
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
                // The extension builds the server name from `env.appName`.
                expect(serverInfo.name).toBe("Claude Code Diode MCP");
            },
        );

        it(
            "context: selection is sent as selection_changed, Ctrl+Alt+K as at_mentioned with lines",
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

        it("getDiagnostics returns the TypeScript error the editor shows", { timeout: 120_000 }, async () => {
            const { probe } = await IdeProbe.connect(lock);
            try {
                const result = await waitUntil(
                    () => probe.callTool("getDiagnostics", { uri: pathToFileURL(mainFile).href }),
                    (r) => r.text.includes("Type 'string' is not assignable to type 'number'."),
                    {
                        describe: "TS error in getDiagnostics",
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
            "openDiff: diff tab with ✓/↺; edit + Ctrl+S — FILE_SAVED with the edited text, Ctrl+W — DIFF_REJECTED",
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
                // The ✓/↺ buttons are keyed by `claude-code.viewingProposedDiff`, computed from the visible side.
                const waitForDiffTab = (title: string): Promise<unknown> =>
                    app.session.waitForText((t) => t.includes(title) && t.includes(CHECK) && t.includes(DISCARD), {
                        timeoutMs: 30_000,
                    });
                try {
                    // Editing the right side right in the diff and Ctrl+S — acceptance with the user's edits.
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
                    // The CLI closes the tab itself: saving the side + tabGroups.close, no dialog.
                    expect(
                        (await probe.callTool("close_tab", { tab_name: "[Claude Code] main.ts (save) ⧉" })).text,
                    ).toBe("TAB_CLOSED");
                    await app.session.waitForText((t) => !t.includes("main.ts (save)") && !t.includes(CHECK));

                    // Closing the tab is a rejection; the buttons go away together with the key.
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
            "clicking '✻ Claude Code' opens claude as a tab on the right, the CLI sees the port and lock",
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
                // The tab is in the group to the right of the file: main.ts is further left in the tab row.
                const tabs = text.split("\n").find((line) => line.includes("Claude Code ×"));
                expect(tabs?.indexOf("main.ts ×")).toBeGreaterThanOrEqual(0);
                expect(tabs?.indexOf("main.ts ×")).toBeLessThan(tabs?.indexOf("Claude Code ×") ?? 0);
            },
        );

        it(
            "CLAUDE_CODE_SSE_PORT is also in the panel terminal environment (claude typed by hand)",
            { timeout: 60_000 },
            async () => {
                await app.session.executeCommand("workbench.action.terminal.new");
                await app.session.waitForText((t) => t.includes("TERMINAL"), { timeoutMs: 15_000 });
                // Typing before the prompt isn't lost: the pty buffers it, the shell reads it once it starts.
                await app.session.sendText('echo "sse=$CLAUDE_CODE_SSE_PORT"\r');
                await app.session.waitForText((t) => t.includes(`sse=${String(lock.port)}`), { timeoutMs: 15_000 });
            },
        );
    },
);
