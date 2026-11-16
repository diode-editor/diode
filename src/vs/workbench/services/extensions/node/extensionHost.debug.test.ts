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
import { NO_DELAY_TIMING, registerSyntheticDebugger } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { bindExtensionDebuggers, ExtensionDebugAdapter } from "../../../contrib/debug/browser/extensionDebugAdapter.ts";
import type { IConfig, IDebugVariableResolver } from "../../../contrib/debug/common/debug.ts";

const EXTENSION_ID = "test.debugger";

/** `${command:name}` through the debugger's `variables`, as the configuration resolver does it. */
function commandVariables(execute: (id: string) => Promise<unknown>): IDebugVariableResolver {
    return async (_folder, config, variables) => {
        const resolved: Record<string, unknown> = { ...config };
        for (const [key, value] of Object.entries(config)) {
            const match = typeof value === "string" ? /^\$\{command:(\w+)\}$/.exec(value) : null;
            if (match) resolved[key] = await execute(variables?.[match[1]] ?? match[1]);
        }
        return resolved as unknown as IConfig;
    };
}

// The extension's providers over the real wire into the core's DebugService, as upstream's `ExtHostDebugService` ↔
// `MainThreadDebugService`: F5 on a configuration of the extension's type goes through its providers to a session.
describe("ExtensionHost — debug configuration providers reach the DebugService", () => {
    let dir: string;
    let folder: IWorkspaceFolder;
    let fx: IDebugServiceFixture;
    let harness: IExtensionHarness;

    const seen = async (): Promise<string[]> => (await harness.commandRegistry.execute("test.debug.seen")) as string[];

    beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-debug-")));
        folder = { uri: Uri.file(dir), name: path.basename(dir), index: 0 };
        fx = createDebugServiceFixture({
            folders: [folder],
            workspaceLaunch: {
                version: "0.2.0",
                configurations: [
                    { type: "synthetic", request: "launch", name: "Launch", pid: "${command:pickProcess}" },
                    { type: "synthetic", request: "launch", name: "Abort" },
                    { type: "synthetic", request: "launch", name: "Open launch.json" },
                    { type: "synthetic", request: "launch", name: "Throw" },
                ],
            },
        });
        // The core's adapter of the type, until the extension's own adapter (#1140).
        registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING);
        const extension = {
            ...extensionFixture(EXTENSION_ID, "debugConfigurationProvider.cjs"),
            manifest: {
                name: EXTENSION_ID,
                publisher: "test",
                version: "0.0.1",
                contributes: {
                    debuggers: [{ type: "synthetic", variables: { pickProcess: "test.debug.pickProcess" } }],
                },
            },
        };
        bindExtensionDebuggers(fx.service, [extension as never], { warn: vi.fn() } as never);
        harness = await createExtensionTestHarness({
            extensions: [extension],
            workspaceFolders: [dir],
            debugSink: new ExtensionDebugAdapter(() => fx.service),
        });
        fx.variables = commandVariables(async (id) => await harness.commandRegistry.execute(id));
        await waitUntil("the providers", () =>
            fx.service.getConfigurationManager().hasDebugConfigurationProvider("synthetic"),
        );
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        fx.service.dispose();
        await harness.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const launch = () => fx.service.getConfigurationManager().getLaunch(folder.uri);

    it("[api:debug.registerDebugConfigurationProvider] F5: the type's provider, the `*` one, the variables through the extension's command, the provider again, then the session", async () => {
        await expect(fx.service.startDebugging(launch(), "Launch")).resolves.toBe(true);

        const [session] = fx.service.getModel().getSessions();
        expect(session.configuration).toMatchObject({
            name: "Launch",
            resolvedBy: "synthetic",
            star: true,
            pid: "4242",
            port: 4711,
        });
        expect(await seen()).toEqual([`resolve:${folder.name}:Launch`, `resolve2:${folder.name}:4242`]);
        expect(fx.activated).toEqual(expect.arrayContaining(["onDebugResolve:synthetic"]));
    });

    it("`undefined` from the provider aborts silently; `null` aborts and opens launch.json", async () => {
        await expect(fx.service.startDebugging(launch(), "Abort")).resolves.toBe(false);
        expect(fx.opened).toEqual([]);

        await expect(fx.service.startDebugging(launch(), "Open launch.json")).resolves.toBe(false);
        expect(fx.opened).toEqual([{ resource: launch()?.uri.toString(), line: undefined, preserveFocus: true }]);
        expect(fx.service.getModel().getSessions()).toEqual([]);
        expect(fx.shown).toEqual([]);
    });

    it("a provider that throws fails the start with its message, as upstream (the resolution is outside its catch)", async () => {
        await expect(fx.service.startDebugging(launch(), "Throw")).rejects.toThrow("the provider failed");

        expect(fx.shown.map((m) => m.message)).toEqual([expect.stringContaining("the provider failed")]);
        expect(fx.opened).toEqual([]);
    });

    it("[api:debug.registerDebugConfigurationProvider] a new launch.json gets the configurations of the provider", async () => {
        const writeFile = vi.spyOn(fx.ports.configurationManager.files, "writeFile");

        await launch()?.openConfigFile({ preserveFocus: false, type: "synthetic" });

        const written = new TextDecoder().decode(writeFile.mock.calls[0][1] as Uint8Array);
        expect(written).toContain('"name": "From the provider"');
        expect(await seen()).toEqual([`provide:${folder.name}`]);
        expect(fx.activated).toEqual(expect.arrayContaining(["onDebugInitialConfigurations"]));
    });

    it("[api:debug.startDebugging] [api:debug.stopDebugging] the extension starts a configuration of its folder by name and stops every session", async () => {
        await expect(harness.commandRegistry.execute("test.debug.start", "Launch")).resolves.toBe(true);
        expect(
            fx.service
                .getModel()
                .getSessions()
                .map((s) => (s.configuration as { pid?: unknown }).pid),
        ).toEqual(["4242"]);

        await harness.commandRegistry.execute("test.debug.stop");
        await waitUntil("the session ends", () => fx.service.getModel().getSessions().length === 0);
    });

    it("[api:debug.startDebugging] a configuration object of the extension starts too; an unknown name is the core's error", async () => {
        await expect(
            harness.commandRegistry.execute("test.debug.start", {
                type: "synthetic",
                request: "launch",
                name: "Inline",
            }),
        ).resolves.toBe(true);
        expect(fx.service.getModel().getSessions()[0].configuration).toMatchObject({ name: "Inline", port: 4711 });

        await expect(harness.commandRegistry.execute("test.debug.start", "Missing")).rejects.toThrow(
            "Configuration 'Missing' is missing in 'launch.json'.",
        );
    });
});
