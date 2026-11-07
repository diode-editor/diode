import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { registrationFromInstalled } from "../../../../../TestUtils/installedExtensionRegistration.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { fetchStockVsix } from "../../../../../TestUtils/stockVsix.ts";
import { makeTestingServices } from "../../../../../TestUtils/testingServices.ts";
import { createResultsPanel } from "../../../../../TestUtils/testResultsPanel.ts";
import { testTree } from "../../../../../TestUtils/testTree.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import { Event } from "../../../../base/common/event.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { InMemoryClipboard } from "../../../../platform/clipboard/common/inMemoryClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IContextMenuDelegate } from "../../../../platform/contextview/common/contextMenuDelegate.ts";
import { installVsix } from "../../../../platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { ProgressService } from "../../../../platform/progress/common/progressService.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { TestResultState } from "../../../api/common/testingWireTypes.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { SetContextCommandContribution } from "../../../browser/setContextCommandContribution.ts";
import { TestingDecorations } from "../../../contrib/testing/browser/testingDecorations.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { registerExtensionMenus } from "../common/extensionMenuContributor.ts";

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
        "[api:tests.createTestController] the controller, its profiles and its lazily resolved tree reach the core; a row's Update Snapshot gets its TestItem; the failure's diff, stack and Copy Error; refresh calls the extension",
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
                height: 16,
            });
            views.service.attachRegisteredContainers();
            registerExtensionMenus(
                [
                    {
                        id: EXT_ID,
                        manifest: registration.manifest as unknown as IExtensionManifest,
                        location: workspace,
                        isBuiltin: false,
                    },
                ],
                views.menuRegistry,
            );
            // Copy Error's `when` reads vitest's `vitest.testFiles`, set by `setContext`.
            const setContext = new SetContextCommandContribution(views.commands, views.contextKeys);
            const output: string[] = [];
            const clipboard = new InMemoryClipboard();
            const harness: IExtensionHarness = await createExtensionTestHarness({
                workspaceFolders: [workspace],
                extensions: [registration],
                activateEvents: [],
                testingSink: services.adapter,
                commandRegistry: views.commands,
                clipboard,
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

                // The failure's message: vitest sends expected/actual, a diff of 2 against 1; its frames under it, the
                // test's line among them; Copy Error (`testing/message/context`) puts vitest's report in the clipboard.
                const messageX = 60 + tree[failsRow + 1].indexOf("expected");
                panel.click(messageX, failsRow + 1);
                const diff = await panel.waitFrame((text) => text.includes("Expected result"));
                const content = diff.split("\n").map((line) => line.slice(0, 60));
                const sides = content.findIndex((line) => line.includes("Expected result"));
                expect(content[sides]).toContain("Actual result");
                expect(content[sides + 1]).toMatch(/2.*│.*1/);
                await panel.waitFrame((text) =>
                    /math\.test\.ts:8:/.test(
                        text
                            .split("\n")
                            .map((line) => line.slice(0, 60))
                            .join("\n"),
                    ),
                );
                panel.click(messageX, failsRow + 1, "right");
                const copy = (views.shown.at(-1)?.getEntries?.() ?? []).find(
                    (entry) => entry.type !== "separator" && entry.label === "Copy Error",
                );
                if (copy?.type !== "separator" && copy?.type !== "submenu") copy?.onSelect?.();
                await vi.waitFor(
                    async () => {
                        expect(await clipboard.readText()).toContain("expected 1 to be 2");
                    },
                    { timeout: 60_000 },
                );
                expect(await clipboard.readText()).toContain("Test: math.test.ts > math > fails");

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
                setContext.dispose();
                await harness.dispose();
            }
        },
    );

    it(
        "[api:tests.createTestController] the editor gutter: run-all at describe, run at each it; a click on fails' glyph runs only it and turns it into the failed icon; the glyph's menu has Vitest's testing/item/gutter items",
        { timeout: 120_000 },
        async () => {
            const workspace = path.join(tmpRoot, "gutter");
            writeWorkspace(workspace);
            const services = makeTestingServices();
            const { contextKeys, tests, results, profiles } = services;
            const commands = new CommandRegistry();
            const harness = await createExtensionTestHarness({
                workspaceFolders: [workspace],
                extensions: [registration],
                activateEvents: [],
                testingSink: services.adapter,
                commandRegistry: commands,
            });
            try {
                const icons = new StaticProductIconService(false);
                const menus = new MenuRegistry(commands, new KeybindingRegistry(), contextKeys, [], icons);
                registerExtensionMenus(
                    [
                        {
                            id: EXT_ID,
                            manifest: registration.manifest as unknown as IExtensionManifest,
                            location: workspace,
                            isBuiltin: false,
                        },
                    ],
                    menus,
                );
                const shown: IContextMenuDelegate[] = [];
                const configuration = {
                    get: (key: string) =>
                        ({ "testing.gutterEnabled": true, "testing.defaultGutterClickAction": "run" })[key],
                    onDidChangeConfiguration: Event.None,
                } as unknown as IConfigurationService;
                const decorations = new TestingDecorations(
                    harness.group,
                    tests,
                    results,
                    profiles,
                    configuration,
                    new ProgressService(),
                    icons,
                    new MenuService(menus),
                    {
                        showContextMenu: (delegate: IContextMenuDelegate) => shown.push(delegate),
                    } as unknown as ContextMenuService,
                    commands,
                    {} as QuickInputService,
                    { saveAllBeforeTest: () => Promise.resolve(), showError: () => undefined },
                );
                await harness.host.activateByEvent("workspaceContains:node_modules/.bin/vitest");
                await waitUntil("a Run profile", () => contextKeys.get("testing.hasRunnableTests") === true, 60_000);
                harness.group.openFile(path.join(workspace, "src", "math.test.ts"));

                // Opening the file resolves its tests: nobody expands the tree here but the gutter.
                const rows = (): string[] => {
                    harness.app.render();
                    return harness.app.backend.screenToString().split("\n");
                };
                const row = (text: string): string => rows().find((line) => line.includes(text)) ?? "";
                await waitUntil("the glyphs", () => row('it("fails"').includes("▷"), 60_000);
                expect(row('describe("math"')).toContain("▷");
                expect(row('it("adds"')).toContain("▷");
                expect(row("expect(1 + 1)")).not.toContain("▷");

                const click = (text: string, glyph: string, button: "left" | "right"): void => {
                    const all = rows();
                    const y = all.findIndex((line) => line.includes(text));
                    const x = all[y].indexOf(glyph);
                    for (const action of ["press", "release"] as const) {
                        harness.app.backend.simulateMouse({
                            kind: "mouse",
                            button,
                            action,
                            x: x + 1,
                            y: y + 1,
                            shiftKey: false,
                            altKey: false,
                            ctrlKey: false,
                            raw: "",
                        });
                    }
                };
                click('it("fails"', "▷", "left");
                await waitUntil("fails' failed glyph", () => row('it("fails"').includes("✗"), 60_000);
                // Vitest reports the rest of the file as skipped, as in VS Code.
                expect(row('it("adds"')).toContain("↷");
                const failed = [...results.results[0].tests].filter(
                    (test) => test.ownComputedState === TestResultState.Failed,
                );
                expect(failed.map((test) => test.item.label)).toEqual(["fails"]);

                click('it("adds"', "↷", "right");
                const labels = (shown.at(-1)?.getEntries?.() ?? []).map((entry) =>
                    entry.type === "separator" ? "-" : entry.label,
                );
                expect(labels.slice(0, 3)).toEqual(["Run Test", "Reveal in Test Explorer", "-"]);
                expect(labels).toContain("Update Snapshot");
                decorations.dispose();
            } finally {
                await harness.dispose();
            }
        },
    );
});
