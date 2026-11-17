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
import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { TestResultState, TestRunProfileBitset } from "../../../api/common/testingWireTypes.ts";
import { bindExtensionDebuggers, ExtensionDebugAdapter } from "../../../contrib/debug/browser/extensionDebugAdapter.ts";
import { State } from "../../../contrib/debug/common/debug.ts";

const EXTENSION_ID = "test.testingdebug";
const CONTROLLER = "fixture-debug";
const ADDS = `${CONTROLLER}\0adds`;
const TIMEOUT = 20_000;
const WAIT = { timeout: 10_000, interval: 20 };

// The Debug profile of an extension's test controller, as vitest.explorer's: the core asks for the Debug profile, the
// extension's `runHandler` starts a debug session of its own type through `vscode.debug.startDebugging`, and the
// session runs in the core's debug service (upstream `MainThreadTesting` → `ExtHostTesting` → `ExtHostDebugService`
// → `MainThreadDebugService`).
describe("ExtensionHost — a test controller's Debug profile starts a debug session", () => {
    let dir: string;
    let fx: IDebugServiceFixture;
    let harness: IExtensionHarness;
    let testing: ReturnType<typeof makeTestingServices>;

    const seen = async (): Promise<string[]> =>
        (await harness.commandRegistry.execute("test.testingDebug.seen")) as string[];

    beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "diode-testing-debug-")));
        const folder = { uri: Uri.file(dir), name: path.basename(dir), index: 0 };
        fx = createDebugServiceFixture({ folders: [folder] });
        testing = makeTestingServices();
        const extension = {
            ...extensionFixture(EXTENSION_ID, "testingDebug/extension.cjs"),
            manifest: {
                name: EXTENSION_ID,
                publisher: "test",
                version: "0.0.1",
                activationEvents: ["*"],
                contributes: { debuggers: [{ type: "fixture-test-debug", label: "Test Debug" }] },
            },
        };
        bindExtensionDebuggers(fx.service, [extension as never], { warn: vi.fn() } as never);
        const sink = new ExtensionDebugAdapter(() => fx.service);
        const registerDebugTypes = vi.spyOn(sink, "registerDebugTypes");
        harness = await createExtensionTestHarness({
            extensions: [extension],
            workspaceFolders: [dir],
            debugSink: sink,
            testingSink: testing.adapter,
        });
        await waitUntil("the debug types of the subprocess", () => registerDebugTypes.mock.calls.length > 0);
        await waitUntil("the controller's test", () => testing.tests.getNodeById(ADDS) !== undefined);
    }, TIMEOUT);

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        fx.service.dispose();
        await harness.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it(
        "[api:debug.startDebugging] testing.hasDebuggableTests; the Debug group runs the Debug profile, whose session stops on entry with the tests, and the run ends with the session",
        async () => {
            expect(testing.contextKeys.get("testing.hasDebuggableTests")).toBe(true);
            const adds = testing.tests.getNodeById(ADDS)!;
            const running = testing.tests.runTests({ tests: [adds], group: TestRunProfileBitset.Debug });

            await waitUntil("a debug session", () => fx.service.getModel().getSessions().length === 1);
            const [session] = fx.service.getModel().getSessions();
            expect(session.configuration).toMatchObject({ type: "fixture-test-debug", tests: ["adds"] });
            await waitUntil("stopped on entry", () => session.state === State.Stopped);
            await vi.waitFor(async () => {
                expect(await seen()).toEqual(["debug adds started=true"]);
            }, WAIT);
            const result = await vi.waitFor(() => {
                const live = testing.results.results[0];
                expect(live.getStateById(ADDS)?.ownComputedState).toBe(TestResultState.Running);
                return live;
            }, WAIT);
            expect(result.request.group).toBe(TestRunProfileBitset.Debug);
            expect(result.completedAt).toBeUndefined();

            await fx.service.stopSession(session);
            await running;
            await vi.waitFor(() => {
                expect(result.getStateById(ADDS)?.ownComputedState).toBe(TestResultState.Passed);
                expect(result.completedAt).toBeDefined();
            }, WAIT);
            expect(await seen()).toEqual(["debug adds started=true"]);
        },
        TIMEOUT,
    );

    it(
        "the Run group runs the Run profile: no debug session",
        async () => {
            await testing.tests.runTests({ tests: [testing.tests.getNodeById(ADDS)!] });
            await vi.waitFor(async () => {
                expect(await seen()).toEqual(["run adds"]);
            }, WAIT);
            expect(fx.service.getModel().getSessions()).toEqual([]);
        },
        TIMEOUT,
    );
});
