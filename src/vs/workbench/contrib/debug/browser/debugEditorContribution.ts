/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugEditorContribution.ts
// The exception widget of upstream's `DebugEditorContribution` (`toggleExceptionWidget`, `closeExceptionWidget`) over
// every text editor of the tabs, with `exceptionWidget.ts`'s text and colors. Deviations (decision 2026-11-14): the
// exception is a badge after the frame's line, as the test messages are, not a zone between the lines with a frame
// and an arrow (the one-line badge has no frame: `debugExceptionWidget.border` is not drawn); the description and
// the stack trace go to the Debug Console once per stop, where the links of the trace work; a click on the badge
// opens the console. Not here yet: the debug hover, the inline values, the launch.json helpers.

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import type { ILineMessageDecoration } from "../../../../editor/common/model/iLineMessageDecoration.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import {
    type IDebugService,
    type IDebugSession,
    type IExceptionInfo,
    type IRawStoppedDetails,
    type IStackFrame,
    type IThread,
    REPL_VIEW_ID,
    State,
} from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

/** The owner of the exception's badge among an editor's line messages. */
export const EXCEPTION_MESSAGE_OWNER = "debug.exception";

/** `TextEditorPane` matches structurally; the DI module does the binding. */
export interface IDebugEditor {
    readonly uri: Uri;
    setLineMessageDecorations(decorations: readonly ILineMessageDecoration[], owner: string): void;
    onDidClickLineMessage(listener: (key: string) => void): IDisposable;
}

export interface IDebugEditorSource {
    /** The tabs' text editors of every group. */
    getEditors(): readonly IDebugEditor[];
    onDidChangeEditors(listener: () => void): IDisposable;
}

export const DebugEditorSourceDIToken = token<IDebugEditorSource>("DebugEditorSource");
export const DebugEditorContributionDIToken = token<DebugEditorContribution>("DebugEditorContribution");

/** The exception the editors show: where, and the stop it belongs to. */
interface IShownException {
    readonly uri: string;
    /** 0-based. */
    readonly line: number;
    readonly text: string;
    readonly stop: IRawStoppedDetails;
}

/** Upstream `ExceptionWidget`'s title: `Exception has occurred: <id>`, or without the id. */
function exceptionTitle(exceptionInfo: IExceptionInfo): string {
    return exceptionInfo.id ? `Exception has occurred: ${exceptionInfo.id}` : "Exception has occurred.";
}

/** The badge's one line: the title and the description, the whitespace runs (newlines too) as one space. */
export function exceptionBadgeText(exceptionInfo: IExceptionInfo): string {
    const text = exceptionInfo.description
        ? `${exceptionTitle(exceptionInfo)} — ${exceptionInfo.description}`
        : exceptionTitle(exceptionInfo);
    return ` ${text.replace(/\s+/gu, " ").trim()} `;
}

/** What the console gets: the title, the description and the stack trace, each on its own lines. */
export function exceptionConsoleText(exceptionInfo: IExceptionInfo): string {
    const lines = [exceptionTitle(exceptionInfo)];
    if (exceptionInfo.description) lines.push(exceptionInfo.description);
    const stackTrace = exceptionInfo.details?.stackTrace;
    if (stackTrace) lines.push(stackTrace);
    return `${lines.join("\n")}\n`;
}

/**
 * Upstream `toggleExceptionWidget`: while the focused frame is the first frame of its thread with an available
 * source that is not deemphasized and the thread stopped on an exception, every editor of the frame's file shows the
 * exception after the frame's line. Close Exception Widget (Escape) hides it until the next stop.
 */
export class DebugEditorContribution extends Disposable {
    public static dependencies = [
        DebugEditorSourceDIToken,
        DebugServiceDIToken,
        ContextKeyServiceDIToken,
        ViewsServiceDIToken,
    ] as const;

    private readonly subscriptions = new Map<IDebugEditor, IDisposable>();
    private shown: IShownException | undefined;
    /** The stop whose exception was closed. */
    private closedStop: IRawStoppedDetails | undefined;
    /** The stops whose exception went to the console. */
    private readonly reportedStops = new WeakSet<IRawStoppedDetails>();
    /** A later toggle wins over an earlier one still waiting for its exception info. */
    private generation = 0;

    public constructor(
        private readonly editors: IDebugEditorSource,
        private readonly debugService: IDebugService,
        private readonly contextKeys: Pick<ContextKeyService, "set">,
        private readonly views: Pick<ViewsService, "openView">,
    ) {
        super();
        const toggle = (): void => {
            this.toggleExceptionWidget().catch(onUnexpectedError);
        };
        this.register(
            editors.onDidChangeEditors(() => {
                this.syncEditors();
            }),
        );
        this.register(debugService.getViewModel().onDidFocusStackFrame(toggle));
        this.register(
            debugService.onDidChangeState((state) => {
                if (state !== State.Stopped) toggle();
            }),
        );
        this.register({
            dispose: () => {
                for (const subscription of this.subscriptions.values()) subscription.dispose();
            },
        });
        this.syncEditors();
        toggle();
    }

    /** Upstream `closeExceptionWidget`. */
    public closeExceptionWidget(): void {
        if (this.shown === undefined) return;
        this.closedStop = this.shown.stop;
        this.show(undefined);
    }

    private syncEditors(): void {
        const open = new Set(this.editors.getEditors());
        for (const [editor, subscription] of [...this.subscriptions]) {
            if (open.has(editor)) continue;
            subscription.dispose();
            this.subscriptions.delete(editor);
        }
        for (const editor of open) {
            if (this.subscriptions.has(editor)) continue;
            this.subscriptions.set(
                editor,
                editor.onDidClickLineMessage((key) => {
                    if (key === EXCEPTION_MESSAGE_OWNER) this.views.openView(REPL_VIEW_ID, false);
                }),
            );
        }
        this.show(this.shown);
    }

    private async toggleExceptionWidget(): Promise<void> {
        // Stryker disable next-line UpdateOperator: equivalent, the counter only needs a new value per toggle
        const generation = ++this.generation;
        const focusedSf = this.debugService.getViewModel().focusedStackFrame;
        const stop = focusedSf?.thread.stoppedDetails;
        // First call stack frame that is available is the frame where exception has been thrown
        if (focusedSf === undefined || firstAvailableFrame(focusedSf.thread) !== focusedSf || stop === undefined) {
            this.show(undefined);
            return;
        }
        const exceptionInfo = await focusedSf.thread.exceptionInfo;
        if (generation !== this.generation) return;
        if (exceptionInfo === undefined) {
            this.show(undefined);
            return;
        }
        this.report(focusedSf.thread.session, stop, exceptionInfo);
        if (stop === this.closedStop) {
            this.show(undefined);
            return;
        }
        this.show({
            uri: focusedSf.source.uri.toString(),
            line: focusedSf.range.startLineNumber - 1,
            text: exceptionBadgeText(exceptionInfo),
            stop,
        });
    }

    /** The exception's whole text goes to the console of its session once per stop. */
    private report(session: IDebugSession, stop: IRawStoppedDetails, exceptionInfo: IExceptionInfo): void {
        if (this.reportedStops.has(stop)) return;
        this.reportedStops.add(stop);
        session.appendToRepl({ output: exceptionConsoleText(exceptionInfo), sev: "error" });
    }

    /** Upstream's context key is the editor's own; here it holds while an editor of the tabs shows the badge. */
    private show(shown: IShownException | undefined): void {
        // Nothing shown before and now: the editors have no badge to take away.
        if (shown === undefined && this.shown === undefined) return;
        this.shown = shown;
        let visible = false;
        for (const editor of this.subscriptions.keys()) visible = this.decorate(editor) || visible;
        this.contextKeys.set("exceptionWidgetVisible", visible);
    }

    /** Whether the editor shows the badge. */
    private decorate(editor: IDebugEditor): boolean {
        const shown = this.shown;
        const decorations: ILineMessageDecoration[] =
            shown?.uri === editor.uri.toString()
                ? [
                      {
                          key: EXCEPTION_MESSAGE_OWNER,
                          line: shown.line,
                          text: shown.text,
                          colorToken: "editor.foreground",
                          bgToken: "debugExceptionWidget.background",
                      },
                  ]
                : [];
        editor.setLineMessageDecorations(decorations, EXCEPTION_MESSAGE_OWNER);
        return decorations.length > 0;
    }
}

/** Upstream's exception frame: the thread's first frame with a source that is available and not deemphasized. */
function firstAvailableFrame(thread: IThread): IStackFrame | undefined {
    return thread.getCallStack().find((sf) => sf.source.available && sf.source.presentationHint !== "deemphasize");
}
