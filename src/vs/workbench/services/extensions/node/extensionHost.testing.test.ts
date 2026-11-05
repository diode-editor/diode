import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle, waitUntil } from "../../../../../TestUtils/timing.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ExtensionTestingAdapter } from "../../../contrib/testing/browser/extensionTestingAdapter.ts";
import { TestProfileService } from "../../../contrib/testing/common/testProfileService.ts";
import { TestService } from "../../../contrib/testing/common/testService.ts";

const ROOT = "fixture";
const FILE = "fixture\0math.test.ts";
const SUITE = "fixture\0math.test.ts\0math";

/** Labels of the tree, children indented, the expand state in brackets when not `NotExpandable`. */
function tree(service: TestService): string[] {
    const lines: string[] = [];
    const walk = (id: string, depth: number): void => {
        const node = service.getNodeById(id);
        if (node === undefined) return;
        lines.push(`${"  ".repeat(depth)}${node.item.label}${node.expand === 0 ? "" : ` [${node.expand}]`}`);
        for (const child of node.children) walk(child, depth + 1);
    };
    for (const root of service.rootItems) walk(root.item.extId, 0);
    return lines;
}

// The extension's controller over the real wire into the core's TestService, as upstream's
// `ExtHostTesting` ↔ `MainThreadTesting`.
describe("ExtensionHost — test controllers reach the TestService", () => {
    let harness: IExtensionHarness;
    let contextKeys: ContextKeyService;
    let tests: TestService;
    let profiles: TestProfileService;
    const output: string[] = [];

    beforeEach(async () => {
        output.length = 0;
        contextKeys = new ContextKeyService();
        tests = new TestService(contextKeys);
        profiles = new TestProfileService(contextKeys);
        harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.testing", "testControllerExtension.cjs")],
            testingSink: new ExtensionTestingAdapter(tests, profiles),
            outputSink: {
                append: (channel, _label, level, value) => {
                    output.push(`${channel}/${level}: ${value}`);
                },
                show: () => undefined,
            },
        });
        await waitUntil("the controller root", () => tests.rootItems.length === 1);
    });

    afterEach(async () => {
        await harness.dispose();
    });

    const state = async (): Promise<string[]> =>
        (await harness.commandRegistry.execute("test.testing.state")) as string[];
    const waitForEvent = async (event: string): Promise<void> => {
        for (let attempt = 0; !(await state()).includes(event); attempt++) {
            if (attempt > 200) throw new Error(`the extension never saw "${event}"`);
            await settle(20);
        }
    };

    it("[api:tests.createTestController] the controller is counted, can refresh, has something to run; no warn", async () => {
        expect(contextKeys.get("testing.providerCount")).toBe(1);
        expect(contextKeys.get("testing.canRefresh")).toBe(true);
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(true);
        expect(contextKeys.get("testing.hasDebuggableTests")).toBe(false);
        expect(contextKeys.get("testing.hasCoverableTests")).toBe(false);
        expect(contextKeys.evaluate("testing.providerCount > 0")).toBe(true);
        expect(tests.getTestController(ROOT)).toMatchObject({ id: ROOT, label: "Fixture", canRefresh: true });
        expect(profiles.getControllerProfiles(ROOT).map((p) => [p.label, p.group, p.isDefault])).toEqual([
            ["Run Tests", 2, true],
            ["Debug Tests", 4, false],
            ["Run Tests with Coverage", 8, false],
        ]);
        expect(tree(tests)).toEqual(["Fixture [1]"]);
        expect(output).toEqual([]);
        expect(await state()).toEqual([]);
    });

    it("[api:tests.createTestController] expanding resolves lazily: the root with undefined, the file with itself", async () => {
        await tests.expandTest(ROOT, 0);
        expect(tree(tests)).toEqual(["Fixture [3]", "  math.test.ts [1]"]);
        expect(tests.getNodeById(FILE)?.item.uri).toBe("file:///w/math.test.ts");

        const expanding = tests.expandTest(FILE, 1);
        await waitForEvent("resolve:math.test.ts");
        // Past the 200 ms batch window the busy state reaches the core while the handler runs.
        await waitUntil("the file busy", () => tests.getNodeById(FILE)?.expand === 2);
        await harness.commandRegistry.execute("test.testing.finishResolve");
        await expanding;
        expect(tree(tests)).toEqual(["Fixture [3]", "  math.test.ts [3]", "    math", "      adds", "      subtracts"]);
        expect(tests.getNodeById(`${SUITE}\0adds`)?.item.range).toEqual({
            start: { line: 1, character: 4 },
            end: { line: 3, character: 6 },
        });
        expect(await state()).toEqual(["resolve:<root>", "resolve:math.test.ts"]);
    });

    it("[api:tests.createTestController] edits and deletes reach the tree; the controller label renames its root", async () => {
        await tests.expandTest(ROOT, 0);
        await harness.commandRegistry.execute("test.testing.rename");
        await waitUntil("the rename", () => tests.getNodeById(FILE)?.item.label === "renamed.test.ts");
        expect(tests.getTestController(ROOT)?.label).toBe("Renamed");
        expect(tree(tests)).toEqual(["Renamed [3]", "  renamed.test.ts [1]"]);
        await harness.commandRegistry.execute("test.testing.removeFile");
        await waitUntil("the removal", () => tests.getNodeById(FILE) === undefined);
        expect(tree(tests)).toEqual(["Renamed [3]"]);
    });

    it("[api:tests.createTestController] a failing resolveHandler is an Output line, the tree stays and the host lives", async () => {
        await tests.expandTest(ROOT, 0);
        await harness.commandRegistry.execute("test.testing.failResolve");
        await tests.expandTest("fixture\0other.test.ts", 0);
        expect(output).toEqual([
            'extensions/error: Unhandled error in resolveHandler of test controller "fixture": Error: resolve exploded',
        ]);
        expect(tree(tests)).toEqual(["Fixture [3]", "  math.test.ts", "  other.test.ts [3]"]);
        expect(await state()).toEqual(["resolve:<root>", "resolve:other.test.ts"]);
    });

    it("[api:tests.createTestController] a refresh calls refreshHandler, holds testing.isRefreshing until it is done", async () => {
        const refreshing = tests.refreshTests();
        expect(contextKeys.get("testing.isRefreshing")).toBe(true);
        await waitForEvent("refresh");
        await harness.commandRegistry.execute("test.testing.finishRefresh");
        await refreshing;
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
        expect(await state()).toEqual(["refresh", "refresh:done"]);
    });

    it("[api:tests.createTestController] cancelling a refresh cancels the extension's token", async () => {
        const refreshing = tests.refreshTests();
        await waitForEvent("refresh");
        tests.cancelRefreshTests();
        expect(contextKeys.get("testing.isRefreshing")).toBe(false);
        await refreshing;
        await waitForEvent("refresh:cancelled");
    });

    it("[api:tests.createTestController] a disposed profile and a disposed controller leave the core", async () => {
        await harness.commandRegistry.execute("test.testing.disposeRunProfile");
        await waitUntil("the profile removal", () => contextKeys.get("testing.hasRunnableTests") === false);
        expect(profiles.getControllerProfiles(ROOT)).toHaveLength(2);
        await harness.commandRegistry.execute("test.testing.dispose");
        await waitUntil("the controller removal", () => contextKeys.get("testing.providerCount") === 0);
        expect(tests.rootItems).toEqual([]);
        expect(profiles.getControllerProfiles(ROOT)).toEqual([]);
        expect(contextKeys.get("testing.canRefresh")).toBe(false);
    });

    it("[api:tests.createTestController] the subprocess dying drops its controllers, trees and profiles", async () => {
        await tests.expandTest(ROOT, 0);
        await harness.commandRegistry.execute("test.testing.kill");
        await waitUntil("the reset", () => contextKeys.get("testing.providerCount") === 0);
        expect(tests.rootItems).toEqual([]);
        expect(tests.getNodeById(FILE)).toBeUndefined();
        expect(contextKeys.get("testing.canRefresh")).toBe(false);
        expect(contextKeys.get("testing.hasRunnableTests")).toBe(false);
    });
});
