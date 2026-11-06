import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { registrationFromInstalled } from "../../../../../TestUtils/installedExtensionRegistration.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { fetchStockVsix } from "../../../../../TestUtils/stockVsix.ts";
import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import { createResultsPanel } from "../../../../../TestUtils/testResultsPanel.ts";
import { testTree } from "../../../../../TestUtils/testTree.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { installVsix } from "../../../../platform/extensionManagement/node/extensionInstaller.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { TestResultState } from "../../../api/common/testingWireTypes.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// The stock `vitest.explorer` from the marketplace (#1068): its controller reaches the TestService over the
// real wire, with the project's own vitest (a symlink to this repository's node_modules, no npm needed).

const EXT_ID = "vitest.explorer";
const REPO_NODE_MODULES = path.resolve(import.meta.dirname, "../../../../../../node_modules");

const MATH_TEST = [
    'import { describe, expect, it } from "vitest";',
    "",
    'describe("math", () => {',
    '    it("adds", () => {',
    "        expect(1 + 1).toBe(2);",
    "    });",
    '    it("fails", () => {',
    "        expect(2 - 1).toBe(2);",
    "    });",
    "});",
    "",
].join("\n");

function writeWorkspace(root: string): void {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "math", type: "module", private: true }));
    fs.writeFileSync(
        path.join(root, "vitest.config.ts"),
        'import { defineConfig } from "vitest/config";\n\nexport default defineConfig({});\n',
    );
    fs.writeFileSync(path.join(root, "src", "math.test.ts"), MATH_TEST);
    fs.symlinkSync(REPO_NODE_MODULES, path.join(root, "node_modules"), "dir");
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock vitest.explorer (#1068)", () => {
    let tmpRoot: string;
    let registration: IExtensionRegistration;

    beforeAll(async () => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "diode-vitest-explorer-"));
        const extensionsDir = path.join(tmpRoot, "extensions");
        const { id, version } = await installVsix((await fetchStockVsix(EXT_ID)).vsixPath, extensionsDir);
        expect(id).toBe(EXT_ID);
        registration = await registrationFromInstalled(extensionsDir, id, version);
    }, 120_000);

    afterAll(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it(
        "[api:tests.createTestController] the controller, its profiles and its lazily resolved tree reach the core; a row's Update Snapshot gets its TestItem; refresh calls the extension",
        { timeout: 120_000 },
        async () => {
            const workspace = path.join(tmpRoot, "workspace");
            writeWorkspace(workspace);
            const views = makeViewsHarness();
            const services = makeTestingServices({ contextKeys: views.contextKeys });
            const { contextKeys, tests, results } = services;
            const configuration = {
                get: (key: string) => (key === "testing.automaticallyOpenTestResults" ? "openOnTestStart" : undefined),
                onDidChangeConfiguration: () => ({ dispose: () => undefined }),
            } as unknown as IConfigurationService;
            const panel = createResultsPanel({
                results,
                views,
                theme: WorkbenchTheme.fromThemeFile(darkPlusTheme),
                configuration,
                progress: new ProgressService(),
                width: 120,
                height: 12,
            });
            views.service.attachRegisteredContainers();
            const output: string[] = [];
            const harness: IExtensionHarness = await createExtensionTestHarness({
                workspaceFolders: [workspace],
                extensions: [registration],
                activateEvents: [],
                testingSink: services.adapter,
                outputSink: {
                    append: (channel, _label, _level, value) => {
                        output.push(`${channel}: ${value}`);
                    },
                    show: () => undefined,
                },
            });
            try {
                // Exactly an event the vsix manifest declares.
                await harness.host.activateByEvent("workspaceContains:node_modules/.bin/vitest");
                await waitUntil("the controller", () => contextKeys.get("testing.providerCount") === 1, 60_000);
                expect(contextKeys.get("testing.canRefresh")).toBe(true);
                await waitUntil("a Run profile", () => contextKeys.get("testing.hasRunnableTests") === true, 60_000);
                expect(output.filter((line) => line.includes("not shown in TUI"))).toEqual([]);

                // vitest lists the folders and test files on its own, a file's tests only on its resolve: the view
                // expands a file when the user does (a folder is not resolvable, levels do not pass through it).
                // The controller is counted before its root item reaches the mirror.
                await waitUntil("the root", () => tests.rootItems.length === 1, 60_000);
                const [root] = tests.rootItems;
                await tests.expandTest(root.item.extId, Infinity);
                await waitUntil("the test file", () => testTree(tests, false).includes("    math.test.ts"), 60_000);
                expect(testTree(tests, false)).toEqual(["Vitest", "  src", "    math.test.ts"]);
                const file = [...(tests.getNodeById([...root.children][0])?.children ?? [])][0];
                expect(tests.getNodeById(file)?.expand).toBe(1);
                await tests.expandTest(file, Infinity);
                await waitUntil("the file's tests", () => testTree(tests, false).length === 6, 60_000);
                expect(testTree(tests, false)).toEqual([
                    "Vitest",
                    "  src",
                    "    math.test.ts",
                    "      math",
                    "        adds",
                    "        fails",
                ]);

                // The row's "Update Snapshot" (`testing/item/context`) gets the extension's own TestItem: it runs it.
                const suite = [...(tests.getNodeById(file)?.children ?? [])][0];
                const adds = [...(tests.getNodeById(suite)?.children ?? [])].find(
                    (id) => tests.getNodeById(id)?.item.label === "adds",
                );
                const before = output.length;
                await harness.commandRegistry.execute("vitest.updateSnapshot", { $testId: adds });
                await waitUntil(
                    'Enqueuing "adds"',
                    () => output.slice(before).some((line) => line.includes('Enqueuing "adds"')),
                    60_000,
                );

                // Run Tests from the core: the profile's runHandler; `adds` passes, `fails` fails, 1 of 2 passed.
                const fails = [...(tests.getNodeById(suite)?.children ?? [])].find(
                    (id) => tests.getNodeById(id)?.item.label === "fails",
                );
                const run = await tests.runTests({ tests: [root] });
                const state = (id: string | undefined) =>
                    id === undefined ? undefined : results.getStateById(id)?.[1];
                expect(state(adds)?.ownComputedState).toBe(TestResultState.Passed);
                expect(state(fails)?.ownComputedState).toBe(TestResultState.Failed);
                expect(state(suite)?.computedState).toBe(TestResultState.Failed);
                expect(run.counts[TestResultState.Passed]).toBe(1);
                expect(run.counts[TestResultState.Failed] + run.counts[TestResultState.Errored]).toBe(1);
                expect(
                    state(fails)
                        ?.tasks.flatMap((task) => task.messages)
                        .some((m) => m.type === "error"),
                ).toBe(true);
                // TEST RESULTS opened with the run: `fails` with its message in the tree, vitest's report in the
                // task's output.
                expect(views.service.isViewShown("workbench.panel.testResults.view")).toBe(true);
                expect(run.tasks[0].output).toContain("FAIL");
                const frame = await panel.waitFrame((text) => text.includes("fails") && text.includes("expected"));
                const tree = frame.split("\n").map((line) => line.slice(60));
                const failsRow = tree.findIndex((line) => line.includes("fails"));
                expect(tree[failsRow + 1]).toMatch(/expected .* to be/);

                // Rerun Failed Tests: only `fails` runs; vitest reports the rest of the file as skipped, as in VS Code.
                const beforeRerun = output.length;
                const rerun = await tests.runTests({
                    tests: [assertReturnsDefined(tests.getNodeById(assertReturnsDefined(fails)))],
                });
                const ran = [...rerun.tests].filter((test) => test.ownComputedState !== TestResultState.Unset);
                expect(ran.map((test) => [test.item.label, test.ownComputedState])).toEqual([
                    ["fails", TestResultState.Failed],
                    ["adds", TestResultState.Skipped],
                ]);

                // OUTPUT → Vitest names the test it runs.
                expect(
                    output.slice(beforeRerun).some((line) => line.includes("with name pattern: ^\\s?math fails$")),
                ).toBe(true);
                const resolving = output.filter((line) => line.includes("Resolving configs")).length;
                await tests.refreshTests();
                await waitUntil(
                    "a new Resolving configs",
                    () => output.filter((line) => line.includes("Resolving configs")).length > resolving,
                    60_000,
                );
            } finally {
                await harness.dispose();
            }
        },
    );
});
