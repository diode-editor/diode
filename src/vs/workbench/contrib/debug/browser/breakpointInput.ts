/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/breakpointWidget.ts
// Upstream's breakpoint widget as a quick input (decision 2026-11-14): the input line holds the value, the list under
// it is upstream's select of the kind — Expression, Hit Count, Log Message, Wait for Breakpoint — and, when the
// adapters offer more than one mode of source breakpoints, upstream's mode select as a Mode row. The arrows switch
// the kind and the line shows that kind's value, as upstream's select does; Enter on a kind writes what upstream's
// `close(true)` writes, Enter on Wait for Breakpoint picks the breakpoint from a list, Enter on Mode picks the mode;
// Escape in those lists comes back to the kinds. Also the question of the glyph lane's click before a breakpoint with
// a condition is removed (upstream's dialog), as a modal message. Deviations: the kinds list is always shown (upstream
// hides the input behind the breakpoint select for a trigger); the mode is the breakpoint's own until another one is
// picked (upstream's widget clears it unless the select is touched); the question is asked on Linux too (upstream
// skips it there for an Electron issue); no completions in the input.

import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickSessionItem } from "../../../browser/parts/quickinput/quickPickSession.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import type { IBreakpoint, IBreakpointUpdateData, IDebugService } from "../common/debug.ts";

import { breakpointLabel, BreakpointSourcesDIToken, type IBreakpointSources } from "./breakpointsView.ts";
import { DebugServiceDIToken } from "./debugService.ts";

/** Upstream `BreakpointWidgetContext`. */
export const enum BreakpointWidgetContext {
    CONDITION = 0,
    HIT_COUNT = 1,
    LOG_MESSAGE = 2,
    TRIGGER_POINT = 3,
}

type TextContext = Exclude<BreakpointWidgetContext, BreakpointWidgetContext.TRIGGER_POINT>;

const PLACEHOLDERS: Record<TextContext, string> = {
    [BreakpointWidgetContext.CONDITION]:
        "Break when expression evaluates to true. 'Enter' to accept, 'Escape' to cancel.",
    [BreakpointWidgetContext.HIT_COUNT]:
        "Break when hit count condition is met. 'Enter' to accept, 'Escape' to cancel.",
    [BreakpointWidgetContext.LOG_MESSAGE]:
        "Message to log when breakpoint is hit. Expressions within {} are interpolated. 'Enter' to accept, 'Escape' to cancel.",
};

/** Upstream's options of the kind select, in the order of `BreakpointWidgetContext`. */
const KIND_LABELS = ["Expression", "Hit Count", "Log Message", "Wait for Breakpoint"] as const;
/** Upstream's `selectBreakpoint` aria label: the line has nothing to type while the trigger is the kind. */
const TRIGGER_PLACEHOLDER = "Select breakpoint. 'Enter' to pick, 'Escape' to cancel.";
const MODE_PLACEHOLDER = "Mode. 'Enter' to pick, 'Escape' to cancel.";

export const BreakpointInputDIToken = token<BreakpointInput>("BreakpointInput");

/** What upstream's widget holds while it is open: a value per kind, the kind shown, the trigger and the mode. */
interface IWidgetState {
    context: BreakpointWidgetContext;
    readonly inputs: [string, string, string];
    triggeredBy: IBreakpoint | undefined;
    mode: DebugProtocol.BreakpointMode | undefined;
}

/** How the kinds list was left: Enter on a kind (`true`) or on Mode, or Escape (`false`). */
type KindChoice = boolean | "mode";

interface IKindItem extends QuickPickSessionItem {
    /** A kind, or `undefined` for the Mode row. */
    readonly context: BreakpointWidgetContext | undefined;
}

export class BreakpointInput {
    public static dependencies = [
        DebugServiceDIToken,
        QuickInputServiceDIToken,
        NotificationServiceDIToken,
        BreakpointSourcesDIToken,
    ] as const;

    public constructor(
        private readonly debugService: IDebugService,
        private readonly quickInput: Pick<QuickInputService, "quickPick" | "createQuickPick">,
        private readonly notifications: Pick<NotificationService, "show">,
        private readonly sources: Pick<IBreakpointSources, "uriLabel">,
    ) {}

    /** Upstream `showBreakpointWidget`: the breakpoint at the line (and column) is edited, or one is added there. */
    public async show(
        uri: Uri,
        lineNumber: number,
        column: number | undefined,
        contextArg?: BreakpointWidgetContext,
    ): Promise<void> {
        const model = this.debugService.getModel();
        const breakpoints = model.getBreakpoints({ lineNumber, column, uri });
        const breakpoint = breakpoints.length ? breakpoints[0] : undefined;
        const modes = model.getBreakpointModes("source");
        const state: IWidgetState = {
            context: contextArg ?? contextOf(breakpoint),
            inputs: [breakpoint?.condition ?? "", breakpoint?.hitCondition ?? "", breakpoint?.logMessage ?? ""],
            triggeredBy: model.getBreakpoints().find((bp) => bp.getId() === breakpoint?.triggeredBy),
            mode: modes.find((mode) => mode.mode === breakpoint?.mode),
        };
        if (!(await this.ask(state, breakpoint, modes))) return;

        const [conditionInput, hitCountInput, logMessageInput] = state.inputs;
        let condition: string | undefined = undefined;
        let hitCondition: string | undefined = undefined;
        let logMessage: string | undefined = undefined;
        let triggeredBy: string | undefined = undefined;
        let mode: string | undefined = undefined;
        let modeLabel: string | undefined = undefined;
        if (conditionInput || state.context === BreakpointWidgetContext.CONDITION) {
            condition = conditionInput;
        }
        if (hitCountInput || state.context === BreakpointWidgetContext.HIT_COUNT) {
            hitCondition = hitCountInput;
        }
        if (logMessageInput || state.context === BreakpointWidgetContext.LOG_MESSAGE) {
            logMessage = logMessageInput;
        }
        if (modes.length > 1) {
            mode = state.mode?.mode;
            modeLabel = state.mode?.label;
        }
        if (state.context === BreakpointWidgetContext.TRIGGER_POINT) {
            // currently, trigger points don't support additional conditions:
            condition = undefined;
            hitCondition = undefined;
            logMessage = undefined;
            // Accepted only with a trigger picked.
            triggeredBy = assertReturnsDefined(state.triggeredBy).getId();
        }

        if (breakpoint) {
            const data = new Map<string, IBreakpointUpdateData>();
            data.set(breakpoint.getId(), { condition, hitCondition, logMessage, triggeredBy, mode, modeLabel });
            await this.debugService.updateBreakpoints(breakpoint.originalUri, data, false);
        } else {
            await this.debugService.addBreakpoints(uri, [
                {
                    lineNumber,
                    column,
                    enabled: true,
                    condition,
                    hitCondition,
                    logMessage,
                    triggeredBy,
                    mode,
                    modeLabel,
                },
            ]);
        }
    }

    /** The widget until it is accepted (`true`) or closed: the kinds, and the lists they open. */
    private async ask(
        state: IWidgetState,
        breakpoint: IBreakpoint | undefined,
        modes: readonly DebugProtocol.BreakpointMode[],
    ): Promise<boolean> {
        let onMode = false;
        for (;;) {
            const choice = await this.pickKind(state, modes.length > 1, onMode);
            onMode = choice === "mode";
            if (choice === "mode") {
                state.mode = (await pickBreakpointMode(this.quickInput, modes, state.mode)) ?? state.mode;
                continue;
            }
            if (!choice) return false;
            if (state.context !== BreakpointWidgetContext.TRIGGER_POINT) return true;
            const trigger = await this.pickTrigger(breakpoint);
            if (trigger !== undefined) {
                state.triggeredBy = trigger;
                return true;
            }
        }
    }

    /**
     * The input line with the kinds under it, the Mode row above them (the arrows reach it from Expression without
     * passing another kind); the arrows switch the kind, keeping what was typed for each.
     */
    private pickKind(state: IWidgetState, withModes: boolean, onMode: boolean): Promise<KindChoice> {
        return new Promise<KindChoice>((resolve) => {
            /** The kind shown, `undefined` for the Mode row. */
            let shown = onMode ? undefined : state.context;
            // The dispose hides the session, whose `onDidHide` settles again: a resolved promise ignores it.
            const settle = (choice: KindChoice): void => {
                resolve(choice);
                session.dispose();
            };
            const items = (): IKindItem[] => [
                ...(withModes ? [{ label: "Mode", context: undefined, description: state.mode?.label }] : []),
                ...KIND_LABELS.map((label, index) => {
                    const context = index as BreakpointWidgetContext;
                    return {
                        label,
                        context,
                        description:
                            context === BreakpointWidgetContext.TRIGGER_POINT
                                ? state.triggeredBy && breakpointLabel(this.sources, state.triggeredBy)
                                : state.inputs[context] || undefined,
                    };
                }),
            ];
            /** What was typed belongs to the kind shown, the trigger and the mode have nothing typed. */
            const remember = (value: string): void => {
                // Stryker disable next-line ConditionalExpression,LogicalOperator: what would be stored for the trigger or the Mode row (index 3, `undefined`) is read by nothing
                if (shown !== undefined && shown !== BreakpointWidgetContext.TRIGGER_POINT) {
                    state.inputs[shown] = value;
                }
            };
            const showKind = (context: BreakpointWidgetContext | undefined): void => {
                shown = context;
                const list = items();
                session.update({
                    value:
                        context === undefined || context === BreakpointWidgetContext.TRIGGER_POINT
                            ? ""
                            : state.inputs[context],
                    valueSelection: undefined,
                    placeholder:
                        context === undefined
                            ? MODE_PLACEHOLDER
                            : context === BreakpointWidgetContext.TRIGGER_POINT
                              ? TRIGGER_PLACEHOLDER
                              : PLACEHOLDERS[context],
                    items: list,
                    activeItems: list.filter((row) => row.context === context),
                });
            };
            const session = this.quickInput.createQuickPick<IKindItem>({
                onDidChangeValue: () => undefined,
                // The list always has its rows, and the session tells only a move to another one.
                onDidChangeActive: (active) => {
                    remember(session.getState().value);
                    showKind(active[0].context);
                },
                onDidChangeSelection: () => undefined,
                onDidAccept: () => {
                    remember(session.getState().value);
                    if (shown === undefined) {
                        settle("mode");
                    } else {
                        state.context = shown;
                        settle(true);
                    }
                },
                onDidHide: () => {
                    settle(false);
                },
            });
            // The value is not a filter: every kind stays in the list whatever is typed.
            session.update({ matchOnLabel: false });
            showKind(shown);
            session.show();
        });
    }

    /** Upstream's list of the breakpoints to wait for: the others, without logpoints. */
    private async pickTrigger(breakpoint: IBreakpoint | undefined): Promise<IBreakpoint | undefined> {
        const candidates = this.debugService
            .getModel()
            .getBreakpoints()
            .filter((bp) => bp !== breakpoint && !bp.logMessage);
        const items = candidates.map((bp) => ({ label: breakpointLabel(this.sources, bp) }));
        const picked = await this.quickInput.quickPick({ placeholder: "Wait for Breakpoint", items });
        // Stryker disable next-line ConditionalExpression: without the check `indexOf` gives -1, and `candidates[-1]` is undefined too
        return picked === undefined ? undefined : candidates[items.indexOf(picked)];
    }

    /** Upstream's dialog before a click removes breakpoints with a condition, a log message or a trigger. */
    public async confirmRemoval(breakpoints: readonly IBreakpoint[], enabled: boolean): Promise<void> {
        const logPoint = breakpoints.every((bp) => !!bp.logMessage);
        const breakpointType = logPoint ? "Logpoint" : "Breakpoint";
        const kind = breakpointType.toLowerCase();
        const what = logPoint ? "message" : "condition";
        const message = enabled
            ? `This ${kind} has a ${what} that will get lost on remove. Consider disabling the ${kind} instead.`
            : `This ${kind} has a ${what} that will get lost on remove. Consider enabling the ${kind} instead.`;
        const answer = await this.notifications.show({
            severity: "info",
            message,
            modal: true,
            items: [`Remove ${breakpointType}`, `${enabled ? "Disable" : "Enable"} ${breakpointType}`, "Cancel"],
            closeAffordance: 2,
        }).answered;
        if (answer === 0) {
            await Promise.all(breakpoints.map((bp) => this.debugService.removeBreakpoints(bp.getId())));
        } else if (answer === 1) {
            await Promise.all(breakpoints.map((bp) => this.debugService.enableOrDisableBreakpoints(!enabled, bp)));
        }
    }
}

/** Upstream's "Select Breakpoint Mode" pick of the widget and of Edit Mode...: the mode picked, if any. */
export async function pickBreakpointMode(
    quickInput: Pick<QuickInputService, "quickPick">,
    modes: readonly DebugProtocol.BreakpointMode[],
    current: DebugProtocol.BreakpointMode | undefined,
): Promise<DebugProtocol.BreakpointMode | undefined> {
    const items: QuickPickItem[] = modes.map((mode) => ({ label: mode.label, description: mode.description }));
    const picked = await quickInput.quickPick({
        placeholder: "Select Breakpoint Mode",
        items,
        activeIndex: current === undefined ? undefined : modes.indexOf(current),
    });
    // Stryker disable next-line ConditionalExpression: without the check `indexOf` gives -1, and `modes[-1]` is undefined too
    return picked === undefined ? undefined : modes[items.indexOf(picked)];
}

/** Upstream's context of a widget opened without one: the breakpoint's kind. */
function contextOf(breakpoint: IBreakpoint | undefined): BreakpointWidgetContext {
    if (breakpoint && !breakpoint.condition && !breakpoint.hitCondition && breakpoint.logMessage) {
        return BreakpointWidgetContext.LOG_MESSAGE;
    } else if (breakpoint && !breakpoint.condition && breakpoint.hitCondition) {
        return BreakpointWidgetContext.HIT_COUNT;
    } else if (breakpoint?.triggeredBy) {
        return BreakpointWidgetContext.TRIGGER_POINT;
    }
    return BreakpointWidgetContext.CONDITION;
}
