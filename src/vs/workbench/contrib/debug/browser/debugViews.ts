import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";

import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { Component } from "../../../browser/component.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IViewWelcomeBlock } from "../../../browser/parts/views/viewWelcomeElement.ts";
import {
    type DebugStubModel,
    DebugStubModelDIToken,
    type IDebugBreakpoint,
    type IDebugFrame,
    type IDebugThread,
    type IDebugValue,
    type IExceptionFilter,
    type IWatchExpression,
} from "../common/debugStubModel.ts";

import { type ISpan, spansLabel, splitRow, valueSpans } from "./debugRows.ts";
import { DebugTreeList } from "./debugTreeList.ts";

/** Upstream `VIEWLET_ID`. */
export const DEBUG_VIEWLET_ID = "workbench.view.debug";
export const VARIABLES_VIEW_ID = "workbench.debug.variablesView";
export const WATCH_VIEW_ID = "workbench.debug.watchExpressionsView";
export const CALLSTACK_VIEW_ID = "workbench.debug.callStackView";
export const BREAKPOINTS_VIEW_ID = "workbench.debug.breakPointsView";

export const DebugViewsComponentDIToken = token<DebugViewsComponent>("DebugViewsComponent");

/** Upstream's `debug.contribution.ts` welcome of the Run and Debug viewlet without a `launch.json`. */
const WELCOME: readonly IViewWelcomeBlock[] = [
    { kind: "button", label: "Run and Debug", command: "workbench.action.debug.start" },
    { kind: "text", text: "" },
    { kind: "text", text: "To customize Run and Debug, create a launch.json file." },
    { kind: "text", text: "" },
    { kind: "text", text: "(spike: F5 starts a fake C++ session under CodeLLDB)" },
];

/** How long a changed value stays highlighted after a stop: upstream's `debugViewletValueChanged` animation. */
const CHANGE_HIGHLIGHT_MS = 1000;

/** A one-cell glyph in both sets: some debug codicons have no BMP fallback yet. */
function icon(name: string, fallback: string): IProductIcon {
    const base = codicon(name);
    return { nerdFont: base.nerdFont, unicode: base.unicode === "" ? fallback : base.unicode };
}

const BREAKPOINT_ICON = icon("debug-breakpoint", "●");
const BREAKPOINT_CONDITIONAL_ICON = icon("debug-breakpoint-conditional", "◆");
const BREAKPOINT_LOG_ICON = icon("debug-breakpoint-log", "◈");
const BREAKPOINT_UNVERIFIED_ICON = icon("debug-breakpoint-unverified", "○");
const BREAKPOINT_FUNCTION_ICON = icon("debug-breakpoint-function", "▲");
const STACKFRAME_ICON = icon("debug-stackframe", "➜");
const CHECKED = "[✓] ";
const UNCHECKED = "[ ] ";

type CallStackItem =
    | { readonly kind: "thread"; readonly thread: IDebugThread }
    | { readonly kind: "frame"; readonly frame: IDebugFrame; readonly thread: IDebugThread; readonly index: number }
    | { readonly kind: "more"; readonly thread: IDebugThread; readonly count: number };

type BreakpointItem =
    | { readonly kind: "exception"; readonly filter: IExceptionFilter }
    | { readonly kind: "breakpoint"; readonly breakpoint: IDebugBreakpoint };

type WatchItem = { readonly kind: "watch"; readonly watch: IWatchExpression; readonly value: IDebugValue } | { readonly kind: "child"; readonly value: IDebugValue };

/** Upstream loads this many frames of a thread first (`callStackView.ts`). */
const INITIAL_FRAMES = 20;

/**
 * SPIKE: the Run and Debug viewlet over {@link DebugStubModel} — VARIABLES, WATCH, CALL STACK and BREAKPOINTS as in
 * upstream's `variablesView.ts`, `watchExpressionsView.ts`, `callStackView.ts` and `breakpointsView.ts`.
 */
export class DebugViewsComponent extends Component {
    public static dependencies = [DebugStubModelDIToken, ViewsServiceDIToken, ProductIconServiceDIToken] as const;

    public readonly view: TUIElement;
    public readonly variables: DebugTreeList<IDebugValue>;
    public readonly watch: DebugTreeList<WatchItem>;
    public readonly callStack: DebugTreeList<CallStackItem>;
    public readonly breakpoints: DebugTreeList<BreakpointItem>;
    private readonly variablesBody: TUIElement;
    private readonly callStackBody: TUIElement;
    private highlightChanges = false;
    private highlightTimer: ReturnType<typeof setTimeout> | undefined;
    /** Threads whose remaining frames the user asked for. */
    private readonly fullThreads = new Set<number>();

    public constructor(
        private readonly model: DebugStubModel,
        private readonly views: ViewsService,
        private readonly icons: IProductIconService,
    ) {
        super();
        this.variables = new DebugTreeList<IDebugValue>("var", {
            getRoots: () => model.getScopes(),
            getChildren: (v) => v.getChildren(),
            key: (v) => v.id,
            hasChildren: (v) => v.expandable,
            // Upstream expands the first scope of a frame.
            initiallyExpanded: (v) => v.isScope === true && v.name === "Locals",
            render: (v) => spansLabel(valueSpans(v, this.highlightChanges)),
            label: (v) => v.name,
        });
        this.watch = new DebugTreeList<WatchItem>("watch", {
            getRoots: () =>
                model.watches.map((watch) => ({ kind: "watch", watch, value: model.evaluate(watch.expression, `watch/${watch.id}`) }) as const),
            getChildren: async (item) => (await item.value.getChildren()).map((value) => ({ kind: "child", value }) as const),
            key: (item) => item.value.id,
            hasChildren: (item) => item.value.expandable,
            render: (item) => this.renderWatch(item),
            label: (item) => (item.kind === "watch" ? item.watch.expression : item.value.name),
        });
        this.callStack = new DebugTreeList<CallStackItem>("stack", {
            getRoots: () => model.threads.map((thread) => ({ kind: "thread", thread }) as const),
            getChildren: (item) => (item.kind === "thread" ? this.framesOf(item.thread) : []),
            key: (item) => this.callStackKey(item),
            hasChildren: (item) => item.kind === "thread" && item.thread.frames.length > 0,
            // Upstream expands the stopped thread (and the session) on a stop.
            initiallyExpanded: (item) => item.kind === "thread" && item.thread.id === 1,
            render: (item) => this.renderCallStackItem(item),
            label: (item) => (item.kind === "thread" ? item.thread.name : item.kind === "frame" ? item.frame.name : ""),
        });
        this.breakpoints = new DebugTreeList<BreakpointItem>("bp", {
            getRoots: () => [
                ...model.exceptionFilters.map((filter) => ({ kind: "exception", filter }) as const),
                ...model.breakpoints.map((breakpoint) => ({ kind: "breakpoint", breakpoint }) as const),
            ],
            getChildren: () => [],
            key: (item) => (item.kind === "exception" ? item.filter.id : String(item.breakpoint.id)),
            hasChildren: () => false,
            render: (item) => this.renderBreakpoint(item),
            label: (item) => (item.kind === "exception" ? item.filter.label : item.breakpoint.file),
        });

        this.callStack.onSelect = (item) => {
            if (item.kind === "frame") model.focusFrame(item.frame.id);
        };
        this.callStack.onActivate = (item) => {
            if (item.kind === "frame") model.focusFrame(item.frame.id);
            if (item.kind === "more") {
                this.fullThreads.add(item.thread.id);
                this.refreshLater(this.callStack);
            }
        };
        // Upstream: Space or a click on the checkbox toggles; here Enter does it too.
        this.breakpoints.onActivate = (item) => {
            if (item.kind === "exception") model.toggleExceptionFilter(item.filter.id);
            else model.toggleBreakpoint(item.breakpoint.id);
        };
        this.breakpoints.list.addEventListener("keydown", (event) => {
            const item = this.breakpoints.selected;
            if (item === undefined) return;
            if (event.key === " ") {
                event.preventDefault();
                if (item.kind === "exception") model.toggleExceptionFilter(item.filter.id);
                else model.toggleBreakpoint(item.breakpoint.id);
            } else if (event.key === "Delete" && item.kind === "breakpoint") {
                event.preventDefault();
                model.removeBreakpoint(item.breakpoint.id);
            }
        });
        this.watch.list.addEventListener("keydown", (event) => {
            const item = this.watch.selected;
            if (item?.kind !== "watch") return;
            if (event.key === "Delete") {
                event.preventDefault();
                model.removeWatch(item.watch.id);
            }
        });

        this.variablesBody = new ScrollBarDecorator(this.variables.list);
        this.callStackBody = new ScrollBarDecorator(this.callStack.list);
        this.view = this.variablesBody;

        views.registerContainer({
            id: DEBUG_VIEWLET_ID,
            title: "RUN AND DEBUG",
            label: "Run and Debug",
            location: "sidebar",
            // Upstream `order: 3`: after Source Control, before Extensions.
            order: 2.5,
        });
        views.registerView({
            id: VARIABLES_VIEW_ID,
            containerId: DEBUG_VIEWLET_ID,
            title: "VARIABLES",
            order: 10,
            body: null,
            placeholder: WELCOME,
            canMoveView: true,
            focus: () => {
                this.variables.list.focus();
            },
        });
        views.registerView({
            id: WATCH_VIEW_ID,
            containerId: DEBUG_VIEWLET_ID,
            title: "WATCH",
            order: 20,
            body: new ScrollBarDecorator(this.watch.list),
            canMoveView: true,
            focus: () => {
                this.watch.list.focus();
            },
        });
        views.registerView({
            id: CALLSTACK_VIEW_ID,
            containerId: DEBUG_VIEWLET_ID,
            title: "CALL STACK",
            order: 30,
            body: null,
            placeholder: "Not debugging.",
            canMoveView: true,
            focus: () => {
                this.callStack.list.focus();
            },
        });
        views.registerView({
            id: BREAKPOINTS_VIEW_ID,
            containerId: DEBUG_VIEWLET_ID,
            title: "BREAKPOINTS",
            order: 40,
            body: new ScrollBarDecorator(this.breakpoints.list),
            canMoveView: true,
            focus: () => {
                this.breakpoints.list.focus();
            },
        });

        this.register(
            model.onDidChangeState(() => {
                this.onStateChanged();
            }),
        );
        this.register(
            model.onDidFocusFrame(() => {
                this.refreshLater(this.variables);
                this.refreshLater(this.callStack);
            }),
        );
        this.register(
            model.onDidChangeWatch(() => {
                this.refreshLater(this.watch);
            }),
        );
        this.register(
            model.onDidChangeBreakpoints(() => {
                this.refreshLater(this.breakpoints);
            }),
        );
        this.register(
            icons.onDidChange(() => {
                this.refreshAll();
            }),
        );
        this.register({
            dispose: () => {
                clearTimeout(this.highlightTimer);
            },
        });
        this.refreshAll();
    }

    public async addWatchExpression(expression: string): Promise<void> {
        this.model.addWatch(expression);
        await this.watch.refresh();
        this.views.openView(WATCH_VIEW_ID, true);
    }

    private onStateChanged(): void {
        const state = this.model.state;
        this.views.setViewBody(VARIABLES_VIEW_ID, state === "inactive" ? null : this.variablesBody);
        this.views.setViewBody(CALLSTACK_VIEW_ID, state === "inactive" ? null : this.callStackBody);
        if (state === "stopped") {
            this.fullThreads.clear();
            this.highlightChanges = true;
            clearTimeout(this.highlightTimer);
            this.highlightTimer = setTimeout(() => {
                this.highlightChanges = false;
                this.refreshLater(this.variables);
                this.refreshLater(this.watch);
            }, CHANGE_HIGHLIGHT_MS);
        }
        if (state === "running") {
            // Upstream keeps the old values for a moment (`variablesView` delays the clear by 400 ms); the spike
            // keeps them until the next stop to see how stale data reads.
            this.refreshLater(this.callStack);
            return;
        }
        if (state !== "inactive") this.views.openViewContainer(DEBUG_VIEWLET_ID);
        this.refreshAll();
    }

    private refreshAll(): void {
        this.refreshLater(this.variables);
        this.refreshLater(this.watch);
        this.refreshLater(this.callStack);
        this.refreshLater(this.breakpoints);
    }

    private refreshLater<T>(tree: DebugTreeList<T>): void {
        void tree.refresh().catch(onUnexpectedError);
    }

    private framesOf(thread: IDebugThread): CallStackItem[] {
        const all = this.fullThreads.has(thread.id);
        const frames = all ? thread.frames : thread.frames.slice(0, INITIAL_FRAMES);
        const items: CallStackItem[] = frames.map((frame, index) => ({ kind: "frame", frame, thread, index }));
        if (!all && thread.totalFrames > frames.length) {
            items.push({ kind: "more", thread, count: thread.totalFrames - frames.length });
        }
        return items;
    }

    private callStackKey(item: CallStackItem): string {
        if (item.kind === "thread") return `t${String(item.thread.id)}`;
        if (item.kind === "frame") return item.frame.id;
        return `more${String(item.thread.id)}`;
    }

    private renderCallStackItem(item: CallStackItem): TUIElement {
        if (item.kind === "thread") {
            const exception = item.thread.stateLabel.includes("EXCEPTION");
            return splitRow(
                [{ text: item.thread.name }],
                [
                    {
                        text: ` ${item.thread.stateLabel} `,
                        fg: exception ? "debugView.exceptionLabelForeground" : "debugView.stateLabelForeground",
                        bg: exception ? "debugView.exceptionLabelBackground" : "debugView.stateLabelBackground",
                    },
                ],
            );
        }
        if (item.kind === "more") {
            return spansLabel([{ text: `Load ${String(item.count)} More Stack Frames`, fg: "textLink.foreground" }]);
        }
        const { frame } = item;
        const focused = this.model.focusedFrameId === frame.id;
        const top = item.index === 0 && item.thread.id === 1;
        const marker: ISpan = {
            text: top || focused ? `${this.icons.glyph(STACKFRAME_ICON)} ` : "  ",
            fg: "debugIcon.breakpointCurrentStackframeForeground",
        };
        if (frame.source === undefined) {
            // Upstream `presentationHint: subtle`/no source: dimmed and italic, no line.
            return spansLabel([marker, { text: frame.name, fg: "descriptionForeground", italic: true }]);
        }
        // Deviation: upstream pins `file line:col` to the right edge; a narrow sidebar would eat the function name,
        // so the location follows the name and the edge cuts it first.
        return spansLabel([
            marker,
            { text: frame.name, bold: focused },
            { text: `  ${frame.source}:${String(frame.line)}`, fg: "descriptionForeground" },
        ]);
    }

    private renderWatch(item: WatchItem): TUIElement {
        if (item.kind === "child") return spansLabel(valueSpans(item.value, this.highlightChanges));
        const spans = valueSpans(item.value, this.highlightChanges);
        // The watch row names the expression, not the evaluated variable.
        return spansLabel([{ text: item.watch.expression, fg: "debugTokenExpression.name" }, ...spans.slice(1)]);
    }

    private renderBreakpoint(item: BreakpointItem): TUIElement {
        if (item.kind === "exception") {
            return spansLabel([{ text: item.filter.enabled ? CHECKED : UNCHECKED }, { text: item.filter.label }]);
        }
        const bp = item.breakpoint;
        const glyph =
            bp.line === 0
                ? BREAKPOINT_FUNCTION_ICON
                : !bp.verified
                  ? BREAKPOINT_UNVERIFIED_ICON
                  : bp.logMessage !== undefined
                    ? BREAKPOINT_LOG_ICON
                    : bp.condition !== undefined
                      ? BREAKPOINT_CONDITIONAL_ICON
                      : BREAKPOINT_ICON;
        const iconColor = bp.enabled && bp.verified ? "debugIcon.breakpointForeground" : "debugIcon.breakpointDisabledForeground";
        const left: ISpan[] = [
            { text: bp.enabled ? CHECKED : UNCHECKED },
            { text: `${this.icons.glyph(glyph)} `, fg: iconColor },
            { text: bp.file, ...(bp.verified ? {} : { fg: "descriptionForeground" }) },
        ];
        if (bp.dir !== "") left.push({ text: ` ${bp.dir}`, fg: "descriptionForeground" });
        // Deviation: upstream shows the condition and the log message only in the hover.
        if (bp.condition !== undefined) left.push({ text: `  if ${bp.condition}`, fg: "descriptionForeground", italic: true });
        if (bp.logMessage !== undefined) left.push({ text: `  log "${bp.logMessage}"`, fg: "descriptionForeground", italic: true });
        return splitRow(left, bp.line === 0 ? [] : [{ text: String(bp.line), fg: "descriptionForeground" }]);
    }
}
