import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { bindExtensionDebuggers, ExtensionDebugAdapter } from "../../../contrib/debug/browser/extensionDebugAdapter.ts";
import { type IDebugSession, State } from "../../../contrib/debug/common/debug.ts";

const EXTENSION_ID = "test.debugsessions";
const TIMEOUT = 20_000;
const WAIT = { timeout: 10_000, interval: 20 };

interface IState {
    readonly active?: string;
    readonly stackItem?: { readonly threadId: number; readonly frameId?: number };
    readonly breakpoints: readonly { readonly where: string; readonly enabled: boolean; readonly condition?: string }[];
}

// The core's sessions as an extension sees them through `vscode.debug`, over a real subprocess (upstream
// `MainThreadDebugService` ↔ `ExtHostDebugService`): the events of a session's life, the focused frame, the
// session's own requests, the Debug Console, and breakpoints both ways.
describe("ExtensionHost — the core's debug sessions for an extension", () => {
    let dir: string;
    let file: string;
    let folder: IWorkspaceFolder;
    let fx: IDebugServiceFixture;
    let harness: IExtensionHarness;
    /** Everything the extension heard, in order. */
    let heard: string[];

    const run = async (command: string, ...args: unknown[]): Promise<unknown> =>
        harness.commandRegistry.execute(`test.debugSessions.${command}`, ...args);
    const state = async (): Promise<IState> => (await run("state")) as IState;

    /** Waits until the extension heard `line`. */
    async function hear(line: string): Promise<void> {
        await vi.waitFor(async () => {
            heard.push(...((await run("seen")) as string[]));
            expect(heard).toContain(line);
        }, WAIT);
    }

    async function start(extra: object = {}): Promise<IDebugSession> {
        const config = { type: "fixture-sessions", request: "launch", name: "Launch sessions", ...extra };
        const launch = fx.service.getConfigurationManager().getLaunch(folder.uri);
        await expect(fx.service.startDebugging(launch, config)).resolves.toBe(true);
        const [session] = fx.service.getModel().getSessions();
        await waitUntil("stopped on entry", () => session.state === State.Stopped);
        return session;
    }

    beforeEach(async () => {
        heard = [];
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-debug-sessions-")));
        file = path.join(dir, "main.c");
        fs.writeFileSync(file, "int main() {\n  return 0;\n}\n");
        folder = { uri: Uri.file(dir), name: path.basename(dir), index: 0 };
        fx = createDebugServiceFixture({ folders: [folder] });
        // A breakpoint from before the extension host: the subprocess hears of it when it attaches.
        await fx.service.addBreakpoints(Uri.file(file), [{ lineNumber: 1 }]);
        const extension = {
            ...extensionFixture(EXTENSION_ID, "debugSessions/extension.cjs"),
            manifest: {
                name: EXTENSION_ID,
                publisher: "test",
                version: "0.0.1",
                activationEvents: ["*"],
                contributes: { debuggers: [{ type: "fixture-sessions", label: "Sessions" }] },
            },
        };
        bindExtensionDebuggers(fx.service, [extension as never], { warn: vi.fn() } as never);
        const sink = new ExtensionDebugAdapter(() => fx.service);
        const registerDebugTypes = vi.spyOn(sink, "registerDebugTypes");
        harness = await createExtensionTestHarness({
            extensions: [extension],
            workspaceFolders: [dir],
            debugSink: sink,
        });
        await waitUntil("the debug types of the subprocess", () => registerDebugTypes.mock.calls.length > 0);
    }, TIMEOUT);

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        fx.service.dispose();
        await harness.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it(
        "[api:debug.onDidStartDebugSession] [api:debug.onDidTerminateDebugSession] [api:debug.onDidChangeActiveDebugSession] [api:debug.onDidReceiveDebugSessionCustomEvent] [api:debug.onDidChangeActiveStackItem] a session's life as the extension hears it",
        async () => {
            const session = await start({ program: file });
            await hear("stack frame 1/7 Launch sessions");
            await hear('custom Launch sessions fixtureReady {"ready":true}');
            expect(heard).toEqual(
                expect.arrayContaining(["active Launch sessions", "started Launch sessions fixture-sessions folder"]),
            );
            expect(await state()).toMatchObject({ active: "Launch sessions", stackItem: { threadId: 1, frameId: 7 } });

            await fx.service.stopSession(session);
            await hear("terminated Launch sessions");
            await hear("active none");
            await hear("stack none");
            expect((await state()).active).toBeUndefined();
        },
        TIMEOUT,
    );

    it(
        "[api:debug.activeDebugSession] the extension's requests reach the session's adapter; a rename and console output reach the core",
        async () => {
            const session = await start();
            await vi.waitFor(async () => {
                expect((await state()).active).toBe("Launch sessions");
            }, WAIT);

            await expect(run("echo", { x: 1 })).resolves.toEqual({ echo: { x: 1 } });
            await expect(run("unknownRequest")).resolves.toMatch(/^rejected: /);

            await expect(run("rename", "Renamed")).resolves.toBe("Renamed");
            await vi.waitFor(() => {
                expect(session.name).toBe("Renamed");
            }, WAIT);

            await run("console", "from the extension");
            await vi.waitFor(() => {
                expect(session.getReplElements().map((e) => e.toString())).toContain("from the extension!\n");
            }, WAIT);
        },
        TIMEOUT,
    );

    it(
        "[api:debug.breakpoints] [api:debug.addBreakpoints] [api:debug.removeBreakpoints] [api:debug.onDidChangeBreakpoints] breakpoints both ways: the core's reach the extension, the extension's join the core's model",
        async () => {
            const model = fx.service.getModel();
            await vi.waitFor(async () => {
                expect((await state()).breakpoints).toEqual([{ where: "main.c:0", enabled: true }]);
            }, WAIT);

            await fx.service.addBreakpoints(Uri.file(file), [{ lineNumber: 3, condition: "x" }]);
            await hear("breakpoints +[main.c:2] -[] ~[]");

            const session = await start();
            const [sourceId, functionId] = (await run("addBreakpoints", file, 1)) as [string, string];
            await vi.waitFor(() => {
                expect(model.getBreakpoints().map((bp) => [bp.getId(), bp.lineNumber, bp.condition])).toContainEqual([
                    sourceId,
                    2,
                    "i == 2",
                ]);
                expect(model.getFunctionBreakpoints().map((bp) => [bp.getId(), bp.name])).toEqual([
                    [functionId, "sessions_main"],
                ]);
            }, WAIT);
            await vi.waitFor(async () => {
                expect(await run("protocolBreakpoint")).toMatchObject({ verified: true });
            }, WAIT);
            expect(session.state).toBe(State.Stopped);

            await run("removeBreakpoints");
            await vi.waitFor(() => {
                expect(model.getBreakpoints()).toEqual([]);
                expect(model.getFunctionBreakpoints()).toEqual([]);
            }, WAIT);
            expect((await state()).breakpoints).toEqual([]);
        },
        TIMEOUT,
    );
});
