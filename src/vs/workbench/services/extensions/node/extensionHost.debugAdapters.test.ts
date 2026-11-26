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

const EXTENSION_ID = "test.debugadapters";
const KINDS = ["inline", "server", "pipe", "exec", "package"] as const;
const TYPES = [...KINDS.map((kind) => `fixture-${kind}`), "fixture-missing"];
const TIMEOUT = 20_000;

// The extension's adapters in the subprocess, the core's session over the wire, as upstream's `ExtHostDebugService`
// ↔ `MainThreadDebugService`: a session of each kind of adapter starts, stops on entry and prints its output in
// the Debug Console; the extension's tracker sees the DAP messages both ways.
describe("ExtensionHost — debug adapters of an extension", () => {
    let dir: string;
    let folder: IWorkspaceFolder;
    let fx: IDebugServiceFixture;
    let harness: IExtensionHarness;

    const seen = async (): Promise<string[]> =>
        (await harness.commandRegistry.execute("test.debugAdapters.seen")) as string[];

    async function start(kind: (typeof KINDS)[number], extra: object = {}): Promise<IDebugSession> {
        const config = { type: `fixture-${kind}`, request: "launch", name: `Launch ${kind}`, ...extra };
        const launch = fx.service.getConfigurationManager().getLaunch(folder.uri);
        await expect(fx.service.startDebugging(launch, config)).resolves.toBe(true);
        const [session] = fx.service.getModel().getSessions();
        return session;
    }

    const output = (session: IDebugSession): string[] => session.getReplElements().map((e) => e.toString());

    beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-debug-adapters-")));
        folder = { uri: Uri.file(dir), name: path.basename(dir), index: 0 };
        fx = createDebugServiceFixture({ folders: [folder] });
        const extension = {
            ...extensionFixture(EXTENSION_ID, "debugAdapters/extension.cjs"),
            manifest: {
                name: EXTENSION_ID,
                publisher: "test",
                version: "0.0.1",
                contributes: {
                    debuggers: [
                        { type: "fixture-inline", label: "Inline" },
                        { type: "fixture-server", label: "Server" },
                        { type: "fixture-pipe", label: "Pipe" },
                        { type: "fixture-exec", label: "Executable" },
                        {
                            type: "fixture-package",
                            label: "Package",
                            runtime: "node",
                            program: "./adapterProcess.cjs",
                            args: ["package"],
                        },
                        { type: "fixture-missing", label: "Missing" },
                    ],
                },
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
        expect(registerDebugTypes.mock.calls[0][0]).toEqual(TYPES);
    }, TIMEOUT);

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        fx.service.dispose();
        await harness.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it.each(KINDS)(
        "[api:debug.registerDebugAdapterDescriptorFactory] %s: the session stops on entry, its output reaches the Debug Console, the stop stops the adapter",
        async (kind) => {
            const session = await start(kind);
            await waitUntil("stopped on entry", () => session.state === State.Stopped);
            expect(session.getAllThreads().map((t) => t.name)).toEqual(["main"]);
            await waitUntil("the output", () => output(session).includes(`hello from ${kind}\n`));

            await fx.service.stopSession(session);
            await waitUntil("the session ends", () => fx.service.getModel().getSessions().length === 0);
            const type = `fixture-${kind}`;
            expect(await seen()).toEqual(
                expect.arrayContaining([`${type}:start`, `${type}:> disconnect`, `${type}:stop`]),
            );
            expect(fx.shown).toEqual([]);
        },
        TIMEOUT,
    );

    it(
        "[api:debug.registerDebugAdapterTrackerFactory] the tracker sees the session start, every message both ways in order, and the stop; the inline adapter is disposed",
        async () => {
            const session = await start("inline");
            await waitUntil("stopped on entry", () => session.state === State.Stopped);
            await fx.service.stopSession(session);
            await waitUntil("the session ends", () => fx.service.getModel().getSessions().length === 0);

            const record = await seen();
            expect(record[0]).toBe(`factory:fixture-inline:Launch inline:${folder.name}:undefined`);
            expect(record.slice(1, 9)).toEqual([
                "fixture-inline:start",
                "fixture-inline:> initialize",
                "fixture-inline:< initialize",
                "fixture-inline:> launch",
                "fixture-inline:< launch",
                "fixture-inline:< initialized",
                "fixture-inline:> configurationDone",
                "fixture-inline:< configurationDone",
            ]);
            expect(record).toEqual(expect.arrayContaining(["fixture-inline:< stopped", "fixture-inline:< output"]));
            expect(record.slice(-2)).toEqual(["fixture-inline:stop", "inline:disposed"]);
        },
        TIMEOUT,
    );

    it(
        "an adapter process that dies ends its session with the error in the Debug Console; the core goes on",
        async () => {
            const session = await start("exec", { crash: true });
            await waitUntil("the session ends", () => fx.service.getModel().getSessions().length === 0);

            // Whichever the adapter process reports first: its exit, its stdout closing, a write into its dead stdin.
            expect(output(session)).toContainEqual(
                expect.stringMatching(/^Debug adapter process has terminated unexpectedly \(.+\)\n$/),
            );
            expect(await seen()).toEqual(expect.arrayContaining(["fixture-exec:exit 3"]));

            const next = await start("exec");
            await waitUntil("the next session stops on entry", () => next.state === State.Stopped);
        },
        TIMEOUT,
    );

    it(
        "a subprocess that dies ends the session with 'Extension host shut down' in the Debug Console",
        async () => {
            const session = await start("inline");
            await waitUntil("stopped on entry", () => session.state === State.Stopped);

            await harness.dispose();
            await waitUntil("the session ends", () => fx.service.getModel().getSessions().length === 0);

            expect(output(session)).toContain(
                "Debug adapter process has terminated unexpectedly (Extension host shut down)\n",
            );
        },
        TIMEOUT,
    );

    it(
        "[api:debug.registerDebugAdapterTrackerFactory] the tracker sees the adapter process exit after the user stops the session, as upstream",
        async () => {
            const session = await start("exec");
            await waitUntil("stopped on entry", () => session.state === State.Stopped);

            await fx.service.stopSession(session);
            await waitUntil("the session ends", () => fx.service.getModel().getSessions().length === 0);

            // Upstream's onExit listener holds the tracker itself, not the map $stopDASession clears: the process the
            // stop killed still reaches the tracker (code null → undefined).
            const record: string[] = [];
            const deadline = Date.now() + 5_000;
            while (!record.some((what) => what.startsWith("fixture-exec:exit")) && Date.now() < deadline) {
                record.push(...(await seen()));
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            expect(record).toContainEqual(expect.stringMatching(/^fixture-exec:exit/));
        },
        TIMEOUT,
    );

    it(
        "an adapter executable that does not exist: the user is told so, as when the adapter's port refuses",
        async () => {
            const launch = fx.service.getConfigurationManager().getLaunch(folder.uri);
            await fx.service.startDebugging(launch, { type: "fixture-missing", request: "launch", name: "Missing" });
            await waitUntil("no session left", () => fx.service.getModel().getSessions().length === 0);

            expect(fx.shown.map((m) => m.message)).toContainEqual(
                expect.stringMatching(/Debug adapter executable '.*no-such-adapter' does not exist/),
            );
        },
        TIMEOUT,
    );
});
