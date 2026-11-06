import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import type { MenuEntry, MenuItemEntry, MenuSubmenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import {
    add,
    setupExplorer,
    SwitchableIcons,
    THEME,
    update,
    wireItem,
} from "../../../../../TestUtils/testingExplorerHarness.ts";
import { testId } from "../../../../../TestUtils/testTree.ts";
import { CODICON_GLYPHS } from "../../../../base/common/codicons.generated.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import {
    type IProductIconService,
    StaticProductIconService,
} from "../../../../platform/theme/common/productIconService.ts";
import {
    type IWireTestItem,
    TestItemExpandState,
    TestResultState,
    TestRunProfileBitset,
} from "../../../api/common/testingWireTypes.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import {
    type ITestingDecorationsEditor,
    MAX_TESTS_IN_SUBMENU,
    PEEK_TEST_ERROR_COMMAND,
    TestingDecorations,
} from "./testingDecorations.ts";

const { NotExpandable, Expandable, Expanded } = TestItemExpandState;
const { Running, Passed, Failed } = TestResultState;

const URI = "file:///w/src/math.test.ts";
const OTHER_URI = "file:///w/src/other.test.ts";
const ROOT = ["vitest"];
const FILE = ["vitest", "math.test.ts"];
const SUITE = [...FILE, "math"];
const ADDS = [...SUITE, "adds"];
const FAILS = [...SUITE, "fails"];

const TEXT = [
    'import { it } from "vitest";',
    'describe("math", () => {',
    '    it("adds", () => {});',
    "",
    '    it("fails", () => {});',
    "});",
].join("\n");

const NERD = new StaticProductIconService(true);
const RUN = CODICON_GLYPHS.run;
const RUN_ALL = CODICON_GLYPHS["run-all"];
const PASS = CODICON_GLYPHS.pass;
const ERROR = CODICON_GLYPHS.error;

function item(path: readonly string[], line?: number, uri = URI): IWireTestItem {
    return wireItem(path, path[path.length - 1], {
        uri: line === undefined ? undefined : uri,
        range: line === undefined ? null : createRange(line, 4, line, 20),
    });
}

interface IOpenEditor {
    readonly editor: ITestingDecorationsEditor & { isTooLargeForTokenization: boolean };
    readonly element: EditorElement;
    readonly app: TestApp;
    readonly largeFileLeft: Emitter<void>;
    /** The gutter cells left of the text of a 0-based line. */
    gutter(line: number): string;
    fg(x: number, line: number): number;
    click(x: number, line: number, button?: "left" | "right"): void;
}

interface ISetupOptions {
    readonly settings?: Record<string, unknown>;
    /** The index the quick pick answers with. */
    readonly picks?: (items: readonly QuickPickItem[]) => number;
    readonly icons?: IProductIconService;
}

function setup(options: ISetupOptions = {}) {
    const explorer = setupExplorer({ progress: { delayMs: 0, intervalMs: 5, minVisibleMs: 0 } });
    explorer.registerController("vitest", "Vitest");
    explorer.profiles.addProfile({
        controllerId: "vitest",
        profileId: 1,
        label: "Run",
        group: TestRunProfileBitset.Run,
        isDefault: true,
        tag: null,
        hasConfigurationHandler: false,
        supportsContinuousRun: false,
    });
    const settings: Record<string, unknown> = {
        "testing.gutterEnabled": true,
        "testing.defaultGutterClickAction": "run",
        ...options.settings,
    };
    const configurationChanged = new Emitter<{ affectsConfiguration(key: string): boolean }>();
    const configuration = {
        get: (key: string) => settings[key],
        onDidChangeConfiguration: configurationChanged.event,
    } as unknown as IConfigurationService;
    const setSetting = (key: string, value: unknown): void => {
        settings[key] = value;
        configurationChanged.fire({ affectsConfiguration: (affected) => affected === key });
    };
    const editorsChanged = new Emitter<void>();
    const open: ITestingDecorationsEditor[] = [];
    const picked: string[][] = [];
    const quickInput = {
        quickPick: (opts: { items: readonly QuickPickItem[] }) => {
            picked.push(opts.items.map((entry) => entry.label));
            return Promise.resolve(opts.items[options.picks?.(opts.items) ?? 0]);
        },
    } as unknown as QuickInputService;
    const toasts: string[] = [];
    const notifications = {
        show: (toast: { message: string }) => toasts.push(toast.message),
    } as unknown as NotificationService;
    const decorations = new TestingDecorations(
        { getEditors: () => open, onDidChangeEditors: editorsChanged.event },
        explorer.tests,
        explorer.results,
        explorer.profiles,
        configuration,
        explorer.progress,
        options.icons ?? NERD,
        explorer.views.menuService,
        explorer.views.contextMenu,
        explorer.views.commands,
        quickInput,
        notifications,
    );

    const openEditor = (uri = URI, text = TEXT): IOpenEditor => {
        const element = new EditorElement(new EditorViewState(new TextDocument(text)));
        element.occurrenceHighlightEnabled = false;
        element.setStyleVars(THEME.colors as Record<string, number>);
        const app = TestApp.createWithContent(element, new Size(40, 8));
        const largeFileLeft = new Emitter<void>();
        const editor = {
            uri: Uri.parse(uri),
            view: element,
            isTooLargeForTokenization: false,
            onDidChangeTooLargeForTokenization: largeFileLeft.event,
            setGlyphMarginDecorations: (glyphs) => {
                element.setGlyphMarginDecorations(glyphs);
            },
            onDidClickGlyphMargin: (listener) => element.onDidClickGlyphMargin(listener),
        } satisfies ITestingDecorationsEditor & { isTooLargeForTokenization: boolean };
        return {
            editor,
            element,
            app,
            largeFileLeft,
            gutter: (line) => {
                app.render();
                return app.backend.getTextAt(new Point(0, line), element.gutterWidth);
            },
            fg: (x, line) => {
                app.render();
                return app.backend.getFgAt(new Point(x, line));
            },
            click: (x, line, button = "left") => {
                app.render();
                for (const action of ["press", "release"] as const) {
                    app.backend.simulateMouse({
                        kind: "mouse",
                        button,
                        x: x + 1,
                        y: line + 1,
                        action,
                        shiftKey: false,
                        altKey: false,
                        ctrlKey: false,
                        raw: "",
                    });
                }
            },
        };
    };
    const show = (editor: IOpenEditor): IOpenEditor => {
        open.push(editor.editor);
        editorsChanged.fire();
        return editor;
    };
    const close = (editor: IOpenEditor): void => {
        open.splice(open.indexOf(editor.editor), 1);
        editorsChanged.fire();
    };
    /** `math.test.ts` → `math` (line 1) → `adds` (line 2), `fails` (line 4). */
    const publishTests = (): void => {
        explorer.tests.publishDiff([
            add(wireItem(ROOT, "Vitest"), Expanded),
            add(item(FILE), Expanded),
            add(item(SUITE, 1), Expanded),
            add(item(ADDS, 2), NotExpandable),
            add(item(FAILS, 4), NotExpandable),
        ]);
    };
    /** The run the core asked for last, reported as the extension would. */
    const report = () => {
        const request = explorer.runs.at(-1)!;
        const result = explorer.results.getResult(request.requests[0].runId)!;
        result.addTask({ id: "t", name: "vitest", ctrlId: "vitest" });
        return {
            request,
            result,
            state: (path: readonly string[], value: TestResultState): void => {
                result.addTestChainToRun(
                    "vitest",
                    path.map((_, i) => wireItem(path.slice(0, i + 1))),
                );
                result.updateState(testId(...path), "t", value);
            },
            end: (): void => {
                result.markTaskComplete("t");
                request.finish();
            },
        };
    };
    const menu = (): MenuEntry[] => explorer.views.shown.at(-1)?.getEntries?.() ?? [];
    const labels = (entries: readonly MenuEntry[] = menu()): string[] =>
        entries.map((entry) => (entry.type === "separator" ? "-" : entry.label));
    const select = (label: string, entries: readonly MenuEntry[] = menu()): void => {
        const entry = entries.find((candidate) => candidate.type !== "separator" && candidate.label === label);
        expect(entry, `"${label}" in ${labels(entries).join(", ")}`).toBeDefined();
        (entry as MenuItemEntry).onSelect?.();
    };
    return {
        explorer,
        decorations,
        openEditor,
        show,
        close,
        publishTests,
        report,
        menu,
        labels,
        select,
        setSetting,
        picked,
        toasts,
    };
}

type Setup = ReturnType<typeof setup>;

async function flush(): Promise<void> {
    await Promise.resolve();
}

/** Runs through a click on `fails`, reports `adds` passed and `fails` failed. */
async function runAndFail(s: Setup, open: IOpenEditor): Promise<void> {
    await flush();
    open.click(1, 1);
    await vi.waitFor(() => {
        expect(s.explorer.runs).toHaveLength(1);
    });
    const run = s.report();
    run.state(ADDS, Passed);
    run.state(FAILS, Failed);
    run.end();
    await vi.waitFor(() => {
        expect(run.result.completedAt).toBeDefined();
    });
    await flush();
}

describe("TestingDecorations", () => {
    it("before a run: run-all on a suite's line, run on each test's, in the run action's color; other lines plain", async () => {
        const s = setup();
        const open = s.show(s.openEditor());
        s.publishTests();
        await flush();

        expect(open.gutter(0)).toBe("   1   ");
        expect(open.gutter(1)).toBe(` ${RUN_ALL} 2   `);
        expect(open.gutter(2)).toBe(` ${RUN} 3   `);
        expect(open.gutter(3)).toBe("   4   ");
        expect(open.gutter(4)).toBe(` ${RUN} 5   `);
        expect(open.fg(1, 2)).toBe(THEME.getColor("testing.runAction"));
    });

    it("an editor of a file without tests keeps the gutter it had", async () => {
        const s = setup();
        s.publishTests();
        const other = s.show(s.openEditor(OTHER_URI));
        await flush();
        expect(other.element.gutterWidth).toBe(6);
        expect(other.gutter(1)).toBe("  2   ");
    });

    it("a left click on a test's glyph runs only that test and leaves the cursor; the glyph then shows its state", async () => {
        const s = setup();
        const open = s.show(s.openEditor());
        s.publishTests();
        await flush();
        open.element.viewState.selections = [createCursorSelection(5, 1)];

        open.click(1, 4);

        await vi.waitFor(() => {
            expect(s.explorer.runs).toHaveLength(1);
        });
        expect(s.explorer.runs[0].requests.map((request) => request.testIds)).toEqual([[testId(...FAILS)]]);
        expect(open.element.viewState.selections).toEqual([createCursorSelection(5, 1)]);

        const run = s.report();
        run.state(FAILS, Failed);
        run.end();
        await vi.waitFor(() => {
            expect(open.gutter(4)).toBe(` ${ERROR} 5   `);
        });
        expect(open.fg(1, 4)).toBe(THEME.getColor("testing.iconFailed"));
        // The suite's glyph takes its children's state from the run.
        expect(open.gutter(1)).toBe(` ${ERROR} 2   `);
        expect(open.gutter(2)).toBe(` ${RUN} 3   `);
        expect(open.element.getScrollBarMarkers()).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ start: 1, color: THEME.getColor("editorOverviewRuler.errorForeground") }),
                expect.objectContaining({ start: 4, color: THEME.getColor("editorOverviewRuler.errorForeground") }),
            ]),
        );
    });

    it("a suite's glyph runs the suite alone, not its tests again", async () => {
        const s = setup();
        const open = s.show(s.openEditor());
        s.publishTests();
        await runAndFail(s, open);

        expect(s.explorer.runs[0].requests.map((request) => request.testIds)).toEqual([[testId(...SUITE)]]);
        expect(open.gutter(2)).toBe(` ${PASS} 3   `);
        expect(open.fg(1, 2)).toBe(THEME.getColor("testing.iconPassed"));
    });

    it("a running test spins with the progress clock", async () => {
        const s = setup();
        const open = s.show(s.openEditor());
        s.publishTests();
        await flush();
        open.click(1, 2);
        await vi.waitFor(() => {
            expect(s.explorer.runs).toHaveLength(1);
        });
        const run = s.report();
        run.state(ADDS, Running);
        await flush();

        const frames = new Set<string>();
        await vi.waitFor(() => {
            frames.add(open.gutter(2).charAt(1));
            expect(frames.size).toBeGreaterThan(1);
        });
        expect([...frames].every((frame) => "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".includes(frame))).toBe(true);
        run.state(ADDS, Passed);
        run.end();
        await vi.waitFor(() => {
            expect(open.gutter(2)).toBe(` ${PASS} 3   `);
        });
    });

    it("testing.gutterEnabled off removes the glyphs and the lane, on brings them back", async () => {
        const s = setup();
        const open = s.show(s.openEditor());
        s.publishTests();
        await flush();

        s.setSetting("testing.gutterEnabled", false);
        expect(open.element.gutterWidth).toBe(6);
        expect(open.gutter(2)).toBe("  3   ");

        s.setSetting("testing.gutterEnabled", true);
        expect(open.gutter(2)).toBe(` ${RUN} 3   `);
    });

    it.each(["debug", "runWithCoverage"])(
        "testing.defaultGutterClickAction %s runs the test: there is no debugger nor coverage",
        async (action) => {
            const s = setup({ settings: { "testing.defaultGutterClickAction": action } });
            const open = s.show(s.openEditor());
            s.publishTests();
            await flush();

            open.click(1, 2);

            await vi.waitFor(() => {
                expect(s.explorer.runs).toHaveLength(1);
            });
            expect(s.explorer.views.shown).toHaveLength(0);
        },
    );

    it("testing.defaultGutterClickAction contextMenu: a left click opens the menu at the pointer instead of running", async () => {
        const s = setup({ settings: { "testing.defaultGutterClickAction": "contextMenu" } });
        const open = s.show(s.openEditor());
        s.publishTests();
        await flush();

        open.click(2, 2);

        expect(s.labels()).toEqual(["Run Test", "Reveal in Test Explorer"]);
        expect(s.explorer.views.shown.at(-1)?.getAnchor()).toEqual({ screenX: 2, screenY: 2 });
        expect(s.explorer.views.shown.at(-1)?.getOwner()).toBe(open.element);
        await flush();
        expect(s.explorer.runs).toHaveLength(0);
    });

    describe("the context menu", () => {
        it("a right click shows Run Test and Reveal in Test Explorer; Run Test runs the test", async () => {
            const s = setup();
            const open = s.show(s.openEditor());
            s.publishTests();
            await flush();

            open.click(1, 2, "right");
            expect(s.labels()).toEqual(["Run Test", "Reveal in Test Explorer"]);
            s.select("Run Test");

            await vi.waitFor(() => {
                expect(s.explorer.runs).toHaveLength(1);
            });
            expect(s.explorer.runs[0].requests[0].testIds).toEqual([testId(...ADDS)]);
        });

        it("Reveal in Test Explorer puts the explorer's cursor on the test", async () => {
            const s = setup();
            const open = s.show(s.openEditor());
            s.publishTests();
            await flush();
            s.explorer.frame();

            open.click(1, 4, "right");
            s.select("Reveal in Test Explorer");

            await vi.waitFor(() => {
                expect(s.explorer.component.focusedTestId).toBe(testId(...FAILS));
            });
        });

        it("a failed test offers Peek Error once its command exists, a running one Cancel Test Run", async () => {
            const s = setup();
            const open = s.show(s.openEditor());
            s.publishTests();
            await runAndFail(s, open);

            open.click(1, 4, "right");
            expect(s.labels()).toEqual(["Run Test", "Reveal in Test Explorer"]);

            const peeked: unknown[] = [];
            s.explorer.views.commands.register(PEEK_TEST_ERROR_COMMAND, (id) => peeked.push(id));
            open.click(1, 4, "right");
            expect(s.labels()).toEqual(["Run Test", "Peek Error", "Reveal in Test Explorer"]);
            s.select("Peek Error");
            expect(peeked).toEqual([testId(...FAILS)]);

            open.click(1, 2);
            await vi.waitFor(() => {
                expect(s.explorer.runs).toHaveLength(2);
            });
            s.report().state(ADDS, Running);
            await flush();
            open.click(1, 2, "right");
            expect(s.labels()).toEqual(["Run Test", "Cancel Test Run", "Reveal in Test Explorer"]);
            s.select("Cancel Test Run");
            await vi.waitFor(() => {
                expect(s.explorer.cancels).toEqual([s.explorer.runs[1].requests[0].runId]);
            });
        });

        it("testing/item/gutter items follow with the test's keys and get the test", async () => {
            const s = setup();
            const received: unknown[] = [];
            s.explorer.views.commands.register("vitest.updateSnapshot", (arg) => received.push(arg));
            s.explorer.views.menuRegistry.appendMenuItem({
                menuId: MenuId.TestItemGutter,
                command: "vitest.updateSnapshot",
                title: "Update Snapshot",
                when: "controllerId == vitest && testId == adds",
            });
            const open = s.show(s.openEditor());
            s.publishTests();
            await flush();

            open.click(1, 4, "right");
            expect(s.labels()).toEqual(["Run Test", "Reveal in Test Explorer"]);
            open.click(1, 2, "right");
            expect(s.labels()).toEqual(["Run Test", "Reveal in Test Explorer", "-", "Update Snapshot"]);
            s.select("Update Snapshot");
            expect(received).toEqual([{ $testId: testId(...ADDS) }]);
        });

        it("a failing contributed command is an error notification", async () => {
            const s = setup();
            s.explorer.views.commands.register("vitest.broken", () => {
                throw new Error("no snapshot");
            });
            s.explorer.views.menuRegistry.appendMenuItem({
                menuId: MenuId.TestItemGutter,
                command: "vitest.broken",
                title: "Broken",
            });
            const open = s.show(s.openEditor());
            s.publishTests();
            await flush();

            open.click(1, 2, "right");
            s.select("Broken");
            expect(s.toasts).toEqual(["no snapshot"]);
        });
    });

    describe("several tests on one line", () => {
        function publishOnOneLine(s: Setup, count: number, label = (i: number) => `case ${String(i)}`): void {
            s.explorer.tests.publishDiff([
                add(wireItem(ROOT, "Vitest"), Expanded),
                add(item(FILE), Expanded),
                ...Array.from({ length: count }, (_, i) =>
                    add(
                        wireItem([...FILE, `t${String(i)}`], label(i), { uri: URI, range: createRange(2, 0, 2, 5) }),
                        NotExpandable,
                    ),
                ),
            ]);
        }

        it("share one run-all glyph that runs them all; the menu has Run All Tests and a submenu per test", async () => {
            const s = setup();
            const open = s.show(s.openEditor());
            publishOnOneLine(s, 2);
            await flush();

            expect(open.gutter(2)).toBe(` ${RUN_ALL} 3   `);
            open.click(1, 2, "right");
            expect(s.labels()).toEqual(["Run All Tests", "-", "case 0", "case 1"]);
            const submenu = s.menu()[3] as MenuSubmenuEntry;
            expect(s.labels((submenu.entries as () => MenuEntry[])())).toEqual(["Run Test", "Reveal in Test Explorer"]);

            s.select("Run All Tests");
            await vi.waitFor(() => {
                expect(s.explorer.runs).toHaveLength(1);
            });
            expect(s.explorer.runs[0].requests[0].testIds).toEqual([testId(...FILE, "t0"), testId(...FILE, "t1")]);
        });

        it("equal labels are told apart by their parents; a label shows its first line", async () => {
            const s = setup();
            const open = s.show(s.openEditor());
            s.explorer.tests.publishDiff([
                add(wireItem(ROOT, "Vitest"), Expanded),
                add(item(FILE), Expanded),
                add(wireItem([...FILE, "a"], "first"), Expanded),
                add(wireItem([...FILE, "b"], "second"), Expanded),
                add(wireItem([...FILE, "a", "x"], "same", { uri: URI, range: createRange(2, 0, 2, 5) }), NotExpandable),
                add(wireItem([...FILE, "b", "x"], "same", { uri: URI, range: createRange(2, 0, 2, 5) }), NotExpandable),
                add(
                    wireItem([...FILE, "c"], "multi\nline", { uri: URI, range: createRange(2, 0, 2, 5) }),
                    NotExpandable,
                ),
            ]);
            await flush();

            open.click(1, 2, "right");
            expect(s.labels()).toEqual(["Run All Tests", "-", "multi", "first > same", "second > same"]);
        });

        it(`past ${String(MAX_TESTS_IN_SUBMENU)} tests the rest are behind "more tests...", which picks a test and then an action`, async () => {
            const s = setup({ picks: (items) => (items[0].label === "Run Test" ? 0 : items.length - 1) });
            const open = s.show(s.openEditor());
            publishOnOneLine(s, MAX_TESTS_IN_SUBMENU + 2, (i) => `case ${String(i).padStart(2, "0")}`);
            await flush();

            open.click(1, 2, "right");
            const shown = s.labels();
            expect(shown).toHaveLength(2 + MAX_TESTS_IN_SUBMENU + 1);
            expect(shown.at(-2)).toBe("case 29");
            expect(shown.at(-1)).toBe("2 more tests...");
            s.select("2 more tests...");

            await vi.waitFor(() => {
                expect(s.explorer.runs).toHaveLength(1);
            });
            expect(s.picked[0]).toHaveLength(MAX_TESTS_IN_SUBMENU + 2);
            expect(s.picked[1]).toEqual(["Run Test", "Reveal in Test Explorer"]);
            expect(s.explorer.runs[0].requests[0].testIds).toEqual([testId(...FILE, "t31")]);
        });
    });

    describe("edits and diffs", () => {
        it("a glyph rides its line through an edit and keeps it when the results come", async () => {
            const s = setup();
            const open = s.show(s.openEditor());
            s.publishTests();
            await flush();

            open.element.viewState.document.applyEdits([createTextEdit(createRange(0, 0, 0, 0), "// top\n")]);
            expect(open.gutter(3)).toBe(` ${RUN} 4   `);

            open.click(1, 5);
            await vi.waitFor(() => {
                expect(s.explorer.runs).toHaveLength(1);
            });
            expect(s.explorer.runs[0].requests[0].testIds).toEqual([testId(...FAILS)]);
            const run = s.report();
            run.state(FAILS, Failed);
            run.end();
            await vi.waitFor(() => {
                expect(open.gutter(5)).toBe(` ${ERROR} 6   `);
            });
            expect(open.gutter(4)).toBe("   5   ");
        });

        it("a new range from the extension moves the glyph; a removed test takes its glyph along", async () => {
            const s = setup();
            const open = s.show(s.openEditor());
            s.publishTests();
            await flush();

            s.explorer.tests.publishDiff([update(ADDS, { range: createRange(3, 0, 3, 4) })]);
            await flush();
            expect(open.gutter(2)).toBe("   3   ");
            expect(open.gutter(3)).toBe(` ${RUN} 4   `);

            s.explorer.tests.publishDiff([{ op: 3, itemId: testId(...FAILS) }]);
            await flush();
            expect(open.gutter(4)).toBe("   5   ");
        });

        it("tests without a range have no glyph", async () => {
            const s = setup();
            const open = s.show(s.openEditor());
            s.explorer.tests.publishDiff([
                add(wireItem(ROOT, "Vitest"), Expanded),
                add(wireItem(FILE, "math.test.ts", { uri: URI }), Expanded),
            ]);
            await flush();
            expect(open.element.gutterWidth).toBe(6);
        });
    });

    describe("editors", () => {
        it("an editor opened after the tests arrive gets its glyphs; a closed one is left alone", async () => {
            const s = setup();
            s.publishTests();
            const open = s.show(s.openEditor());
            expect(open.gutter(2)).toBe(` ${RUN} 3   `);

            s.close(open);
            s.explorer.tests.publishDiff([{ op: 3, itemId: testId(...ADDS) }]);
            await flush();
            expect(open.gutter(2)).toBe(` ${RUN} 3   `);
            open.click(1, 2);
            await flush();
            expect(s.explorer.runs).toHaveLength(0);
        });

        it("the large-file mode has no glyphs until it is left", async () => {
            const s = setup();
            s.publishTests();
            const open = s.openEditor();
            open.editor.isTooLargeForTokenization = true;
            s.show(open);
            expect(open.element.gutterWidth).toBe(6);

            open.editor.isTooLargeForTokenization = false;
            open.largeFileLeft.fire();
            expect(open.gutter(2)).toBe(` ${RUN} 3   `);
        });

        it("the tests over the file resolve their children: the file's own and its folders', not other files'", async () => {
            const s = setup();
            s.show(s.openEditor());
            s.explorer.tests.publishDiff([
                add(wireItem(ROOT, "Vitest"), Expanded),
                add(wireItem(["vitest", "src"], "src", { uri: "file:///w/src" }), Expandable),
                add(wireItem(["vitest", "lib"], "lib", { uri: "file:///w/lib/" }), Expandable),
                add(wireItem(["vitest", "math"], "math", { uri: URI }), Expandable),
                add(wireItem(["vitest", "other"], "other", { uri: OTHER_URI }), Expandable),
            ]);
            await flush();

            expect(s.explorer.expands).toEqual([
                [testId("vitest", "src"), 1],
                [testId("vitest", "math"), 1],
            ]);
            s.explorer.tests.publishDiff([update(["vitest", "lib"], { label: "lib!" })]);
            await flush();
            expect(s.explorer.expands).toHaveLength(2);
        });
    });

    it("without a Nerd Font the glyphs are Unicode; switching the font redraws them", async () => {
        const icons = new SwitchableIcons();
        const s = setup({ icons });
        const open = s.show(s.openEditor());
        s.publishTests();
        await flush();
        expect(open.gutter(2)).toBe(" ▷ 3   ");

        icons.useNerdFont();
        expect(open.gutter(2)).toBe(` ${RUN} 3   `);
    });

    it("disposed, it leaves the editors alone", async () => {
        const s = setup();
        const open = s.show(s.openEditor());
        s.decorations.dispose();
        s.publishTests();
        await flush();
        expect(open.element.gutterWidth).toBe(6);
    });
});
