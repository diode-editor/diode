// The whole workbench with a real shell in a PTY: the synthetic adapter launches with CodeLLDB's
// `terminal: "integrated"`, its `runInTerminal` runs a program that reads stdin in a TERMINAL tab, and a line typed
// there reaches the program — what the user does with a debuggee that reads its input.

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
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { TerminalServiceDIToken } from "../../terminal/browser/terminalService.ts";
import { DefaultShellResolverDIToken } from "../../terminal/common/defaultShell.ts";
import { TerminalSessionFactoryDIToken } from "../../terminal/common/terminalSessionFactory.ts";
import { EmbeddedTerminalSession } from "../../terminal/node/embeddedTerminalSession.ts";

import { DebugServiceDIToken } from "./debugService.ts";

describe.skipIf(process.platform === "win32")("runInTerminal in the workbench", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let registration: IDisposable & { factory: SyntheticDebugAdapterFactory };

    beforeEach(async () => {
        ws = createTempWorkspace({ prefix: "diode-debug-terminal-" });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            // The panel's frame takes two columns: the terminal's tab still fits its whole name.
            size: new Size(102, 30),
            containerOverrides: (container) => {
                container.bind(TerminalSessionFactoryDIToken, () => (options) => new EmbeddedTerminalSession(options));
                // A shell without the user's rc files: a plain prompt, ready at once.
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
        await h.container.get(DebugServiceDIToken).stopSession(undefined);
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

    // A real shell in a PTY, and the launcher waits for 500 ms of quiet from it before it types the command.
    it(
        "the program runs in a TERMINAL tab named after the configuration and reads the line typed there",
        { timeout: 20_000 },
        async () => {
            await h.commands.execute("debug.startFromConfig", {
                ...SYNTHETIC_LAUNCH_CONFIG,
                terminal: "integrated",
                // As upstream, the Debug Console opens after the launch and would take the panel from the terminal.
                internalConsoleOptions: "neverOpen",
                program: "/bin/sh",
                args: ["-c", 'read line; echo "got: $line"'],
                cwd: ws.dir,
            });
            await vi.waitFor(
                () => {
                    expect(h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
                },
                { timeout: 10_000 },
            );

            const terminals = h.container.get(TerminalServiceDIToken);
            const [instance] = terminals.getInstances();
            expect(instance.title).toBe(SYNTHETIC_LAUNCH_CONFIG.name);
            const [response] = registration.factory.adapters[0].responses;
            expect(response).toMatchObject({ command: "runInTerminal", success: true });
            expect(response.body).toEqual({ shellProcessId: instance.processId });
            expect(frame()).toContain(SYNTHETIC_LAUNCH_CONFIG.name);

            await h.commands.execute("workbench.action.terminal.focus");
            for (const key of "hello") h.testApp.sendKey(key);
            h.testApp.sendKey("Enter");

            await vi.waitFor(
                () => {
                    expect(frame()).toContain("got: hello");
                },
                { timeout: 10_000 },
            );
        },
    );
});
