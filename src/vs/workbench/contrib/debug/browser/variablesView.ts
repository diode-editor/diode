/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/variablesView.ts
// The VARIABLES tree over the focused stack frame: its scopes with the first non-expensive one expanded, variables
// read on expansion (the model chunks large arrays into `[0..99]`), the refresh postponed by 400 ms while stepping
// and immediate on an explicit frame change. A lazy variable (`presentationHint.lazy`) is evaluated by Enter or a
// click, as upstream's eye button. The tree remembers the expanded nodes by their ids (scope ids carry the frame),
// not a view state per frame. Not here yet: Set Value (double click, F2) and the context menu with its commands
// (#1150). Not planned: debug visualizers, the memory view (`View Binary Data`).

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { LazyTreeControl } from "../../../browser/parts/views/lazyTreeControl.ts";
import type { IDebugService, IExpression, IScope, IStackFrame } from "../common/debug.ts";
import { ErrorScope, Scope, Variable } from "../common/debugModel.ts";

import type { DebugExpressionRenderer } from "./debugExpressionRenderer.ts";

/** Upstream's delay before the tree follows a frame focused by stepping, so the rows do not flash on every step. */
export const VARIABLES_REFRESH_DELAY_MS = 400;

/** Upstream `expressionAndScopeLabelProvider`: what typeahead matches. */
export function expressionAndScopeLabel(e: IExpression | IScope): string {
    return `${e.name}: ${e.value}`;
}

export class VariablesView extends Disposable {
    public readonly tree: LazyTreeControl<IExpression | IScope>;
    private stackFrame: IStackFrame | undefined;
    /** The scopes of the frame on screen: the first non-expensive one starts expanded. */
    private scopes: readonly IScope[] = [];
    private readonly updateTreeScheduler: RunOnceScheduler;

    public constructor(debugService: IDebugService, renderer: DebugExpressionRenderer) {
        super();
        this.tree = new LazyTreeControl<IExpression | IScope>(
            {
                getRoots: async () => {
                    this.scopes = (await this.stackFrame?.getScopes()) ?? [];
                    return this.scopes;
                },
                getChildren: (element) => element.getChildren(),
                getKey: (element) => element.getId(),
                hasChildren: (element) => element.hasChildren,
                isInitiallyExpanded: (element) => element === this.scopes.find((scope) => !scope.expensive),
                renderRow: (element) => {
                    if (element instanceof ErrorScope) {
                        return [{ text: element.name, fg: "debugTokenExpression.error" }];
                    }
                    if (element instanceof Scope) return [{ text: element.name }];
                    return renderer.renderVariable(element as IExpression, { showChanged: true });
                },
                getLabel: expressionAndScopeLabel,
            },
            { idPrefix: "variables" },
        );
        this.tree.onActivate = (element) => {
            if (element instanceof Variable && element.presentationHint?.lazy) {
                void debugService.getViewModel().evaluateLazyExpression(element).catch(onUnexpectedError);
            }
        };

        // Use scheduler to prevent unnecessary flashing
        this.updateTreeScheduler = this.register(
            new RunOnceScheduler(() => {
                this.stackFrame = debugService.getViewModel().focusedStackFrame;
                this.refresh();
            }, VARIABLES_REFRESH_DELAY_MS),
        );
        const viewModel = debugService.getViewModel();
        this.register(
            viewModel.onDidFocusStackFrame((sf) => {
                // Refresh the tree immediately if the user explictly changed stack frames.
                // Otherwise postpone the refresh until user stops stepping.
                this.updateTreeScheduler.schedule(sf.explicit ? 0 : undefined);
            }),
        );
        this.register(
            viewModel.onWillUpdateViews(() => {
                this.stackFrame?.forgetScopes();
                this.refresh();
            }),
        );
        this.register(
            viewModel.onDidEvaluateLazyExpression((e) => {
                if (e instanceof Variable) this.tree.expand(e);
            }),
        );
        this.stackFrame = viewModel.focusedStackFrame;
        this.refresh();
    }

    public refresh(): void {
        this.tree.refresh().catch(onUnexpectedError);
    }

    public focus(): void {
        this.tree.list.focus();
    }
}
