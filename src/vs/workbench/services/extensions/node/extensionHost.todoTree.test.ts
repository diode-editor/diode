import * as fs from "node:fs";
import * as path from "node:path";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import {
    type IInstalledTodoTree,
    installTodoTree,
    TODO_TREE_CONTAINER,
    TODO_TREE_ID,
} from "../../../../../TestUtils/todoTreeFixture.ts";
import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import type { IExtensionManifest } from "../../../../platform/extensions/common/iExtensionManifest.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { ExtensionStatusBarAdapter } from "../../../api/browser/extensionStatusBarAdapter.ts";
import { ExtensionTreeViewsAdapter } from "../../../api/browser/extensionTreeViewsAdapter.ts";
import { ExtensionViewWelcomes } from "../../../api/browser/extensionViewWelcomes.ts";
import { registerExtensionViews } from "../../../api/browser/viewsExtensionPoint.ts";
import { makeViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { SetContextCommandContribution } from "../../../browser/setContextCommandContribution.ts";
import { registerExtensionMenus } from "../../extensions/common/extensionMenuContributor.ts";
import { StatusBarService } from "../../statusbar/common/statusBarService.ts";

// Stock Gruntfuggly.todo-tree scans the workspace with rg from `env.appRoot` and fills its TODOS container:
// workspace → folders → files → `TAG : text` rows, each with `vscode.open` + `{ selection }` as its command.
// The contracts are gated hermetically (extensionHost.appRoot.test.ts, extensionHost.treeView.test.ts,
// extensionTreeViewsAdapter.itemMenu.test.ts); this suite checks the real extension lands where the user looks.

/** `$(check) <total>`, resolved to its glyph by the status bar adapter. */
const CHECK = CODICON_GLYPHS.check ?? "";

/** A tag text in Cyrillic ("kirillitsa"), escaped: code stays ASCII. */
const CYRILLIC = "\u043a\u0438\u0440\u0438\u043b\u043b\u0438\u0446\u0430";

const A_TS = "// TODO: first\nconst a = 1;\n// FIXME: broken\n";

let installed: IInstalledTodoTree;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — stock Gruntfuggly.todo-tree", () => {
    beforeAll(async () => {
        installed = await installTodoTree();
        expect(installed.registration.id).toBe(TODO_TREE_ID);
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    it(
        "TODOS shows the workspace's tags, follows an edit, a click on a tag opens its line, the status bar counts them",
        { timeout: 180_000 },
        async () => {
            const views = makeViewsHarness();
            const { registration } = installed;
            const viewsLog: string[] = [];
            const extension = {
                id: registration.id,
                manifest: registration.manifest as IExtensionManifest,
                location: "UserExtensions/todo-tree/",
                isBuiltin: false,
            };
            registerExtensionMenus([extension], views.menuRegistry);
            registerExtensionViews([extension], {
                views: views.service,
                commands: views.commands,
                contextKeys: views.contextKeys,
                notify: () => undefined,
                logger: {
                    warn: (line: string) => viewsLog.push(line),
                    error: (line: string) => viewsLog.push(line),
                } as never,
            });
            views.service.attachRegisteredContainers();
            views.showViewlet(TODO_TREE_CONTAINER);
            const errors: string[] = [];
            const adapter = new ExtensionTreeViewsAdapter({
                views: views.service,
                welcomes: new ExtensionViewWelcomes(views.service, views.contextKeys, views.commands, {
                    open: () => Promise.resolve(false),
                }),
                commands: views.commands,
                menus: views.menuRegistry,
                menuService: views.menuService,
                contextMenu: views.contextMenu,
                contextKeys: views.contextKeys,
                configuration: new InMemoryConfigurationService(new ConfigurationRegistry()),
                workspace: views.workspace,
                colors: { resolve: () => undefined },
                notifyError: (message) => errors.push(message),
                logger: {
                    warn: (line: string) => errors.push(line),
                    error: (line: string) => errors.push(line),
                } as never,
            });
            const bar = new StatusBarService(NULL_STATE_SERVICE);
            const harness: IExtensionHarness = await createExtensionTestHarness({
                activateEvents: [],
                treeViewsSink: adapter,
                statusBarItemSink: new ExtensionStatusBarAdapter(bar, {
                    execute: () => Promise.resolve(undefined),
                    registerProxy: () => ({ dispose: () => undefined }),
                }),
                commandRegistry: views.commands,
                configuration: { "todo-tree.general.statusBar": "total" },
                extensions: [registration],
            });
            // The workbench's `setContext`: the view's `when` is `!todo-tree-is-empty`.
            new SetContextCommandContribution(harness.commandRegistry, views.contextKeys);
            try {
                fs.mkdirSync(path.join(harness.tmpDir, "src"));
                fs.mkdirSync(path.join(harness.tmpDir, "node_modules", "dep"), { recursive: true });
                const aPath = harness.writeFile(path.join("src", "a.ts"), A_TS);
                harness.writeFile(path.join("src", "b.ts"), `// HACK: ${CYRILLIC}\n`);
                // Excluded by default (`todo-tree.filtering.excludeGlobs`).
                harness.writeFile(path.join("node_modules", "dep", "index.js"), "// TODO: vendored\n");
                harness.group.openFile(aPath);
                await harness.host.activateByEvent("onStartupFinished");
                expect(harness.host.hasExtension(TODO_TREE_ID)).toBe(true);

                const app = TestApp.createWithContent(views.root(TODO_TREE_CONTAINER), new Size(60, 24));
                const frame = (): string => {
                    app.render();
                    return app.backend.screenToString();
                };
                const lines = (): string[] => frame().split("\n");
                const click = (needle: string): void => {
                    const rows = lines();
                    const row = rows.findIndex((line) => line.includes(needle));
                    expect(row, `"${needle}" in\n${rows.join("\n")}`).toBeGreaterThanOrEqual(0);
                    const column = (rows[row] ?? "").indexOf(needle);
                    for (const action of ["press", "release"] as const) {
                        app.backend.simulateMouse({
                            kind: "mouse",
                            button: "left",
                            x: column + 1,
                            y: row + 1,
                            action,
                            shiftKey: false,
                            altKey: false,
                            ctrlKey: false,
                            raw: "",
                        });
                    }
                };

                // The view appears after the first scan; nodes start collapsed, as in VS Code.
                const root = path.basename(harness.tmpDir);
                await waitUntil("the workspace node in TODOS", () => frame().includes(root), 60_000);
                click(root);
                // The cursor stays on the expanded workspace row: its indent guide runs through src.
                await waitUntil(
                    "src under the workspace",
                    () => /^\s+(?:\u2502\s+)?(?:\S\s)?src\s*$/mu.test(frame()),
                    10_000,
                );
                click("src");
                await waitUntil("a.ts and b.ts under src", () => frame().includes("b.ts"), 10_000);
                click("a.ts");
                await waitUntil("a.ts expanded", () => frame().includes("FIXME : broken"), 10_000);
                click("b.ts");
                await waitUntil("b.ts expanded", () => frame().includes(`HACK : ${CYRILLIC}`), 10_000);
                expect(lines().filter((line) => line.includes(" : "))).toEqual([
                    expect.stringContaining("TODO : first"),
                    expect.stringContaining("FIXME : broken"),
                    expect.stringContaining(`HACK : ${CYRILLIC}`),
                ]);
                expect(frame()).not.toContain("vendored");
                expect(bar.entries().map((entry) => entry.text)).toContain(`${CHECK} 3`);

                click("FIXME : broken");
                await waitUntil(
                    "the cursor on FIXME's line",
                    () =>
                        harness.group.getActiveEditor()?.absoluteFilePath === aPath &&
                        harness.group.getActiveEditor()?.primaryCursorLine === 2,
                    10_000,
                );

                // An edit of the open document reaches the tree without a save.
                harness.group
                    .getActiveEditor()
                    ?.applyExternalEdits([createTextEdit(createRange(3, 0, 3, 0), "// TODO: added\n")], "test edit");
                await waitUntil("the added tag in TODOS", () => frame().includes("TODO : added"), 20_000);
                await waitUntil(
                    "the status bar counts it",
                    () => bar.entries().some((e) => e.text === `${CHECK} 4`),
                    10_000,
                );

                expect(errors).toEqual([]);
                expect(viewsLog).toEqual([]);
            } finally {
                await harness.dispose();
            }
        },
    );
});
