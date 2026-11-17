// The exception's badge over fake editors and a fake debug service: which frame shows it, in which editors, the
// console's text once per stop, Close Exception Widget until the next stop, the context key, the click, a late
// answer of the adapter, and the texts of the badge and the console.

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILineMessageDecoration } from "../../../../editor/common/model/iLineMessageDecoration.ts";
import {
    type IDebugService,
    type IDebugSession,
    type IExceptionInfo,
    type IRawStoppedDetails,
    type IStackFrame,
    REPL_VIEW_ID,
    State,
} from "../common/debug.ts";

import {
    DebugEditorContribution,
    EXCEPTION_MESSAGE_OWNER,
    exceptionBadgeText,
    exceptionConsoleText,
    type IDebugEditor,
} from "./debugEditorContribution.ts";

const FILE = Uri.file("/w/main.cpp");
const OTHER = Uri.file("/w/other.cpp");

const INFO: IExceptionInfo = {
    id: "std::out_of_range",
    description: "vector::_M_range_check",
    breakMode: "always",
    details: { stackTrace: "  at accumulate\n  at main" },
};

interface IFakeEditor extends IDebugEditor {
    messages: readonly ILineMessageDecoration[];
    click(key: string): void;
}

function fakeEditor(uri = FILE): IFakeEditor {
    const clicks = new Emitter<string>();
    const editor: IFakeEditor = {
        uri,
        messages: [],
        setLineMessageDecorations: (decorations, owner) => {
            expect(owner).toBe(EXCEPTION_MESSAGE_OWNER);
            editor.messages = decorations;
        },
        onDidClickLineMessage: (listener) => clicks.event(listener),
        click: (key) => {
            clicks.fire(key);
        },
    };
    return editor;
}

interface IFrameSpec {
    readonly uri?: Uri;
    readonly line: number;
    readonly available?: boolean;
    readonly hint?: string;
}

/** A thread stopped with `stop`, its call stack from `specs`; the session takes the console's output. */
function stoppedThread(
    specs: readonly IFrameSpec[],
    stop: IRawStoppedDetails | undefined,
    exceptionInfo: Promise<IExceptionInfo | undefined>,
): { frames: IStackFrame[]; appendToRepl: ReturnType<typeof vi.fn> } {
    const appendToRepl = vi.fn();
    const session = { appendToRepl } as unknown as IDebugSession;
    const thread = { session, stoppedDetails: stop, exceptionInfo };
    const frames = specs.map(
        (spec) =>
            ({
                source: { uri: spec.uri ?? FILE, available: spec.available ?? true, presentationHint: spec.hint },
                range: { startLineNumber: spec.line },
                thread,
            }) as unknown as IStackFrame,
    );
    Object.assign(thread, { getCallStack: () => frames });
    return { frames, appendToRepl };
}

describe("DebugEditorContribution", () => {
    let open: IFakeEditor[];
    let editorsChanged: Emitter<void>;
    let focusChanged: Emitter<void>;
    let stateChanged: Emitter<State>;
    let focused: IStackFrame | undefined;
    let keys: Map<string, unknown>;
    let openView: Mock<(viewId: string, focus?: boolean) => void>;
    let contribution: DebugEditorContribution | undefined;

    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
        open = [fakeEditor(), fakeEditor(OTHER)];
        editorsChanged = new Emitter<void>();
        focusChanged = new Emitter<void>();
        stateChanged = new Emitter<State>();
        focused = undefined;
        keys = new Map();
        openView = vi.fn<(viewId: string, focus?: boolean) => void>();
        contribution = undefined;
    });

    afterEach(() => {
        contribution?.dispose();
    });

    function create(): DebugEditorContribution {
        const debugService = {
            getViewModel: () => ({
                get focusedStackFrame() {
                    return focused;
                },
                onDidFocusStackFrame: focusChanged.event,
            }),
            onDidChangeState: stateChanged.event,
        } as unknown as IDebugService;
        contribution = new DebugEditorContribution(
            { getEditors: () => open, onDidChangeEditors: (listener) => editorsChanged.event(listener) },
            debugService,
            {
                set: (key: string, value: unknown) => {
                    keys.set(key, value);
                },
            },
            { openView },
        );
        return contribution;
    }

    /** Focuses the frame and lets the exception's info come. */
    async function focus(frame: IStackFrame | undefined): Promise<void> {
        focused = frame;
        focusChanged.fire();
        await settle();
    }

    function badge(editor = open[0]): [number, string, string, string | undefined] | undefined {
        const message = editor.messages.at(0);
        return message && [message.line, message.text, message.colorToken, message.bgToken];
    }

    it("the exception's frame shows the badge after its line in the editors of its file, the console gets it once", async () => {
        create();
        const stop: IRawStoppedDetails = { reason: "exception" };
        const { frames, appendToRepl } = stoppedThread([{ line: 30 }, { line: 47 }], stop, Promise.resolve(INFO));
        await focus(frames[0]);

        expect(badge()).toEqual([
            29,
            " Exception has occurred: std::out_of_range — vector::_M_range_check ",
            "editor.foreground",
            "debugExceptionWidget.background",
        ]);
        expect(open[0].messages[0].key).toBe(EXCEPTION_MESSAGE_OWNER);
        expect(open[1].messages).toEqual([]);
        expect(keys.get("exceptionWidgetVisible")).toBe(true);
        expect(appendToRepl.mock.calls).toEqual([
            [
                {
                    output: "Exception has occurred: std::out_of_range\nvector::_M_range_check\n  at accumulate\n  at main\n",
                    sev: "error",
                },
            ],
        ]);

        // Another frame of the stack: no badge; back to the exception's frame: the badge, the console not again.
        await focus(frames[1]);
        expect(badge()).toBeUndefined();
        expect(keys.get("exceptionWidgetVisible")).toBe(false);
        await focus(frames[0]);
        expect(badge()?.[0]).toBe(29);
        expect(appendToRepl).toHaveBeenCalledTimes(1);
    });

    it("the exception's frame is the first one with an available source that is not deemphasized", async () => {
        create();
        const stop: IRawStoppedDetails = { reason: "exception" };
        const { frames } = stoppedThread(
            [{ line: 1, available: false }, { line: 2, hint: "deemphasize" }, { line: 3, hint: "normal" }, { line: 4 }],
            stop,
            Promise.resolve(INFO),
        );
        for (const frame of [frames[0], frames[1], frames[3]]) {
            await focus(frame);
            expect(badge()).toBeUndefined();
        }
        await focus(frames[2]);
        expect(badge()?.[0]).toBe(2);
    });

    it("no badge without a focused frame, a stop or an exception's info", async () => {
        create();
        await focus(undefined);
        expect(badge()).toBeUndefined();
        // Nothing was shown: the editors and the key are not touched.
        expect(keys.has("exceptionWidgetVisible")).toBe(false);

        const unstopped = stoppedThread([{ line: 5 }], undefined, Promise.resolve(INFO));
        await focus(unstopped.frames[0]);
        expect(badge()).toBeUndefined();

        const noInfo = stoppedThread([{ line: 5 }], { reason: "step" }, Promise.resolve(undefined));
        await focus(noInfo.frames[0]);
        expect(badge()).toBeUndefined();
        expect(noInfo.appendToRepl).not.toHaveBeenCalled();
    });

    it("Close Exception Widget hides it until the next stop; the console is not told twice", async () => {
        const c = create();
        c.closeExceptionWidget();
        expect(keys.has("exceptionWidgetVisible")).toBe(false);

        const first = stoppedThread([{ line: 30 }], { reason: "exception" }, Promise.resolve(INFO));
        await focus(first.frames[0]);
        c.closeExceptionWidget();
        expect(badge()).toBeUndefined();
        expect(keys.get("exceptionWidgetVisible")).toBe(false);
        await focus(first.frames[0]);
        expect(badge()).toBeUndefined();

        const next = stoppedThread([{ line: 31 }], { reason: "exception" }, Promise.resolve(INFO));
        await focus(next.frames[0]);
        expect(badge()?.[0]).toBe(30);
        expect(first.appendToRepl).toHaveBeenCalledTimes(1);
    });

    it("leaving the stopped state takes the badge away; staying stopped does not ask again", async () => {
        create();
        const { frames } = stoppedThread([{ line: 30 }], { reason: "exception" }, Promise.resolve(INFO));
        await focus(frames[0]);
        stateChanged.fire(State.Stopped);
        await settle();
        expect(badge()?.[0]).toBe(29);
        focused = undefined;
        stateChanged.fire(State.Running);
        await settle();
        expect(badge()).toBeUndefined();
    });

    it("an editor opened later shows it; a closed editor is let go; the context key follows the editors", async () => {
        create();
        open = [fakeEditor(OTHER)];
        editorsChanged.fire();
        const { frames } = stoppedThread([{ line: 30 }], { reason: "exception" }, Promise.resolve(INFO));
        await focus(frames[0]);
        expect(keys.get("exceptionWidgetVisible")).toBe(false);

        const later = fakeEditor();
        open = [...open, later];
        editorsChanged.fire();
        expect(badge(later)?.[0]).toBe(29);
        expect(keys.get("exceptionWidgetVisible")).toBe(true);

        open = [open[0]];
        editorsChanged.fire();
        expect(keys.get("exceptionWidgetVisible")).toBe(false);
        later.click(EXCEPTION_MESSAGE_OWNER);
        expect(openView).not.toHaveBeenCalled();
    });

    it("a click on the badge opens the Debug Console without its focus; another owner's message is not it", async () => {
        create();
        open[0].click("some-test");
        expect(openView).not.toHaveBeenCalled();
        open[0].click(EXCEPTION_MESSAGE_OWNER);
        expect(openView).toHaveBeenCalledWith(REPL_VIEW_ID, false);
    });

    it("an answer that comes after a newer focus is dropped", async () => {
        create();
        let answer: (info: IExceptionInfo) => void = () => undefined;
        const late = stoppedThread(
            [{ line: 30 }],
            { reason: "exception" },
            new Promise((resolve) => {
                answer = resolve;
            }),
        );
        focused = late.frames[0];
        focusChanged.fire();
        await focus(undefined);
        answer(INFO);
        await settle();
        expect(badge()).toBeUndefined();
        expect(late.appendToRepl).not.toHaveBeenCalled();
    });

    it("a disposed contribution lets the editors go", async () => {
        const c = create();
        c.dispose();
        contribution = undefined;
        open[0].click(EXCEPTION_MESSAGE_OWNER);
        expect(openView).not.toHaveBeenCalled();
    });
});

describe("the exception's texts", () => {
    it("the badge: title and description on one line; without an id or a description, less", () => {
        expect(exceptionBadgeText({ id: "E", description: "a\n  b\tc", breakMode: null })).toBe(
            " Exception has occurred: E — a b c ",
        );
        expect(exceptionBadgeText({ description: "boom", breakMode: null })).toBe(" Exception has occurred. — boom ");
        expect(exceptionBadgeText({ id: "E", breakMode: null })).toBe(" Exception has occurred: E ");
    });

    it("the console: title, description, stack trace, each on its lines", () => {
        expect(exceptionConsoleText({ breakMode: null })).toBe("Exception has occurred.\n");
        expect(exceptionConsoleText({ id: "E", breakMode: null, details: {} })).toBe("Exception has occurred: E\n");
        expect(exceptionConsoleText({ id: "E", description: "d", breakMode: null })).toBe(
            "Exception has occurred: E\nd\n",
        );
    });
});
