/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/repl.ts
// The Debug Console (upstream `Repl` and the renderers of `replViewer.ts`): the console of the shown session as a
// tree — output in its ANSI colors with its links, its source on the right and the count of collapsed lines; groups as
// nodes; evaluations with their expandable results; objects the adapter logged — over a multi-line input. Lines wrap
// with `debug.console.wordWrap`. The filter is in the view's title ("Filter (e.g. text, !exclude, \escape)", kept per
// workspace, "Showing n of m" beside it). Enter evaluates in the focused frame (context `repl`), Shift+Enter breaks the
// line, Up/Down walk the history (100 entries per workspace) from the first and the last line, Escape clears the
// input; the input completes through the adapter (`replSuggest.ts`). The tree follows its tail unless the user
// scrolled up; an evaluation scrolls to it anyway. Which session is shown follows upstream's `selectSession`: the
// focused one, else the one shown until it is cleared, else any other.
// Deviations: without a running session upstream makes the input read-only and shows the hint in it; here the hint
// is the placeholder and Enter still echoes the input with the hint as its result. `stdout` (severity `info`) is in
// the plain foreground, not `debugConsole.infoForeground` (the spike's look). Escape clearing the input is ours. A line
// break inside an element is a space without wrapping (the row is one line, cut: the list does not scroll sideways);
// with wrapping it breaks the row, as upstream's `pre-wrap`. The filter has no history of its own (upstream's Up/Down in it).
// With several consoles (`multiSessionRepl`: the sessions with a console of their own, but the cleared ended ones) the
// title has upstream's select of them (`SelectReplActionViewItem`) after the filter; picking one runs
// `workbench.action.debug.selectRepl`.
// Not here yet (#1158): Find, clicking a source to open it, the `debug.console.*` font settings (the terminal's font). The view has no `debuggersAvailable`
// gate: it is always there.

import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { OverlayLayer } from "@tuidom/core/dom/overlayLayer";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { VFlexElement, vflexFill, vflexFit } from "@tuidom/elements/layout/vFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { combinedDisposable, type IDisposable, MutableDisposable } from "../../../../base/common/lifecycle.ts";
import { removeAnsiEscapeCodes } from "../../../../base/common/strings.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { type MenuService, MenuServiceDIToken } from "../../../../platform/actions/common/menuService.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import {
    type ContextMenuService,
    ContextMenuServiceDIToken,
} from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IStateDescriptor,
    type IStateService,
    StateServiceDIToken,
} from "../../../../platform/state/common/iStateService.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { Component } from "../../../browser/component.ts";
import { type IRowSpan, LazyTreeControl } from "../../../browser/parts/views/lazyTreeControl.ts";
import { type ViewsService, ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import {
    DEBUG_PANEL_ID,
    type IDebugSession,
    type IExpression,
    type INestingReplElement,
    type IReplElement,
    type IReplElementSource,
    REPL_VIEW_ID,
    type ReplSeverity,
    State,
} from "../common/debug.ts";
import { Variable } from "../common/debugModel.ts";
import {
    ReplEvaluationInput,
    ReplEvaluationResult,
    ReplGroup,
    ReplOutputElement,
    ReplVariableElement,
} from "../common/replModel.ts";

import { handleANSIOutput } from "./debugANSIHandling.ts";
import { showDebugContextMenu } from "./debugContextMenus.ts";
import { DebugExpressionRenderer } from "./debugExpressionRenderer.ts";
import { type DebugService, DebugServiceDIToken } from "./debugService.ts";
import { FocusSessionActionViewItem } from "./focusSessionActionViewItem.ts";
import { type LinkDetector, LinkDetectorDIToken } from "./linkDetector.ts";
import { ReplFilter } from "./replFilter.ts";
import { ReplSuggest } from "./replSuggest.ts";

/** Upstream's id of the console's select of sessions (`repl.ts`); `replActions.ts` registers its command. */
export const SELECT_REPL_ID = "workbench.action.debug.selectRepl";

export const ReplDIToken = token<Repl>("Repl");

const HISTORY_STORAGE_KEY: IStateDescriptor<string[]> = { key: "debug.repl.history", scope: "workspace", default: [] };
const FILTER_VALUE_STORAGE_KEY: IStateDescriptor<string> = {
    key: "debug.repl.filter.value",
    scope: "workspace",
    default: "",
};
/** Upstream's `HistoryNavigator` limit. */
const HISTORY_LIMIT = 100;
/** Upstream's delay before the tree follows the console. */
const REFRESH_DELAY_MS = 50;
/** The filter field's columns: upstream's filter widget is a fixed width too. */
const FILTER_WIDTH = 30;
export const START_DEBUG_FIRST = "Please start a debug session to evaluate expressions";
export const FILTER_PLACEHOLDER = "Filter (e.g. text, !exclude, \\escape)";

/** Upstream `debugConsoleEvaluationInput` (the echo of an evaluation) and `debugConsoleEvaluationPrompt`. */
const EVALUATION_INPUT_ICON = codicon("arrow-small-right");
const EVALUATION_PROMPT_ICON = codicon("chevron-right");

/** Upstream's `.value.warn/.error/.ignore` of an output line; `info` keeps the plain foreground. */
const SEVERITY_SPAN: Readonly<Record<ReplSeverity, Omit<IRowSpan, "text"> & { readonly style: StyleFlags }>> = {
    info: { style: StyleFlags.None },
    warning: { fg: "debugConsole.warningForeground", style: StyleFlags.None },
    error: { fg: "debugConsole.errorForeground", style: StyleFlags.None },
    ignore: { style: StyleFlags.Italic },
};

/**
 * The text of a row. Wrapped, its line breaks stay (upstream's `pre-wrap`), but the element's own last one; cut to one
 * line, a line break is a space.
 */
function rowText(value: string, wrap: boolean): string {
    return wrap ? value.replace(/\r?\n$/u, "").replace(/\r\n/gu, "\n") : value.replace(/\r?\n/gu, " ");
}

function isNesting(element: IReplElement): element is INestingReplElement {
    return (element as Partial<INestingReplElement>).hasChildren === true;
}

/** Upstream `SourceWidget`: `name:line`, its own color; a click that opens it is not here yet. */
function sourceSpan(source: IReplElementSource | undefined): IRowSpan[] {
    if (source === undefined) return [];
    const path = source.source.name;
    const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    return [{ text: `${name}:${String(source.lineNumber)}`, fg: "debugConsole.sourceForeground" }];
}

export class Repl extends Component implements IContextKeyContributor {
    public static dependencies = [
        DebugServiceDIToken,
        ViewsServiceDIToken,
        IConfigurationServiceDIToken,
        ProductIconServiceDIToken,
        StateServiceDIToken,
        MenuServiceDIToken,
        ContextMenuServiceDIToken,
        CommandRegistryDIToken,
        LinkDetectorDIToken,
        LayoutServiceDIToken,
    ] as const;

    public readonly view: TUIElement;
    public readonly tree: LazyTreeControl<IReplElement>;
    public readonly input = new InputElement();
    /** The filter field in the view's title. */
    public readonly filterInput = new InputElement();
    /** Upstream's badge of the filter: "Showing n of m" while the filter hides lines. */
    public readonly filterBadge = new TextLabelElement("");
    /** Upstream `SelectReplActionViewItem`: in the title while there are several consoles. */
    public readonly sessionSelect: FocusSessionActionViewItem;
    /** The select after a column of space: hidden while there is one console. */
    private readonly sessionSelectSlot = new HFlexElement();
    public readonly suggest: ReplSuggest;
    private readonly renderer: DebugExpressionRenderer;
    private readonly filter = new ReplFilter();
    private session: IDebugSession | undefined;
    /** Sessions cleared after they ended: no longer shown. */
    private readonly sessionsToIgnore = new Set<IDebugSession>();
    private readonly sessionListeners = this.register(new MutableDisposable<IDisposable>());
    /** Evaluations without a running session: the input and the hint, after the shown console. */
    private readonly orphans: IReplElement[] = [];
    /** Where Up/Down stand in the history; its length (or more: a history loaded from the store) is past the newest entry. */
    private historyIndex = Number.MAX_SAFE_INTEGER;
    // Stryker disable next-line BooleanLiteral: equivalent — every refresh with rows to reveal follows a selectSession or an evaluation, which set it themselves
    private revealLast = false;
    /** Output came while the console was hidden. */
    private stale = false;
    private readonly refreshScheduler: RunOnceScheduler;

    /** `debug.console.wordWrap`: the tree asks it on every rebuild, the rows read it as they render. */
    private get wrap(): boolean {
        return this.configuration.get("debug.console.wordWrap");
    }

    public constructor(
        private readonly debugService: DebugService,
        private readonly views: ViewsService,
        private readonly configuration: IConfigurationService,
        private readonly icons: IProductIconService,
        private readonly state: Pick<IStateService, "get" | "store">,
        menus: MenuService,
        contextMenu: ContextMenuService,
        commands: CommandRegistry,
        private readonly links: Pick<LinkDetector, "linkify">,
        layout: { readonly mainContainer: { readonly overlayLayer: OverlayLayer } },
    ) {
        super();
        this.renderer = this.register(
            new DebugExpressionRenderer({
                icons,
                showVariableTypes: () => configuration.get("debug.showVariableTypes"),
                onHighlightsExpired: () => {
                    this.tree.rerender();
                },
            }),
        );
        this.tree = new LazyTreeControl<IReplElement>(
            {
                getRoots: () => this.elements().filter((element) => this.filter.filter(element)),
                // The tree asks only the elements it was told have children, and only the shown ones: a group's
                // children without a verdict of their own are visible as it is (upstream's `parentVisibility`).
                getChildren: async (element) =>
                    (await (element as INestingReplElement).getChildren()).filter((child) => this.filter.filter(child)),
                getKey: (element) => element.getId(),
                hasChildren: isNesting,
                isInitiallyExpanded: (element) => element instanceof ReplGroup && element.autoExpand,
                renderRow: (element) => this.renderRow(element),
                renderRowEnd: (element) =>
                    element instanceof ReplOutputElement || element instanceof ReplGroup
                        ? sourceSpan(element.sourceData)
                        : [],
            },
            { idPrefix: "repl", stickyTail: true, wrap: () => this.wrap },
        );
        this.refreshScheduler = this.register(
            new RunOnceScheduler(() => {
                this.refresh();
            }, REFRESH_DELAY_MS),
        );

        this.suggest = this.register(
            new ReplSuggest(
                this.input,
                {
                    // An ended session has no adapter: no capabilities, so no completions.
                    session: () => this.session,
                    frame: () => {
                        const frame = debugService.getViewModel().focusedStackFrame;
                        return { frameId: frame?.frameId, threadId: frame?.thread.threadId ?? 0 };
                    },
                    history: () => state.get(HISTORY_STORAGE_KEY),
                    historySuggestions: () => configuration.get("debug.console.historySuggestions"),
                    acceptOnEnter: () => configuration.get("debug.console.acceptSuggestionOnEnter") === "on",
                },
                () => layout.mainContainer,
            ),
        );
        this.input.multiline = true;
        this.input.onChange = () => {
            this.suggest.trigger(false);
        };
        this.input.addEventListener("blur", () => {
            this.suggest.close();
        });
        this.input.addEventListener("keydown", (event) => {
            const plain = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
            if (plain && this.suggest.handleKey(event.key)) {
                event.preventDefault();
                return;
            }
            if (event.key === " " && event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
                this.suggest.trigger(true);
            } else if (event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                this.input.inputState.insert("\n");
                this.input.markDirty();
            } else if (!plain) {
                return;
            } else if (event.key === "Enter") {
                this.acceptReplInput();
            } else if (event.key === "ArrowUp" && this.input.cursorLine === 0) {
                this.navigateHistory(true);
            } else if (event.key === "ArrowDown" && this.input.cursorLine === this.input.lineCount - 1) {
                this.navigateHistory(false);
            } else if (event.key === "Escape" && this.input.inputState.value !== "") {
                this.setInput("");
            } else {
                return;
            }
            event.preventDefault();
        });
        const prompt = new TextLabelElement(icons.glyph(EVALUATION_PROMPT_ICON));
        prompt.style = { fg: "debugConsoleInputIcon.foreground" };
        const inputRow = new HFlexElement();
        inputRow.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        inputRow.addChild(prompt, { width: hflexFit(), height: 1 });
        inputRow.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        // As tall as its lines: the field grows with Shift+Enter.
        inputRow.addChild(this.input, { width: hflexFill(), height: "fill" });
        const root = new VFlexElement();
        root.addChild(this.tree.element, { height: vflexFill(), width: "fill" });
        root.addChild(inputRow, { height: vflexFit(), width: "fill" });
        this.view = root;

        this.filterInput.id = "replFilter";
        this.filterInput.placeholder = FILTER_PLACEHOLDER;
        this.filterInput.inputState.value = state.get(FILTER_VALUE_STORAGE_KEY);
        this.filter.filterQuery = this.filterInput.inputState.value;
        this.filterInput.onChange = (value) => {
            this.setFilter(value);
        };
        this.filterInput.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || this.filterInput.inputState.value === "") return;
            event.preventDefault();
            this.filterInput.inputState.value = "";
            // Stryker disable next-line CallExpression: the refresh of setFilter right after repaints the title too
            this.filterInput.markDirty();
            this.setFilter("");
        });
        this.filterBadge.style = { fg: "descriptionForeground" };
        this.sessionSelect = this.register(
            new FocusSessionActionViewItem(
                debugService,
                {
                    getSessions: () => this.consoleSessions(),
                    mapFocusedSessionToSelected: (focusedSession) => {
                        let selected = focusedSession;
                        while (selected.parentSession && !selected.hasSeparateRepl()) {
                            selected = selected.parentSession;
                        }
                        return selected;
                    },
                },
                (session) => {
                    commands.execute(SELECT_REPL_ID, session);
                },
                debugService.getViewModel().focusedSession,
            ),
        );
        this.sessionSelectSlot.addChild(new FillerElement(), { width: hflexFixed(1), height: 1 });
        this.sessionSelectSlot.addChild(this.sessionSelect.element, { width: hflexFit(), height: 1 });
        this.updateTitleWidget();
        const filterWidget = new HFlexElement();
        filterWidget.addChild(this.filterBadge, { width: hflexFit(), height: 1 });
        filterWidget.addChild(this.filterInput, { width: hflexFixed(FILTER_WIDTH), height: 1 });
        filterWidget.addChild(this.sessionSelectSlot, { width: hflexFit(), height: 1 });

        views.registerContainer({
            id: DEBUG_PANEL_ID,
            title: "DEBUG CONSOLE",
            label: "Debug Console",
            location: "panel",
            // Upstream: after Output, before Terminal.
            order: 1.5,
        });
        views.registerView({
            id: REPL_VIEW_ID,
            containerId: DEBUG_PANEL_ID,
            title: "DEBUG CONSOLE",
            order: 10,
            body: root,
            canMoveView: true,
            focus: () => {
                this.focus();
            },
        });
        views.setViewTitleWidget(REPL_VIEW_ID, filterWidget);

        this.register(
            views.onDidShowView((id) => {
                if (id === REPL_VIEW_ID && this.stale) this.refresh();
            }),
        );
        this.register(
            configuration.onDidChangeConfiguration((event) => {
                // Stryker disable next-line ConditionalExpression: a rerender of the same rows paints the same
                if (event.affectsConfiguration("debug.console.wordWrap")) this.tree.rerender();
            }),
        );
        const viewModel = debugService.getViewModel();
        this.register(
            viewModel.onDidFocusSession((session) => {
                this.selectSession(session);
            }),
        );
        this.register(
            viewModel.onDidEvaluateLazyExpression((e) => {
                if (e instanceof Variable) this.tree.expand(e);
            }),
        );
        this.register(
            debugService.onWillNewSession((newSession) => {
                // Need to listen to output events for sessions which are not yet fully initialised
                if (!this.session || this.session.state === State.Inactive) this.selectSession(newSession);
                this.updateTitleWidget();
            }),
        );
        this.register(
            debugService.onDidEndSession(() => {
                // Update view, since orphaned sessions might now be separate
                // allow other listeners to go first, so sessions can update parents
                void Promise.resolve().then(() => {
                    this.updateTitleWidget();
                });
            }),
        );
        this.register(
            icons.onDidChange(() => {
                prompt.setText(icons.glyph(EVALUATION_PROMPT_ICON));
                this.tree.rerender();
            }),
        );
        // Upstream `onContextMenu`: the console's menu with the row as the argument.
        this.tree.onContextMenu = (element, screenX, screenY) => {
            showDebugContextMenu(
                { menus, contextMenu, commands },
                {
                    owner: this.tree.list,
                    anchor: { screenX, screenY },
                    menuId: MenuId.DebugConsoleContext,
                    keys: {},
                    args: [element],
                },
            );
        };
        this.selectSession(viewModel.focusedSession);
    }

    /** Upstream's Paste: the text goes to the end of the input, which gets the focus. */
    public paste(text: string): void {
        // Setting the value puts the cursor at its end.
        this.setInput(this.input.inputState.value + text);
        this.input.focus();
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("inDebugRepl", active?.getAncestorPath().includes(this.view) === true);
        // Upstream `isMultiSessionView`: the select shows exactly then.
        contextKeys.set("multiSessionRepl", !this.sessionSelectSlot.hidden);
    }

    /** The sessions with a console of their own, but the cleared ended ones. */
    private consoleSessions(): IDebugSession[] {
        return this.debugService
            .getModel()
            .getSessions(true)
            .filter((s) => s.hasSeparateRepl() && !this.sessionsToIgnore.has(s));
    }

    /** After the filter, the select of the consoles while there are several (upstream `isMultiSessionView`). */
    private updateTitleWidget(): void {
        this.sessionSelectSlot.hidden = this.consoleSessions().length <= 1;
    }

    /** Upstream: the focus goes to the input. */
    public focus(): void {
        this.input.focus();
    }

    /** Upstream `focusFilter` (`repl.action.filter`). */
    public focusFilter(): void {
        this.filterInput.focus();
    }

    /** Upstream `collapseAll` (`debug.collapseRepl`). */
    public collapseAll(): void {
        this.tree.collapseAll();
    }

    /** Upstream `getVisibleContent` (`repl.action.copyAll`): the rows shown, a line each, without ANSI codes. */
    public getVisibleContent(): string {
        return removeAnsiEscapeCodes(
            this.tree.shownItems.map((element) => `${element.toString().trimEnd()}\n`).join(""),
        );
    }

    /** The session whose console is shown. */
    public get shownSession(): IDebugSession | undefined {
        return this.session;
    }

    public selectSession(session?: IDebugSession): void {
        if (!session) {
            const focusedSession = this.debugService.getViewModel().focusedSession;
            // If there is a focusedSession focus on that one, otherwise just show any other not ignored session
            if (focusedSession) {
                session = focusedSession;
            } else if (!this.session || this.sessionsToIgnore.has(this.session)) {
                session = this.debugService
                    .getModel()
                    .getSessions(true)
                    .find((s) => !this.sessionsToIgnore.has(s));
            }
        }
        if (session && this.session !== session) {
            const shown = session;
            this.sessionListeners.value = combinedDisposable(
                shown.onDidChangeReplElements(() => {
                    this.refreshReplElements(shown.getReplElements().length === 0);
                }),
                // The shown session may end without the focus moving: the hint follows its own state.
                shown.onDidChangeState(() => {
                    this.updateInput();
                }),
            );
            this.session = shown;
            this.orphans.length = 0;
            this.suggest.close();
            this.revealLast = true;
            this.refresh();
        }
        this.updateInput();
    }

    public clearRepl(): void {
        const session = this.session;
        this.orphans.length = 0;
        if (session) {
            session.removeReplExpressions();
            if (session.state === State.Inactive) {
                // Ignore inactive sessions which got cleared - so they are not shown any more
                this.sessionsToIgnore.add(session);
                this.selectSession();
                this.sessionSelect.update();
                this.updateTitleWidget();
            }
        }
        this.refresh();
        this.input.focus();
    }

    public acceptReplInput(): void {
        this.suggest.close();
        const value = this.input.inputState.value;
        if (value.trim() === "") return;
        const session = this.session;
        this.revealLast = true;
        if (session && session.state !== State.Inactive) {
            void session
                .addReplExpression(this.debugService.getViewModel().focusedStackFrame, value)
                .catch(onUnexpectedError);
        } else {
            void this.evaluateWithoutSession(value);
        }
        this.addToHistory(value);
        this.setInput("");
    }

    private async evaluateWithoutSession(value: string): Promise<void> {
        const result = new ReplEvaluationResult(value);
        // Without a session the model's answer is the hint, as an unavailable value.
        await result.evaluateExpression(value, undefined, undefined, "repl");
        this.orphans.push(new ReplEvaluationInput(value), result);
        this.refresh();
    }

    private addToHistory(value: string): void {
        const history = this.state.get(HISTORY_STORAGE_KEY).filter((entry) => entry !== value);
        history.push(value);
        history.splice(0, history.length - HISTORY_LIMIT);
        this.state.store(HISTORY_STORAGE_KEY, history);
        this.historyIndex = history.length;
    }

    /** Upstream `navigateHistory`: before the oldest entry stays on it, past the newest is the empty input. */
    private navigateHistory(previous: boolean): void {
        const history = this.state.get(HISTORY_STORAGE_KEY);
        const index = Math.min(history.length, this.historyIndex) + (previous ? -1 : 1);
        this.historyIndex = Math.max(0, Math.min(history.length, index));
        this.setInput(history[this.historyIndex] ?? "");
    }

    private setInput(value: string): void {
        this.input.inputState.value = value;
        this.input.markDirty();
    }

    /** Upstream: the filter applies at once, the console scrolls to its end, the value is kept per workspace. */
    private setFilter(value: string): void {
        this.filter.filterQuery = value;
        this.state.store(FILTER_VALUE_STORAGE_KEY, value);
        this.revealLast = true;
        this.refresh();
    }

    private updateInput(): void {
        const active = this.session !== undefined && this.session.state !== State.Inactive;
        this.input.placeholder = active ? undefined : START_DEBUG_FIRST;
        this.input.markDirty();
    }

    /** Upstream: a hidden console is refreshed when it shows; a pending refresh takes the later output too. */
    private refreshReplElements(noDelay: boolean): void {
        if (!this.views.isViewShown(REPL_VIEW_ID)) {
            this.stale = true;
            return;
        }
        if (this.refreshScheduler.isScheduled()) return;
        this.refreshScheduler.schedule(noDelay ? 0 : undefined);
    }

    private refresh(): void {
        this.stale = false;
        this.refreshScheduler.cancel();
        const revealTail = this.revealLast;
        this.revealLast = false;
        this.updateFilterBadge();
        this.tree.refresh({ revealTail }).catch(onUnexpectedError);
    }

    /** The top-level elements: the shown session's, then the output that came without one. */
    private elements(): IReplElement[] {
        return [...(this.session?.getReplElements() ?? []), ...this.orphans];
    }

    /** Upstream `getFilterStats`: the top-level lines shown of all. */
    private updateFilterBadge(): void {
        const all = this.elements();
        const shown = all.filter((element) => this.filter.filter(element)).length;
        this.filterBadge.setText(shown === all.length ? "" : `Showing ${String(shown)} of ${String(all.length)} `);
    }

    /** Upstream's output and group renderers: the ANSI styles over the severity's, then the links. */
    private renderOutput(value: string, severity: ReplSeverity, session: IDebugSession): IRowSpan[] {
        const base = SEVERITY_SPAN[severity];
        const spans = handleANSIOutput(rowText(value, this.wrap)).map((span) => ({
            ...base,
            ...span,
            style: base.style | (span.style ?? StyleFlags.None),
        }));
        return this.links.linkify(spans, session.root);
    }

    private renderRow(element: IReplElement): IRowSpan[] {
        if (element instanceof ReplEvaluationInput) {
            return [
                { text: `${this.icons.glyph(EVALUATION_INPUT_ICON)} `, fg: "debugConsoleInputIcon.foreground" },
                { text: rowText(element.value, this.wrap) },
            ];
        }
        if (element instanceof ReplOutputElement) {
            const badge: IRowSpan[] =
                element.count >= 2
                    ? [
                          { text: ` ${String(element.count)} `, fg: "badge.foreground", bg: "badge.background" },
                          { text: " " },
                      ]
                    : [];
            return [...badge, ...this.renderOutput(element.value, element.severity, element.session)];
        }
        if (element instanceof ReplGroup) return this.renderOutput(element.name, "info", element.session);
        if (element instanceof ReplVariableElement) {
            return this.renderer.renderValue(element.expression, { colorize: true });
        }
        // An evaluation result (it has no name) or a child: upstream `ReplVariablesRenderer` shows a child without a
        // name (several objects of one output) by its value, as `ReplEvaluationResultsRenderer` does a result.
        const expression = element as IExpression;
        if (!expression.name) return this.renderer.renderValue(expression, { colorize: true });
        return this.renderer.renderVariable(expression, { showChanged: true });
    }
}
