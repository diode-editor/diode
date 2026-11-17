/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/breakpointsView.ts
// The editing commands of the BREAKPOINTS rows with upstream's ids, titles and menu items: the condition of a source
// breakpoint in the breakpoint widget, the condition of an exception filter, the name, the condition and the hit
// count of a function breakpoint, the condition and the hit count of a data breakpoint, the mode, and the data
// breakpoints on a range of memory (`MemoryBreakpointAction`). Deviations: what upstream types in an input box on the
// row is typed in the quick input (as the name of a new function breakpoint); there are no inline buttons, so Edit
// Condition... is in the menu of a function breakpoint too, where it edits the condition (upstream's inline button
// opens a menu of Edit Condition... and Edit Hit Count..., and Edit Hit Count... is in the row's menu already), and
// it is not in the menu of a file or an instruction breakpoint, where upstream's does nothing; Enter on a range that
// does not parse while typed does nothing (upstream closes the input), one that fails only in the end is told as an
// error (upstream throws it); the widget of a source breakpoint opens in the quick input even when its file does not
// (upstream's lives in the editor).

import { codicon } from "../../../../base/common/codicons.ts";
import { type CommandAction, HIDDEN_FROM_PALETTE } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import {
    BREAKPOINTS_VIEW_ID,
    DataBreakpointSetType,
    type IBreakpointUpdateData,
    type IDataBreakpointInfoResponse,
} from "../common/debug.ts";
import {
    Breakpoint,
    DataBreakpoint,
    ExceptionBreakpoint,
    FunctionBreakpoint,
    InstructionBreakpoint,
} from "../common/debugModel.ts";

import { BreakpointInputDIToken } from "./breakpointInput.ts";
import { BreakpointSourcesDIToken } from "./breakpointsView.ts";
import { getModeKindForBreakpoint, rowMenuItem } from "./debugContextMenus.ts";
import { DebugServiceDIToken } from "./debugService.ts";

const CONDITION_PLACEHOLDER = "Break when expression evaluates to true";
const HIT_COUNT_PLACEHOLDER = "Break when hit count is met";

/** Upstream's `renderInputBox` of a function or a data breakpoint: the field typed in the quick input. */
async function editField(
    accessor: ServiceAccessor,
    breakpoint: FunctionBreakpoint | DataBreakpoint,
    type: "name" | "condition" | "hitCount",
): Promise<void> {
    const debugService = accessor.get(DebugServiceDIToken);
    const placeholder =
        type === "name" ? "Function to break on" : type === "condition" ? CONDITION_PLACEHOLDER : HIT_COUNT_PLACEHOLDER;
    const current =
        type === "name"
            ? (breakpoint as FunctionBreakpoint).name
            : type === "condition"
              ? breakpoint.condition
              : breakpoint.hitCondition;
    const value = await accessor.get(QuickInputServiceDIToken).input({ placeholder, value: current ?? "" });
    if (value === undefined) return;
    const update =
        type === "name" ? { name: value } : type === "condition" ? { condition: value } : { hitCondition: value };
    if (breakpoint instanceof FunctionBreakpoint) {
        await debugService.updateFunctionBreakpoint(breakpoint.getId(), update);
    } else {
        await debugService.updateDataBreakpoint(breakpoint.getId(), update);
    }
}

export const editBreakpointConditionAction: CommandAction = {
    id: "debug.editBreakpoint",
    title: "Edit Condition...",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(
            MenuId.DebugBreakpointsContext,
            "navigation",
            10,
            "breakpointItemType == 'breakpoint' || breakpointItemType == 'exceptionBreakpoint' || breakpointItemType == 'functionBreakpoint' || breakpointItemType == 'dataBreakpoint'",
            "breakpointSupportsCondition",
        ),
    ],
    async run(accessor, breakpoint) {
        if (breakpoint instanceof Breakpoint) {
            await accessor.get(BreakpointSourcesDIToken).openBreakpoint(breakpoint, false);
            await accessor.get(BreakpointInputDIToken).show(breakpoint.uri, breakpoint.lineNumber, breakpoint.column);
        } else if (breakpoint instanceof ExceptionBreakpoint) {
            const condition = await accessor.get(QuickInputServiceDIToken).input({
                // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty description is none, as upstream
                placeholder: breakpoint.conditionDescription || CONDITION_PLACEHOLDER,
                value: breakpoint.condition ?? "",
            });
            if (condition === undefined) return;
            await accessor
                .get(DebugServiceDIToken)
                .setExceptionBreakpointCondition(breakpoint, condition !== "" ? condition : undefined);
        } else if (breakpoint instanceof FunctionBreakpoint || breakpoint instanceof DataBreakpoint) {
            await editField(accessor, breakpoint, "condition");
        }
    },
};

export const editFunctionBreakpointAction: CommandAction = {
    id: "debug.editFunctionBreakpoint",
    title: "Edit Function Condition...",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(MenuId.DebugBreakpointsContext, "navigation", 10, "breakpointItemType == 'functionBreakpoint'"),
    ],
    async run(accessor, breakpoint) {
        if (breakpoint instanceof FunctionBreakpoint) await editField(accessor, breakpoint, "name");
    },
};

export const editFunctionBreakpointHitCountAction: CommandAction = {
    id: "debug.editFunctionBreakpointHitCount",
    title: "Edit Hit Count...",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(
            MenuId.DebugBreakpointsContext,
            "navigation",
            20,
            "breakpointItemType == 'functionBreakpoint' || breakpointItemType == 'dataBreakpoint'",
            "breakpointSupportsCondition",
        ),
    ],
    async run(accessor, breakpoint) {
        if (breakpoint instanceof FunctionBreakpoint || breakpoint instanceof DataBreakpoint) {
            await editField(accessor, breakpoint, "hitCount");
        }
    },
};

export const editBreakpointModeAction: CommandAction = {
    id: "debug.editBreakpointMode",
    title: "Edit Mode...",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(
            MenuId.DebugBreakpointsContext,
            "navigation",
            20,
            "breakpointHasModes && (breakpointItemType == 'breakpoint' || breakpointItemType == 'exceptionBreakpoint' || breakpointItemType == 'instructionBreakpoint')",
        ),
    ],
    async run(accessor, breakpoint) {
        if (
            !(
                breakpoint instanceof Breakpoint ||
                breakpoint instanceof ExceptionBreakpoint ||
                breakpoint instanceof InstructionBreakpoint
            )
        ) {
            return;
        }
        const debugService = accessor.get(DebugServiceDIToken);
        const modes = debugService.getModel().getBreakpointModes(getModeKindForBreakpoint(breakpoint));
        const items: QuickPickItem[] = modes.map((mode) => ({ label: mode.label, description: mode.description }));
        const picked = await accessor
            .get(QuickInputServiceDIToken)
            .quickPick({ placeholder: "Select Breakpoint Mode", items });
        if (!picked) return;
        const { mode } = modes[items.indexOf(picked)];

        if (breakpoint instanceof Breakpoint) {
            const data = new Map<string, IBreakpointUpdateData>();
            data.set(breakpoint.getId(), { mode, modeLabel: picked.label });
            await debugService.updateBreakpoints(breakpoint.originalUri, data, false);
        } else if (breakpoint instanceof InstructionBreakpoint) {
            await debugService.removeInstructionBreakpoints(breakpoint.instructionReference, breakpoint.offset);
            await debugService.addInstructionBreakpoint({ ...breakpoint.toJSON(), mode, modeLabel: picked.label });
        } else {
            breakpoint.mode = mode;
            breakpoint.modeLabel = picked.label;
            // no-op to trigger a re-send
            await debugService.setExceptionBreakpointCondition(breakpoint, breakpoint.condition);
        }
    },
};

/** Upstream `MemoryBreakpointAction.parseAddress`: a range as `start - end` or `start + bytes`. */
export function parseAddress(
    range: string,
    isFinal: boolean,
): { error: string } | { address: string; bytes: number } | undefined {
    const parts = /^(\S+)\s*(?:([+-])\s*(\S+))?/.exec(range);
    if (!parts) {
        return { error: 'Address should be a range of numbers the form "[Start] - [End]" or "[Start] + [Bytes]"' };
    }

    const isNum = (e: string): boolean => (isFinal ? /^0x[0-9a-f]*|[0-9]*$/i.test(e) : /^0x[0-9a-f]+|[0-9]+$/i.test(e));
    const [, startStr, sign = "+", endStr = "1"] = parts;

    for (const n of [startStr, endStr]) {
        if (!isNum(n)) {
            return { error: `Number must be a decimal integer or hex value starting with "0x", got ${n}` };
        }
    }

    if (!isFinal) {
        return undefined;
    }

    let start: bigint;
    let end: bigint;
    try {
        start = BigInt(startStr);
        end = BigInt(endStr);
    } catch {
        // Upstream lets the SyntaxError of a number like `12g` escape.
        return { error: `Number must be a decimal integer or hex value starting with "0x", got ${range}` };
    }
    const address = `0x${start.toString(16)}`;
    if (sign === "-") {
        if (start > end) {
            return { error: `End (${endStr}) should be greater than Start (${startStr})` };
        }
        return { address, bytes: Number(end - start) };
    }

    return { address, bytes: Number(end) };
}

/** Upstream `MemoryBreakpointAction.run`: a data breakpoint on a range typed in, replacing the one edited. */
async function setMemoryBreakpoint(accessor: ServiceAccessor, existingBreakpoint: unknown): Promise<void> {
    const debugService = accessor.get(DebugServiceDIToken);
    const session = debugService.getViewModel().focusedSession;
    if (!session) {
        return;
    }
    const existing = existingBreakpoint instanceof DataBreakpoint ? existingBreakpoint : undefined;

    let defaultValue: string | undefined = undefined;
    if (existing?.src.type === DataBreakpointSetType.Address) {
        defaultValue = `${existing.src.address} + ${String(existing.src.bytes)}`;
    }

    const quickInput = accessor.get(QuickInputServiceDIToken);
    const value = await quickInput.input({
        prompt: "Enter a memory range in which to break",
        placeholder: "Absolute range (0x1234 - 0x1300) or range of bytes after an address (0x1234 + 0xff)",
        value: defaultValue,
        validateInput: (text) => {
            const result = parseAddress(text, false);
            return result && "error" in result ? result.error : null;
        },
    });
    if (value === undefined) return;
    const range = parseAddress(value, true);
    if (!range || "error" in range) {
        accessor
            .get(NotificationServiceDIToken)
            .show({ severity: "error", message: range?.error ?? value, modal: false, items: [] });
        return;
    }

    let info: IDataBreakpointInfoResponse | undefined;
    try {
        info = await session.dataBytesBreakpointInfo(range.address, range.bytes);
    } catch (e) {
        accessor.get(NotificationServiceDIToken).show({
            severity: "error",
            message: `Failed to set data breakpoint at ${range.address}: ${(e as Error).message}`,
            modal: false,
            items: [],
        });
    }

    if (!info?.dataId) {
        return;
    }

    let accessType: DebugProtocol.DataBreakpointAccessType = "write";
    if (info.accessTypes && info.accessTypes.length > 1) {
        const accessTypes = info.accessTypes.map((type) => ({ label: type }));
        const selectedAccessType = await quickInput.quickPick({
            placeholder: "Select the access type to monitor",
            items: accessTypes,
        });
        if (!selectedAccessType) {
            return;
        }

        accessType = selectedAccessType.label as DebugProtocol.DataBreakpointAccessType;
    }

    if (existing) {
        await debugService.removeDataBreakpoints(existing.getId());
    }

    await debugService.addDataBreakpoint({
        description: info.description,
        src: { type: DataBreakpointSetType.Address, ...range },
        canPersist: true,
        accessTypes: info.accessTypes,
        accessType: accessType,
        initialSessionData: { session, dataId: info.dataId },
    });
}

export const addDataBreakpointOnAddressAction: CommandAction = {
    id: "workbench.debug.viewlet.action.addDataBreakpointOnAddress",
    title: "Add Data Breakpoint at Address",
    menus: [
        {
            menuId: MenuId.ViewTitle,
            group: "navigation",
            order: 11,
            icon: codicon("variable-group"),
            when: "debugSetDataBreakpointAddressSupported",
            visible: viewMenuVisible(BREAKPOINTS_VIEW_ID),
        },
    ],
    run(accessor) {
        return setMemoryBreakpoint(accessor, undefined);
    },
};

export const editDataBreakpointOnAddressAction: CommandAction = {
    id: "workbench.debug.viewlet.action.editDataBreakpointOnAddress",
    title: "Edit Address...",
    menus: [
        ...HIDDEN_FROM_PALETTE,
        rowMenuItem(
            MenuId.DebugBreakpointsContext,
            "navigation",
            15,
            "debugSetDataBreakpointAddressSupported && breakpointItemBytes",
        ),
    ],
    run(accessor, breakpoint) {
        return setMemoryBreakpoint(accessor, breakpoint);
    },
};

export const BREAKPOINT_EDIT_ACTIONS: readonly CommandAction[] = [
    editBreakpointConditionAction,
    editFunctionBreakpointAction,
    editFunctionBreakpointHitCountAction,
    editBreakpointModeAction,
    addDataBreakpointOnAddressAction,
    editDataBreakpointOnAddressAction,
];
