// What the user sees when an adapter runs the debuggee through `runInTerminal`, in the whole workbench with a real
// shell in a PTY: the external kind, cwd/args/env arriving verbatim, and reusing the terminal of an ended session.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { TerminalServiceDIToken } from "../../terminal/browser/terminalService.ts";
import { DefaultShellResolverDIToken } from "../../terminal/common/defaultShell.ts";
import { TerminalSessionFactoryDIToken } from "../../terminal/common/terminalSessionFactory.ts";
import { EmbeddedTerminalSession } from "../../terminal/node/embeddedTerminalSession.ts";

import { DebugServiceDIToken } from "./debugService.ts";

const EXTERNAL_LINE = "external terminal is not available, using the integrated one";

describe.skipIf(process.platform === "win32")("runInTerminal scenarios in the workbench", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let registration: IDisposable & { factory: SyntheticDebugAdapterFactory };

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-debug-terminal-" });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(120, 40),
            containerOverrides: (container) => {
                container.bind(TerminalSessionFactoryDIToken, () => (options) => new EmbeddedTerminalSession(options));
                container.bind(DefaultShellResolverDIToken, () => () => "/bin/sh");
            },
        });
        await h.workbench.activate();
        registration = registerSyntheticDebugger(
            h.container.get(DebugServiceDIToken).getAdapterManager(),
            NO_DELAY_TIMING,
        );
    });

    afterEach(async () => {
        const debug = h.container.get(DebugServiceDIToken);
        for (const s of debug.getModel().getSessions()) await debug.stopSession(s);
        registration.factory.adapters.forEach((a) => {
            a.dispose();
        });
        registration.dispose();
        h.dispose();
        ws.dispose();
    });

    function frame(): string {
        h.testApp.render();
        return h.testApp.backend.screenToString();
    }

    function terminals() {
        return h.container.get(TerminalServiceDIToken).getInstances();
    }

    // `sh -c <script>` as the debuggee; `$((40+2))`-style markers appear only in the program's output, never in the
    // typed command line.
    async function launch(script: string, extra: Record<string, unknown> = {}): Promise<void> {
        await h.commands.execute("debug.startFromConfig", {
            ...SYNTHETIC_LAUNCH_CONFIG,
            terminal: "integrated",
            program: "/bin/sh",
            args: ["-c", script],
            cwd: ws.dir,
            ...extra,
        });
    }

    async function waitFrame(re: RegExp): Promise<void> {
        await vi.waitFor(
            () => {
                expect(frame()).toMatch(re);
            },
            { timeout: 10_000 },
        );
    }

    async function stopAll(): Promise<void> {
        const debug = h.container.get(DebugServiceDIToken);
        for (const s of debug.getModel().getSessions()) await debug.stopSession(s);
    }

    function replText(): string {
        return h.container
            .get(DebugServiceDIToken)
            .getModel()
            .getSessions(true)
            .flatMap((s) => s.getReplElements().map((e) => e.toString()))
            .join("\n");
    }

    it(
        "kind external runs the program in the integrated terminal and says so once in the Debug Console",
        { timeout: 20_000 },
        async () => {
            await launch('echo "EXT-$((40+2))"', { terminal: "external" });
            await waitFrame(/EXT-42/);
            expect(terminals()).toHaveLength(1);
            expect(replText().split(EXTERNAL_LINE)).toHaveLength(2);
        },
    );

    it("kind integrated writes no external-terminal line", { timeout: 20_000 }, async () => {
        await launch('echo "INT-$((40+2))"');
        await waitFrame(/INT-42/);
        expect(replText()).not.toContain(EXTERNAL_LINE);
    });

    it("the program runs in a cwd with spaces and unicode", { timeout: 20_000 }, async () => {
        const dir = join(ws.dir, "my dir ñ");
        mkdirSync(dir);
        await launch('echo "CWD-$((1+1)):$(pwd)"', { cwd: dir });
        await waitFrame(/CWD-2:.*my dir ñ/);
    });

    it("args arrive verbatim: spaces, quotes, dollar, backslash, unicode, empty", { timeout: 20_000 }, async () => {
        await launch('for a in "$@"; do printf "<%s>" "$a"; done; echo " ARGS-$((2+3))"', {
            args: [
                "-c",
                'for a in "$@"; do printf "<%s>" "$a"; done; echo " ARGS-$((2+3))"',
                "x",
                "a b",
                `it's "q"`,
                "$HOME",
                "back\\slash",
                "héllo",
                "",
            ],
        });
        await waitFrame(/ARGS-5/);
        expect(frame()).toContain(`<a b><it's "q"><$HOME><back\\slash><héllo><> ARGS-5`);
    });

    it("env adds variables and null removes an inherited one", { timeout: 20_000 }, async () => {
        process.env.DIODE_T1142_INHERITED = "inherited";
        try {
            await launch('echo "ENV-$((3+4)):[$DIODE_T1142_ADDED][${DIODE_T1142_INHERITED-unset}]"', {
                // `null` first: `/usr/bin/env` takes `-u` only before the first assignment, upstream's order too.
                env: { DIODE_T1142_INHERITED: null, DIODE_T1142_ADDED: "a b ñ" },
            });
            await waitFrame(/ENV-7:/);
            expect(frame()).toContain("ENV-7:[a b ñ][unset]");
        } finally {
            delete process.env.DIODE_T1142_INHERITED;
        }
    });

    it("a second session after the first ended reuses its terminal", { timeout: 30_000 }, async () => {
        await launch('echo "FIRST-$((10+1))"');
        await waitFrame(/FIRST-11/);
        await stopAll();
        await new Promise((r) => setTimeout(r, 1200));

        await launch('echo "SECOND-$((10+2))"');
        await waitFrame(/SECOND-12/);
        expect(terminals()).toHaveLength(1);
    });

    it("text the user left in the reused terminal does not corrupt the next command", { timeout: 30_000 }, async () => {
        await launch('echo "FIRST-$((10+1))"');
        await waitFrame(/FIRST-11/);
        await stopAll();
        await new Promise((r) => setTimeout(r, 1200));

        await h.commands.execute("workbench.action.terminal.focus");
        for (const key of "garbage") h.testApp.sendKey(key);
        await new Promise((r) => setTimeout(r, 300));

        await launch('echo "SECOND-$((10+2))"');
        await waitFrame(/SECOND-12/);
        expect(frame()).not.toMatch(/garbage\/bin\/sh/);
        expect(terminals()).toHaveLength(1);
    });

    it("with debug.terminal.clearBeforeReusing the previous output is cleared", { timeout: 30_000 }, async () => {
        await h.container.get(IConfigurationServiceDIToken).updateValue("debug.terminal.clearBeforeReusing", true);
        await launch('echo "FIRST-$((10+1))"');
        await waitFrame(/FIRST-11/);
        await stopAll();
        await new Promise((r) => setTimeout(r, 1200));

        await launch('echo "SECOND-$((10+2))"');
        await waitFrame(/SECOND-12/);
        expect(frame()).not.toContain("FIRST-11");
    });

    it("without debug.terminal.clearBeforeReusing the previous output stays", { timeout: 30_000 }, async () => {
        await launch('echo "FIRST-$((10+1))"');
        await waitFrame(/FIRST-11/);
        await stopAll();
        await new Promise((r) => setTimeout(r, 1200));

        await launch('echo "SECOND-$((10+2))"');
        await waitFrame(/SECOND-12/);
        expect(frame()).toContain("FIRST-11");
    });

    it("a terminal still running a debuggee is not reused by another session", { timeout: 30_000 }, async () => {
        await launch('echo "BUSY-$((5+5))"; read line; echo "BUSY-GOT:$line"');
        await waitFrame(/BUSY-10/);
        await new Promise((r) => setTimeout(r, 1200));

        await launch('echo "OTHER-$((6+6))"');
        await vi.waitFor(
            () => {
                expect(terminals()).toHaveLength(2);
            },
            { timeout: 10_000 },
        );
        await waitFrame(/OTHER-12/);
        expect(frame()).not.toContain("BUSY-GOT");
    });
});
