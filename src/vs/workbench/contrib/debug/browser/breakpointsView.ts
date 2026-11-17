/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/breakpointsView.ts
// The BREAKPOINTS tree: the exception filters of the focused session on top, then the function, data, source and
// instruction breakpoints, each with its checkbox and upstream's icon of its kind and state in the
// `debugIcon.breakpoint*` colors, muted while the breakpoints are deactivated or not verified by a running session.
// `debug.breakpointsView.presentation: tree` groups the source breakpoints under a row per file with a three-state
// checkbox, the breakpoint rows reading the source line. A click on a checkbox (or Space) enables or disables, Enter
// or a double click opens the breakpoint's line, Ctrl+Enter beside. On a stop the breakpoint that was hit gets the
// cursor. Deviations: a source breakpoint's condition, hit count, log message and the breakpoint it waits for are
// written in the row in italics, not only in the hover (decision 2026-11-14, there are no hovers on the rows), and so
// is upstream's hover message of a breakpoint the debugger does not support, in the warning color; a function
// breakpoint's name is typed in the quick input (as a watch expression), and the rows have no hover. The editing
// commands of the rows are in `breakpointEditActions.ts`. Not here yet: the inline buttons, the hint about unverified
// breakpoints in the title. Not planned: the disassembly view (instruction breakpoints are listed, not opened).

import { StyleFlags } from "@tuidom/core/common/styleFlags";

import { codicon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { type Uri, UriUtils } from "../../../../base/common/uri.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { type IRowSpan, LazyTreeControl } from "../../../browser/parts/views/lazyTreeControl.ts";
import {
    DEBUG_SCHEME,
    type IBreakpoint,
    type IDataBreakpoint,
    type IDebugModel,
    type IDebugService,
    type IExceptionBreakpoint,
    type IFunctionBreakpoint,
    type IInstructionBreakpoint,
    type IThread,
    State,
} from "../common/debug.ts";
import {
    Breakpoint,
    DataBreakpoint,
    ExceptionBreakpoint,
    FunctionBreakpoint,
    InstructionBreakpoint,
} from "../common/debugModel.ts";

type BreakpointItem =
    | IBreakpoint
    | IFunctionBreakpoint
    | IDataBreakpoint
    | IExceptionBreakpoint
    | IInstructionBreakpoint;

/**
 * Represents a file node in the breakpoints tree that groups breakpoints by file.
 */
export class BreakpointsFolderItem {
    public constructor(
        public readonly uri: Uri,
        public readonly breakpoints: IBreakpoint[],
    ) {}

    public getId(): string {
        return this.uri.toString();
    }

    /** Upstream's `enabled` and `indeterminate` in one: all the file's breakpoints are enabled, none, or some. */
    public get checked(): boolean | "mixed" {
        const enabled = this.breakpoints.filter((bp) => bp.enabled).length;
        if (enabled === this.breakpoints.length) return true;
        return enabled === 0 ? false : "mixed";
    }
}

export type BreakpointTreeElement = BreakpointsFolderItem | BreakpointItem;

/** The files behind the breakpoints: their labels, their lines, the editor that shows them. */
export interface IBreakpointSources {
    /** Upstream `getUriLabel(uri, { relative: true })`. */
    uriLabel(uri: Uri): string;
    /** The lines of a file, for the rows under a file in the tree presentation. */
    readLines(uri: Uri): Promise<readonly string[]>;
    /** Upstream `openBreakpointSource`: the breakpoint's line in an editor, beside the active one or in it. */
    openBreakpoint(breakpoint: IBreakpoint, sideBySide: boolean): Promise<void>;
}
export const BreakpointSourcesDIToken = token<IBreakpointSources>("BreakpointSources");

/** A source breakpoint as upstream names it in its lists: the file and the line. */
export function breakpointLabel(sources: Pick<IBreakpointSources, "uriLabel">, breakpoint: IBreakpoint): string {
    return `${sources.uriLabel(breakpoint.uri)}: ${String(breakpoint.lineNumber)}`;
}

/** How the view draws: the glyphs and `debug.breakpointsView.presentation`. */
export interface IBreakpointsViewLook {
    readonly icons: Pick<IProductIconService, "glyph">;
    presentation(): "tree" | "list";
}

const MUTED = "descriptionForeground";
const WARNING = "editorWarning.foreground";

/** Upstream `debugIcons.ts`: the icon of a kind of breakpoint in its three states. */
const BREAKPOINT_ICONS = {
    breakpoint: "debug-breakpoint",
    functionBreakpoint: "debug-breakpoint-function",
    conditionalBreakpoint: "debug-breakpoint-conditional",
    dataBreakpoint: "debug-breakpoint-data",
    logBreakpoint: "debug-breakpoint-log",
} as const;

/**
 * Upstream `getBreakpointMessageAndIcon` without the message (the rows have no hover): the codicon of a breakpoint
 * in the given state.
 */
export function getBreakpointIcon(
    state: State,
    breakpointsActivated: boolean,
    breakpoint: BreakpointItem,
    debugModel: IDebugModel,
): string {
    const debugActive = state === State.Running || state === State.Stopped;

    const breakpointIcon =
        breakpoint instanceof DataBreakpoint
            ? BREAKPOINT_ICONS.dataBreakpoint
            : breakpoint instanceof FunctionBreakpoint
              ? BREAKPOINT_ICONS.functionBreakpoint
              : breakpoint.logMessage
                ? BREAKPOINT_ICONS.logBreakpoint
                : BREAKPOINT_ICONS.breakpoint;

    if (!breakpoint.enabled || !breakpointsActivated) {
        return `${breakpointIcon}-disabled`;
    }

    if (debugActive && breakpoint instanceof Breakpoint && breakpoint.pending) {
        return "debug-breakpoint-pending";
    }

    if (debugActive && !breakpoint.verified) {
        return `${breakpointIcon}-unverified`;
    }

    if (breakpoint instanceof DataBreakpoint || breakpoint instanceof FunctionBreakpoint) {
        return breakpoint.supported ? breakpointIcon : `${breakpointIcon}-unverified`;
    }

    if (breakpoint instanceof InstructionBreakpoint) {
        return breakpoint.supported ? breakpointIcon : `${breakpointIcon}-unverified`;
    }

    // can change this when all breakpoint supports dependent breakpoint condition. Only a source breakpoint is
    // left here, and no breakpoint's id is undefined: one without a trigger finds none.
    const triggeredBy = (breakpoint as IBreakpoint).triggeredBy;
    const triggeringBreakpoint = debugModel.getBreakpoints().find((bp) => bp.getId() === triggeredBy);

    if (breakpoint.logMessage || breakpoint.condition || breakpoint.hitCondition || triggeringBreakpoint) {
        if (!breakpoint.supported) {
            return "debug-breakpoint-unsupported";
        }
        return breakpoint.logMessage ? BREAKPOINT_ICONS.logBreakpoint : BREAKPOINT_ICONS.conditionalBreakpoint;
    }

    return breakpointIcon;
}

/** Upstream's theme rules of the breakpoint codicons, in the view and the editor's glyph lane. */
export function breakpointIconColor(icon: string): string {
    if (icon.endsWith("-disabled")) return "debugIcon.breakpointDisabledForeground";
    if (icon.endsWith("-unverified")) return "debugIcon.breakpointUnverifiedForeground";
    return "debugIcon.breakpointForeground";
}

export class BreakpointsView extends Disposable {
    public readonly tree: LazyTreeControl<BreakpointTreeElement>;
    /** The lines of the files the tree presentation shows breakpoints of, by uri. */
    private readonly lines = new Map<string, readonly string[] | "loading" | "failed">();
    /** The breakpoint the last stop put the cursor on, to take it away once the program goes on. */
    private autoFocusedElement: BreakpointItem | undefined;

    public constructor(
        private readonly debugService: IDebugService,
        private readonly sources: IBreakpointSources,
        private readonly look: IBreakpointsViewLook,
    ) {
        super();
        this.tree = new LazyTreeControl<BreakpointTreeElement>(
            {
                getRoots: () => this.getTreeElements(),
                // Only a file row has children.
                getChildren: (element) => (element as BreakpointsFolderItem).breakpoints,
                getKey: (element) => element.getId(),
                hasChildren: (element) => element instanceof BreakpointsFolderItem,
                // Items are expanded by default.
                isInitiallyExpanded: () => true,
                renderRow: (element) => this.renderRow(element),
                renderRowEnd: (element) => this.renderBadge(element),
                getLabel: (element) => getKeyboardNavigationLabel(element),
            },
            // Stryker disable next-line StringLiteral: the prefix keeps the row ids apart from other views'; no other view in the window has a breakpoint's key
            { idPrefix: "breakpoints" },
        );
        this.tree.onActivate = (element) => {
            if (element instanceof Breakpoint) {
                this.openBreakpoint(element, false).catch(onUnexpectedError);
            }
        };
        this.register(
            debugService.getModel().onDidChangeBreakpoints(() => {
                this.refresh();
            }),
        );
        this.register(
            debugService.getViewModel().onDidFocusSession(() => {
                this.refresh();
            }),
        );
        this.register(
            debugService.onDidChangeState(() => {
                this.onStateChange();
            }),
        );
        this.refresh();
    }

    public refresh(): void {
        // A file may have changed since its lines were read.
        this.lines.clear();
        this.tree.refresh().catch(onUnexpectedError);
    }

    public focus(): void {
        this.tree.list.focus();
    }

    /** Upstream `openBreakpointSource`: a source the adapter gave lives only as long as the debugging. */
    public async openBreakpoint(breakpoint: IBreakpoint, sideBySide: boolean): Promise<void> {
        if (breakpoint.uri.scheme === DEBUG_SCHEME && this.debugService.state === State.Inactive) return;
        await this.sources.openBreakpoint(breakpoint, sideBySide);
    }

    /** The breakpoint under the cursor; a file row is not one. */
    public get focusedBreakpoint(): BreakpointItem | undefined {
        const focused = this.tree.focused;
        return focused instanceof BreakpointsFolderItem ? undefined : focused;
    }

    private onStateChange(): void {
        // The icons and the muted rows follow the state.
        this.tree.rerender();
        const thread = this.debugService.getViewModel().focusedThread;
        const hitElement = thread && this.hitBreakpoint(thread);
        if (hitElement) {
            this.tree.reveal(hitElement);
            this.autoFocusedElement = hitElement;
            return;
        }
        // Deselect breakpoint in breakpoint view when no longer stopped on it #125528. Without one there is no
        // cursor to take away when nothing has it.
        if (this.tree.focused === this.autoFocusedElement) {
            this.tree.list.clearCursor();
        }
        this.autoFocusedElement = undefined;
    }

    /** The breakpoint the thread stopped at, by the adapter's ids in the session. */
    private hitBreakpoint(thread: IThread): BreakpointItem | undefined {
        const hitIds = thread.stoppedDetails?.hitBreakpointIds;
        if (hitIds === undefined) return undefined;
        const sessionId = thread.session.getId();
        return this.flatElements(sessionId).find((e) => hitIds.some((id) => id === e.getIdFromAdapter(sessionId)));
    }

    private getTreeElements(): BreakpointTreeElement[] {
        const model = this.debugService.getModel();
        const sessionId = this.debugService.getViewModel().focusedSession?.getId();
        // Exception breakpoints at the top (root level), then function and data breakpoints (root level)
        const result: BreakpointTreeElement[] = [
            ...model.getExceptionBreakpointsForSession(sessionId),
            ...model.getFunctionBreakpoints(),
            ...model.getDataBreakpoints(),
        ];

        // Source breakpoints - group by file if showAsTree is enabled
        const sourceBreakpoints = model.getBreakpoints();
        if (this.look.presentation() === "tree") {
            const breakpointsByUri = new Map<string, IBreakpoint[]>();
            for (const bp of sourceBreakpoints) {
                const key = bp.uri.toString();
                const group = breakpointsByUri.get(key) ?? [];
                group.push(bp);
                breakpointsByUri.set(key, group);
            }
            for (const breakpoints of breakpointsByUri.values()) {
                // Sort breakpoints by line number
                breakpoints.sort((a, b) => a.lineNumber - b.lineNumber);
                result.push(new BreakpointsFolderItem(breakpoints[0].uri, breakpoints));
            }
        } else {
            result.push(...sourceBreakpoints);
        }

        // Instruction breakpoints (root level)
        result.push(...model.getInstructionBreakpoints());
        return result;
    }

    private flatElements(sessionId: string): BreakpointItem[] {
        const model = this.debugService.getModel();
        return [
            ...model.getExceptionBreakpointsForSession(sessionId),
            ...model.getFunctionBreakpoints(),
            ...model.getDataBreakpoints(),
            ...model.getBreakpoints(),
            ...model.getInstructionBreakpoints(),
        ];
    }

    private checkbox(checked: boolean | "mixed", toggle: () => void): IRowSpan {
        const mark = checked === "mixed" ? "-" : checked ? "✓" : " ";
        return { text: `[${mark}] `, onClick: toggle };
    }

    private renderRow(element: BreakpointTreeElement): IRowSpan[] {
        const model = this.debugService.getModel();
        if (element instanceof BreakpointsFolderItem) {
            return this.renderFolder(element);
        }
        const check = this.checkbox(element.enabled, () => {
            void this.debugService.enableOrDisableBreakpoints(!element.enabled, element).catch(onUnexpectedError);
        });
        if (element instanceof ExceptionBreakpoint) {
            const muted = !element.verified;
            return [
                check,
                { text: element.label || `${element.filter} exceptions`, ...(muted ? { fg: MUTED } : {}) },
                ...italicNote(element.condition),
            ];
        }
        const icon = getBreakpointIcon(this.debugService.state, model.areBreakpointsActivated(), element, model);
        const glyph: IRowSpan = { text: `${this.look.icons.glyph(codicon(icon))} `, fg: breakpointIconColor(icon) };
        const muted = this.isMuted(element);
        const text = (value: string): IRowSpan => ({ text: value, ...(muted ? { fg: MUTED } : {}) });
        const warning = this.unsupportedWarning(element);
        if (element instanceof FunctionBreakpoint) {
            return [check, glyph, text(element.name), ...italicNote(conditionLabel(element)), ...warning];
        }
        if (element instanceof DataBreakpoint) {
            const access = element.accessType === "read" ? "Read" : element.accessType === "write" ? "Write" : "Access";
            return [
                check,
                glyph,
                text(element.description),
                { text: `  ${access}`, fg: MUTED },
                ...italicNote(conditionLabel(element)),
                ...warning,
            ];
        }
        if (element instanceof InstructionBreakpoint) {
            return [check, glyph, text(`0x${element.address.toString(16)}`), ...warning];
        }
        const breakpoint = element as IBreakpoint;
        // Deviation: upstream shows the condition, the hit count, the log message and the trigger only in the hover.
        const trigger =
            // Stryker disable next-line ConditionalExpression: the search for an undefined id finds none; the check saves the search on every row
            breakpoint.triggeredBy === undefined
                ? undefined
                : model.getBreakpoints().find((bp) => bp.getId() === breakpoint.triggeredBy);
        const notes = [
            ...italicNote(breakpoint.condition && `if ${breakpoint.condition}`),
            ...italicNote(breakpoint.hitCondition && `hit count ${breakpoint.hitCondition}`),
            ...italicNote(breakpoint.logMessage && `log "${breakpoint.logMessage}"`),
            ...italicNote(trigger && `after ${breakpointLabel(this.sources, trigger)}`),
            ...warning,
        ];
        if (this.look.presentation() === "tree") {
            return [check, glyph, text(this.lineContent(breakpoint)), ...notes];
        }
        const dir = this.sources.uriLabel(UriUtils.dirname(breakpoint.uri));
        return [
            check,
            glyph,
            text(UriUtils.basenameOrAuthority(breakpoint.uri)),
            { text: ` ${dir}`, fg: MUTED },
            ...notes,
        ];
    }

    private renderFolder(folder: BreakpointsFolderItem): IRowSpan[] {
        const checked = folder.checked;
        const check = this.checkbox(checked, () => {
            const enabled = checked === "mixed" ? true : !checked;
            for (const bp of folder.breakpoints) {
                void this.debugService.enableOrDisableBreakpoints(enabled, bp).catch(onUnexpectedError);
            }
        });
        const activated = this.debugService.getModel().areBreakpointsActivated();
        return [
            check,
            { text: UriUtils.basenameOrAuthority(folder.uri), ...(activated ? {} : { fg: MUTED }) },
            { text: ` ${this.sources.uriLabel(UriUtils.dirname(folder.uri))}`, fg: MUTED },
        ];
    }

    /** Upstream's badge: the line (and column) of a source breakpoint, the mode of the others. */
    private renderBadge(element: BreakpointTreeElement): IRowSpan[] {
        // Stryker disable next-line ConditionalExpression: a file row has no mode label, so the path below gives no badge either
        if (element instanceof BreakpointsFolderItem) return [];
        let badge = element.modeLabel;
        if (element instanceof Breakpoint) {
            const position =
                element.column === undefined
                    ? String(element.lineNumber)
                    : `${String(element.lineNumber)}:${String(element.column)}`;
            badge = badge === undefined ? position : `${badge}: ${position}`;
        }
        return badge === undefined ? [] : [{ text: badge, fg: MUTED }];
    }

    /**
     * Upstream's hover message of a breakpoint the debugger does not support (`getBreakpointMessageAndIcon`): only of
     * an enabled one, and not while a running session has not verified it (its message is the adapter's then).
     */
    private unsupportedWarning(element: BreakpointItem): IRowSpan[] {
        if (!element.enabled || !this.debugService.getModel().areBreakpointsActivated()) return [];
        const debugActive = this.debugService.state === State.Running || this.debugService.state === State.Stopped;
        if ((debugActive && !element.verified) || element.supported) return [];
        // A source breakpoint is unsupported only for its condition, hit count or log message.
        const message =
            element instanceof DataBreakpoint
                ? "Data breakpoints not supported by this debug type"
                : element instanceof FunctionBreakpoint
                  ? "Function breakpoints not supported by this debug type"
                  : element instanceof InstructionBreakpoint
                    ? "Instruction breakpoints not supported by this debug type"
                    : "Breakpoints of this type are not supported by the debugger";
        return [{ text: `  ${message}`, fg: WARNING, style: StyleFlags.Italic }];
    }

    /** Upstream's `.disabled` row: the breakpoints are off, unsupported by the session, or not verified by it. */
    private isMuted(element: BreakpointItem): boolean {
        if (!this.debugService.getModel().areBreakpointsActivated()) return true;
        const session = this.debugService.getViewModel().focusedSession;
        if (element instanceof FunctionBreakpoint) return session?.capabilities.supportsFunctionBreakpoints === false;
        if (element instanceof DataBreakpoint) return session?.capabilities.supportsDataBreakpoints === false;
        const debugActive = this.debugService.state === State.Running || this.debugService.state === State.Stopped;
        return debugActive && !element.verified;
    }

    /** Upstream `renderBreakpointLineLabel`: the source line under a file row, read once per file. */
    private lineContent(breakpoint: IBreakpoint): string {
        const key = breakpoint.uri.toString();
        const lines = this.lines.get(key);
        if (lines === undefined) {
            this.lines.set(key, "loading");
            this.sources.readLines(breakpoint.uri).then(
                (read) => {
                    this.lines.set(key, read);
                    this.tree.rerender();
                },
                () => {
                    this.lines.set(key, "failed");
                    this.tree.rerender();
                },
            );
            return "Loading...";
        }
        if (lines === "loading") return "Loading...";
        if (lines === "failed") return "(cannot load line)";
        if (breakpoint.lineNumber > lines.length) return "(line not found)";
        return lines[breakpoint.lineNumber - 1].trim() || "(empty line)";
    }
}

function italicNote(note: string | undefined): IRowSpan[] {
    return note ? [{ text: `  ${note}`, fg: MUTED, style: StyleFlags.Italic }] : [];
}

/** Upstream's condition label of a function or a data breakpoint. */
function conditionLabel(breakpoint: IFunctionBreakpoint | IDataBreakpoint): string | undefined {
    if (breakpoint.condition && breakpoint.hitCondition) {
        return `Condition: ${breakpoint.condition} | Hit Count: ${breakpoint.hitCondition}`;
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty condition is none, as upstream
    return breakpoint.condition || breakpoint.hitCondition;
}

function getKeyboardNavigationLabel(element: BreakpointTreeElement): string {
    if (element instanceof BreakpointsFolderItem) return UriUtils.basenameOrAuthority(element.uri);
    if (element instanceof Breakpoint) return `${UriUtils.basenameOrAuthority(element.uri)}:${element.lineNumber}`;
    if (element instanceof FunctionBreakpoint) return element.name;
    if (element instanceof DataBreakpoint) return element.description;
    if (element instanceof ExceptionBreakpoint) return element.label || element.filter;
    return `0x${(element as IInstructionBreakpoint).address.toString(16)}`;
}
