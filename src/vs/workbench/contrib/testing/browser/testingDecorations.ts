import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type {
    IGlyphMarginClick,
    IGlyphMarginDecoration,
} from "../../../../editor/common/model/iGlyphMarginDecoration.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { joinMenuGroups, type MenuContextKeys } from "../../../../platform/actions/common/menuRegistry.ts";
import { type MenuService, MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import {
    type ContextMenuService,
    ContextMenuServiceDIToken,
} from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type ProgressService,
    ProgressServiceDIToken,
    SPINNER_FRAMES,
} from "../../../../platform/progress/common/progressService.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import {
    type IWireTestItemArg,
    TestId,
    TestItemExpandState,
    TestResultState,
    TestRunProfileBitset,
} from "../../../api/common/testingWireTypes.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import { bindMenuEntry, runMenuEntry } from "../../../browser/parts/views/treeItemMenu.ts";
import { isFailedState, maxPriority } from "../common/testingStates.ts";
import { type TestProfileService, TestProfileServiceDIToken } from "../common/testProfileService.ts";
import { type TestResultService, TestResultServiceDIToken } from "../common/testResultService.ts";
import {
    type ITestNode,
    type ITestRunUi,
    TestRunUiDIToken,
    type TestService,
    TestServiceDIToken,
} from "../common/testService.ts";

import { testingRunAllIcon, testingRunIcon, testingStatesToIcons } from "./icons.ts";
import { cancelTestRunAction } from "./testingActions.ts";
import { REVEAL_TEST_COMMAND, TESTING_EXPLORER_VIEW_ID } from "./testingExplorerView.ts";
import { getTestItemContextOverlay } from "./testItemContextOverlay.ts";

// Upstream `contrib/testing/browser/testingDecorations.ts`: the run glyphs (`RunTestDecoration`). Deviations: no Debug
// and no Coverage entries (no debugger, no coverage yet), Alt does not switch to debug, and the glyph has no hover.

/** Upstream `MAX_TESTS_IN_SUBMENU`. */
export const MAX_TESTS_IN_SUBMENU = 30;

/** Upstream's command behind "Peek Error"; offered once something registers it (the TEST RESULTS view). */
export const PEEK_TEST_ERROR_COMMAND = "vscode.peekTestError";

/** `TextEditorPane` matches structurally; the DI module does the binding. */
export interface ITestingDecorationsEditor {
    readonly uri: Uri;
    readonly view: TUIElement;
    /** The large-file mode (docs/arch/Editor.md) has no glyphs; the event fires when it is left. */
    readonly isTooLargeForTokenization: boolean;
    onDidChangeTooLargeForTokenization(listener: () => void): IDisposable;
    setGlyphMarginDecorations(decorations: readonly IGlyphMarginDecoration[]): void;
    onDidClickGlyphMargin(listener: (click: IGlyphMarginClick) => void): IDisposable;
}

export interface ITestingDecorationsEditorSource {
    /** The tabs' text editors of every group: no diff sides, no panels. */
    getEditors(): readonly ITestingDecorationsEditor[];
    onDidChangeEditors(listener: () => void): IDisposable;
}

export const TestingDecorationsEditorSourceDIToken = token<ITestingDecorationsEditorSource>(
    "TestingDecorationsEditorSource",
);
export const TestingDecorationsDIToken = token<TestingDecorations>("TestingDecorations");

interface IAttachedEditor {
    readonly editor: ITestingDecorationsEditor;
    readonly subscriptions: readonly IDisposable[];
    /** Upstream `RunTestDecoration`s: the tests whose range starts on one line, by the glyph's key. */
    decorations: ReadonlyMap<string, readonly ITestNode[]>;
    /** Some glyph shows the spinner: the progress ticks redraw this editor. */
    spinning: boolean;
    /** Tests asked to resolve their children for this file: upstream's `testsInFile`. */
    readonly expanded: Set<string>;
}

/**
 * Upstream `TestingDecorationService` with `TestingDecorations`: each text editor of a file with tests has a glyph on
 * the start line of every test's range — run or run-all before a result, the state's icon after one, the spinner
 * while it runs. A left click acts by `testing.defaultGutterClickAction`, a right click opens the test's menu.
 */
export class TestingDecorations extends Disposable {
    public static dependencies = [
        TestingDecorationsEditorSourceDIToken,
        TestServiceDIToken,
        TestResultServiceDIToken,
        TestProfileServiceDIToken,
        IConfigurationServiceDIToken,
        ProgressServiceDIToken,
        ProductIconServiceDIToken,
        MenuServiceDIToken,
        ContextMenuServiceDIToken,
        CommandRegistryDIToken,
        QuickInputServiceDIToken,
        TestRunUiDIToken,
    ] as const;

    private readonly attached = new Map<ITestingDecorationsEditor, IAttachedEditor>();
    private refreshQueued = false;
    /** A diff came in the batch: the files' tests may have new children to resolve. */
    private expandQueued = false;

    public constructor(
        private readonly editors: ITestingDecorationsEditorSource,
        private readonly tests: TestService,
        private readonly results: TestResultService,
        private readonly profiles: TestProfileService,
        private readonly configuration: IConfigurationService,
        private readonly progress: ProgressService,
        private readonly icons: IProductIconService,
        private readonly menus: MenuService,
        private readonly contextMenu: ContextMenuService,
        private readonly commands: CommandRegistry,
        private readonly quickInput: QuickInputService,
        private readonly ui: ITestRunUi,
    ) {
        super();
        this.register(
            editors.onDidChangeEditors(() => {
                this.syncEditors();
            }),
        );
        this.register(
            tests.onDidProcessDiff(() => {
                this.expandQueued = true;
                this.queueRefresh();
            }),
        );
        this.register(
            results.onResultsChanged(() => {
                this.queueRefresh();
            }),
        );
        this.register(
            results.onTestChanged(() => {
                this.queueRefresh();
            }),
        );
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("testing.gutterEnabled")) this.refreshAll();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.refreshAll();
            }),
        );
        this.register(
            progress.onDidChange(() => {
                for (const state of this.attached.values()) {
                    if (state.spinning) this.refresh(state);
                }
            }),
        );
        this.register({
            dispose: () => {
                for (const editor of [...this.attached.keys()]) this.detach(editor);
            },
        });
        this.syncEditors();
    }

    private syncEditors(): void {
        const open = new Set(this.editors.getEditors());
        for (const editor of [...this.attached.keys()]) {
            if (!open.has(editor)) this.detach(editor);
        }
        for (const editor of open) {
            if (this.attached.has(editor)) continue;
            const state: IAttachedEditor = {
                editor,
                subscriptions: [
                    editor.onDidClickGlyphMargin((click) => {
                        this.click(state, click);
                    }),
                    editor.onDidChangeTooLargeForTokenization(() => {
                        this.expandTestsInFile(state);
                        this.refresh(state);
                    }),
                ],
                decorations: new Map(),
                spinning: false,
                expanded: new Set(),
            };
            this.attached.set(editor, state);
            this.expandTestsInFile(state);
            this.refresh(state);
        }
    }

    private detach(editor: ITestingDecorationsEditor): void {
        const state = this.attached.get(editor);
        if (state === undefined) return;
        for (const subscription of state.subscriptions) subscription.dispose();
        this.attached.delete(editor);
    }

    /** A run reports state by state, discovery diff by diff: the glyphs are recomputed once per batch. */
    private queueRefresh(): void {
        if (this.refreshQueued) return;
        this.refreshQueued = true;
        queueMicrotask(() => {
            this.refreshQueued = false;
            if (this.expandQueued) {
                this.expandQueued = false;
                for (const state of this.attached.values()) this.expandTestsInFile(state);
            }
            this.refreshAll();
        });
    }

    private refreshAll(): void {
        for (const state of this.attached.values()) this.refresh(state);
    }

    /** Upstream `applyDecorations`. */
    private refresh(state: IAttachedEditor): void {
        const { editor } = state;
        const byLine = new Map<number, ITestNode[]>();
        if (this.configuration.get("testing.gutterEnabled") && !editor.isTooLargeForTokenization) {
            for (const test of this.tests.getNodesByUri(editor.uri.toString())) {
                const range = test.item.range;
                if (range === null) continue;
                const onLine = byLine.get(range.start.line);
                if (onLine === undefined) byLine.set(range.start.line, [test]);
                else onLine.push(test);
            }
        }
        const decorations = new Map<string, readonly ITestNode[]>();
        const glyphs: IGlyphMarginDecoration[] = [];
        state.spinning = false;
        for (const [line, tests] of byLine) {
            // Upstream `CachedDecorations` keys a decoration by its exact tests.
            const key = tests
                .map((test) => test.item.extId)
                .sort()
                .join("\0\0");
            decorations.set(key, tests);
            const glyph = this.glyphFor(tests);
            state.spinning ||= glyph.spinning;
            glyphs.push({ key, line, ...glyph.decoration });
        }
        state.decorations = decorations;
        editor.setGlyphMarginDecorations(glyphs);
    }

    /** Upstream `createRunTestDecoration`. */
    private glyphFor(tests: readonly ITestNode[]): {
        readonly decoration: Omit<IGlyphMarginDecoration, "key" | "line">;
        readonly spinning: boolean;
    } {
        const state = this.stateOf(tests);
        if (state === TestResultState.Unset) {
            const multiple = tests.length > 1 || tests[0].children.size > 0;
            const glyph = this.icons.glyph(multiple ? testingRunAllIcon : testingRunIcon);
            return { decoration: { glyph, colorToken: "testing.runAction" }, spinning: false };
        }
        const icon = testingStatesToIcons[state];
        if (icon === undefined) {
            // Running: the spinner of the explorer's progress, the shared clock of `ProgressService`.
            const spinner = this.progress.viewProgress().get(TESTING_EXPLORER_VIEW_ID)?.spinner ?? SPINNER_FRAMES[0];
            return { decoration: { glyph: spinner, colorToken: "testing.runAction" }, spinning: true };
        }
        const decoration = {
            glyph: this.icons.glyph(icon.icon),
            colorToken: icon.color,
            overviewRulerColorToken: isFailedState(state) ? "editorOverviewRuler.errorForeground" : undefined,
        };
        return { decoration, spinning: false };
    }

    private stateOf(tests: readonly ITestNode[]): TestResultState {
        return maxPriority(...tests.map((test) => this.testState(test)));
    }

    private testState(test: ITestNode): TestResultState {
        return this.results.getStateById(test.item.extId)?.[1].computedState ?? TestResultState.Unset;
    }

    /**
     * Upstream `testsInFile`: the tests over the file (no uri, a folder of it, the file itself) are asked to resolve
     * their children, so a controller that discovers lazily shows the file's tests.
     */
    private expandTestsInFile(state: IAttachedEditor): void {
        const { editor } = state;
        if (editor.isTooLargeForTokenization) return;
        const uri = editor.uri.toString();
        const visit = (test: ITestNode): void => {
            const testUri = test.item.uri;
            if (testUri !== undefined && testUri !== uri && !uri.startsWith(`${testUri.replace(/\/$/, "")}/`)) return;
            const testId = test.item.extId;
            if (test.expand === TestItemExpandState.Expandable && !state.expanded.has(testId)) {
                state.expanded.add(testId);
                this.tests.expandTest(testId, 1).catch(onUnexpectedError);
            }
            for (const childId of test.children) {
                const child = this.tests.getNodeById(childId);
                if (child !== undefined) visit(child);
            }
        };
        for (const root of this.tests.rootItems) visit(root);
    }

    /** Upstream `RunTestDecoration.click`; Alt changes nothing, there is no debugger. */
    private click(state: IAttachedEditor, click: IGlyphMarginClick): void {
        const tests = state.decorations.get(click.key);
        if (tests === undefined) return;
        if (click.button === "right" || this.configuration.get("testing.defaultGutterClickAction") === "contextMenu") {
            this.showContextMenu(state.editor, tests, click);
            return;
        }
        // `debug` and `runWithCoverage` run: no debugger, no coverage yet.
        this.run(tests);
    }

    /** Upstream `runWith` over `simplifyTestsToExecute`: a test under another one of the set runs with it. */
    private run(tests: readonly ITestNode[]): void {
        const ids = new Set(tests.map((test) => test.item.extId));
        const outermost = tests.filter((test) => {
            for (let id = TestId.parentId(test.item.extId); id !== undefined; id = TestId.parentId(id)) {
                if (ids.has(id)) return false;
            }
            return true;
        });
        this.tests.runTests({ tests: outermost }).catch(onUnexpectedError);
    }

    private showContextMenu(
        editor: ITestingDecorationsEditor,
        tests: readonly ITestNode[],
        click: IGlyphMarginClick,
    ): void {
        const entries = tests.length === 1 ? this.testEntries(tests[0]) : this.multiTestEntries(tests);
        this.contextMenu.showContextMenu({
            getOwner: () => editor.view,
            getAnchor: () => ({ screenX: click.screenX, screenY: click.screenY }),
            getEntries: () => entries,
        });
    }

    /** Upstream `getTestContextMenuActions` without Debug, Coverage and profiles. */
    private testEntries(test: ITestNode): MenuEntry[] {
        const testId = test.item.extId;
        const state = this.testState(test);
        const entries: MenuEntry[] = [];
        if (this.profiles.getDefaultProfileForTest(TestRunProfileBitset.Run, test) !== undefined) {
            entries.push({
                label: "Run Test",
                onSelect: () => {
                    this.run([test]);
                },
            });
        }
        if (isFailedState(state) && this.commands.has(PEEK_TEST_ERROR_COMMAND)) {
            entries.push({
                label: "Peek Error",
                onSelect: () => {
                    this.execute(PEEK_TEST_ERROR_COMMAND, testId);
                },
            });
        }
        if (state === TestResultState.Running) {
            entries.push({
                label: "Cancel Test Run",
                onSelect: () => {
                    this.execute(cancelTestRunAction.id);
                },
            });
        }
        entries.push({
            label: "Reveal in Test Explorer",
            onSelect: () => {
                this.execute(REVEAL_TEST_COMMAND, testId);
            },
        });
        const contributed = this.contributedEntries(test);
        return contributed.length > 0 ? [...entries, { type: "separator" }, ...contributed] : entries;
    }

    /** Upstream `getContributedTestActions`: `testing/item/gutter` with the test's keys, the test as the argument. */
    private contributedEntries(test: ITestNode): MenuEntry[] {
        const keys = getTestItemContextOverlay(test);
        const arg: IWireTestItemArg = { $testId: test.item.extId };
        return joinMenuGroups(this.menus.getEntryGroups(MenuId.TestItemGutter, undefined, keys)).map((entry) =>
            bindMenuEntry(entry, (item) => {
                runMenuEntry(
                    item,
                    (id) => this.commands.execute(id, arg),
                    (message) => {
                        this.ui.showError(message);
                    },
                );
            }),
        );
    }

    /** Upstream `MultiRunTestDecoration.getContextMenuActions` without Debug and Coverage. */
    private multiTestEntries(tests: readonly ITestNode[]): MenuEntry[] {
        const entries: MenuEntry[] = [];
        if (
            tests.some((test) => this.profiles.getDefaultProfileForTest(TestRunProfileBitset.Run, test) !== undefined)
        ) {
            entries.push({
                label: "Run All Tests",
                onSelect: () => {
                    this.run(tests);
                },
            });
        }
        const labelled = labelTests(tests, (id) => this.tests.getNodeById(id));
        const submenus: MenuEntry[] = labelled.slice(0, MAX_TESTS_IN_SUBMENU).map(({ label, test }) => ({
            type: "submenu",
            label,
            entries: () => this.testEntries(test),
        }));
        const overflow = labelled.length - MAX_TESTS_IN_SUBMENU;
        if (overflow > 0) {
            submenus.push({
                label: `${String(overflow)} more tests...`,
                onSelect: () => {
                    this.pickAndRun(labelled).catch(onUnexpectedError);
                },
            });
        }
        return entries.length > 0 ? [...entries, { type: "separator" }, ...submenus] : submenus;
    }

    /** Upstream `pickAndRun`: a test, then one of its actions. */
    private async pickAndRun(labelled: readonly ILabelledTest[]): Promise<void> {
        const picked = await this.quickInput.quickPick({
            placeholder: "Select a test to run",
            items: labelled.map(({ label }) => ({ label })),
        });
        if (picked === undefined) return;
        const test = labelled.find(({ label }) => label === picked.label)?.test;
        if (test === undefined) return;
        const actions = this.testEntries(test).filter(
            (entry) => entry.type !== "separator" && entry.type !== "submenu",
        );
        const action = await this.quickInput.quickPick({
            placeholder: picked.label,
            items: actions.map((entry) => ({ label: entry.label })),
        });
        actions.find((entry) => entry.label === action?.label)?.onSelect?.();
    }

    private execute(id: string, ...args: unknown[]): void {
        Promise.resolve(this.commands.execute(id, ...args)).catch(onUnexpectedError);
    }
}

interface ILabelledTest {
    readonly label: string;
    readonly test: ITestNode;
}

/**
 * Upstream's labels of the submenus: a label shared by several tests is prefixed with their parents' (`suite > test`)
 * until the labels differ or the parents run out; sorted by `sortText` or label; only the first line.
 */
export function labelTests(
    tests: readonly ITestNode[],
    getNode: (testId: string) => ITestNode | undefined,
): ILabelledTest[] {
    const items = tests.map((test) => ({ label: test.item.label, parent: TestId.parentId(test.item.extId), test }));
    let hasParent = true;
    for (;;) {
        const counts = new Map<string, number>();
        for (const item of items) counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
        const conflicts = items.filter((item) => (counts.get(item.label) ?? 0) > 1);
        if (conflicts.length === 0 || !hasParent) break;
        for (const conflict of conflicts) {
            if (conflict.parent === undefined) {
                hasParent = false;
                continue;
            }
            conflict.label = `${String(getNode(conflict.parent)?.item.label)} > ${conflict.label}`;
            conflict.parent = TestId.parentId(conflict.parent);
        }
    }
    items.sort((a, b) =>
        (a.test.item.sortText ?? a.test.item.label).localeCompare(b.test.item.sortText ?? b.test.item.label),
    );
    return items.map(({ label, test }) => ({ label: label.split("\n")[0], test }));
}
