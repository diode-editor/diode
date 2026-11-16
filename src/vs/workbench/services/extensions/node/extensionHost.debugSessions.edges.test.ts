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
import type { DebugModel } from "../../../contrib/debug/common/debugModel.ts";

const EXTENSION_ID = "test.debugprobe";
const TIMEOUT = 20_000;
const WAIT = { timeout: 10_000, interval: 20 };

// `vscode.debug` as a user extension sees it, at the edges: the same session object everywhere, a request after
// the session ended, breakpoints with every property both ways, the echo of an extension's own breakpoints.
describe("ExtensionHost — vscode.debug sessions and breakpoints at the edges", () => {
    let dir: string;
    let file: string;
    let folder: IWorkspaceFolder;
    let fx: IDebugServiceFixture;
    let harness: IExtensionHarness;

    /** Runs `code` in the extension with `vscode`, `events` (every `vscode.debug` event) and `store` in scope. */
    const probe = async (code: string): Promise<unknown> =>
        harness.commandRegistry.execute("test.debugProbe.run", code);

    async function start(): Promise<IDebugSession> {
        const config = { type: "fixture-probe", request: "launch", name: "Probe", program: file };
        const launch = fx.service.getConfigurationManager().getLaunch(folder.uri);
        await expect(fx.service.startDebugging(launch, config)).resolves.toBe(true);
        const [session] = fx.service.getModel().getSessions();
        await waitUntil("stopped on entry", () => session.state === State.Stopped);
        return session;
    }

    beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-debug-probe-")));
        file = path.join(dir, "main.c");
        fs.writeFileSync(file, "int main() {\n  int i = 0;\n  return i;\n}\n");
        folder = { uri: Uri.file(dir), name: path.basename(dir), index: 0 };
        fx = createDebugServiceFixture({ folders: [folder] });
        const extension = {
            ...extensionFixture(EXTENSION_ID, "debugSessionsProbe/extension.cjs"),
            manifest: {
                name: EXTENSION_ID,
                publisher: "test",
                version: "0.0.1",
                activationEvents: ["*"],
                contributes: { debuggers: [{ type: "fixture-probe", label: "Probe" }] },
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
        "one session object for the start, the active session, the custom event, the focused frame and the end",
        async () => {
            const session = await start();
            await vi.waitFor(async () => {
                expect(
                    await probe(
                        `return events.some((e) => e.kind === "custom") && events.some((e) => e.kind === "stack" && e.value);`,
                    ),
                ).toBe(true);
            }, WAIT);
            expect(
                await probe(`
                    const s = vscode.debug.activeDebugSession;
                    const started = events.find((e) => e.kind === "start").value;
                    const custom = events.find((e) => e.kind === "custom").value;
                    const item = vscode.debug.activeStackItem;
                    return {
                        id: s.id, type: s.type, name: s.name, folder: s.workspaceFolder && s.workspaceFolder.name,
                        parent: s.parentSession === undefined, configType: s.configuration.type,
                        sameStart: started === s, sameCustom: custom.session === s, sameItem: item.session === s,
                        event: custom.event, body: custom.body, frame: item instanceof vscode.DebugStackFrame && [item.threadId, item.frameId],
                    };
                `),
            ).toEqual({
                id: session.getId(),
                type: "fixture-probe",
                name: "Probe",
                folder: folder.name,
                parent: true,
                configType: "fixture-probe",
                sameStart: true,
                sameCustom: true,
                sameItem: true,
                event: "probeReady",
                body: { n: 1 },
                frame: [1, 11],
            });

            await fx.service.stopSession(session);
            await vi.waitFor(async () => {
                expect(await probe(`return events.some((e) => e.kind === "terminate");`)).toBe(true);
            }, WAIT);
            expect(
                await probe(`
                    const started = events.find((e) => e.kind === "start").value;
                    return events.find((e) => e.kind === "terminate").value === started;
                `),
            ).toBe(true);
        },
        TIMEOUT,
    );

    it(
        "customRequest round-trips its arguments, rejects with the adapter's message, and rejects after the session ended",
        async () => {
            const session = await start();
            await vi.waitFor(async () => {
                expect(await probe(`return !!vscode.debug.activeDebugSession;`)).toBe(true);
            }, WAIT);
            await probe(`store.session = vscode.debug.activeDebugSession;`);
            await expect(
                probe(`return store.session.customRequest("echo", { s: "ünï ✓", n: [1, 2] });`),
            ).resolves.toEqual({
                echo: { s: "ünï ✓", n: [1, 2] },
            });
            await expect(
                probe(
                    `return store.session.customRequest("nope").then(() => "resolved", (e) => "rejected: " + e.message);`,
                ),
            ).resolves.toBe("rejected: no such request");

            await fx.service.stopSession(session);
            await vi.waitFor(async () => {
                expect(await probe(`return events.some((e) => e.kind === "terminate");`)).toBe(true);
            }, WAIT);
            await expect(
                probe(`
                    const timeout = new Promise((r) => setTimeout(() => r("hung"), 3000));
                    const request = store.session.customRequest("echo", {}).then(() => "resolved", () => "rejected");
                    return Promise.race([request, timeout]);
                `),
            ).resolves.toBe("rejected");
        },
        TIMEOUT,
    );

    it(
        "a breakpoint the core changes is the same object in `changed`, with the new enablement, condition, hit condition and log message",
        async () => {
            const [bp] = await fx.service.addBreakpoints(Uri.file(file), [{ lineNumber: 2 }]);
            await vi.waitFor(async () => {
                expect(await probe(`return vscode.debug.breakpoints.length;`)).toBe(1);
            }, WAIT);
            await probe(`store.bp = vscode.debug.breakpoints[0];`);

            await fx.service.enableOrDisableBreakpoints(false, bp);
            await vi.waitFor(async () => {
                expect(await probe(`return vscode.debug.breakpoints[0].enabled;`)).toBe(false);
            }, WAIT);
            (fx.service.getModel() as DebugModel).updateBreakpoints(
                new Map([[bp.getId(), { condition: "i > 1", hitCondition: "3", logMessage: "i={i}" }]]),
            );
            await vi.waitFor(async () => {
                expect(
                    await probe(`
                        const b = vscode.debug.breakpoints[0];
                        return [b === store.bp, b.condition, b.hitCondition, b.logMessage];
                    `),
                ).toEqual([true, "i > 1", "3", "i={i}"]);
            }, WAIT);
            expect(
                await probe(`
                    const changed = events.filter((e) => e.kind === "breakpoints" && e.value.changed.length > 0);
                    return changed.length > 0 && changed.every((e) => e.value.changed[0] === store.bp);
                `),
            ).toBe(true);

            await fx.service.removeBreakpoints(bp.getId());
            await vi.waitFor(async () => {
                expect(
                    await probe(`
                        const removed = events.find((e) => e.kind === "breakpoints" && e.value.removed.length > 0);
                        return removed ? removed.value.removed[0] === store.bp : "none";
                    `),
                ).toBe(true);
            }, WAIT);
        },
        TIMEOUT,
    );

    it(
        "an extension's breakpoint with every property lands in the core as given, is announced once, and stays the same object",
        async () => {
            await probe(`
                const uri = vscode.Uri.file(${JSON.stringify(file)});
                store.source = new vscode.SourceBreakpoint(
                    new vscode.Location(uri, new vscode.Position(1, 6)), false, "i == 0", "2", "i is {i}");
                store.fn = new vscode.FunctionBreakpoint("main", true, "argc > 1", "4", "in main");
                vscode.debug.addBreakpoints([store.source, store.fn]);
            `);
            await vi.waitFor(() => {
                const [source] = fx.service.getModel().getBreakpoints();
                expect(source).toBeDefined();
                expect([
                    source.getId(),
                    source.lineNumber,
                    source.column,
                    source.enabled,
                    source.condition,
                    source.hitCondition,
                    source.logMessage,
                ]).toEqual([expect.any(String), 2, 7, false, "i == 0", "2", "i is {i}"]);
                const [fn] = fx.service.getModel().getFunctionBreakpoints();
                expect([fn.name, fn.enabled, fn.condition, fn.hitCondition, fn.logMessage]).toEqual([
                    "main",
                    true,
                    "argc > 1",
                    "4",
                    "in main",
                ]);
            }, WAIT);
            expect(fx.service.getModel().getBreakpoints()[0].getId()).toBe(await probe(`return store.source.id;`));
            // Give the core's echo time to come back.
            await new Promise((r) => setTimeout(r, 500));
            expect(
                await probe(`
                    const added = events.filter((e) => e.kind === "breakpoints").flatMap((e) => e.value.added);
                    return {
                        added: added.length,
                        all: vscode.debug.breakpoints.length,
                        same: vscode.debug.breakpoints.includes(store.source) && vscode.debug.breakpoints.includes(store.fn),
                    };
                `),
            ).toEqual({ added: 2, all: 2, same: true });
        },
        TIMEOUT,
    );

    it(
        "removeBreakpoints of the core's breakpoints clears them from the core, from `breakpoints`, and announces each once",
        async () => {
            await fx.service.addBreakpoints(Uri.file(file), [{ lineNumber: 1 }, { lineNumber: 3 }]);
            await fx.service.addFunctionBreakpoint({ name: "main" });
            await vi.waitFor(async () => {
                expect(await probe(`return vscode.debug.breakpoints.length;`)).toBe(3);
            }, WAIT);
            await probe(`vscode.debug.removeBreakpoints(vscode.debug.breakpoints);`);
            await vi.waitFor(() => {
                expect(fx.service.getModel().getBreakpoints()).toEqual([]);
                expect(fx.service.getModel().getFunctionBreakpoints()).toEqual([]);
            }, WAIT);
            await new Promise((r) => setTimeout(r, 500));
            expect(
                await probe(`
                    const removed = events.filter((e) => e.kind === "breakpoints").flatMap((e) => e.value.removed);
                    return { removed: removed.length, left: vscode.debug.breakpoints.length };
                `),
            ).toEqual({ removed: 3, left: 0 });
        },
        TIMEOUT,
    );

    it(
        "quick add/remove rounds from the extension end with the same breakpoints on both sides",
        async () => {
            await probe(`
                const uri = vscode.Uri.file(${JSON.stringify(file)});
                const make = (line) => new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line, 0)));
                for (let round = 0; round < 10; round++) {
                    const bps = [make(0), make(1), make(2)];
                    vscode.debug.addBreakpoints(bps);
                    if (round < 9) vscode.debug.removeBreakpoints(bps);
                }
            `);
            await new Promise((r) => setTimeout(r, 1500));
            expect(
                fx.service
                    .getModel()
                    .getBreakpoints()
                    .map((bp) => bp.lineNumber)
                    .sort(),
            ).toEqual([1, 2, 3]);
            expect(
                await probe(`return vscode.debug.breakpoints.map((b) => b.location.range.start.line).sort();`),
            ).toEqual([0, 1, 2]);
        },
        TIMEOUT,
    );

    it(
        "a breakpoint in a file with a non-ASCII path crosses both ways",
        async () => {
            const unicode = path.join(dir, "файл ✓.c");
            fs.writeFileSync(unicode, "int x;\n");
            await probe(`
                vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(
                    new vscode.Location(vscode.Uri.file(${JSON.stringify(unicode)}), new vscode.Position(0, 0)))]);
            `);
            await vi.waitFor(() => {
                expect(
                    fx.service
                        .getModel()
                        .getBreakpoints()
                        .map((bp) => bp.uri.fsPath),
                ).toEqual([unicode]);
            }, WAIT);
            await fx.service.addBreakpoints(Uri.file(unicode), [{ lineNumber: 1, column: 5 }]);
            await vi.waitFor(async () => {
                expect(await probe(`return vscode.debug.breakpoints.map((b) => b.location.uri.fsPath);`)).toEqual([
                    unicode,
                    unicode,
                ]);
            }, WAIT);
        },
        TIMEOUT,
    );

    it(
        "focusing another thread or frame tells the extension; the end of the session clears the focused item",
        async () => {
            const session = await start();
            await vi.waitFor(async () => {
                expect(
                    await probe(`const i = vscode.debug.activeStackItem; return i && [i.threadId, i.frameId];`),
                ).toEqual([1, 11]);
            }, WAIT);
            const thread1 = session.getThread(1)!;
            const caller = thread1.getCallStack().find((f) => f.name === "caller")!;
            await fx.service.focusStackFrame(caller, thread1, session, { explicit: true });
            await vi.waitFor(async () => {
                expect(
                    await probe(`const i = vscode.debug.activeStackItem; return i && [i.threadId, i.frameId];`),
                ).toEqual([1, 12]);
            }, WAIT);
            await vi.waitFor(async () => {
                expect(
                    await probe(
                        `return events.filter((e) => e.kind === "stack" && e.value && e.value.frameId === 12).length;`,
                    ),
                ).toBe(1);
            }, WAIT);

            await fx.service.stopSession(session);
            await vi.waitFor(async () => {
                expect(
                    await probe(
                        `return vscode.debug.activeStackItem === undefined && vscode.debug.activeDebugSession === undefined;`,
                    ),
                ).toBe(true);
            }, WAIT);
        },
        TIMEOUT,
    );

    it(
        "the Debug Console joins append and appendLine, and writing without a session does not throw",
        async () => {
            await expect(
                probe(`vscode.debug.activeDebugConsole.appendLine("nobody listens"); return "ok";`),
            ).resolves.toBe("ok");
            const session = await start();
            await vi.waitFor(async () => {
                expect(await probe(`return !!vscode.debug.activeDebugSession;`)).toBe(true);
            }, WAIT);
            await probe(`
                vscode.debug.activeDebugConsole.append("часть ");
                vscode.debug.activeDebugConsole.append("two ");
                vscode.debug.activeDebugConsole.appendLine("✓ done");
            `);
            await vi.waitFor(() => {
                expect(
                    session
                        .getReplElements()
                        .map((e) => e.toString())
                        .join(""),
                ).toContain("часть two ✓ done\n");
            }, WAIT);
        },
        TIMEOUT,
    );

    it(
        "a renamed session: the core and every extension view see the new name, and a restart keeps the session active",
        async () => {
            const session = await start();
            await vi.waitFor(async () => {
                expect(await probe(`return !!vscode.debug.activeDebugSession;`)).toBe(true);
            }, WAIT);
            await probe(`vscode.debug.activeDebugSession.name = "Пробa ✓";`);
            await vi.waitFor(() => {
                expect(session.name).toBe("Пробa ✓");
            }, WAIT);
            expect(await probe(`return events.find((e) => e.kind === "start").value.name;`)).toBe("Пробa ✓");

            await fx.service.restartSession(session);
            await waitUntil("stopped again", () => fx.service.getModel().getSessions()[0]?.state === State.Stopped);
            await vi.waitFor(async () => {
                expect(await probe(`const s = vscode.debug.activeDebugSession; return s && s.name;`)).toBe(
                    fx.service.getModel().getSessions()[0].name,
                );
            }, WAIT);
        },
        TIMEOUT,
    );
    it(
        "a child session started by the extension has the parent session object as `parentSession`",
        async () => {
            await start();
            await vi.waitFor(async () => {
                expect(await probe(`return !!vscode.debug.activeDebugSession;`)).toBe(true);
            }, WAIT);
            await expect(
                probe(`
                    store.parent = vscode.debug.activeDebugSession;
                    return vscode.debug.startDebugging(store.parent.workspaceFolder,
                        { type: "fixture-probe", request: "launch", name: "Child", program: ${JSON.stringify("x")} },
                        { parentSession: store.parent });
                `),
            ).resolves.toBe(true);
            await vi.waitFor(async () => {
                expect(
                    await probe(`
                        const child = events.filter((e) => e.kind === "start").map((e) => e.value).find((s) => s.name === "Child");
                        return child ? [child.parentSession === store.parent, child.id !== store.parent.id] : "no child";
                    `),
                ).toEqual([true, true]);
            }, WAIT);
            const child = fx.service
                .getModel()
                .getSessions()
                .find((s) => s.name === "Child");
            expect(child?.parentSession?.name).toBe("Probe");
        },
        TIMEOUT,
    );

    it(
        "with two sessions, ending the focused one leaves the other's requests working",
        async () => {
            await start();
            const launch = fx.service.getConfigurationManager().getLaunch(folder.uri);
            const second = { type: "fixture-probe", request: "launch", name: "Second", program: file };
            await fx.service.startDebugging(launch, second);
            await vi.waitFor(async () => {
                expect(
                    await probe(`return events.filter((e) => e.kind === "start").map((e) => e.value.name);`),
                ).toEqual(["Probe", "Second"]);
            }, WAIT);
            const first = fx.service
                .getModel()
                .getSessions()
                .find((s) => s.name === "Probe")!;
            await fx.service.stopSession(first);
            await vi.waitFor(async () => {
                expect(
                    await probe(`return events.filter((e) => e.kind === "terminate").map((e) => e.value.name);`),
                ).toEqual(["Probe"]);
            }, WAIT);
            await expect(
                probe(`
                    const second = events.find((e) => e.kind === "start" && e.value.name === "Second").value;
                    return second.customRequest("echo", { ok: 1 });
                `),
            ).resolves.toEqual({ echo: { ok: 1 } });
        },
        TIMEOUT,
    );

    it(
        "adding the same breakpoint object twice and removing one that was never added change nothing",
        async () => {
            await probe(`
                store.bp = new vscode.SourceBreakpoint(
                    new vscode.Location(vscode.Uri.file(${JSON.stringify(file)}), new vscode.Position(0, 0)));
                await vscode.debug.addBreakpoints([store.bp]);
                await vscode.debug.addBreakpoints([store.bp]);
                await vscode.debug.removeBreakpoints([new vscode.FunctionBreakpoint("never")]);
            `);
            await new Promise((r) => setTimeout(r, 800));
            expect(fx.service.getModel().getBreakpoints()).toHaveLength(1);
            expect(
                await probe(`
                    const added = events.filter((e) => e.kind === "breakpoints").flatMap((e) => e.value.added);
                    const removed = events.filter((e) => e.kind === "breakpoints").flatMap((e) => e.value.removed);
                    return [vscode.debug.breakpoints.length, added.length, removed.length];
                `),
            ).toEqual([1, 1, 0]);
        },
        TIMEOUT,
    );

    it(
        "getDebugProtocolBreakpoint: the adapter's breakpoint for a sent one, undefined for one the session does not know",
        async () => {
            await probe(`
                store.known = new vscode.SourceBreakpoint(
                    new vscode.Location(vscode.Uri.file(${JSON.stringify(file)}), new vscode.Position(2, 0)));
                await vscode.debug.addBreakpoints([store.known]);
            `);
            await start();
            await vi.waitFor(async () => {
                expect(await probe(`return !!vscode.debug.activeDebugSession;`)).toBe(true);
            }, WAIT);
            await vi.waitFor(async () => {
                expect(
                    await probe(`return vscode.debug.activeDebugSession.getDebugProtocolBreakpoint(store.known);`),
                ).toMatchObject({
                    verified: true,
                    line: 3,
                });
            }, WAIT);
            await expect(
                probe(`
                    const unknown = new vscode.FunctionBreakpoint("never");
                    const bp = await vscode.debug.activeDebugSession.getDebugProtocolBreakpoint(unknown);
                    return bp === undefined ? "undefined" : bp;
                `),
            ).resolves.toBe("undefined");
        },
        TIMEOUT,
    );

    it(
        "focusing a thread without a frame makes `activeStackItem` a DebugThread",
        async () => {
            const session = await start();
            await vi.waitFor(async () => {
                expect(await probe(`return !!vscode.debug.activeStackItem;`)).toBe(true);
            }, WAIT);
            const thread2 = session.getThread(2)!;
            await fx.service.focusStackFrame(undefined, thread2, session, { explicit: true });
            await vi.waitFor(async () => {
                expect(
                    await probe(`
                        const i = vscode.debug.activeStackItem;
                        return [i instanceof vscode.DebugThread || i instanceof vscode.DebugStackFrame ? i.constructor.name : "?", i.threadId, i.session === vscode.debug.activeDebugSession];
                    `),
                ).toEqual([expect.any(String), 2, true]);
            }, WAIT);
        },
        TIMEOUT,
    );
});
