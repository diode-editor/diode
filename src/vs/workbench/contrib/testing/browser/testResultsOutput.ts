import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";

import { Disposable, DisposableStore } from "../../../../base/common/lifecycle.ts";
import { formatMessageForTerminal } from "../../../../platform/terminal/common/terminalStrings.ts";
import {
    applyTerminalColors,
    type ITerminalColors,
    type TerminalColorsService,
} from "../../terminal/browser/terminalColorsService.ts";
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

/** Upstream `attachTerminalToDom`: the output has no cursor. */
const HIDE_CURSOR = "\x1b[?25l";

/** Upstream `createDetachedTerminal`'s size before the first layout. */
const INITIAL_COLS = 80;
const INITIAL_ROWS = 10;

/**
 * Upstream `TerminalMessagePeek`: the output in a read-only terminal surface — ANSI colors in the terminal's palette,
 * wrapping, the scrollback; a live run writes into it as it goes. Each subject gets a fresh surface (upstream resets
 * one). The widget takes no keyboard: nothing is typed into the output, and the workbench keeps its keys.
 */
export class TestResultsOutput extends Disposable {
    private readonly subjectStore = this.register(new DisposableStore());
    private session: IExtensionPtySession | null = null;
    private widgetValue: TerminalViewElement;

    public constructor(
        private readonly createSession: ExtensionPtySessionFactory,
        private readonly colors: Pick<TerminalColorsService, "colors" | "onDidChange">,
        /** The new widget goes where the old one was. */
        private readonly onDidChangeWidget: (widget: TerminalViewElement) => void,
    ) {
        super();
        this.widgetValue = this.createWidget();
        this.register(
            colors.onDidChange((next) => {
                this.applyColors(next);
            }),
        );
    }

    public get widget(): TerminalViewElement {
        return this.widgetValue;
    }

    /** An empty surface: the shown run is gone. */
    public clear(): void {
        this.widgetValue = this.createWidget();
        this.onDidChangeWidget(this.widgetValue);
    }

    public show(subject: TestResultsSubject): void {
        this.clear();
        if (subject.kind === "message") {
            this.showMessage(subject);
            return;
        }
        const { result, taskIndex } = subject;
        const task = result.tasks[taskIndex];
        const initial =
            subject.kind === "task"
                ? task.output
                : (result.getStateById(subject.testId)?.tasks[taskIndex].messages ?? [])
                      .filter((message) => message.type === "output")
                      .map((message) => task.output.slice(message.offset, message.offset + message.length))
                      .join("");
        const noOutput = subject.kind === "task" ? RUN_NO_OUTPUT : CASE_NO_OUTPUT;
        let wrote = initial.length > 0;
        this.write(initial);
        if (result.completedAt !== undefined) {
            if (!wrote) this.write(formatMessageForTerminal(noOutput));
            return;
        }
        const testId = subject.kind === "test" ? subject.testId : undefined;
        this.subjectStore.add(
            result.onDidAppendOutput((append) => {
                if (append.taskIndex !== taskIndex || (testId !== undefined && append.testId !== testId)) return;
                wrote ||= append.output.length > 0;
                this.write(append.output);
            }),
        );
        this.subjectStore.add(
            result.onComplete(() => {
                if (!wrote) this.write(formatMessageForTerminal(noOutput));
            }),
        );
    }

    /** Plain text: the message's lines as they are. */
    private showMessage(subject: Extract<TestResultsSubject, { kind: "message" }>): void {
        const message = subject.result.getStateById(subject.testId)?.tasks[subject.taskIndex].messages[
            subject.messageIndex
        ];
        this.write((message?.message ?? "").replace(/\r?\n/g, "\r\n"));
    }

    private write(data: string): void {
        this.session?.feed(data);
    }

    private createWidget(): TerminalViewElement {
        this.subjectStore.clear();
        this.session?.dispose();
        const session = this.createSession({
            cols: INITIAL_COLS,
            rows: INITIAL_ROWS,
            name: "Test Results",
            onInput: () => undefined,
            onResize: () => undefined,
        });
        this.session = session;
        const widget = new TerminalViewElement(session);
        widget.focusable = false;
        this.subjectStore.add({
            dispose: () => {
                widget.dispose();
            },
        });
        this.applyColors(this.colors.colors, widget);
        session.feed(HIDE_CURSOR);
        return widget;
    }

    /** Upstream `colorProvider` over the terminal's colors. */
    private applyColors(colors: ITerminalColors, widget = this.widgetValue): void {
        if (this.session !== null) applyTerminalColors({ session: this.session }, widget, colors);
    }

    public override dispose(): void {
        super.dispose();
        this.session?.dispose();
        this.session = null;
    }
}
