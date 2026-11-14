/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugModel.ts
// Deviations: `ITextFileService` is narrowed to `ITextFileDirtyState`, there is no `IUriIdentityService`, a logger
// stands for `ILogService`. `DebugStorage` hands out plain arrays instead of observables: the model reads them when
// built and again on `onDidReload` (upstream: `autorun` over the storage observables). Not here yet: `openInEditor`
// of a stack frame (with the editor service it needs). Not planned: the memory view (`MemoryRegion`,
// `getUriForDebugMemory`), debug visualizers (`VisualizedExpression`, proposed API), the disassembly view.

import { distinct } from "../../../../base/common/arrays.ts";
import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import { DeferredPromise, RunOnceScheduler } from "../../../../base/common/async.ts";
import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { Emitter, type Event, trackSetChanges } from "../../../../base/common/event.ts";
import { stringHash } from "../../../../base/common/hash.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { type Uri as uri, UriUtils } from "../../../../base/common/uri.ts";
import { generateUuid } from "../../../../base/common/uuid.ts";
import { type IRange, Range } from "../../../../editor/common/core/range.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import {
    DataBreakpointSetType,
    type DataBreakpointSource,
    type IBaseBreakpoint,
    type IBreakpoint,
    type IBreakpointData,
    type IBreakpointsChangeEvent,
    type IBreakpointUpdateData,
    type IDataBreakpoint,
    type IDebugEvaluatePosition,
    type IDebugModel,
    type IDebugSession,
    type IEnablement,
    type IExceptionBreakpoint,
    type IExceptionInfo,
    type IExpression,
    type IExpressionContainer,
    type IFunctionBreakpoint,
    type IInstructionBreakpoint,
    type IRawModelUpdate,
    type IRawStoppedDetails,
    type IScope,
    isFrameDeemphasized,
    type IStackFrame,
    type IThread,
    type ITreeElement,
    State,
} from "./debug.ts";
import { getUriFromSource, type Source, UNKNOWN_SOURCE_LABEL } from "./debugSource.ts";
import type { DebugStorage } from "./debugStorage.ts";

/** Upstream `ITextFileService`, narrowed to what breakpoints read: a breakpoint in a modified file is unverified. */
export interface ITextFileDirtyState {
    isDirty(resource: uri): boolean;
}

interface IDebugProtocolVariableWithContext extends DebugProtocol.Variable {
    __vscodeVariableMenuContext?: string;
}

export class ExpressionContainer implements IExpressionContainer {
    public static readonly allValues = new Map<string, string>();
    // Use chunks to support variable paging #9537
    private static readonly BASE_CHUNK_SIZE = 100;

    public type: string | undefined;
    public valueChanged = false;
    private _value = "";
    protected children?: Promise<IExpression[]>;

    public constructor(
        protected session: IDebugSession | undefined,
        protected readonly threadId: number | undefined,
        private _reference: number | undefined,
        private readonly id: string,
        public namedVariables: number | undefined = 0,
        public indexedVariables: number | undefined = 0,
        public memoryReference?: string | undefined,
        private startOfVariables: number | undefined = 0,
        public presentationHint?: DebugProtocol.VariablePresentationHint | undefined,
        public valueLocationReference?: number | undefined,
    ) {}

    public get reference(): number | undefined {
        return this._reference;
    }

    public set reference(value: number | undefined) {
        this._reference = value;
        this.children = undefined; // invalidate children cache
    }

    public async evaluateLazy(): Promise<void> {
        if (typeof this.reference === "undefined") {
            return;
        }

        const response = await assertReturnsDefined(this.session).variables(
            this.reference,
            this.threadId,
            undefined,
            undefined,
            undefined,
        );
        if (response?.body.variables.length !== 1) {
            return;
        }

        const dummyVar = response.body.variables[0];
        this.reference = dummyVar.variablesReference;
        this._value = dummyVar.value;
        this.namedVariables = dummyVar.namedVariables;
        this.indexedVariables = dummyVar.indexedVariables;
        this.memoryReference = dummyVar.memoryReference;
        this.presentationHint = dummyVar.presentationHint;
        this.valueLocationReference = dummyVar.valueLocationReference;
        // Also call overridden method to adopt subclass props
        this.adoptLazyResponse(dummyVar);
    }

    protected adoptLazyResponse(_response: DebugProtocol.Variable): void {
        // A `Variable` adopts its evaluate name.
    }

    public getChildren(): Promise<IExpression[]> {
        this.children ??= this.doGetChildren();
        return this.children;
    }

    private async doGetChildren(): Promise<IExpression[]> {
        if (!this.hasChildren) {
            return [];
        }

        if (!this.getChildrenInChunks) {
            return this.fetchVariables(undefined, undefined, undefined);
        }

        // Check if object has named variables, fetch them independent from indexed variables #9670
        const children = this.namedVariables ? await this.fetchVariables(undefined, undefined, "named") : [];

        // Use a dynamic chunk size based on the number of elements #9774
        let chunkSize = ExpressionContainer.BASE_CHUNK_SIZE;
        while (!!this.indexedVariables && this.indexedVariables > chunkSize * ExpressionContainer.BASE_CHUNK_SIZE) {
            chunkSize *= ExpressionContainer.BASE_CHUNK_SIZE;
        }

        if (!!this.indexedVariables && this.indexedVariables > chunkSize) {
            // There are a lot of children, create fake intermediate values that represent chunks #9537
            const numberOfChunks = Math.ceil(this.indexedVariables / chunkSize);
            for (let i = 0; i < numberOfChunks; i++) {
                const start = (this.startOfVariables ?? 0) + i * chunkSize;
                const count = Math.min(chunkSize, this.indexedVariables - i * chunkSize);
                children.push(
                    new Variable(
                        this.session,
                        this.threadId,
                        this,
                        this.reference,
                        `[${start}..${start + count - 1}]`,
                        "",
                        "",
                        undefined,
                        count,
                        undefined,
                        { kind: "virtual" },
                        undefined,
                        undefined,
                        true,
                        start,
                    ),
                );
            }

            return children;
        }

        const variables = await this.fetchVariables(this.startOfVariables, this.indexedVariables, "indexed");
        return children.concat(variables);
    }

    public getId(): string {
        return this.id;
    }

    public getSession(): IDebugSession | undefined {
        return this.session;
    }

    public get value(): string {
        return this._value;
    }

    public set value(value: string) {
        this._value = value;
        this.valueChanged =
            !!ExpressionContainer.allValues.get(this.getId()) &&
            ExpressionContainer.allValues.get(this.getId()) !== Expression.DEFAULT_VALUE &&
            ExpressionContainer.allValues.get(this.getId()) !== value;
        ExpressionContainer.allValues.set(this.getId(), value);
    }

    public get hasChildren(): boolean {
        // only variables with reference > 0 have children.
        return !!this.reference && this.reference > 0 && !this.presentationHint?.lazy;
    }

    private async fetchVariables(
        start: number | undefined,
        count: number | undefined,
        filter: "indexed" | "named" | undefined,
    ): Promise<Variable[]> {
        try {
            const session = assertReturnsDefined(this.session);
            const response = await session.variables(this.reference ?? 0, this.threadId, filter, start, count);
            if (!response) {
                return [];
            }

            const nameCount = new Map<string, number>();
            const vars = response.body.variables.map((v: IDebugProtocolVariableWithContext) => {
                if (
                    typeof v.value === "string" &&
                    typeof v.name === "string" &&
                    typeof v.variablesReference === "number"
                ) {
                    const count = nameCount.get(v.name) ?? 0;
                    const idDuplicationIndex = count > 0 ? count.toString() : "";
                    nameCount.set(v.name, count + 1);
                    return new Variable(
                        this.session,
                        this.threadId,
                        this,
                        v.variablesReference,
                        v.name,
                        v.evaluateName,
                        v.value,
                        v.namedVariables,
                        v.indexedVariables,
                        v.memoryReference,
                        v.presentationHint,
                        v.type,
                        v.__vscodeVariableMenuContext,
                        true,
                        0,
                        idDuplicationIndex,
                        v.declarationLocationReference,
                        v.valueLocationReference,
                    );
                }
                return new Variable(
                    this.session,
                    this.threadId,
                    this,
                    0,
                    "",
                    undefined,
                    "Invalid variable attributes",
                    0,
                    0,
                    undefined,
                    { kind: "virtual" },
                    undefined,
                    undefined,
                    false,
                );
            });

            if (session.autoExpandLazyVariables) {
                await Promise.all(vars.filter((v) => v.presentationHint?.lazy).map((v) => v.evaluateLazy()));
            }

            return vars;
        } catch (e) {
            return [
                new Variable(
                    this.session,
                    this.threadId,
                    this,
                    0,
                    "",
                    undefined,
                    (e as Error).message,
                    0,
                    0,
                    undefined,
                    { kind: "virtual" },
                    undefined,
                    undefined,
                    false,
                ),
            ];
        }
    }

    // The adapter explicitly sents the children count of an expression only if there are lots of children which should be chunked.
    private get getChildrenInChunks(): boolean {
        return !!this.indexedVariables;
    }

    public toString(): string {
        return this.value;
    }

    public async evaluateExpression(
        expression: string,
        session: IDebugSession | undefined,
        stackFrame: IStackFrame | undefined,
        context: string,
        keepLazyVars = false,
        location?: IDebugEvaluatePosition,
    ): Promise<boolean> {
        if (!session || (!stackFrame && context !== "repl")) {
            this.value =
                context === "repl" ? "Please start a debug session to evaluate expressions" : Expression.DEFAULT_VALUE;
            this.reference = 0;
            return false;
        }

        this.session = session;
        try {
            const response = await session.evaluate(
                expression,
                stackFrame ? stackFrame.frameId : undefined,
                context,
                location,
            );

            if (response?.body) {
                this.value = response.body.result || "";
                this.reference = response.body.variablesReference;
                this.namedVariables = response.body.namedVariables;
                this.indexedVariables = response.body.indexedVariables;
                this.memoryReference = response.body.memoryReference;
                this.type = response.body.type ?? this.type;
                this.presentationHint = response.body.presentationHint;
                this.valueLocationReference = response.body.valueLocationReference;

                if (!keepLazyVars && response.body.presentationHint?.lazy) {
                    await this.evaluateLazy();
                }

                return true;
            }
            return false;
        } catch (e) {
            this.value = (e as Error).message || "";
            this.reference = 0;
            this.memoryReference = undefined;
            return false;
        }
    }
}

function handleSetResponse(
    expression: ExpressionContainer,
    response: DebugProtocol.SetVariableResponse | DebugProtocol.SetExpressionResponse | undefined,
): void {
    if (response?.body) {
        expression.value = response.body.value || "";
        expression.type = response.body.type ?? expression.type;
        expression.reference = response.body.variablesReference;
        expression.namedVariables = response.body.namedVariables;
        expression.indexedVariables = response.body.indexedVariables;
        expression.memoryReference = response.body.memoryReference;
        expression.valueLocationReference = response.body.valueLocationReference;
    }
}

export class Expression extends ExpressionContainer implements IExpression {
    public static readonly DEFAULT_VALUE = "not available";

    public available: boolean;

    private readonly _onDidChangeValue = new Emitter<IExpression>();
    public readonly onDidChangeValue: Event<IExpression> = this._onDidChangeValue.event;

    public constructor(
        public name: string,
        id = generateUuid(),
    ) {
        super(undefined, undefined, 0, id);
        this.available = false;
        // name is not set if the expression is just being added
        // in that case do not set default value to prevent flashing #14499
        if (name) {
            this.value = Expression.DEFAULT_VALUE;
        }
    }

    public async evaluate(
        session: IDebugSession | undefined,
        stackFrame: IStackFrame | undefined,
        context: string,
        keepLazyVars?: boolean,
        location?: IDebugEvaluatePosition,
    ): Promise<void> {
        const hadDefaultValue = this.value === Expression.DEFAULT_VALUE;
        this.available = await this.evaluateExpression(this.name, session, stackFrame, context, keepLazyVars, location);
        if (hadDefaultValue || this.valueChanged) {
            this._onDidChangeValue.fire(this);
        }
    }

    public override toString(): string {
        return `${this.name}\n${this.value}`;
    }

    public toJSON(): { sessionId: string | undefined; variable: DebugProtocol.Variable } {
        return {
            sessionId: this.getSession()?.getId(),
            variable: this.toDebugProtocolObject(),
        };
    }

    public toDebugProtocolObject(): DebugProtocol.Variable {
        return {
            name: this.name,
            variablesReference: this.reference ?? 0,
            memoryReference: this.memoryReference,
            value: this.value,
            type: this.type,
            evaluateName: this.name,
        };
    }

    public async setExpression(value: string, stackFrame: IStackFrame): Promise<void> {
        if (!this.session) {
            return;
        }

        const response = await this.session.setExpression(stackFrame.frameId, this.name, value);
        handleSetResponse(this, response);
    }
}

export class Variable extends ExpressionContainer implements IExpression {
    // Used to show the error message coming from the adapter when setting the value #7807
    public errorMessage: string | undefined;

    public constructor(
        session: IDebugSession | undefined,
        threadId: number | undefined,
        public readonly parent: IExpressionContainer,
        reference: number | undefined,
        public readonly name: string,
        public evaluateName: string | undefined,
        value: string | undefined,
        namedVariables: number | undefined,
        indexedVariables: number | undefined,
        memoryReference: string | undefined,
        presentationHint: DebugProtocol.VariablePresentationHint | undefined,
        type?: string,
        public readonly variableMenuContext?: string | undefined,
        public readonly available = true,
        startOfVariables = 0,
        idDuplicationIndex = "",
        public readonly declarationLocationReference?: number | undefined,
        valueLocationReference?: number,
    ) {
        super(
            session,
            threadId,
            reference,
            `variable:${parent.getId()}:${name}:${idDuplicationIndex}`,
            namedVariables,
            indexedVariables,
            memoryReference,
            startOfVariables,
            presentationHint,
            valueLocationReference,
        );
        this.value = value ?? "";
        this.type = type;
    }

    public getThreadId(): number | undefined {
        return this.threadId;
    }

    public async setVariable(value: string, stackFrame: IStackFrame): Promise<void> {
        if (!this.session) {
            return;
        }

        try {
            // Send out a setExpression for debug extensions that do not support set variables https://github.com/microsoft/vscode/issues/124679#issuecomment-869844437
            if (
                this.session.capabilities.supportsSetExpression &&
                !this.session.capabilities.supportsSetVariable &&
                this.evaluateName
            ) {
                await this.setExpression(value, stackFrame);
                return;
            }

            const response = await this.session.setVariable(
                (this.parent as ExpressionContainer).reference,
                this.name,
                value,
            );
            handleSetResponse(this, response);
        } catch (err) {
            this.errorMessage = (err as Error).message;
        }
    }

    public async setExpression(value: string, stackFrame: IStackFrame): Promise<void> {
        if (!this.session || !this.evaluateName) {
            return;
        }

        const response = await this.session.setExpression(stackFrame.frameId, this.evaluateName, value);
        handleSetResponse(this, response);
    }

    public override toString(): string {
        return this.name ? `${this.name}: ${this.value}` : this.value;
    }

    public toJSON(): {
        sessionId: string | undefined;
        container: { expression: string } | DebugProtocol.Variable | DebugProtocol.Scope;
        variable: DebugProtocol.Variable;
    } {
        return {
            sessionId: this.getSession()?.getId(),
            container:
                this.parent instanceof Expression
                    ? { expression: this.parent.name }
                    : (this.parent as Variable | Scope).toDebugProtocolObject(),
            variable: this.toDebugProtocolObject(),
        };
    }

    protected override adoptLazyResponse(response: DebugProtocol.Variable): void {
        this.evaluateName = response.evaluateName;
    }

    public toDebugProtocolObject(): DebugProtocol.Variable {
        return {
            name: this.name,
            variablesReference: this.reference ?? 0,
            memoryReference: this.memoryReference,
            value: this.value,
            type: this.type,
            evaluateName: this.evaluateName,
        };
    }
}

export class Scope extends ExpressionContainer implements IScope {
    public constructor(
        public readonly stackFrame: IStackFrame,
        id: number,
        public readonly name: string,
        reference: number,
        public expensive: boolean,
        namedVariables?: number,
        indexedVariables?: number,
        public readonly range?: IRange,
    ) {
        super(
            stackFrame.thread.session,
            stackFrame.thread.threadId,
            reference,
            `scope:${name}:${id}`,
            namedVariables,
            indexedVariables,
        );
    }

    public get childrenHaveBeenLoaded(): boolean {
        return !!this.children;
    }

    public override toString(): string {
        return this.name;
    }

    public toDebugProtocolObject(): DebugProtocol.Scope {
        return {
            name: this.name,
            variablesReference: this.reference ?? 0,
            expensive: this.expensive,
        };
    }
}

export class ErrorScope extends Scope {
    public constructor(stackFrame: IStackFrame, index: number, message: string) {
        super(stackFrame, index, message, 0, false);
    }
}

export class StackFrame implements IStackFrame {
    private scopes: Promise<Scope[]> | undefined;

    public constructor(
        public readonly thread: Thread,
        public readonly frameId: number,
        public readonly source: Source,
        public readonly name: string,
        public readonly presentationHint: string | undefined,
        public readonly range: IRange,
        private readonly index: number,
        public readonly canRestart: boolean,
        public readonly instructionPointerReference?: string,
    ) {}

    public getId(): string {
        return `stackframe:${this.thread.getId()}:${this.index}:${this.source.name}`;
    }

    public getScopes(): Promise<IScope[]> {
        this.scopes ??= this.thread.session.scopes(this.frameId, this.thread.threadId).then(
            (response) => {
                if (!response) {
                    return [];
                }

                const usedIds = new Set<number>();
                return response.body.scopes.map((rs) => {
                    // form the id based on the name and location so that it's the
                    // same across multiple pauses to retain expansion state
                    let id = 0;
                    do {
                        id = stringHash(`${rs.name}:${rs.line}:${rs.column}`, id);
                    } while (usedIds.has(id));

                    usedIds.add(id);
                    return new Scope(
                        this,
                        id,
                        rs.name,
                        rs.variablesReference,
                        rs.expensive,
                        rs.namedVariables,
                        rs.indexedVariables,
                        rs.line && rs.column && rs.endLine && rs.endColumn
                            ? new Range(rs.line, rs.column, rs.endLine, rs.endColumn)
                            : undefined,
                    );
                });
            },
            (err: unknown) => [new ErrorScope(this, 0, (err as Error).message)],
        );

        return this.scopes;
    }

    public async getMostSpecificScopes(range: IRange): Promise<IScope[]> {
        const scopes = await this.getScopes();
        const nonExpensiveScopes = scopes.filter((s) => !s.expensive);
        const haveRangeInfo = nonExpensiveScopes.some((s) => !!s.range);
        if (!haveRangeInfo) {
            return nonExpensiveScopes;
        }

        const height = (scope: IScope): number =>
            assertReturnsDefined(scope.range).endLineNumber - assertReturnsDefined(scope.range).startLineNumber;
        const scopesContainingRange = nonExpensiveScopes
            .filter((scope) => scope.range && Range.containsRange(scope.range, range))
            .sort((first, second) => height(first) - height(second));
        return scopesContainingRange.length ? scopesContainingRange : nonExpensiveScopes;
    }

    public restart(): Promise<void> {
        return this.thread.session.restartFrame(this.frameId, this.thread.threadId);
    }

    public forgetScopes(): void {
        this.scopes = undefined;
    }

    public toString(): string {
        const lineNumberToString =
            typeof this.range.startLineNumber === "number" ? `:${this.range.startLineNumber}` : "";
        const sourceToString = `${this.source.inMemory ? this.source.name : this.source.uri.fsPath}${lineNumberToString}`;

        return sourceToString === UNKNOWN_SOURCE_LABEL ? this.name : `${this.name} (${sourceToString})`;
    }

    public equals(other: IStackFrame): boolean {
        return (
            this.name === other.name &&
            other.thread === this.thread &&
            this.frameId === other.frameId &&
            other.source === this.source &&
            Range.equalsRange(this.range, other.range)
        );
    }
}

const KEEP_SUBTLE_FRAME_AT_TOP_REASONS: readonly string[] = ["breakpoint", "step", "function breakpoint"];

export class Thread implements IThread {
    private callStack: IStackFrame[];
    private staleCallStack: IStackFrame[];
    private callStackCancellationTokens: CancellationTokenSource[] = [];
    public stoppedDetails: IRawStoppedDetails | undefined;
    public stopped: boolean;
    public reachedEndOfCallStack = false;
    public lastSteppingGranularity: DebugProtocol.SteppingGranularity | undefined;

    public constructor(
        public readonly session: IDebugSession,
        public name: string,
        public readonly threadId: number,
    ) {
        this.callStack = [];
        this.staleCallStack = [];
        this.stopped = false;
    }

    public getId(): string {
        return `thread:${this.session.getId()}:${this.threadId}`;
    }

    public clearCallStack(): void {
        if (this.callStack.length) {
            this.staleCallStack = this.callStack;
        }
        this.callStack = [];
        // Upstream `dispose(true)`: cancel, then dispose.
        this.callStackCancellationTokens.forEach((c) => {
            c.cancel();
            c.dispose();
        });
        this.callStackCancellationTokens = [];
    }

    public getCallStack(): IStackFrame[] {
        return this.callStack;
    }

    public getStaleCallStack(): readonly IStackFrame[] {
        return this.staleCallStack;
    }

    public getTopStackFrame(): IStackFrame | undefined {
        const callStack = this.getCallStack();
        const stopReason = this.stoppedDetails?.reason;
        // Allow stack frame without source and with instructionReferencePointer as top stack frame when using disassembly view.
        const instructionStop =
            stopReason === "instruction breakpoint" ||
            (stopReason === "step" && this.lastSteppingGranularity === "instruction");
        const firstAvailableStackFrame = callStack.find(
            (sf) =>
                (instructionStop && sf.instructionPointerReference !== undefined) ||
                (sf.source.available &&
                    ((stopReason !== undefined && KEEP_SUBTLE_FRAME_AT_TOP_REASONS.includes(stopReason)) ||
                        !isFrameDeemphasized(sf))),
        );
        return firstAvailableStackFrame;
    }

    public get stateLabel(): string {
        if (this.stoppedDetails) {
            return (
                // `||`: an empty description means none, as upstream.
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
                this.stoppedDetails.description ||
                (this.stoppedDetails.reason ? `Paused on ${this.stoppedDetails.reason}` : "Paused")
            );
        }

        return "Running";
    }

    /**
     * Queries the debug adapter for the callstack and returns a promise
     * which completes once the call stack has been retrieved.
     * If the thread is not stopped, it returns a promise to an empty array.
     * Only fetches the first stack frame for performance reasons. Calling this method consecutive times
     * gets the remainder of the call stack.
     */
    public async fetchCallStack(levels = 20): Promise<void> {
        if (this.stopped) {
            const start = this.callStack.length;
            const callStack = await this.getCallStackImpl(start, levels);
            this.reachedEndOfCallStack = callStack.length < levels;
            if (start < this.callStack.length) {
                // Set the stack frames for exact position we requested. To make sure no concurrent requests create duplicate stack frames #30660
                this.callStack.splice(start, this.callStack.length - start);
            }
            this.callStack = this.callStack.concat(callStack);
            if (
                typeof this.stoppedDetails?.totalFrames === "number" &&
                this.stoppedDetails.totalFrames === this.callStack.length
            ) {
                this.reachedEndOfCallStack = true;
            }
        }
    }

    private async getCallStackImpl(startFrame: number, levels: number): Promise<IStackFrame[]> {
        try {
            const tokenSource = new CancellationTokenSource();
            this.callStackCancellationTokens.push(tokenSource);
            const response = await this.session.stackTrace(this.threadId, startFrame, levels, tokenSource.token);
            if (!response?.body || tokenSource.token.isCancellationRequested) {
                return [];
            }

            if (this.stoppedDetails) {
                this.stoppedDetails.totalFrames = response.body.totalFrames;
            }

            return response.body.stackFrames.map((rsf, index) => {
                const source = this.session.getSource(rsf.source);

                return new StackFrame(
                    this,
                    rsf.id,
                    source,
                    rsf.name,
                    rsf.presentationHint,
                    new Range(rsf.line, rsf.column, rsf.endLine ?? rsf.line, rsf.endColumn ?? rsf.column),
                    startFrame + index,
                    typeof rsf.canRestart === "boolean" ? rsf.canRestart : true,
                    rsf.instructionPointerReference,
                );
            });
        } catch (err) {
            if (this.stoppedDetails) {
                this.stoppedDetails.framesErrorMessage = (err as Error).message;
            }

            return [];
        }
    }

    /**
     * Returns exception info promise if the exception was thrown, otherwise undefined
     */
    public get exceptionInfo(): Promise<IExceptionInfo | undefined> {
        if (this.stoppedDetails?.reason === "exception") {
            if (this.session.capabilities.supportsExceptionInfoRequest) {
                return this.session.exceptionInfo(this.threadId);
            }
            return Promise.resolve({
                description: this.stoppedDetails.text,
                breakMode: null,
            });
        }
        return Promise.resolve(undefined);
    }

    public next(granularity?: DebugProtocol.SteppingGranularity): Promise<void> {
        return this.session.next(this.threadId, granularity);
    }

    public stepIn(granularity?: DebugProtocol.SteppingGranularity): Promise<void> {
        return this.session.stepIn(this.threadId, undefined, granularity);
    }

    public stepOut(granularity?: DebugProtocol.SteppingGranularity): Promise<void> {
        return this.session.stepOut(this.threadId, granularity);
    }

    public stepBack(granularity?: DebugProtocol.SteppingGranularity): Promise<void> {
        return this.session.stepBack(this.threadId, granularity);
    }

    public continue(): Promise<void> {
        return this.session.continue(this.threadId);
    }

    public pause(): Promise<void> {
        return this.session.pause(this.threadId);
    }

    public terminate(): Promise<void> {
        return this.session.terminateThreads([this.threadId]);
    }

    public reverseContinue(): Promise<void> {
        return this.session.reverseContinue(this.threadId);
    }
}

export class Enablement implements IEnablement {
    public constructor(
        public enabled: boolean,
        private readonly id: string,
    ) {}

    public getId(): string {
        return this.id;
    }
}

interface IBreakpointSessionData extends DebugProtocol.Breakpoint {
    supportsConditionalBreakpoints: boolean;
    supportsHitConditionalBreakpoints: boolean;
    supportsLogPoints: boolean;
    supportsFunctionBreakpoints: boolean;
    supportsDataBreakpoints: boolean;
    supportsInstructionBreakpoints: boolean;
    sessionId: string;
}

function toBreakpointSessionData(
    data: DebugProtocol.Breakpoint,
    capabilities: DebugProtocol.Capabilities,
): IBreakpointSessionData {
    return {
        supportsConditionalBreakpoints: !!capabilities.supportsConditionalBreakpoints,
        supportsHitConditionalBreakpoints: !!capabilities.supportsHitConditionalBreakpoints,
        supportsLogPoints: !!capabilities.supportsLogPoints,
        supportsFunctionBreakpoints: !!capabilities.supportsFunctionBreakpoints,
        supportsDataBreakpoints: !!capabilities.supportsDataBreakpoints,
        supportsInstructionBreakpoints: !!capabilities.supportsInstructionBreakpoints,
        sessionId: "",
        ...data,
    };
}

export interface IBaseBreakpointOptions {
    enabled?: boolean;
    hitCondition?: string;
    condition?: string;
    logMessage?: string;
    mode?: string;
    modeLabel?: string;
}

export abstract class BaseBreakpoint extends Enablement implements IBaseBreakpoint {
    private sessionData = new Map<string, IBreakpointSessionData>();
    protected data: IBreakpointSessionData | undefined;
    public hitCondition: string | undefined;
    public condition: string | undefined;
    public logMessage: string | undefined;
    public mode: string | undefined;
    public modeLabel: string | undefined;

    public constructor(id: string, opts: IBaseBreakpointOptions) {
        super(opts.enabled ?? true, id);
        this.condition = opts.condition;
        this.hitCondition = opts.hitCondition;
        this.logMessage = opts.logMessage;
        this.mode = opts.mode;
        this.modeLabel = opts.modeLabel;
    }

    public setSessionData(sessionId: string, data: IBreakpointSessionData | undefined): void {
        if (!data) {
            this.sessionData.delete(sessionId);
        } else {
            data.sessionId = sessionId;
            this.sessionData.set(sessionId, data);
        }

        const allData = Array.from(this.sessionData.values());
        const verifiedData = distinct(
            allData.filter((d) => d.verified),
            (d) => `${d.line}:${d.column}`,
        );
        if (verifiedData.length) {
            // In case multiple session verified the breakpoint and they provide different data show the intial data that the user set (corner case)
            this.data = verifiedData.length === 1 ? verifiedData[0] : undefined;
        } else {
            // No session verified the breakpoint
            this.data = allData.length ? allData[0] : undefined;
        }
    }

    public get message(): string | undefined {
        if (!this.data) {
            return undefined;
        }

        return this.data.message;
    }

    public get verified(): boolean {
        return this.data ? this.data.verified : true;
    }

    public get sessionsThatVerified(): string[] {
        const sessionIds: string[] = [];
        for (const [sessionId, data] of this.sessionData) {
            if (data.verified) {
                sessionIds.push(sessionId);
            }
        }

        return sessionIds;
    }

    public abstract get supported(): boolean;

    public getIdFromAdapter(sessionId: string): number | undefined {
        const data = this.sessionData.get(sessionId);
        return data ? data.id : undefined;
    }

    public getDebugProtocolBreakpoint(sessionId: string): DebugProtocol.Breakpoint | undefined {
        const data = this.sessionData.get(sessionId);
        if (data) {
            const bp: DebugProtocol.Breakpoint = {
                id: data.id,
                verified: data.verified,
                message: data.message,
                source: data.source,
                line: data.line,
                column: data.column,
                endLine: data.endLine,
                endColumn: data.endColumn,
                instructionReference: data.instructionReference,
                offset: data.offset,
            };
            return bp;
        }
        return undefined;
    }

    public toJSON(): IBaseBreakpointOptions & { id: string } {
        return {
            id: this.getId(),
            enabled: this.enabled,
            condition: this.condition,
            hitCondition: this.hitCondition,
            logMessage: this.logMessage,
            mode: this.mode,
            modeLabel: this.modeLabel,
        };
    }
}

export interface IBreakpointOptions extends IBaseBreakpointOptions {
    uri: uri;
    lineNumber: number;
    column: number | undefined;
    adapterData: unknown;
    triggeredBy: string | undefined;
}

export class Breakpoint extends BaseBreakpoint implements IBreakpoint {
    private sessionsDidTrigger?: Set<string>;
    private readonly _uri: uri;
    private _adapterData: unknown;
    private _lineNumber: number;
    private _column: number | undefined;
    public triggeredBy: string | undefined;

    public constructor(
        opts: IBreakpointOptions,
        private readonly textFileService: ITextFileDirtyState,
        private readonly logService: ILogger,
        id = generateUuid(),
    ) {
        super(id, opts);
        this._uri = opts.uri;
        this._lineNumber = opts.lineNumber;
        this._column = opts.column;
        this._adapterData = opts.adapterData;
        this.triggeredBy = opts.triggeredBy;
    }

    public toDAP(): DebugProtocol.SourceBreakpoint {
        return {
            line: this.sessionAgnosticData.lineNumber,
            column: this.sessionAgnosticData.column,
            condition: this.condition,
            hitCondition: this.hitCondition,
            logMessage: this.logMessage,
            mode: this.mode,
        };
    }

    public get originalUri(): uri {
        return this._uri;
    }

    public get lineNumber(): number {
        return this.verified && this.data && typeof this.data.line === "number" ? this.data.line : this._lineNumber;
    }

    public override get verified(): boolean {
        if (this.data) {
            return this.data.verified && !this.textFileService.isDirty(this._uri);
        }

        return true;
    }

    public get pending(): boolean {
        if (this.data) {
            return false;
        }
        return this.triggeredBy !== undefined;
    }

    public get uri(): uri {
        return this.verified && this.data?.source
            ? getUriFromSource(this.data.source, this.data.source.path, this.data.sessionId, this.logService)
            : this._uri;
    }

    public get column(): number | undefined {
        return this.verified && this.data && typeof this.data.column === "number" ? this.data.column : this._column;
    }

    public override get message(): string | undefined {
        if (this.textFileService.isDirty(this.uri)) {
            return "Unverified breakpoint. File is modified, please restart debug session.";
        }

        return super.message;
    }

    public get adapterData(): unknown {
        return (this.data?.source?.adapterData as unknown) ?? this._adapterData;
    }

    public get endLineNumber(): number | undefined {
        return this.verified && this.data ? this.data.endLine : undefined;
    }

    public get endColumn(): number | undefined {
        return this.verified && this.data ? this.data.endColumn : undefined;
    }

    public get sessionAgnosticData(): { lineNumber: number; column: number | undefined } {
        return {
            lineNumber: this._lineNumber,
            column: this._column,
        };
    }

    public get supported(): boolean {
        if (!this.data) {
            return true;
        }
        if (this.logMessage && !this.data.supportsLogPoints) {
            return false;
        }
        if (this.condition && !this.data.supportsConditionalBreakpoints) {
            return false;
        }
        if (this.hitCondition && !this.data.supportsHitConditionalBreakpoints) {
            return false;
        }

        return true;
    }

    public override setSessionData(sessionId: string, data: IBreakpointSessionData | undefined): void {
        super.setSessionData(sessionId, data);
        this._adapterData ??= this.adapterData;
    }

    public override toJSON(): IBreakpointOptions & { id: string } {
        return {
            ...super.toJSON(),
            uri: this._uri,
            lineNumber: this._lineNumber,
            column: this._column,
            adapterData: this.adapterData,
            triggeredBy: this.triggeredBy,
        };
    }

    public override toString(): string {
        return `${UriUtils.basenameOrAuthority(this.uri)} ${this.lineNumber}`;
    }

    public setSessionDidTrigger(sessionId: string, didTrigger = true): void {
        if (didTrigger) {
            this.sessionsDidTrigger ??= new Set();
            this.sessionsDidTrigger.add(sessionId);
        } else {
            this.sessionsDidTrigger?.delete(sessionId);
        }
    }

    public getSessionDidTrigger(sessionId: string): boolean {
        return !!this.sessionsDidTrigger?.has(sessionId);
    }

    public update(data: IBreakpointUpdateData): void {
        if (Object.hasOwn(data, "lineNumber") && data.lineNumber !== undefined) {
            this._lineNumber = data.lineNumber;
        }
        if (Object.hasOwn(data, "column")) {
            this._column = data.column;
        }
        if (Object.hasOwn(data, "condition")) {
            this.condition = data.condition;
        }
        if (Object.hasOwn(data, "hitCondition")) {
            this.hitCondition = data.hitCondition;
        }
        if (Object.hasOwn(data, "logMessage")) {
            this.logMessage = data.logMessage;
        }
        if (Object.hasOwn(data, "mode")) {
            this.mode = data.mode;
            this.modeLabel = data.modeLabel;
        }
        if (Object.hasOwn(data, "triggeredBy")) {
            this.triggeredBy = data.triggeredBy;
            this.sessionsDidTrigger = undefined;
        }
    }
}

export interface IFunctionBreakpointOptions extends IBaseBreakpointOptions {
    name: string;
}

export class FunctionBreakpoint extends BaseBreakpoint implements IFunctionBreakpoint {
    public name: string;

    public constructor(opts: IFunctionBreakpointOptions, id = generateUuid()) {
        super(id, opts);
        this.name = opts.name;
    }

    public toDAP(): DebugProtocol.FunctionBreakpoint {
        return {
            name: this.name,
            condition: this.condition,
            hitCondition: this.hitCondition,
        };
    }

    public override toJSON(): IFunctionBreakpointOptions & { id: string } {
        return {
            ...super.toJSON(),
            name: this.name,
        };
    }

    public get supported(): boolean {
        if (!this.data) {
            return true;
        }

        return this.data.supportsFunctionBreakpoints;
    }

    public override toString(): string {
        return this.name;
    }
}

export interface IDataBreakpointOptions extends IBaseBreakpointOptions {
    description: string;
    src: DataBreakpointSource;
    canPersist: boolean;
    initialSessionData?: { session: IDebugSession; dataId: string };
    accessTypes: DebugProtocol.DataBreakpointAccessType[] | undefined;
    accessType: DebugProtocol.DataBreakpointAccessType;
}

export class DataBreakpoint extends BaseBreakpoint implements IDataBreakpoint {
    private readonly sessionDataIdForAddr = new WeakMap<IDebugSession, string | null>();

    public readonly description: string;
    public readonly src: DataBreakpointSource;
    public readonly canPersist: boolean;
    public readonly accessTypes: DebugProtocol.DataBreakpointAccessType[] | undefined;
    public readonly accessType: DebugProtocol.DataBreakpointAccessType;

    public constructor(opts: IDataBreakpointOptions, id = generateUuid()) {
        super(id, opts);
        this.description = opts.description;
        if ("dataId" in opts) {
            //  back compat with old saved variables in 1.87
            opts.src = { type: DataBreakpointSetType.Variable, dataId: opts.dataId as string };
        }
        this.src = opts.src;
        this.canPersist = opts.canPersist;
        this.accessTypes = opts.accessTypes;
        this.accessType = opts.accessType;
        if (opts.initialSessionData) {
            this.sessionDataIdForAddr.set(opts.initialSessionData.session, opts.initialSessionData.dataId);
        }
    }

    public async toDAP(session: IDebugSession): Promise<DebugProtocol.DataBreakpoint | undefined> {
        let dataId: string;
        if (this.src.type === DataBreakpointSetType.Variable) {
            dataId = this.src.dataId;
        } else {
            let sessionDataId = this.sessionDataIdForAddr.get(session);
            if (!sessionDataId) {
                sessionDataId = (await session.dataBytesBreakpointInfo(this.src.address, this.src.bytes))?.dataId;
                if (!sessionDataId) {
                    return undefined;
                }
                this.sessionDataIdForAddr.set(session, sessionDataId);
            }
            dataId = sessionDataId;
        }

        return {
            dataId,
            accessType: this.accessType,
            condition: this.condition,
            hitCondition: this.hitCondition,
        };
    }

    public override toJSON(): IDataBreakpointOptions & { id: string } {
        return {
            ...super.toJSON(),
            description: this.description,
            src: this.src,
            accessTypes: this.accessTypes,
            accessType: this.accessType,
            canPersist: this.canPersist,
        };
    }

    public get supported(): boolean {
        if (!this.data) {
            return true;
        }

        return this.data.supportsDataBreakpoints;
    }

    public override toString(): string {
        return this.description;
    }
}

export interface IExceptionBreakpointOptions extends IBaseBreakpointOptions {
    filter: string;
    label: string;
    supportsCondition: boolean;
    description: string | undefined;
    conditionDescription: string | undefined;
    fallback?: boolean;
}

export class ExceptionBreakpoint extends BaseBreakpoint implements IExceptionBreakpoint {
    private supportedSessions = new Set<string>();

    public readonly filter: string;
    public readonly label: string;
    public readonly supportsCondition: boolean;
    public readonly description: string | undefined;
    public readonly conditionDescription: string | undefined;
    private fallback = false;

    public constructor(opts: IExceptionBreakpointOptions, id = generateUuid()) {
        super(id, opts);
        this.filter = opts.filter;
        this.label = opts.label;
        this.supportsCondition = opts.supportsCondition;
        this.description = opts.description;
        this.conditionDescription = opts.conditionDescription;
        this.fallback = opts.fallback ?? false;
    }

    public override toJSON(): IExceptionBreakpointOptions & { id: string } {
        return {
            ...super.toJSON(),
            filter: this.filter,
            label: this.label,
            enabled: this.enabled,
            supportsCondition: this.supportsCondition,
            conditionDescription: this.conditionDescription,
            condition: this.condition,
            fallback: this.fallback,
            description: this.description,
        };
    }

    public setSupportedSession(sessionId: string, supported: boolean): void {
        if (supported) {
            this.supportedSessions.add(sessionId);
        } else {
            this.supportedSessions.delete(sessionId);
        }
    }

    /**
     * Used to specify which breakpoints to show when no session is specified.
     * Useful when no session is active and we want to show the exception breakpoints from the last session.
     */
    public setFallback(isFallback: boolean): void {
        this.fallback = isFallback;
    }

    // eslint-disable-next-line @typescript-eslint/class-literal-property-style -- implements the base class's abstract getter
    public get supported(): boolean {
        return true;
    }

    /**
     * Checks if the breakpoint is applicable for the specified session.
     * If sessionId is undefined, returns true if this breakpoint is a fallback breakpoint.
     */
    public isSupportedSession(sessionId?: string): boolean {
        return sessionId ? this.supportedSessions.has(sessionId) : this.fallback;
    }

    public matches(filter: DebugProtocol.ExceptionBreakpointsFilter): boolean {
        return (
            this.filter === filter.filter &&
            this.label === filter.label &&
            this.supportsCondition === !!filter.supportsCondition &&
            this.conditionDescription === filter.conditionDescription &&
            this.description === filter.description
        );
    }

    public override toString(): string {
        return this.label;
    }
}

export interface IInstructionBreakpointOptions extends IBaseBreakpointOptions {
    instructionReference: string;
    offset: number;
    canPersist: boolean;
    address: bigint;
}

export class InstructionBreakpoint extends BaseBreakpoint implements IInstructionBreakpoint {
    public readonly instructionReference: string;
    public readonly offset: number;
    public readonly canPersist: boolean;
    public readonly address: bigint;

    public constructor(opts: IInstructionBreakpointOptions, id = generateUuid()) {
        super(id, opts);
        this.instructionReference = opts.instructionReference;
        this.offset = opts.offset;
        this.canPersist = opts.canPersist;
        this.address = opts.address;
    }

    public toDAP(): DebugProtocol.InstructionBreakpoint {
        return {
            instructionReference: this.instructionReference,
            condition: this.condition,
            hitCondition: this.hitCondition,
            mode: this.mode,
            offset: this.offset,
        };
    }

    public override toJSON(): IInstructionBreakpointOptions & { id: string } {
        return {
            ...super.toJSON(),
            instructionReference: this.instructionReference,
            offset: this.offset,
            canPersist: this.canPersist,
            address: this.address,
        };
    }

    public get supported(): boolean {
        if (!this.data) {
            return true;
        }

        return this.data.supportsInstructionBreakpoints;
    }

    public override toString(): string {
        return this.instructionReference;
    }
}

export class ThreadAndSessionIds implements ITreeElement {
    public constructor(
        public sessionId: string,
        public threadId: number,
    ) {}

    public getId(): string {
        return `${this.sessionId}:${this.threadId}`;
    }
}

interface IBreakpointModeInternal extends DebugProtocol.BreakpointMode {
    firstFromDebugType: string;
}

export class DebugModel extends Disposable implements IDebugModel {
    private sessions: IDebugSession[];
    private schedulers = new Map<string, { scheduler: RunOnceScheduler; completeDeferred: DeferredPromise<void> }>();
    private breakpointsActivated = true;
    private readonly _onDidChangeBreakpoints = this.register(new Emitter<IBreakpointsChangeEvent | undefined>());
    private readonly _onDidChangeCallStack = this.register(new Emitter<void>());
    private readonly _onDidChangeCallStackFire = this.register(
        new RunOnceScheduler(() => {
            this._onDidChangeCallStack.fire(undefined);
        }, 100),
    );
    private readonly _onDidChangeWatchExpressions = this.register(new Emitter<IExpression | undefined>());
    private readonly _onDidChangeWatchExpressionValue = this.register(new Emitter<IExpression | undefined>());
    private readonly _breakpointModes = new Map<string, IBreakpointModeInternal>();
    private breakpoints!: Breakpoint[];
    private functionBreakpoints!: FunctionBreakpoint[];
    private exceptionBreakpoints!: ExceptionBreakpoint[];
    private dataBreakpoints!: DataBreakpoint[];
    private watchExpressions!: Expression[];
    private instructionBreakpoints: InstructionBreakpoint[];

    public constructor(
        private readonly debugStorage: DebugStorage,
        private readonly textFileService: ITextFileDirtyState,
        private readonly logService: ILogger,
    ) {
        super();

        this.loadBreakpoints();
        this.loadWatchExpressions();
        this.register(
            debugStorage.onDidReload(() => {
                this.loadBreakpoints();
                this.loadWatchExpressions();
            }),
        );

        this.register(
            trackSetChanges(
                () => new Set(this.watchExpressions),
                this.onDidChangeWatchExpressions,
                (we) =>
                    we.onDidChangeValue((e) => {
                        this._onDidChangeWatchExpressionValue.fire(e);
                    }),
            ),
        );

        this.instructionBreakpoints = [];
        this.sessions = [];
    }

    private loadBreakpoints(): void {
        this.breakpoints = this.debugStorage.loadBreakpoints();
        this.functionBreakpoints = this.debugStorage.loadFunctionBreakpoints();
        this.exceptionBreakpoints = this.debugStorage.loadExceptionBreakpoints();
        this.dataBreakpoints = this.debugStorage.loadDataBreakpoints();
        this._onDidChangeBreakpoints.fire(undefined);
    }

    private loadWatchExpressions(): void {
        this.watchExpressions = this.debugStorage.loadWatchExpressions();
        this._onDidChangeWatchExpressions.fire(undefined);
    }

    public getId(): string {
        return "root";
    }

    public getSession(sessionId: string | undefined, includeInactive = false): IDebugSession | undefined {
        if (sessionId) {
            return this.getSessions(includeInactive).find((s) => s.getId() === sessionId);
        }
        return undefined;
    }

    public getSessions(includeInactive = false): IDebugSession[] {
        // By default do not return inactive sessions.
        // However we are still holding onto inactive sessions due to repl and debug service session revival (eh scenario)
        return this.sessions.filter((s) => includeInactive || s.state !== State.Inactive);
    }

    public addSession(session: IDebugSession): void {
        this.sessions = this.sessions.filter((s) => {
            if (s.getId() === session.getId()) {
                // Make sure to de-dupe if a session is re-initialized. In case of EH debugging we are adding a session again after an attach.
                return false;
            }
            if (s.state === State.Inactive && s.configuration.name === session.configuration.name) {
                // Make sure to remove all inactive sessions that are using the same configuration as the new session
                s.dispose();
                return false;
            }

            return true;
        });

        let i = 1;
        while (this.sessions.some((s) => s.getLabel() === session.getLabel())) {
            session.setName(`${session.configuration.name} ${++i}`);
        }

        let index = -1;
        if (session.parentSession) {
            // Make sure that child sessions are placed after the parent session
            index = this.sessions.findLastIndex(
                (s) => s.parentSession === session.parentSession || s === session.parentSession,
            );
        }
        if (index >= 0) {
            this.sessions.splice(index + 1, 0, session);
        } else {
            this.sessions.push(session);
        }
        this._onDidChangeCallStack.fire(undefined);
    }

    public get onDidChangeBreakpoints(): Event<IBreakpointsChangeEvent | undefined> {
        return this._onDidChangeBreakpoints.event;
    }

    public get onDidChangeCallStack(): Event<void> {
        return this._onDidChangeCallStack.event;
    }

    public get onDidChangeWatchExpressions(): Event<IExpression | undefined> {
        return this._onDidChangeWatchExpressions.event;
    }

    public get onDidChangeWatchExpressionValue(): Event<IExpression | undefined> {
        return this._onDidChangeWatchExpressionValue.event;
    }

    public rawUpdate(data: IRawModelUpdate): void {
        const session = this.sessions.find((p) => p.getId() === data.sessionId);
        if (session) {
            session.rawUpdate(data);
            this._onDidChangeCallStack.fire(undefined);
        }
    }

    public clearThreads(id: string, removeThreads: boolean, reference?: number): void {
        const session = this.sessions.find((p) => p.getId() === id);
        if (session) {
            let threads: IThread[];
            if (reference === undefined) {
                threads = session.getAllThreads();
            } else {
                const thread = session.getThread(reference);
                threads = thread !== undefined ? [thread] : [];
            }
            for (const thread of threads) {
                const threadId = thread.getId();
                const entry = this.schedulers.get(threadId);
                if (entry !== undefined) {
                    entry.scheduler.dispose();
                    entry.completeDeferred.complete();
                    this.schedulers.delete(threadId);
                }
            }

            session.clearThreads(removeThreads, reference);
            if (!this._onDidChangeCallStackFire.isScheduled()) {
                this._onDidChangeCallStackFire.schedule();
            }
        }
    }

    /**
     * Update the call stack and notify the call stack view that changes have occurred.
     */
    public async fetchCallstack(thread: IThread, levels?: number): Promise<void> {
        if ((thread as Thread).reachedEndOfCallStack) {
            return;
        }

        const totalFrames = thread.stoppedDetails?.totalFrames;
        const remainingFrames =
            typeof totalFrames === "number" ? totalFrames - thread.getCallStack().length : undefined;

        if (!levels || (remainingFrames && levels > remainingFrames)) {
            levels = remainingFrames;
        }

        if (levels && levels > 0) {
            await (thread as Thread).fetchCallStack(levels);
            this._onDidChangeCallStack.fire();
        }

        return;
    }

    public refreshTopOfCallstack(
        thread: Thread,
        fetchFullStack = true,
    ): { topCallStack: Promise<void>; wholeCallStack: Promise<void> } {
        if (thread.session.capabilities.supportsDelayedStackTraceLoading) {
            // For improved performance load the first stack frame and then load the rest async.
            let topCallStack = Promise.resolve();
            const wholeCallStack = new Promise<void>((c, e) => {
                topCallStack = thread.fetchCallStack(1).then(() => {
                    if (!fetchFullStack) {
                        c();
                        this._onDidChangeCallStack.fire();
                        return;
                    }

                    if (!this.schedulers.has(thread.getId())) {
                        const deferred = new DeferredPromise<void>();
                        this.schedulers.set(thread.getId(), {
                            completeDeferred: deferred,
                            scheduler: new RunOnceScheduler(() => {
                                void thread
                                    .fetchCallStack(19)
                                    .then(() => {
                                        const stale = thread.getStaleCallStack();
                                        const current = thread.getCallStack();
                                        let bottomOfCallStackChanged = stale.length !== current.length;
                                        for (let i = 1; i < stale.length && !bottomOfCallStackChanged; i++) {
                                            bottomOfCallStackChanged = !stale[i].equals(current[i]);
                                        }

                                        if (bottomOfCallStackChanged) {
                                            this._onDidChangeCallStack.fire();
                                        }
                                    })
                                    .finally(() => {
                                        deferred.complete();
                                        this.schedulers.delete(thread.getId());
                                    });
                            }, 420),
                        });
                    }

                    const entry = assertReturnsDefined(this.schedulers.get(thread.getId()));
                    entry.scheduler.schedule();
                    entry.completeDeferred.p.then(c, e);
                    this._onDidChangeCallStack.fire();
                });
            });

            return { topCallStack, wholeCallStack };
        }

        const wholeCallStack = thread.fetchCallStack();
        return { wholeCallStack, topCallStack: wholeCallStack };
    }

    public getBreakpoints(filter?: {
        uri?: uri;
        originalUri?: uri;
        lineNumber?: number;
        column?: number;
        enabledOnly?: boolean;
        triggeredOnly?: boolean;
    }): IBreakpoint[] {
        if (filter) {
            const uriStr = filter.uri?.toString();
            const originalUriStr = filter.originalUri?.toString();
            return this.breakpoints.filter((bp) => {
                if (uriStr && bp.uri.toString() !== uriStr) {
                    return false;
                }
                if (originalUriStr && bp.originalUri.toString() !== originalUriStr) {
                    return false;
                }
                if (filter.lineNumber && bp.lineNumber !== filter.lineNumber) {
                    return false;
                }
                if (filter.column && bp.column !== filter.column) {
                    return false;
                }
                if (filter.enabledOnly && (!this.breakpointsActivated || !bp.enabled)) {
                    return false;
                }
                if (filter.triggeredOnly && bp.triggeredBy === undefined) {
                    return false;
                }

                return true;
            });
        }

        return this.breakpoints;
    }

    public getFunctionBreakpoints(): IFunctionBreakpoint[] {
        return this.functionBreakpoints;
    }

    public getDataBreakpoints(): IDataBreakpoint[] {
        return this.dataBreakpoints;
    }

    public getExceptionBreakpoints(): IExceptionBreakpoint[] {
        return this.exceptionBreakpoints;
    }

    public getExceptionBreakpointsForSession(sessionId?: string): IExceptionBreakpoint[] {
        return this.exceptionBreakpoints.filter((ebp) => ebp.isSupportedSession(sessionId));
    }

    public getInstructionBreakpoints(): IInstructionBreakpoint[] {
        return this.instructionBreakpoints;
    }

    public setExceptionBreakpointsForSession(
        sessionId: string,
        filters: DebugProtocol.ExceptionBreakpointsFilter[],
    ): void {
        let didChangeBreakpoints = false;
        for (const d of filters) {
            let ebp = this.exceptionBreakpoints.filter((exbp) => exbp.matches(d)).pop();

            if (!ebp) {
                didChangeBreakpoints = true;
                ebp = new ExceptionBreakpoint({
                    filter: d.filter,
                    label: d.label,
                    enabled: !!d.default,
                    supportsCondition: !!d.supportsCondition,
                    description: d.description,
                    conditionDescription: d.conditionDescription,
                });
                this.exceptionBreakpoints.push(ebp);
            }

            ebp.setSupportedSession(sessionId, true);
        }

        if (didChangeBreakpoints) {
            this._onDidChangeBreakpoints.fire(undefined);
        }
    }

    public removeExceptionBreakpointsForSession(sessionId: string): void {
        this.exceptionBreakpoints.forEach((ebp) => {
            ebp.setSupportedSession(sessionId, false);
        });
    }

    // Set last focused session as fallback session.
    // This is done to keep track of the exception breakpoints to show when no session is active.
    public setExceptionBreakpointFallbackSession(sessionId: string): void {
        this.exceptionBreakpoints.forEach((ebp) => {
            ebp.setFallback(ebp.isSupportedSession(sessionId));
        });
    }

    public setExceptionBreakpointCondition(
        exceptionBreakpoint: IExceptionBreakpoint,
        condition: string | undefined,
    ): void {
        (exceptionBreakpoint as ExceptionBreakpoint).condition = condition;
        this._onDidChangeBreakpoints.fire(undefined);
    }

    public areBreakpointsActivated(): boolean {
        return this.breakpointsActivated;
    }

    public setBreakpointsActivated(activated: boolean): void {
        this.breakpointsActivated = activated;
        this._onDidChangeBreakpoints.fire(undefined);
    }

    public addBreakpoints(uri: uri, rawData: IBreakpointData[], fireEvent = true): IBreakpoint[] {
        const newBreakpoints = rawData.map((rawBp) => {
            return new Breakpoint(
                {
                    uri,
                    lineNumber: rawBp.lineNumber,
                    column: rawBp.column,
                    enabled: rawBp.enabled ?? true,
                    condition: rawBp.condition,
                    hitCondition: rawBp.hitCondition,
                    logMessage: rawBp.logMessage,
                    triggeredBy: rawBp.triggeredBy,
                    adapterData: undefined,
                    mode: rawBp.mode,
                    modeLabel: rawBp.modeLabel,
                },
                this.textFileService,
                this.logService,
                rawBp.id,
            );
        });
        this.breakpoints = this.breakpoints.concat(newBreakpoints);
        this.breakpointsActivated = true;
        this.sortAndDeDup();

        if (fireEvent) {
            this._onDidChangeBreakpoints.fire({ added: newBreakpoints, sessionOnly: false });
        }

        return newBreakpoints;
    }

    public removeBreakpoints(toRemove: IBreakpoint[]): void {
        this.breakpoints = this.breakpoints.filter(
            (bp) => !toRemove.some((toRemove) => toRemove.getId() === bp.getId()),
        );
        this._onDidChangeBreakpoints.fire({ removed: toRemove, sessionOnly: false });
    }

    public updateBreakpoints(data: Map<string, IBreakpointUpdateData>): void {
        const updated: IBreakpoint[] = [];
        this.breakpoints.forEach((bp) => {
            const bpData = data.get(bp.getId());
            if (bpData) {
                bp.update(bpData);
                updated.push(bp);
            }
        });
        this.sortAndDeDup();
        this._onDidChangeBreakpoints.fire({ changed: updated, sessionOnly: false });
    }

    public setBreakpointSessionData(
        sessionId: string,
        capabilites: DebugProtocol.Capabilities,
        data: Map<string, DebugProtocol.Breakpoint> | undefined,
    ): void {
        const all: BaseBreakpoint[] = [
            ...this.breakpoints,
            ...this.functionBreakpoints,
            ...this.dataBreakpoints,
            ...this.exceptionBreakpoints,
            ...this.instructionBreakpoints,
        ];
        all.forEach((bp) => {
            if (!data) {
                bp.setSessionData(sessionId, undefined);
            } else {
                const bpData = data.get(bp.getId());
                if (bpData) {
                    bp.setSessionData(sessionId, toBreakpointSessionData(bpData, capabilites));
                }
            }
        });

        this._onDidChangeBreakpoints.fire({
            sessionOnly: true,
        });
    }

    public getDebugProtocolBreakpoint(breakpointId: string, sessionId: string): DebugProtocol.Breakpoint | undefined {
        const bp = this.breakpoints.find((bp) => bp.getId() === breakpointId);
        if (bp) {
            return bp.getDebugProtocolBreakpoint(sessionId);
        }
        return undefined;
    }

    public getBreakpointModes(
        forBreakpointType: "source" | "exception" | "data" | "instruction",
    ): DebugProtocol.BreakpointMode[] {
        return [...this._breakpointModes.values()].filter((mode) => mode.appliesTo.includes(forBreakpointType));
    }

    public registerBreakpointModes(debugType: string, modes: DebugProtocol.BreakpointMode[]): void {
        for (const mode of modes) {
            const key = `${mode.mode}/${mode.label}`;
            const rec = this._breakpointModes.get(key);
            if (rec) {
                for (const target of mode.appliesTo) {
                    if (!rec.appliesTo.includes(target)) {
                        rec.appliesTo.push(target);
                    }
                }
            } else {
                const duplicate = [...this._breakpointModes.values()].find((r) => r.label === mode.label);
                if (duplicate) {
                    duplicate.label = `${duplicate.label} (${duplicate.firstFromDebugType})`;
                }

                this._breakpointModes.set(key, {
                    mode: mode.mode,
                    label: duplicate ? `${mode.label} (${debugType})` : mode.label,
                    firstFromDebugType: debugType,
                    description: mode.description,
                    appliesTo: mode.appliesTo.slice(), // avoid later mutations
                });
            }
        }
    }

    private sortAndDeDup(): void {
        this.breakpoints = this.breakpoints.sort((first, second) => {
            if (first.uri.toString() !== second.uri.toString()) {
                return UriUtils.basenameOrAuthority(first.uri).localeCompare(UriUtils.basenameOrAuthority(second.uri));
            }
            if (first.lineNumber === second.lineNumber) {
                if (first.column && second.column) {
                    return first.column - second.column;
                }
                return 1;
            }

            return first.lineNumber - second.lineNumber;
        });
        this.breakpoints = distinct(this.breakpoints, (bp) => `${bp.uri.toString()}:${bp.lineNumber}:${bp.column}`);
    }

    public setEnablement(element: IEnablement, enable: boolean): void {
        if (element instanceof BaseBreakpoint) {
            const changed: (IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IInstructionBreakpoint)[] = [];
            if (element.enabled !== enable && !(element instanceof ExceptionBreakpoint)) {
                changed.push(element as Breakpoint | FunctionBreakpoint | DataBreakpoint | InstructionBreakpoint);
            }

            element.enabled = enable;
            if (enable) {
                this.breakpointsActivated = true;
            }

            this._onDidChangeBreakpoints.fire({ changed: changed, sessionOnly: false });
        }
    }

    public enableOrDisableAllBreakpoints(enable: boolean): void {
        const changed: (IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IInstructionBreakpoint)[] = [];
        const all: (Breakpoint | FunctionBreakpoint | DataBreakpoint | InstructionBreakpoint)[] = [
            ...this.breakpoints,
            ...this.functionBreakpoints,
            ...this.dataBreakpoints,
            ...this.instructionBreakpoints,
        ];
        all.forEach((bp) => {
            if (bp.enabled !== enable) {
                changed.push(bp);
            }
            bp.enabled = enable;
        });

        if (enable) {
            this.breakpointsActivated = true;
        }

        this._onDidChangeBreakpoints.fire({ changed: changed, sessionOnly: false });
    }

    public addFunctionBreakpoint(opts: IFunctionBreakpointOptions, id?: string): IFunctionBreakpoint {
        const newFunctionBreakpoint = new FunctionBreakpoint(opts, id);
        this.functionBreakpoints.push(newFunctionBreakpoint);
        this._onDidChangeBreakpoints.fire({ added: [newFunctionBreakpoint], sessionOnly: false });

        return newFunctionBreakpoint;
    }

    public updateFunctionBreakpoint(
        id: string,
        update: { name?: string; hitCondition?: string; condition?: string },
    ): void {
        const functionBreakpoint = this.functionBreakpoints.find((fbp) => fbp.getId() === id);
        if (functionBreakpoint) {
            if (typeof update.name === "string") {
                functionBreakpoint.name = update.name;
            }
            if (typeof update.condition === "string") {
                functionBreakpoint.condition = update.condition;
            }
            if (typeof update.hitCondition === "string") {
                functionBreakpoint.hitCondition = update.hitCondition;
            }
            this._onDidChangeBreakpoints.fire({ changed: [functionBreakpoint], sessionOnly: false });
        }
    }

    public removeFunctionBreakpoints(id?: string): void {
        let removed: FunctionBreakpoint[];
        if (id) {
            removed = this.functionBreakpoints.filter((fbp) => fbp.getId() === id);
            this.functionBreakpoints = this.functionBreakpoints.filter((fbp) => fbp.getId() !== id);
        } else {
            removed = this.functionBreakpoints;
            this.functionBreakpoints = [];
        }
        this._onDidChangeBreakpoints.fire({ removed, sessionOnly: false });
    }

    public addDataBreakpoint(opts: IDataBreakpointOptions, id?: string): void {
        const newDataBreakpoint = new DataBreakpoint(opts, id);
        this.dataBreakpoints.push(newDataBreakpoint);
        this._onDidChangeBreakpoints.fire({ added: [newDataBreakpoint], sessionOnly: false });
    }

    public updateDataBreakpoint(id: string, update: { hitCondition?: string; condition?: string }): void {
        const dataBreakpoint = this.dataBreakpoints.find((fbp) => fbp.getId() === id);
        if (dataBreakpoint) {
            if (typeof update.condition === "string") {
                dataBreakpoint.condition = update.condition;
            }
            if (typeof update.hitCondition === "string") {
                dataBreakpoint.hitCondition = update.hitCondition;
            }
            this._onDidChangeBreakpoints.fire({ changed: [dataBreakpoint], sessionOnly: false });
        }
    }

    public removeDataBreakpoints(id?: string): void {
        let removed: DataBreakpoint[];
        if (id) {
            removed = this.dataBreakpoints.filter((fbp) => fbp.getId() === id);
            this.dataBreakpoints = this.dataBreakpoints.filter((fbp) => fbp.getId() !== id);
        } else {
            removed = this.dataBreakpoints;
            this.dataBreakpoints = [];
        }
        this._onDidChangeBreakpoints.fire({ removed, sessionOnly: false });
    }

    public addInstructionBreakpoint(opts: IInstructionBreakpointOptions): void {
        const newInstructionBreakpoint = new InstructionBreakpoint(opts);
        this.instructionBreakpoints.push(newInstructionBreakpoint);
        this._onDidChangeBreakpoints.fire({ added: [newInstructionBreakpoint], sessionOnly: true });
    }

    public removeInstructionBreakpoints(instructionReference?: string, offset?: number, address?: bigint): void {
        let removed: InstructionBreakpoint[];
        if (address !== undefined) {
            // Prefer matching by resolved memory address: `instructionReference` is
            // allowed by the Debug Adapter Protocol to change between disassemble
            // requests (e.g. after symbol reloads), so matching on reference+offset
            // alone would fail to locate the breakpoint that the user is trying to
            // toggle off. The `address` on an `InstructionBreakpoint` is the stable
            // resolved memory address and uniquely identifies it.
            removed = this.instructionBreakpoints.filter((ibp) => ibp.address === address);
            this.instructionBreakpoints = this.instructionBreakpoints.filter((ibp) => ibp.address !== address);
        } else if (instructionReference) {
            const matches = (ibp: InstructionBreakpoint): boolean =>
                ibp.instructionReference === instructionReference && (offset === undefined || ibp.offset === offset);
            removed = this.instructionBreakpoints.filter(matches);
            this.instructionBreakpoints = this.instructionBreakpoints.filter((ibp) => !matches(ibp));
        } else {
            removed = this.instructionBreakpoints;
            this.instructionBreakpoints = [];
        }
        this._onDidChangeBreakpoints.fire({ removed, sessionOnly: false });
    }

    public getWatchExpressions(): Expression[] {
        return this.watchExpressions;
    }

    public addWatchExpression(name?: string): IExpression {
        const we = new Expression(name ?? "");
        this.watchExpressions.push(we);
        this._onDidChangeWatchExpressions.fire(we);

        return we;
    }

    public renameWatchExpression(id: string, newName: string): void {
        const filtered = this.watchExpressions.filter((we) => we.getId() === id);
        if (filtered.length === 1) {
            filtered[0].name = newName;
            this._onDidChangeWatchExpressions.fire(filtered[0]);
        }
    }

    public removeWatchExpressions(id: string | null = null): void {
        this.watchExpressions = id ? this.watchExpressions.filter((we) => we.getId() !== id) : [];
        this._onDidChangeWatchExpressions.fire(undefined);
    }

    public moveWatchExpression(id: string, position: number): void {
        const we = this.watchExpressions.find((we) => we.getId() === id);
        if (we) {
            this.watchExpressions = this.watchExpressions.filter((we) => we.getId() !== id);
            this.watchExpressions = this.watchExpressions
                .slice(0, position)
                .concat(we, this.watchExpressions.slice(position));
            this._onDidChangeWatchExpressions.fire(undefined);
        }
    }

    public sourceIsNotAvailable(uri: uri): void {
        this.sessions.forEach((s) => {
            const source = s.getSourceForUri(uri);
            if (source) {
                source.available = false;
            }
        });
        this._onDidChangeCallStack.fire(undefined);
    }
}
