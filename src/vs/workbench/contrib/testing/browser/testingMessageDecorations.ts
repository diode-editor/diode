import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import type { IProductIcon } from "../../../../base/common/codicons.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import { removeAnsiEscapeCodes, truncateMiddle } from "../../../../base/common/strings.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { ILineMessageDecoration } from "../../../../editor/common/model/iLineMessageDecoration.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { TestResultState } from "../../../api/common/testingWireTypes.ts";
import { isFailedState } from "../common/testingStates.ts";
import type { ITestResultItem, ITestResultMessage, LiveTestResult } from "../common/testResult.ts";
import { type TestResultService, TestResultServiceDIToken } from "../common/testResultService.ts";

import { testingStatesToIcons } from "./icons.ts";
import { PEEK_TEST_ERROR_COMMAND } from "./testingDecorations.ts";
import type { TestMessageSubject } from "./testResultsOutput.ts";

// Upstream `contrib/testing/browser/testingDecorations.ts`: `TestErrorContentWidget` and `TestMessageDecoration` of
// `TestingDecorations.applyResults`. Deviations: no hover, no peek — TEST RESULTS plays its role; the error is a badge
// of cells after the line's end, not a widget with an arrow.

/** Upstream `MAX_INLINE_MESSAGE_LENGTH`. */
export const MAX_INLINE_MESSAGE_LENGTH = 128;

/** Upstream `lineBreakRe`. */
const LINE_BREAK = /\r?\n\s*/g;
/** What is left of the control characters once the escape sequences are gone: a cell shows none of them. */
// eslint-disable-next-line no-control-regex -- the control characters are what it matches
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

type ITestErrorMessage = Extract<ITestResultMessage, { readonly type: "error" }>;

/** `TextEditorPane` matches structurally; the DI module does the binding. */
export interface ITestingMessagesEditor {
    readonly uri: Uri;
    /** The large-file mode (docs/arch/Editor.md) has no messages; the event fires when it is left. */
    readonly isTooLargeForTokenization: boolean;
    onDidChangeTooLargeForTokenization(listener: () => void): IDisposable;
    setLineMessageDecorations(decorations: readonly ILineMessageDecoration[]): void;
    getLineMessageDecorations(): ReadonlyMap<number, ILineMessageDecoration>;
    onDidClickLineMessage(listener: (key: string) => void): IDisposable;
}

export interface ITestingMessagesEditorSource {
    /** The tabs' text editors of every group: no diff sides, no panels. */
    getEditors(): readonly ITestingMessagesEditor[];
    onDidChangeEditors(listener: () => void): IDisposable;
}

/** Upstream `ITestingPeekOpener` as TEST RESULTS does it: `TestResultsComponent` matches structurally. */
export interface ITestingMessagePeek {
    showMessage(subject: TestMessageSubject, preserveFocus: boolean): void;
    selectMessage(subject: TestMessageSubject): void;
}

export const TestingMessagesEditorSourceDIToken = token<ITestingMessagesEditorSource>("TestingMessagesEditorSource");
export const TestingMessagePeekDIToken = token<ITestingMessagePeek>("TestingMessagePeek");
export const TestingMessageDecorationsDIToken = token<TestingMessageDecorations>("TestingMessageDecorations");

/** A message an editor shows, with the line it was placed on. */
export interface IShownTestMessage {
    readonly line: number;
    readonly subject: TestMessageSubject;
}

interface IAttachedEditor {
    readonly editor: ITestingMessagesEditor;
    readonly subscriptions: readonly IDisposable[];
    /** The messages the editor shows, by their decorations' keys. */
    shown: ReadonlyMap<string, IShownTestMessage>;
}

/**
 * Upstream `TestingDecorations.applyResults`: each text editor shows, after a line's end, the error messages of the
 * latest result (of every result with `testing.showAllMessages`) whose location or a stack frame is in its file — one
 * per line, errors first; with Toggle Inline Test Output also the logged output with a location in the file. A click
 * on a message shows it in TEST RESULTS, the keyboard stays in the editor.
 */
export class TestingMessageDecorations extends Disposable {
    public static dependencies = [
        TestingMessagesEditorSourceDIToken,
        TestResultServiceDIToken,
        IConfigurationServiceDIToken,
        ProductIconServiceDIToken,
        TestingMessagePeekDIToken,
        CommandRegistryDIToken,
    ] as const;

    private readonly attached = new Map<ITestingMessagesEditor, IAttachedEditor>();
    private refreshQueued = false;
    private showInlineOutputValue = false;
    /** Upstream `lastUri`: the message shown last, Peek Output's fallback. */
    private lastShown: TestMessageSubject | undefined;

    public constructor(
        private readonly editors: ITestingMessagesEditorSource,
        private readonly results: TestResultService,
        private readonly configuration: IConfigurationService,
        private readonly icons: IProductIconService,
        private readonly peek: ITestingMessagePeek,
        commands: CommandRegistry,
    ) {
        super();
        this.register(
            commands.register(PEEK_TEST_ERROR_COMMAND, (testId: unknown) => {
                if (typeof testId === "string") this.showFirstError(testId);
            }),
        );
        this.register(
            editors.onDidChangeEditors(() => {
                this.syncEditors();
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
                if (event.affectsConfiguration("testing.showAllMessages")) this.refreshAll();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.refreshAll();
            }),
        );
        this.register({
            dispose: () => {
                for (const state of [...this.attached.values()]) this.detach(state);
            },
        });
        this.syncEditors();
    }

    /** Upstream `ITestService.showInlineOutput`, in memory: a restart starts without it. */
    public get showInlineOutput(): boolean {
        return this.showInlineOutputValue;
    }

    /** Upstream `ToggleInlineTestOutput`. */
    public toggleInlineOutput(): void {
        this.showInlineOutputValue = !this.showInlineOutputValue;
        this.refreshAll();
    }

    /** The error messages the editor shows, by the lines they are on now: the targets of Go to Next Test Failure. */
    public failuresIn(editor: ITestingMessagesEditor): IShownTestMessage[] {
        const state = this.attached.get(editor);
        if (state === undefined) return [];
        const failures: IShownTestMessage[] = [];
        for (const [line, decoration] of editor.getLineMessageDecorations()) {
            const shown = state.shown.get(decoration.key);
            if (shown !== undefined && messageOf(shown.subject).type === "error")
                failures.push({ line, subject: shown.subject });
        }
        return failures.sort((a, b) => a.line - b.line);
    }

    /** Upstream `peekUri`: TEST RESULTS with the message; Peek Output's next fallback. */
    public show(subject: TestMessageSubject, preserveFocus: boolean): void {
        this.lastShown = subject;
        this.peek.showMessage(subject, preserveFocus);
    }

    /** The message is chosen in TEST RESULTS if it is shown, as Go to Next Test Failure does with the peek's. */
    public select(subject: TestMessageSubject): void {
        this.lastShown = subject;
        this.peek.selectMessage(subject);
    }

    /**
     * Upstream `TestingPeekOpener.open`: the editor's failure nearest to the line, otherwise the message shown last,
     * otherwise the first failure with a location of the latest results; none — nothing opens.
     */
    public showNearest(editor: ITestingMessagesEditor | undefined, line: number): void {
        let nearest: IShownTestMessage | undefined;
        for (const failure of editor === undefined ? [] : this.failuresIn(editor)) {
            if (nearest === undefined || Math.abs(failure.line - line) < Math.abs(nearest.line - line))
                nearest = failure;
        }
        const last = this.lastShown;
        const subject =
            nearest?.subject ?? (last !== undefined && this.results.results.includes(last.result) ? last : undefined);
        const candidate = subject ?? this.anyFailure();
        if (candidate !== undefined) this.show(candidate, false);
    }

    /**
     * Upstream `tryPeekFirstError` ("Peek Error" of a test's menu): the first error message with a location of the
     * test's latest result; none — nothing opens.
     */
    public showFirstError(testId: string): void {
        const found = this.results.getStateById(testId);
        const subject = found === undefined ? undefined : failuresOf(...found).at(0);
        if (subject !== undefined) this.show(subject, false);
    }

    /** Upstream `getAnyCandidateMessage`: the runs from the latest, their failed tests' first error with a location. */
    private anyFailure(): TestMessageSubject | undefined {
        for (const result of this.results.results) {
            for (const test of result.tests) {
                if (!isFailedState(test.ownComputedState)) continue;
                const subject = failuresOf(result, test).at(0);
                if (subject !== undefined) return subject;
            }
        }
        return undefined;
    }

    private syncEditors(): void {
        const open = new Set(this.editors.getEditors());
        for (const state of [...this.attached.values()]) {
            if (!open.has(state.editor)) this.detach(state);
        }
        for (const editor of open) {
            if (this.attached.has(editor)) continue;
            const state: IAttachedEditor = {
                editor,
                subscriptions: [
                    editor.onDidClickLineMessage((key) => {
                        // The keys and the messages are set together.
                        const shown = state.shown.get(key);
                        if (shown !== undefined) this.show(shown.subject, true);
                    }),
                    editor.onDidChangeTooLargeForTokenization(() => {
                        this.refresh(state);
                    }),
                ],
                shown: new Map(),
            };
            this.attached.set(editor, state);
            this.refresh(state);
        }
    }

    private detach(state: IAttachedEditor): void {
        for (const subscription of state.subscriptions) subscription.dispose();
        this.attached.delete(state.editor);
    }

    /** A run reports message by message: the editors are recomputed once per batch. */
    private queueRefresh(): void {
        if (this.refreshQueued) return;
        this.refreshQueued = true;
        queueMicrotask(() => {
            this.refreshQueued = false;
            this.refreshAll();
        });
    }

    private refreshAll(): void {
        for (const state of this.attached.values()) this.refresh(state);
    }

    /** Upstream `applyResultsContentWidgets` and `applyResultsLoggedMessages`. */
    private refresh(state: IAttachedEditor): void {
        const { editor } = state;
        const shown = new Map<string, IShownTestMessage>();
        const decorations: ILineMessageDecoration[] = [];
        if (!editor.isTooLargeForTokenization) {
            const uri = editor.uri.toString();
            const results = this.configuration.get("testing.showAllMessages")
                ? this.results.results
                : this.results.results.slice(0, 1);
            const seenLines = new Set<number>();
            const add = (
                subject: TestMessageSubject,
                line: number,
                decoration: Omit<ILineMessageDecoration, "key" | "line">,
            ) => {
                seenLines.add(line);
                const key = subjectKey(subject);
                shown.set(key, { line, subject });
                decorations.push({ key, line, ...decoration });
            };
            // Errors first: they take their lines before the output.
            for (const result of results) {
                forEachMessage(result, (subject, message) => {
                    if (message.type !== "error") return;
                    const line = errorLine(message, uri);
                    if (line === undefined || seenLines.has(line)) return;
                    add(subject, line, {
                        text: ` ${this.icons.glyph(failedIcon())} ${errorText(message)} `,
                        colorToken: "testing.message.error.badgeForeground",
                        bgToken: "testing.message.error.badgeBackground",
                    });
                });
            }
            if (this.showInlineOutputValue) {
                for (const result of results) {
                    // Upstream walks a task's messages from the last: the latest output of a line wins.
                    forEachMessage(
                        result,
                        (subject, message) => {
                            if (message.type !== "output" || message.location?.uri !== uri) return;
                            const line = message.location.range.start.line;
                            if (seenLines.has(line)) return;
                            add(subject, line, {
                                text: outputText(message.message),
                                colorToken: "testing.message.info.decorationForeground",
                            });
                        },
                        true,
                    );
                }
            }
        }
        state.shown = shown;
        editor.setLineMessageDecorations(decorations);
    }
}

function failedIcon(): IProductIcon {
    // Every terminal state has an icon.
    return assertReturnsDefined(testingStatesToIcons[TestResultState.Failed]).icon;
}

/** One line of cells: the escape sequences go, the other control characters become spaces. */
function plainText(text: string): string {
    return removeAnsiEscapeCodes(text).replace(CONTROL_CHARACTERS, " ");
}

/** The message of a subject: the run keeps every message it got. */
export function messageOf(subject: TestMessageSubject): ITestResultMessage {
    return subject.test.tasks[subject.taskIndex].messages[subject.messageIndex];
}

function subjectKey(subject: TestMessageSubject): string {
    return `${subject.result.id}/${String(subject.taskIndex)}/${subject.test.item.extId}/${String(subject.messageIndex)}`;
}

/** The messages of a run's tests, task by task; `fromLast` walks each task's messages from the last. */
function forEachMessage(
    result: LiveTestResult,
    visit: (subject: TestMessageSubject, message: ITestResultMessage) => void,
    fromLast = false,
): void {
    for (const test of result.tests) {
        test.tasks.forEach((task, taskIndex) => {
            const indexes = task.messages.map((_, index) => index);
            if (fromLast) indexes.reverse();
            for (const messageIndex of indexes) {
                visit({ kind: "message", result, taskIndex, test, messageIndex }, task.messages[messageIndex]);
            }
        });
    }
}

/** Upstream `getFailedCandidateMessage`: the test's error messages with a location, task by task. */
function failuresOf(result: LiveTestResult, test: ITestResultItem): TestMessageSubject[] {
    const subjects: TestMessageSubject[] = [];
    test.tasks.forEach((task, taskIndex) => {
        task.messages.forEach((message, messageIndex) => {
            if (message.type === "error" && message.location !== undefined)
                subjects.push({ kind: "message", result, taskIndex, test, messageIndex });
        });
    });
    return subjects;
}

/** The line of the file an error points at: its location there, otherwise the first stack frame there. */
function errorLine(message: ITestErrorMessage, uri: string): number | undefined {
    if (message.location?.uri === uri) return message.location.range.start.line;
    return message.stackTrace?.find((frame) => frame.uri === uri && frame.position !== undefined)?.position?.line;
}

/** Upstream `TestErrorContentWidget`'s text: `actual != expected` when both are known, else the first line. */
export function errorText(message: ITestErrorMessage): string {
    if (message.expected !== undefined && message.actual !== undefined) {
        const oneLine = (value: string) => truncateMiddle(plainText(value).replace(/\s+/g, " "), 30);
        return `${oneLine(message.actual)} != ${oneLine(message.expected)}`;
    }
    const text = removeAnsiEscapeCodes(message.message);
    const lineFeed = text.indexOf("\n");
    return plainText(lineFeed === -1 ? text : text.slice(0, lineFeed)) || "Test Failed";
}

/** Upstream `TestMessageDecoration`'s text: one line, at most {@link MAX_INLINE_MESSAGE_LENGTH} with the ellipsis. */
export function outputText(message: string): string {
    const text = plainText(removeAnsiEscapeCodes(message).replace(LINE_BREAK, " "));
    return text.length > MAX_INLINE_MESSAGE_LENGTH ? `${text.slice(0, MAX_INLINE_MESSAGE_LENGTH - 1)}…` : text;
}
