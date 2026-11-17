/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/breakpointWidget.ts
// Upstream's breakpoint widget as a quick input (decision 2026-11-14; the widget itself comes with conditions and logpoints, milestone 2): the condition, the
// hit count or the log message of a breakpoint is typed in an input box, the breakpoint it waits for is picked from a
// list. What it writes on accept is upstream's `close(true)`. Also the question of the glyph lane's click before a
// breakpoint with a condition is removed (upstream's dialog), as a modal message. Deviations: no mode select; the
// question is asked on Linux too (upstream skips it there for an Electron issue); no completions in the input.

import type { Uri } from "../../../../base/common/uri.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type QuickInputService,
    QuickInputServiceDIToken,
} from "../../../browser/parts/quickinput/quickInputService.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";
import type { IBreakpoint, IBreakpointUpdateData, IDebugService } from "../common/debug.ts";

import { BreakpointSourcesDIToken, type IBreakpointSources } from "./breakpointsView.ts";
import { DebugServiceDIToken } from "./debugService.ts";

/** Upstream `BreakpointWidgetContext`. */
export const enum BreakpointWidgetContext {
    CONDITION = 0,
    HIT_COUNT = 1,
    LOG_MESSAGE = 2,
    TRIGGER_POINT = 3,
}

const PLACEHOLDERS: Record<Exclude<BreakpointWidgetContext, BreakpointWidgetContext.TRIGGER_POINT>, string> = {
    [BreakpointWidgetContext.CONDITION]:
        "Break when expression evaluates to true. 'Enter' to accept, 'Escape' to cancel.",
    [BreakpointWidgetContext.HIT_COUNT]:
        "Break when hit count condition is met. 'Enter' to accept, 'Escape' to cancel.",
    [BreakpointWidgetContext.LOG_MESSAGE]:
        "Message to log when breakpoint is hit. Expressions within {} are interpolated. 'Enter' to accept, 'Escape' to cancel.",
};

export const BreakpointInputDIToken = token<BreakpointInput>("BreakpointInput");

export class BreakpointInput {
    public static dependencies = [
        DebugServiceDIToken,
        QuickInputServiceDIToken,
        NotificationServiceDIToken,
        BreakpointSourcesDIToken,
    ] as const;

    public constructor(
        private readonly debugService: IDebugService,
        private readonly quickInput: Pick<QuickInputService, "input" | "quickPick">,
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
        const breakpoints = this.debugService.getModel().getBreakpoints({ lineNumber, column, uri });
        const breakpoint = breakpoints.length ? breakpoints[0] : undefined;
        const context = contextArg ?? contextOf(breakpoint);

        let conditionInput = breakpoint?.condition ?? "";
        let hitCountInput = breakpoint?.hitCondition ?? "";
        let logMessageInput = breakpoint?.logMessage ?? "";
        let triggeredBy: string | undefined = undefined;
        if (context === BreakpointWidgetContext.TRIGGER_POINT) {
            const trigger = await this.pickTrigger(breakpoint);
            if (trigger === undefined) return;
            triggeredBy = trigger.getId();
        } else {
            const value = await this.quickInput.input({
                placeholder: PLACEHOLDERS[context],
                value: [conditionInput, hitCountInput, logMessageInput][context],
            });
            if (value === undefined) return;
            if (context === BreakpointWidgetContext.CONDITION) conditionInput = value;
            else if (context === BreakpointWidgetContext.HIT_COUNT) hitCountInput = value;
            else logMessageInput = value;
        }

        let condition: string | undefined = undefined;
        let hitCondition: string | undefined = undefined;
        let logMessage: string | undefined = undefined;
        if (conditionInput || context === BreakpointWidgetContext.CONDITION) {
            condition = conditionInput;
        }
        if (hitCountInput || context === BreakpointWidgetContext.HIT_COUNT) {
            hitCondition = hitCountInput;
        }
        if (logMessageInput || context === BreakpointWidgetContext.LOG_MESSAGE) {
            logMessage = logMessageInput;
        }
        if (context === BreakpointWidgetContext.TRIGGER_POINT) {
            // currently, trigger points don't support additional conditions:
            condition = undefined;
            hitCondition = undefined;
            logMessage = undefined;
        }

        if (breakpoint) {
            const data = new Map<string, IBreakpointUpdateData>();
            data.set(breakpoint.getId(), { condition, hitCondition, logMessage, triggeredBy });
            await this.debugService.updateBreakpoints(breakpoint.originalUri, data, false);
        } else {
            await this.debugService.addBreakpoints(uri, [
                { lineNumber, column, enabled: true, condition, hitCondition, logMessage, triggeredBy },
            ]);
        }
    }

    /** Upstream's list of the breakpoints to wait for: the others, without logpoints. */
    private async pickTrigger(breakpoint: IBreakpoint | undefined): Promise<IBreakpoint | undefined> {
        const candidates = this.debugService
            .getModel()
            .getBreakpoints()
            .filter((bp) => bp !== breakpoint && !bp.logMessage);
        const items = candidates.map((bp) => ({ label: `${this.sources.uriLabel(bp.uri)}: ${String(bp.lineNumber)}` }));
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
