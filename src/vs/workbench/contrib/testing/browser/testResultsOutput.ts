import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";

import { Disposable, DisposableStore, toDisposable } from "../../../../base/common/lifecycle.ts";
import { formatMessageForTerminal } from "../../../../platform/terminal/common/terminalStrings.ts";
import { applyTerminalColors, type TerminalColorsService } from "../../terminal/browser/terminalColorsService.ts";
import type { ExtensionPtySessionFactory, IExtensionPtySession } from "../../terminal/common/terminalSessionFactory.ts";
import type { LiveTestResult } from "../common/testResult.ts";

/** What the content shows: a task's output, a test's output in a task, or the text of a test's message. */
export type TestResultsSubject =
    | { readonly kind: "task"; readonly result: LiveTestResult; readonly taskIndex: number }
    | { readonly kind: "test"; readonly result: LiveTestResult; readonly taskIndex: number; readonly testId: string }
    | {
          readonly kind: "message";
          readonly result: LiveTestResult;
          readonly taskIndex: number;
          readonly testId: string;
          readonly messageIndex: number;
      };

/** Upstream's texts of an empty output. */
export const CASE_NO_OUTPUT = "The test case did not report any output.";
export const RUN_NO_OUTPUT = "The test run did not record any output.";

/** Upstream `makeTerminal` on reuse: a full reset (RIS) — the screen, the scrollback, the modes. */
const RESET = "\x1bc";
/** Upstream `attachTerminalToDom`: the output has no cursor. */
const HIDE_CURSOR = "\x1b[?25l";

/** Upstream `createDetachedTerminal`'s size before the first layout. */
const INITIAL_COLS = 80;
const INITIAL_ROWS = 10;

/**
 * Upstream `TerminalMessagePeek`: the output in a read-only terminal surface — ANSI colors in the terminal's palette,
 * wrapping, the scrollback; a live run writes into it as it goes. One surface, reset for each subject, as upstream.
 * The widget takes no keyboard: nothing is typed into the output, and the workbench keeps its keys.
 */
export class TestResultsOutput extends Disposable {
    private readonly subjectStore = this.register(new DisposableStore());
    private readonly session: IExtensionPtySession;
    public readonly widget: TerminalViewElement;

    public constructor(
        createSession: ExtensionPtySessionFactory,
        colors: Pick<TerminalColorsService, "colors" | "onDidChange">,
    ) {
        super();
        this.session = createSession({
            cols: INITIAL_COLS,
            rows: INITIAL_ROWS,
            name: "Test Results",
            onInput: () => undefined,
            onResize: () => undefined,
        });
        const widget = new TerminalViewElement(this.session);
        this.widget = widget;
        widget.focusable = false;
        const session = this.session;
        this.register(
            toDisposable(() => {
                widget.dispose();
                session.dispose();
            }),
        );
        applyTerminalColors(session, widget, colors.colors);
        this.register(
            colors.onDidChange((next) => {
                applyTerminalColors(session, widget, next);
            }),
        );
        session.feed(HIDE_CURSOR);
    }

    /** An empty surface: the shown run is gone. */
    public clear(): void {
        this.subjectStore.clear();
        this.session.feed(RESET + HIDE_CURSOR);
    }

    public show(subject: TestResultsSubject): void {
        this.clear();
        if (subject.kind === "message") {
            const message = subject.result.getStateById(subject.testId)?.tasks[subject.taskIndex].messages[
                subject.messageIndex
            ];
            // Plain text: the message's lines as they are.
            this.session.feed((message?.message ?? "").replace(/\r?\n/g, "\r\n"));
            return;
        }
        const { result, taskIndex } = subject;
        const task = result.tasks[taskIndex];
        const testId = subject.kind === "test" ? subject.testId : undefined;
        const initial =
            testId === undefined
                ? task.output
                : (result.getStateById(testId)?.tasks[taskIndex].messages ?? [])
                      .filter((message) => message.type === "output")
                      .map((message) => task.output.slice(message.offset, message.offset + message.length))
                      .join("");
        let wrote = initial.length > 0;
        this.session.feed(initial);
        const finish = (): void => {
            if (wrote) return;
            this.session.feed(formatMessageForTerminal(testId === undefined ? RUN_NO_OUTPUT : CASE_NO_OUTPUT));
        };
        if (result.completedAt !== undefined) {
            finish();
            return;
        }
        this.subjectStore.add(
            result.onDidAppendOutput((append) => {
                if (append.taskIndex !== taskIndex || (testId !== undefined && append.testId !== testId)) return;
                wrote ||= append.output.length > 0;
                this.session.feed(append.output);
            }),
        );
        this.subjectStore.add(result.onComplete(finish));
    }
}
