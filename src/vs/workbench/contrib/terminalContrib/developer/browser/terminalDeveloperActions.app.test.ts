// The whole workbench with a real shell in a PTY: what the user sees and what lands on the clipboard.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../../TestUtils/TempWorkspace.ts";
import { ClipboardDIToken } from "../../../../../platform/clipboard/common/iClipboard.ts";
import { StatusBarServiceDIToken } from "../../../../services/statusbar/common/statusBarService.ts";
import { ThemeServiceDIToken } from "../../../../services/themes/common/themeTokens.ts";
import { TerminalServiceDIToken } from "../../../terminal/browser/terminalService.ts";
import { TerminalSessionFactoryDIToken } from "../../../terminal/common/terminalSessionFactory.ts";
import { EmbeddedTerminalSession } from "../../../terminal/node/embeddedTerminalSession.ts";

import { RECORDING_SESSION_TEXT, type TerminalRecordingEvent } from "./terminalDeveloperActions.ts";

describe.skipIf(process.platform === "win32")("Developer terminal commands in the workbench", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-terminal-developer-" });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(100, 30),
            containerOverrides: (container) => {
                // A shell without the user's rc files: a plain prompt, ready at once.
                container.bind(
                    TerminalSessionFactoryDIToken,
                    () => (options) =>
                        new EmbeddedTerminalSession({
                            ...options,
                            shell: "/bin/sh",
                            env: { PS1: "sh$ ", ENV: null },
                        }),
                );
            },
        });
        await h.workbench.activate();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    function frame(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    function type(text: string): void {
        for (const key of text) h.testApp.sendKey(key);
    }

    function find(text: string): Point {
        const lines = frame().split("\n");
        const y = lines.findIndex((line) => line.includes(text));
        expect(y).toBeGreaterThanOrEqual(0);
        return new Point(lines[y].indexOf(text), y);
    }

    const terminals = () => h.container.get(TerminalServiceDIToken);
    const recordingShown = () =>
        h.container
            .get(StatusBarServiceDIToken)
            .entries()
            .some((entry) => entry.text.includes(RECORDING_SESSION_TEXT));

    it(
        "Write Data: the escaped sequence is parsed by the emulator (a red word) and never reaches the shell",
        { timeout: 20_000 },
        async () => {
            const done = h.commands.execute("workbench.action.terminal.writeDataToTerminal") as Promise<void>;
            const [instance] = terminals().getInstances();
            const reached: string[] = [];
            instance.session.onDidWriteData((data) => reached.push(data));
            instance.session.onDidSendText((data) => reached.push(data));
            await vi.waitFor(() => {
                expect(frame()).toContain("Enter data to write directly to the terminal, bypassing the pty");
            });
            type(String.raw`\x1b[31mred\x1B[0m!`);
            h.testApp.sendKey("Enter");
            await done;

            await vi.waitFor(() => {
                expect(frame()).toContain("red!");
            });
            const red = find("red!");
            const theme = h.container.get(ThemeServiceDIToken).theme;
            expect(h.testApp.backend.getFgAt(red)).toBe(theme.getRequiredColor("terminal.ansiRed"));
            expect(h.testApp.backend.getFgAt(new Point(red.x + 3, red.y))).not.toBe(
                theme.getRequiredColor("terminal.ansiRed"),
            );
            expect(reached.join("")).not.toContain("red");
        },
    );

    it("Write Data: Esc in the input writes nothing", async () => {
        const done = h.commands.execute("workbench.action.terminal.writeDataToTerminal") as Promise<void>;
        await vi.waitFor(() => {
            expect(frame()).toContain("Enter data to write directly to the terminal, bypassing the pty");
        });
        type("zzz");
        h.testApp.sendKey("Escape");
        await done;
        expect(frame()).not.toContain("zzz");
    });

    it(
        "Record: a new terminal; typed input, shell output and commands land on the clipboard 5 s after the last event",
        { timeout: 30_000 },
        async () => {
            await h.commands.execute("workbench.action.terminal.new");
            const done = h.commands.execute("workbench.action.terminal.recordSession") as Promise<void>;
            expect(terminals().getInstances()).toHaveLength(2);
            const recorded = terminals().getActiveInstance();
            expect(recorded).toBe(terminals().getInstances()[1]);
            expect(recordingShown()).toBe(true);

            await vi.waitFor(() => {
                expect(frame()).toContain("sh$");
            });
            type("echo hi");
            h.testApp.sendKey("Enter");
            await vi.waitFor(() => {
                // The output line, not the echoed command.
                expect(frame()).toMatch(/^\s*hi\s*│/mu);
            });
            terminals().sendText(recorded?.id, "true", true);
            void h.commands.execute("workbench.action.terminal.focus");

            await done;
            expect(recordingShown()).toBe(false);
            const events = JSON.parse(await h.container.get(ClipboardDIToken).readText()) as TerminalRecordingEvent[];
            expect(events[0]).toStrictEqual({ type: "resize", cols: 80, rows: 24 });
            const data = (type: string): string =>
                events.map((event) => (event.type === type && "data" in event ? event.data : "")).join("");
            expect(data("input")).toContain("echo hi\r");
            expect(data("output")).toContain("hi\r\n");
            expect(data("sendText")).toBe("true\r");
            expect(events).toContainEqual({ type: "command", id: "workbench.action.terminal.focus" });
            // The panel lays the new terminal out at its own size.
            const { cols, rows } = recorded?.session.dimensions ?? {};
            expect(events).toContainEqual({ type: "resize", cols, rows });
            expect(cols).not.toBe(80);
        },
    );
});
