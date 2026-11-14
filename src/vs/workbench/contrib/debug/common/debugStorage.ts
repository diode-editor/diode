/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugStorage.ts
// Upstream keys in the `workspace` scope of `IStateService` instead of `IStorageService`; the values are JSON
// values, not JSON strings. Upstream reloads on an external storage change (another window); here the workspace
// store is replaced when a folder opens in the same process, and `onDidReload` tells the model to read again.

import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri as URI, type Uri } from "../../../../base/common/uri.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";

import type { IDebugModel, IEvaluate, IExpression } from "./debug.ts";
import {
    Breakpoint,
    DataBreakpoint,
    ExceptionBreakpoint,
    Expression,
    FunctionBreakpoint,
    type ITextFileDirtyState,
} from "./debugModel.ts";

function workspaceKey(key: string): IStateDescriptor<unknown> {
    return { key, scope: "workspace", default: undefined };
}

const DEBUG_BREAKPOINTS_KEY = workspaceKey("debug.breakpoint");
const DEBUG_FUNCTION_BREAKPOINTS_KEY = workspaceKey("debug.functionbreakpoint");
const DEBUG_DATA_BREAKPOINTS_KEY = workspaceKey("debug.databreakpoint");
const DEBUG_EXCEPTION_BREAKPOINTS_KEY = workspaceKey("debug.exceptionbreakpoint");
const DEBUG_WATCH_EXPRESSIONS_KEY = workspaceKey("debug.watchexpressions");
const DEBUG_CHOSEN_ENVIRONMENTS_KEY = workspaceKey("debug.chosenenvironment");
const DEBUG_UX_STATE_KEY = workspaceKey("debug.uxstate");

export interface IChosenEnvironment {
    type: string;
    dynamicLabel?: string;
}

/** The stored form of a breakpoint: what `JSON.stringify` makes of `toJSON()`, the uri as `UriComponents`. */
type Stored<T extends { toJSON(): object }> = ReturnType<T["toJSON"]>;

/** The value as `JSON.stringify` writes it (upstream stores the string): `toJSON` applied, `undefined` fields dropped. */
function toJSONValue(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value));
}

export class DebugStorage extends Disposable {
    private readonly onDidReloadEmitter = this.register(new Emitter<void>());
    /** The workspace store was replaced: breakpoints and watch expressions are to be loaded again. */
    public readonly onDidReload: Event<void> = this.onDidReloadEmitter.event;

    public constructor(
        private readonly stateService: Pick<IStateService, "get" | "store" | "remove" | "onDidOpenWorkspace">,
        private readonly textFileService: ITextFileDirtyState,
        private readonly logService: ILogger,
    ) {
        super();
        this.register(
            stateService.onDidOpenWorkspace(() => {
                this.onDidReloadEmitter.fire();
            }),
        );
    }

    public loadDebugUxState(): "simple" | "default" {
        return (this.stateService.get(DEBUG_UX_STATE_KEY) as "simple" | "default" | undefined) ?? "default";
    }

    public storeDebugUxState(value: "simple" | "default"): void {
        this.stateService.store(DEBUG_UX_STATE_KEY, value);
    }

    public loadBreakpoints(): Breakpoint[] {
        return this.load(DEBUG_BREAKPOINTS_KEY, "breakpoints", (breakpoint: Stored<Breakpoint>) => {
            breakpoint.uri = URI.revive(breakpoint.uri);
            return new Breakpoint(breakpoint, this.textFileService, this.logService, breakpoint.id);
        });
    }

    public loadFunctionBreakpoints(): FunctionBreakpoint[] {
        return this.load(
            DEBUG_FUNCTION_BREAKPOINTS_KEY,
            "function breakpoints",
            (fb: Stored<FunctionBreakpoint>) => new FunctionBreakpoint(fb, fb.id),
        );
    }

    public loadExceptionBreakpoints(): ExceptionBreakpoint[] {
        return this.load(
            DEBUG_EXCEPTION_BREAKPOINTS_KEY,
            "exception breakpoints",
            (exBreakpoint: Stored<ExceptionBreakpoint>) => new ExceptionBreakpoint(exBreakpoint, exBreakpoint.id),
        );
    }

    public loadDataBreakpoints(): DataBreakpoint[] {
        return this.load(
            DEBUG_DATA_BREAKPOINTS_KEY,
            "data breakpoints",
            (dbp: Stored<DataBreakpoint>) => new DataBreakpoint(dbp, dbp.id),
        );
    }

    public loadWatchExpressions(): Expression[] {
        return this.load(
            DEBUG_WATCH_EXPRESSIONS_KEY,
            "watch expressions",
            (watchStoredData: { name: string; id: string }) => new Expression(watchStoredData.name, watchStoredData.id),
        );
    }

    private load<T>(descriptor: IStateDescriptor<unknown>, what: string, revive: (stored: never) => T): T[] {
        try {
            return ((this.stateService.get(descriptor) ?? []) as never[]).map(revive);
        } catch (e) {
            this.logService.error(`Failed to load ${what} from storage`, e);
            return [];
        }
    }

    public loadChosenEnvironments(): Record<string, IChosenEnvironment> {
        const obj = (this.stateService.get(DEBUG_CHOSEN_ENVIRONMENTS_KEY) ?? {}) as Record<
            string,
            string | IChosenEnvironment
        >;
        // back compat from when this was a string map:
        return Object.fromEntries(
            Object.entries(obj).map(([key, value]) => [key, typeof value === "string" ? { type: value } : value]),
        );
    }

    public storeChosenEnvironments(environments: Record<string, IChosenEnvironment>): void {
        this.stateService.store(DEBUG_CHOSEN_ENVIRONMENTS_KEY, toJSONValue(environments));
    }

    public storeWatchExpressions(watchExpressions: readonly (IExpression & IEvaluate)[]): void {
        this.storeOrRemove(
            DEBUG_WATCH_EXPRESSIONS_KEY,
            watchExpressions.map((we) => ({ name: we.name, id: we.getId() })),
        );
    }

    public storeBreakpoints(debugModel: IDebugModel): void {
        this.storeOrRemove(DEBUG_BREAKPOINTS_KEY, debugModel.getBreakpoints());
        this.storeOrRemove(DEBUG_FUNCTION_BREAKPOINTS_KEY, debugModel.getFunctionBreakpoints());
        this.storeOrRemove(
            DEBUG_DATA_BREAKPOINTS_KEY,
            debugModel.getDataBreakpoints().filter((dbp) => dbp.canPersist),
        );
        this.storeOrRemove(DEBUG_EXCEPTION_BREAKPOINTS_KEY, debugModel.getExceptionBreakpoints());
    }

    private storeOrRemove(descriptor: IStateDescriptor<unknown>, values: readonly unknown[]): void {
        if (values.length) {
            this.stateService.store(descriptor, toJSONValue(values));
        } else {
            this.stateService.remove(descriptor);
        }
    }
}
