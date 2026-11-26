/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/watchExpressionsView.ts
// The WATCH tree: the expressions of the workspace evaluated in the focused frame (`not available` without one),
// their children read on expansion, `watchExpressionsExist`. Deviation: the expression is typed in the quick input,
// not in an input box on the row (decision 2026-11-14, as the breakpoint condition): adding puts an empty row on
// the tree and asks for the expression, Escape or an empty answer takes the row away, as upstream's input box.
// Set Value (the row's menu) puts an input over the row, as upstream. Not here yet: reordering by drag and drop. Not
// planned: debug visualizers, the memory view.

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { LazyTreeControl } from "../../../browser/parts/views/lazyTreeControl.ts";
import type { IDebugService, IExpression } from "../common/debug.ts";
import { Expression, Variable } from "../common/debugModel.ts";

import type { DebugExpressionRenderer } from "./debugExpressionRenderer.ts";
import { expressionAndScopeLabel } from "./variablesView.ts";

/** Upstream's coalescing of the frame focus changes of a step. */
export const WATCH_REFRESH_DELAY_MS = 50;

export class WatchExpressionsView extends Disposable {
    public readonly tree: LazyTreeControl<IExpression>;
    /** A new empty row is on its way to the input: nothing to evaluate. */
    private useCachedEvaluation = false;
    /** A rename refreshes by itself: `updateViews` must not evaluate twice. */
    private ignoreViewUpdates = false;
    private readonly watchExpressionsUpdatedScheduler: RunOnceScheduler;

    public constructor(
        private readonly debugService: IDebugService,
        renderer: DebugExpressionRenderer,
        contextKeys: Pick<ContextKeyService, "set">,
        private readonly quickInput: Pick<QuickInputService, "input">,
    ) {
        super();
        const model = debugService.getModel();
        const viewModel = debugService.getViewModel();
        this.tree = new LazyTreeControl<IExpression>(
            {
                getRoots: () => {
                    const useCachedEvaluation = this.useCachedEvaluation;
                    return Promise.all(
                        model.getWatchExpressions().map(async (we) => {
                            if (we.name && !useCachedEvaluation) {
                                // The model's expressions take no frame and no session as well.
                                await (we as Expression).evaluate(
                                    viewModel.focusedSession,
                                    viewModel.focusedStackFrame,
                                    "watch",
                                );
                            }
                            return we;
                        }),
                    );
                },
                getChildren: (element) => element.getChildren(),
                getKey: (element) => element.getId(),
                hasChildren: (element) => element.hasChildren,
                renderRow: (element) =>
                    element instanceof Expression
                        ? renderer.renderWatchExpression(element)
                        : renderer.renderVariable(element, { showChanged: true }),
                getLabel: expressionAndScopeLabel,
            },
            { idPrefix: "watch" },
        );
        this.tree.onActivate = (element) => {
            if (element instanceof Variable && element.presentationHint?.lazy) {
                void viewModel.evaluateLazyExpression(element).catch(onUnexpectedError);
            }
        };

        this.watchExpressionsUpdatedScheduler = this.register(
            new RunOnceScheduler(() => {
                this.refresh();
            }, WATCH_REFRESH_DELAY_MS),
        );
        const setExist = (): void => {
            contextKeys.set("watchExpressionsExist", model.getWatchExpressions().length > 0);
        };
        setExist();
        this.register(
            model.onDidChangeWatchExpressions((we) => {
                setExist();
                // We are adding a new input box, no need to re-evaluate watch expressions
                this.useCachedEvaluation = we !== undefined && !we.name;
                this.refresh();
                this.useCachedEvaluation = false;
            }),
        );
        this.register(
            viewModel.onDidFocusStackFrame(() => {
                if (!this.watchExpressionsUpdatedScheduler.isScheduled()) {
                    this.watchExpressionsUpdatedScheduler.schedule();
                }
            }),
        );
        this.register(
            viewModel.onWillUpdateViews(() => {
                if (!this.ignoreViewUpdates) this.refresh();
            }),
        );
        this.register(
            viewModel.onDidSelectExpression((e) => {
                if (e?.settingWatch === true) {
                    this.setValue(e.expression);
                } else if (e?.expression instanceof Expression) {
                    void this.editExpression(e.expression).catch(onUnexpectedError);
                }
            }),
        );
        this.register(
            viewModel.onDidEvaluateLazyExpression((e) => {
                // Only variables are lazy; the tree ignores one it does not show.
                this.tree.expand(e as IExpression);
            }),
        );
        this.refresh();
    }

    public refresh(): void {
        this.tree.refresh().catch(onUnexpectedError);
    }

    public focus(): void {
        this.tree.list.focus();
    }

    /** Upstream's input box of `getInputBoxOptions` with `settingValue`: the value of an expression or a variable. */
    private setValue(expression: IExpression): void {
        const viewModel = this.debugService.getViewModel();
        this.tree.edit(expression, {
            value: expression.value,
            onDone: (value, success) => {
                // Stryker disable next-line BooleanLiteral: equivalent — no expression keeps no `settingWatch`
                viewModel.setSelectedExpression(undefined, false);
                const focusedFrame = viewModel.focusedStackFrame;
                if (success && value && focusedFrame) {
                    // Only these two are selected with `settingWatch`.
                    void (expression as Expression | Variable)
                        .setExpression(value, focusedFrame)
                        .then(() => {
                            viewModel.updateViews();
                        })
                        .catch(onUnexpectedError);
                }
            },
        });
    }

    /** Upstream's input box of a watch expression (`getInputBoxOptions` without `settingValue`). */
    private async editExpression(expression: Expression): Promise<void> {
        const value = await this.quickInput.input({
            placeholder: "Expression to watch",
            value: expression.name,
        });
        if (value) {
            this.debugService.renameWatchExpression(expression.getId(), value);
            this.ignoreViewUpdates = true;
            this.debugService.getViewModel().updateViews();
            this.ignoreViewUpdates = false;
        } else if (!expression.name) {
            this.debugService.removeWatchExpressions(expression.getId());
        }
        // Stryker disable next-line BooleanLiteral: without an expression the view model keeps no settingWatch flag
        this.debugService.getViewModel().setSelectedExpression(undefined, false);
    }
}
