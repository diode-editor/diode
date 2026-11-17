// The editor's commands while debugging over a fake editor, fake sessions and services: what each sends where, the
// cursor's position against the frame and the targets, the picks and the messages. On the whole workbench with the
// synthetic debugger they are in `debugEditorActions.app.test.ts`.

import { describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { NO_DELAY_TIMING, registerSyntheticDebugger } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ISelection } from "../../../../editor/common/core/iSelection.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import type { QuickPickOptions } from "../../../browser/parts/quickinput/quickInputService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import { REPL_VIEW_ID, WATCH_VIEW_ID } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

import { BreakpointSourcesDIToken } from "./breakpointsView.ts";
import {
    closeExceptionWidgetAction,
    goToNextBreakpointAction,
    goToPreviousBreakpointAction,
    jumpToCursorAction,
    runToCursorAction,
    selectionToReplAction,
    selectionToWatchAction,
    stepIntoTargetAction,
    stepIntoTargetsAction,
    toggleInlineBreakpointAction,
} from "./debugEditorActions.ts";
import { DebugEditorContributionDIToken } from "./debugEditorContribution.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { ReplDIToken } from "./repl.ts";

const FILE = Uri.file("/w/main.cpp");
const OTHER = Uri.file("/w/other.cpp");

interface IFakeEditor {
    uri: Uri;
    languageId: string;
    primaryCursorLine: number;
    primaryCursorColumn: number;
    selectedText: string;
    lines: readonly string[];
    viewState: { selections: readonly ISelection[]; document: { getLineContent(line: number): string } };
    revealed: unknown[];
    getSelectedTexts(): string[];
    revealRange(range: unknown): void;
}

function fakeEditor(line: number, column: number, uri = FILE): IFakeEditor {
    const editor: IFakeEditor = {
        uri,
        languageId: "cpp",
        primaryCursorLine: line,
        primaryCursorColumn: column,
        selectedText: "",
        lines: [],
        viewState: { selections: [], document: { getLineContent: (l) => editor.lines[l] } },
        revealed: [],
        getSelectedTexts: () => [editor.selectedText],
        revealRange: (range) => {
            editor.revealed.push(range);
        },
    };
    return editor;
}

interface IHarness {
    readonly accessor: ServiceAccessor;
    readonly shown: { severity: string; message: string }[];
    readonly picks: QuickPickOptions[];
    pickWith(index: number | undefined): void;
}

/** An accessor over `services` by token, with a notification service and a quick input that picks `pick`. */
function harness(services: Map<unknown, unknown>): IHarness {
    const shown: { severity: string; message: string }[] = [];
    const picks: QuickPickOptions[] = [];
    let pickIndex: number | undefined = 0;
    services.set(NotificationServiceDIToken, { show: (m: { severity: string; message: string }) => shown.push(m) });
    services.set(QuickInputServiceDIToken, {
        quickPick: (options: QuickPickOptions): Promise<QuickPickItem | undefined> => {
            picks.push(options);
            return Promise.resolve(pickIndex === undefined ? undefined : options.items[pickIndex]);
        },
    });
    return {
        accessor: { get: (token: unknown) => services.get(token) } as unknown as ServiceAccessor,
        shown,
        picks,
        pickWith: (index) => {
            pickIndex = index;
        },
    };
}

interface IFakeSession {
    getSourceForUri: ReturnType<typeof vi.fn>;
    gotoTargets: ReturnType<typeof vi.fn>;
    goto: ReturnType<typeof vi.fn>;
    stepInTargets: ReturnType<typeof vi.fn>;
    stepIn: ReturnType<typeof vi.fn>;
}

/** A session stopped on thread 7 in frame 3 at `line` of `uri`. */
function stopped(line: number, uri = FILE) {
    const session: IFakeSession = {
        getSourceForUri: vi.fn((u: Uri) => (u.toString() === FILE.toString() ? { raw: { path: u.path } } : undefined)),
        gotoTargets: vi.fn(),
        goto: vi.fn().mockResolvedValue(undefined),
        stepInTargets: vi.fn(),
        stepIn: vi.fn().mockResolvedValue(undefined),
    };
    const frame = { frameId: 3, source: { uri }, range: { startLineNumber: line }, thread: { threadId: 7, session } };
    const runTo = vi.fn().mockResolvedValue(undefined);
    const addWatchExpression = vi.fn();
    const debugService = {
        runTo,
        addWatchExpression,
        getViewModel: () => ({ focusedStackFrame: frame, focusedSession: session }),
    };
    return { session, frame, debugService, runTo, addWatchExpression };
}

function services(editor: IFakeEditor | null, debugService: unknown): Map<unknown, unknown> {
    return new Map<unknown, unknown>([
        [EditorServiceDIToken, { getActiveEditor: () => editor }],
        [DebugServiceDIToken, debugService],
    ]);
}

describe("Run to Cursor", () => {
    it("the cursor's line; its column only on the line the focused frame is paused on", async () => {
        const { debugService, runTo } = stopped(30);
        const on = (editor: IFakeEditor | null) =>
            runToCursorAction.run(harness(services(editor, debugService)).accessor);

        await on(fakeEditor(28, 8));
        await on(fakeEditor(29, 8));
        await on(fakeEditor(29, 8, OTHER));
        await on(null);
        expect(runTo.mock.calls).toEqual([
            [FILE, 29, undefined],
            [FILE, 30, 9],
            [OTHER, 30, undefined],
        ]);
    });

    it("without a focused frame, the line alone", async () => {
        const runTo = vi.fn().mockResolvedValue(undefined);
        const debugService = { runTo, getViewModel: () => ({ focusedStackFrame: undefined }) };
        await runToCursorAction.run(harness(services(fakeEditor(4, 2), debugService)).accessor);
        expect(runTo).toHaveBeenCalledWith(FILE, 5, undefined);
    });
});

describe("Jump to Cursor", () => {
    const NO_CODE = "No executable code is associated at the current cursor position.";

    it("one target: the thread goes to it from the cursor's line and column", async () => {
        const { session, debugService } = stopped(27);
        session.gotoTargets.mockResolvedValue({ body: { targets: [{ id: 31, label: "main.cpp:31" }] } });
        const h = harness(services(fakeEditor(30, 4), debugService));
        await jumpToCursorAction.run(h.accessor);
        expect(session.gotoTargets).toHaveBeenCalledWith({ path: FILE.path }, 31, 5);
        expect(session.goto).toHaveBeenCalledWith(7, 31);
        expect(h.picks).toEqual([]);
        expect(h.shown).toEqual([]);
    });

    it("several: the picked one; a cancelled pick does nothing", async () => {
        const { session, debugService } = stopped(27);
        session.gotoTargets.mockResolvedValue({
            body: {
                targets: [
                    { id: 1, label: "first" },
                    { id: 2, label: "second" },
                ],
            },
        });
        const h = harness(services(fakeEditor(30, 4), debugService));
        h.pickWith(1);
        await jumpToCursorAction.run(h.accessor);
        expect(h.picks.map((p) => [p.placeholder, p.items.map((i) => i.label)])).toEqual([
            ["Choose the specific location", ["first", "second"]],
        ]);
        expect(session.goto).toHaveBeenCalledWith(7, 2);

        h.pickWith(undefined);
        await jumpToCursorAction.run(h.accessor);
        expect(session.goto).toHaveBeenCalledTimes(1);
        expect(h.shown).toEqual([]);
    });

    it("the adapter's refusal to go is a warning", async () => {
        const { session, debugService } = stopped(27);
        session.gotoTargets.mockResolvedValue({ body: { targets: [{ id: 1, label: "x" }] } });
        session.goto.mockRejectedValue(new Error("cannot go there"));
        const h = harness(services(fakeEditor(30, 4), debugService));
        await jumpToCursorAction.run(h.accessor);
        expect(h.shown).toEqual([{ severity: "warn", message: "cannot go there", modal: false, items: [] }]);
    });

    it("no targets, no source, no frame or no editor: the warning that there is no code there", async () => {
        const { session, debugService } = stopped(27);
        session.gotoTargets.mockResolvedValueOnce({ body: { targets: [] } }).mockResolvedValueOnce(undefined);
        const h = harness(services(fakeEditor(30, 4), debugService));
        await jumpToCursorAction.run(h.accessor);
        await jumpToCursorAction.run(h.accessor);
        await jumpToCursorAction.run(harness(services(fakeEditor(30, 4, OTHER), debugService)).accessor);
        const noFrame = { getViewModel: () => ({ focusedStackFrame: undefined }) };
        const others = [harness(services(fakeEditor(0, 0), noFrame)), harness(services(null, debugService))];
        for (const other of others) await jumpToCursorAction.run(other.accessor);
        expect([...h.shown, ...others.flatMap((o) => o.shown)].map((m) => [m.severity, m.message])).toEqual([
            ["warn", NO_CODE],
            ["warn", NO_CODE],
            ["warn", NO_CODE],
            ["warn", NO_CODE],
        ]);
        expect(session.goto).not.toHaveBeenCalled();
    });
});

describe("Step Into Target (the editor's)", () => {
    const NOT_AVAILABLE = "Step targets are not available here";
    const TARGETS = [
        { id: 1, label: "numAt(int)", line: 29, column: 16, endLine: 29, endColumn: 33 },
        { id: 2, label: "at(size_t)", line: 29, column: 22, endLine: 29, endColumn: 32 },
        { id: 3, label: "no line" },
        { id: 4, label: "open end", line: 29, column: 40 },
        // Without columns: from the line's start to its start, around no cursor.
        { id: 5, label: "no columns", line: 29, endLine: 29 },
    ];

    async function stepAt(column: number, targets: unknown = TARGETS, pick?: number) {
        const { session, debugService } = stopped(29);
        session.stepInTargets.mockResolvedValue(targets);
        const h = harness(services(fakeEditor(28, column), debugService));
        h.pickWith(pick);
        await stepIntoTargetsAction.run(h.accessor);
        expect(session.stepInTargets).toHaveBeenCalledWith(3);
        return { session, h, stepped: session.stepIn.mock.calls.map((c) => c[1] as number) };
    }

    it("the innermost call whose range holds the cursor; its end is out", async () => {
        expect((await stepAt(23)).stepped).toEqual([2]);
        expect((await stepAt(21)).stepped).toEqual([2]);
        expect((await stepAt(20)).stepped).toEqual([1]);
        expect((await stepAt(15)).stepped).toEqual([1]);
        expect((await stepAt(31)).stepped).toEqual([1]);
        expect((await stepAt(32)).stepped).toEqual([]);
        expect((await stepAt(32)).session.stepIn).not.toHaveBeenCalled();
    });

    it("past every range, the target without an end that starts last before the cursor", async () => {
        const { session, stepped } = await stepAt(39);
        expect(stepped).toEqual([4]);
        expect(session.stepIn).toHaveBeenCalledWith(7, 4);
    });

    it("before them all, the targets to pick from; a cancelled pick does not step", async () => {
        const picked = await stepAt(2, TARGETS, 2);
        expect(picked.h.picks.map((p) => p.items.map((i) => i.label))).toEqual([
            ["numAt(int)", "at(size_t)", "no line", "open end", "no columns"],
        ]);
        expect(picked.stepped).toEqual([3]);
        expect((await stepAt(2, TARGETS, undefined)).stepped).toEqual([]);
    });

    it("no targets, another file, no frame: the message that there are none here", async () => {
        const none = await stepAt(23, []);
        const nothing = await stepAt(23, null);
        const { session, debugService } = stopped(29);
        const elsewhere = harness(services(fakeEditor(28, 23, OTHER), debugService));
        await stepIntoTargetsAction.run(elsewhere.accessor);
        const noEditor = harness(services(null, debugService));
        await stepIntoTargetsAction.run(noEditor.accessor);
        const noFrame = harness(services(fakeEditor(28, 23), { getViewModel: () => ({ focusedSession: session }) }));
        await stepIntoTargetsAction.run(noFrame.accessor);
        const noSession = harness(services(fakeEditor(28, 23), { getViewModel: () => ({ focusedStackFrame: {} }) }));
        await stepIntoTargetsAction.run(noSession.accessor);
        for (const h of [none.h, nothing.h, elsewhere, noEditor, noFrame, noSession]) {
            expect(h.shown.map((m) => [m.severity, m.message])).toEqual([["info", NOT_AVAILABLE]]);
        }
        expect(session.stepInTargets).not.toHaveBeenCalled();
    });
});

describe("Step Into Target (Ctrl+F11)", () => {
    it("the frame's targets to pick from: the active one's range selected and revealed in the frame's editor", async () => {
        const { session, debugService } = stopped(29);
        session.stepInTargets.mockResolvedValue([
            { id: 1, label: "numAt(int)", line: 29, column: 16, endLine: 29, endColumn: 33 },
            { id: 2, label: "at", line: 30, column: 22 },
            { id: 3, label: "bare", line: 31 },
            { id: 4, label: "nowhere" },
        ]);
        const editor = fakeEditor(0, 0);
        const h = harness(services(editor, debugService));
        h.pickWith(1);
        await stepIntoTargetAction.run(h.accessor);
        expect(session.stepIn).toHaveBeenCalledWith(7, 2);
        const [options] = h.picks;
        expect(options.placeholder).toBeUndefined();

        const activate = (index: number | undefined) => {
            options.onDidChangeActive?.(index === undefined ? undefined : options.items[index], index ?? -1);
            const [selection] = editor.viewState.selections;
            return [
                selection.anchor.line,
                selection.anchor.character,
                selection.active.line,
                selection.active.character,
            ];
        };
        expect(activate(0)).toEqual([28, 15, 28, 32]);
        expect(activate(1)).toEqual([29, 21, 29, 21]);
        expect(activate(2)).toEqual([30, 0, 30, 0]);
        expect(editor.revealed).toHaveLength(3);
        // No line, no item: the selection stays.
        expect(activate(3)).toEqual([30, 0, 30, 0]);
        expect(activate(undefined)).toEqual([30, 0, 30, 0]);
        expect(editor.revealed).toHaveLength(3);
    });

    it("another file in the editor is left alone; none: the placeholder says so, Escape steps nowhere", async () => {
        const { session, debugService } = stopped(29, OTHER);
        session.stepInTargets.mockResolvedValue([{ id: 1, label: "numAt(int)", line: 29 }]);
        const editor = fakeEditor(0, 0);
        const h = harness(services(editor, debugService));
        h.pickWith(undefined);
        await stepIntoTargetAction.run(h.accessor);
        h.picks[0].onDidChangeActive?.(h.picks[0].items[0], 0);
        expect(editor.viewState.selections).toEqual([]);
        expect(session.stepIn).not.toHaveBeenCalled();

        session.stepInTargets.mockResolvedValue(undefined);
        await stepIntoTargetAction.run(harness(services(null, debugService)).accessor);
        const empty = harness(services(null, debugService));
        await stepIntoTargetAction.run(empty.accessor);
        expect(empty.picks.map((p) => [p.placeholder, p.items])).toEqual([["No step targets available", []]]);
    });

    it("without a focused frame or session does nothing", async () => {
        const { session } = stopped(29);
        for (const viewModel of [{ focusedSession: session }, { focusedStackFrame: {} }]) {
            const h = harness(services(null, { getViewModel: () => viewModel }));
            await stepIntoTargetAction.run(h.accessor);
            expect(h.picks).toEqual([]);
        }
    });
});

describe("Evaluate in Debug Console and Add to Watch", () => {
    function setup(editor: IFakeEditor | null, focusedSession: unknown = {}) {
        const sendReplInput = vi.fn();
        const openView = vi.fn();
        const addWatchExpression = vi.fn();
        const map = services(editor, { addWatchExpression, getViewModel: () => ({ focusedSession }) });
        map.set(ReplDIToken, { sendReplInput });
        map.set(ViewsServiceDIToken, { openView });
        return { accessor: harness(map).accessor, sendReplInput, openView, addWatchExpression };
    }

    it("the console gets the selection, else the cursor's line trimmed; the console shows without its focus", () => {
        const editor = fakeEditor(1, 3);
        editor.lines = ["", "    sum += 1;  "];
        const { accessor, sendReplInput, openView } = setup(editor);
        selectionToReplAction.run(accessor);
        editor.selectedText = "sum";
        selectionToReplAction.run(accessor);
        expect(sendReplInput.mock.calls).toEqual([["sum += 1;"], ["sum"]]);
        expect(openView.mock.calls).toEqual([
            [REPL_VIEW_ID, false],
            [REPL_VIEW_ID, false],
        ]);
    });

    it("the console gets nothing without an editor or a session", () => {
        for (const { accessor, sendReplInput, openView } of [setup(null), setup(fakeEditor(0, 0), null)]) {
            selectionToReplAction.run(accessor);
            expect(sendReplInput).not.toHaveBeenCalled();
            expect(openView).not.toHaveBeenCalled();
        }
    });

    it("the watch gets the selection, else the expression under the cursor; nothing on a blank", () => {
        const editor = fakeEditor(0, 23);
        editor.lines = ["        sum += numAt(nums.at(i));"];
        const { accessor, addWatchExpression, openView } = setup(editor);
        selectionToWatchAction.run(accessor);
        editor.primaryCursorColumn = 27;
        selectionToWatchAction.run(accessor);
        editor.selectedText = "numAt(nums.at(i))";
        selectionToWatchAction.run(accessor);
        editor.selectedText = "";
        editor.primaryCursorColumn = 2;
        selectionToWatchAction.run(accessor);
        expect(addWatchExpression.mock.calls).toEqual([["nums"], ["nums.at"], ["numAt(nums.at(i))"]]);
        expect(openView).toHaveBeenCalledTimes(3);
        expect(openView).toHaveBeenCalledWith(WATCH_VIEW_ID, false);

        const none = setup(null);
        selectionToWatchAction.run(none.accessor);
        expect(none.addWatchExpression).not.toHaveBeenCalled();
    });
});

describe("Go to Next/Previous Breakpoint", () => {
    async function setup() {
        const fx = createDebugServiceFixture();
        registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING);
        const a = Uri.file("/w/a.cpp");
        const b = Uri.file("/w/b.cpp");
        const c = Uri.file("/w/c.cpp");
        const model = fx.service.getModel() as DebugModel;
        model.addBreakpoints(a, [{ lineNumber: 2 }, { lineNumber: 5 }, { lineNumber: 8, enabled: false }]);
        model.addBreakpoints(c, [{ lineNumber: 1 }]);
        const opened: string[] = [];
        const go = async (next: boolean, uri: Uri, line: number) => {
            const map = services(fakeEditor(line - 1, 0, uri), fx.service);
            map.set(BreakpointSourcesDIToken, {
                openBreakpoint: (bp: { uri: Uri; lineNumber: number }, sideBySide: boolean) => {
                    expect(sideBySide).toBe(false);
                    opened.push(`${bp.uri.path}:${String(bp.lineNumber)}`);
                    return Promise.resolve();
                },
            });
            await (next ? goToNextBreakpointAction : goToPreviousBreakpointAction).run(harness(map).accessor);
        };
        return { fx, a, b, c, opened, go };
    }

    it("next: after the cursor in the file, else in the files after it, else the first; disabled ones are skipped", async () => {
        const { fx, a, b, c, opened, go } = await setup();
        await go(true, a, 1);
        await go(true, a, 2);
        await go(true, a, 5);
        await go(true, b, 1);
        await go(true, c, 1);
        expect(opened).toEqual(["/w/a.cpp:2", "/w/a.cpp:5", "/w/c.cpp:1", "/w/c.cpp:1", "/w/a.cpp:2"]);
        fx.service.dispose();
    });

    it("previous: before the cursor in the file, else in the files before it, else the last", async () => {
        const { fx, a, b, c, opened, go } = await setup();
        await go(false, a, 9);
        await go(false, a, 5);
        await go(false, b, 1);
        await go(false, c, 1);
        await go(false, a, 2);
        expect(opened).toEqual(["/w/a.cpp:5", "/w/a.cpp:2", "/w/a.cpp:5", "/w/a.cpp:5", "/w/c.cpp:1"]);
        fx.service.dispose();
    });

    it("no breakpoints or no editor: nowhere to go", async () => {
        const fx = createDebugServiceFixture();
        const openBreakpoint = vi.fn();
        for (const editor of [fakeEditor(0, 0), null]) {
            const map = services(editor, fx.service);
            map.set(BreakpointSourcesDIToken, { openBreakpoint });
            await goToNextBreakpointAction.run(harness(map).accessor);
            await goToPreviousBreakpointAction.run(harness(map).accessor);
        }
        expect(openBreakpoint).not.toHaveBeenCalled();
        fx.service.dispose();
    });
});

describe("Inline Breakpoint (Shift+F9)", () => {
    it("a breakpoint at the cursor's column, a line breakpoint at the line's start; none where one is", async () => {
        const fx = createDebugServiceFixture();
        registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING);
        fx.service.getAdapterManager().registerBreakpoints({ language: "cpp" });
        const at = async (line: number, column: number) => {
            await toggleInlineBreakpointAction.run(harness(services(fakeEditor(line, column), fx.service)).accessor);
        };
        await at(0, 4);
        await at(0, 4);
        await at(1, 0);
        await at(1, 0);
        await at(2, 6);
        await at(1, 6);
        expect(
            fx.service
                .getModel()
                .getBreakpoints()
                .map((bp) => [bp.lineNumber, bp.column]),
        ).toEqual([
            [1, 5],
            [2, undefined],
            [2, 7],
            [3, 7],
        ]);
        // A line breakpoint is where a column 1 would be.
        (fx.service.getModel() as DebugModel).addBreakpoints(FILE, [{ lineNumber: 9 }]);
        await at(8, 0);
        expect(fx.service.getModel().getBreakpoints({ lineNumber: 9 })).toHaveLength(1);
        fx.service.dispose();
    });

    it("nothing where breakpoints cannot be set, or without an editor", async () => {
        const fx = createDebugServiceFixture();
        await toggleInlineBreakpointAction.run(harness(services(fakeEditor(0, 4), fx.service)).accessor);
        await toggleInlineBreakpointAction.run(harness(services(null, fx.service)).accessor);
        expect(fx.service.getModel().getBreakpoints()).toEqual([]);
        fx.service.dispose();
    });
});

describe("Close Exception Widget", () => {
    it("closes the contribution's badge", () => {
        const closeExceptionWidget = vi.fn();
        closeExceptionWidgetAction.run(
            harness(new Map([[DebugEditorContributionDIToken, { closeExceptionWidget }]])).accessor,
        );
        expect(closeExceptionWidget).toHaveBeenCalledOnce();
    });
});
