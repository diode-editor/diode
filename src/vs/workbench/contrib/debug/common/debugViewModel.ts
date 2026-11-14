/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugViewModel.ts
// The context keys are written straight to the service: upstream's `bindTo` writes the default at once, so the
// constructor does; `bufferChangeEvents` is not needed, the service coalesces the writes of a tick by itself.
// Not planned: debug visualizers (`setVisualizedExpression`, proposed API).

import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import type { IDebugSession, IExpression, IExpressionContainer, IStackFrame, IThread, IViewModel } from "./debug.ts";
import { isSessionAttach } from "./debugUtils.ts";

export class ViewModel extends Disposable implements IViewModel {
    public firstSessionStart = true;

    private _focusedStackFrame: IStackFrame | undefined;
    private _focusedSession: IDebugSession | undefined;
    private _focusedThread: IThread | undefined;
    private selectedExpression: { expression: IExpression; settingWatch: boolean } | undefined;
    private readonly _onDidFocusSession = this.register(new Emitter<IDebugSession | undefined>());
    private readonly _onDidFocusThread = this.register(
        new Emitter<{ thread: IThread | undefined; explicit: boolean; session: IDebugSession | undefined }>(),
    );
    private readonly _onDidFocusStackFrame = this.register(
        new Emitter<{ stackFrame: IStackFrame | undefined; explicit: boolean; session: IDebugSession | undefined }>(),
    );
    private readonly _onDidSelectExpression = this.register(
        new Emitter<{ expression: IExpression; settingWatch: boolean } | undefined>(),
    );
    private readonly _onDidEvaluateLazyExpression = this.register(new Emitter<IExpressionContainer>());
    private readonly _onWillUpdateViews = this.register(new Emitter<void>());

    public constructor(private readonly contextKeyService: Pick<ContextKeyService, "set" | "get">) {
        super();
        contextKeyService.set("expressionSelected", false);
        contextKeyService.set("multiSessionDebug", false);
        this.setFocusContextKeys(undefined, undefined);
    }

    public getId(): string {
        return "root";
    }

    public get focusedSession(): IDebugSession | undefined {
        return this._focusedSession;
    }

    public get focusedThread(): IThread | undefined {
        return this._focusedThread;
    }

    public get focusedStackFrame(): IStackFrame | undefined {
        return this._focusedStackFrame;
    }

    public setFocus(
        stackFrame: IStackFrame | undefined,
        thread: IThread | undefined,
        session: IDebugSession | undefined,
        explicit: boolean,
    ): void {
        const shouldEmitForStackFrame = this._focusedStackFrame !== stackFrame;
        const shouldEmitForSession = this._focusedSession !== session;
        const shouldEmitForThread = this._focusedThread !== thread;

        this._focusedStackFrame = stackFrame;
        this._focusedThread = thread;
        this._focusedSession = session;

        this.setFocusContextKeys(stackFrame, session);

        if (shouldEmitForSession) {
            this._onDidFocusSession.fire(session);
        }

        // should not call onDidFocusThread if onDidFocusStackFrame is called.
        if (shouldEmitForStackFrame) {
            this._onDidFocusStackFrame.fire({ stackFrame, explicit, session });
        } else if (shouldEmitForThread) {
            this._onDidFocusThread.fire({ thread, explicit, session });
        }
    }

    private setFocusContextKeys(stackFrame: IStackFrame | undefined, session: IDebugSession | undefined): void {
        const keys = this.contextKeyService;
        keys.set("loadedScriptsSupported", !!session?.capabilities.supportsLoadedSourcesRequest);
        keys.set("stepBackSupported", !!session?.capabilities.supportsStepBack);
        keys.set("restartFrameSupported", !!session?.capabilities.supportsRestartFrame);
        keys.set("stepIntoTargetsSupported", !!session?.capabilities.supportsStepInTargetsRequest);
        keys.set("jumpToCursorSupported", !!session?.capabilities.supportsGotoTargetsRequest);
        keys.set("debugSetVariableSupported", !!session?.capabilities.supportsSetVariable);
        keys.set("debugSetDataBreakpointAddressSupported", !!session?.capabilities.supportsDataBreakpointBytes);
        keys.set("debugSetExpressionSupported", !!session?.capabilities.supportsSetExpression);
        keys.set("terminateDebuggeeSupported", !!session?.capabilities.supportTerminateDebuggee);
        keys.set("suspendDebuggeeSupported", !!session?.capabilities.supportSuspendDebuggee);
        keys.set("terminateThreadsSupported", !!session?.capabilities.supportsTerminateThreadsRequest);
        keys.set("disassembleRequestSupported", !!session?.capabilities.supportsDisassembleRequest);
        keys.set("focusedStackFrameHasInstructionReference", !!stackFrame?.instructionPointerReference);
        keys.set("focusedSessionIsAttach", !!session && isSessionAttach(session));
        keys.set("focusedSessionIsNoDebug", !!session && !!session.configuration.noDebug);
    }

    public get onDidFocusSession(): Event<IDebugSession | undefined> {
        return this._onDidFocusSession.event;
    }

    public get onDidFocusThread(): Event<{
        thread: IThread | undefined;
        explicit: boolean;
        session: IDebugSession | undefined;
    }> {
        return this._onDidFocusThread.event;
    }

    public get onDidFocusStackFrame(): Event<{
        stackFrame: IStackFrame | undefined;
        explicit: boolean;
        session: IDebugSession | undefined;
    }> {
        return this._onDidFocusStackFrame.event;
    }

    public getSelectedExpression(): { expression: IExpression; settingWatch: boolean } | undefined {
        return this.selectedExpression;
    }

    public setSelectedExpression(expression: IExpression | undefined, settingWatch: boolean): void {
        this.selectedExpression = expression ? { expression, settingWatch: settingWatch } : undefined;
        this.contextKeyService.set("expressionSelected", !!expression);
        this._onDidSelectExpression.fire(this.selectedExpression);
    }

    public get onDidSelectExpression(): Event<{ expression: IExpression; settingWatch: boolean } | undefined> {
        return this._onDidSelectExpression.event;
    }

    public get onDidEvaluateLazyExpression(): Event<IExpressionContainer> {
        return this._onDidEvaluateLazyExpression.event;
    }

    public updateViews(): void {
        this._onWillUpdateViews.fire();
    }

    public get onWillUpdateViews(): Event<void> {
        return this._onWillUpdateViews.event;
    }

    public isMultiSessionView(): boolean {
        return !!this.contextKeyService.get("multiSessionDebug");
    }

    public setMultiSessionView(isMultiSessionView: boolean): void {
        this.contextKeyService.set("multiSessionDebug", isMultiSessionView);
    }

    public async evaluateLazyExpression(expression: IExpressionContainer): Promise<void> {
        await expression.evaluateLazy();
        this._onDidEvaluateLazyExpression.fire(expression);
    }
}
