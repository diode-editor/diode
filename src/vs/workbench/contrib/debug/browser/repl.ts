/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/repl.ts
// The Debug Console (upstream `Repl` and the renderers of `replViewer.ts`): the console of the shown session as a
// tree — output with its source on the right and the count of collapsed lines, evaluations with their expandable
// results, objects the adapter logged — over an input line. Enter evaluates in the focused frame (context `repl`),
// Up/Down walk the history (100 entries per workspace), Escape clears the input. The tree follows its tail unless
// the user scrolled up; an evaluation scrolls to it anyway. Which session is shown follows upstream's
// `selectSession`: the focused one, else the one shown until it is cleared, else any other.
// Deviations: without a running session upstream makes the input read-only and shows the hint in it; here the hint
// is the placeholder and Enter still echoes the input with the hint as its result. `stdout` (severity `info`) is in
// the plain foreground, not `debugConsole.infoForeground` (the spike's look). Escape clearing the input is ours.
// Not here yet (#1158): ANSI styles, wrapping long lines, completion in the input, the filter, Find, the session
// picker of multiple consoles, the context menu (Copy, Copy All, Collapse All, Paste), clicking a source to open it,
// the `debug.console.*` font and word wrap settings. The view has no `debuggersAvailable` gate: it is always there.

import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { type IDisposable, MutableDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
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

import { DebugExpressionRenderer } from "./debugExpressionRenderer.ts";
import { type DebugService, DebugServiceDIToken } from "./debugService.ts";

export const ReplDIToken = token<Repl>("Repl");

const HISTORY_STORAGE_KEY: IStateDescriptor<string[]> = { key: "debug.repl.history", scope: "workspace", default: [] };
/** Upstream's `HistoryNavigator` limit. */
const HISTORY_LIMIT = 100;
/** Upstream's delay before the tree follows the console. */
const REFRESH_DELAY_MS = 50;
export const START_DEBUG_FIRST = "Please start a debug session to evaluate expressions";

/** Upstream `debugConsoleEvaluationInput` (the echo of an evaluation) and `debugConsoleEvaluationPrompt`. */
const EVALUATION_INPUT_ICON = codicon("arrow-small-right");
const EVALUATION_PROMPT_ICON = codicon("chevron-right");

/** Upstream's `.value.warn/.error/.ignore` of an output line; `info` keeps the plain foreground. */
const SEVERITY_SPAN: Readonly<Record<ReplSeverity, Omit<IRowSpan, "text">>> = {
    info: {},
    warning: { fg: "debugConsole.warningForeground" },
    error: { fg: "debugConsole.errorForeground" },
    ignore: { style: StyleFlags.Italic },
};

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
    ] as const;

    public readonly view: TUIElement;
    public readonly tree: LazyTreeControl<IReplElement>;
    public readonly input = new InputElement();
    private readonly renderer: DebugExpressionRenderer;
    private session: IDebugSession | undefined;
    /** Sessions cleared after they ended: no longer shown. */
    private readonly sessionsToIgnore = new Set<IDebugSession>();
    private readonly replElementsChangeListener = this.register(new MutableDisposable<IDisposable>());
    /** Evaluations without a running session: the input and the hint, after the shown console. */
    private readonly orphans: IReplElement[] = [];
    /** Where Up/Down stand in the history; its length (or more: a history loaded from the store) is past the newest entry. */
    private historyIndex = Number.MAX_SAFE_INTEGER;
    private revealLast = false;
    /** Output came while the console was hidden. */
    private stale = false;
    private readonly refreshScheduler: RunOnceScheduler;

    public constructor(
        private readonly debugService: DebugService,
        private readonly views: ViewsService,
        configuration: IConfigurationService,
        private readonly icons: IProductIconService,
        private readonly state: Pick<IStateService, "get" | "store">,
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
                getRoots: () => [...(this.session?.getReplElements() ?? []), ...this.orphans],
                // The tree asks only the elements it was told have children.
                getChildren: (element) => (element as INestingReplElement).getChildren(),
                getKey: (element) => element.getId(),
                hasChildren: isNesting,
                isInitiallyExpanded: (element) => element instanceof ReplGroup && element.autoExpand,
                renderRow: (element) => this.renderRow(element),
                renderRowEnd: (element) =>
                    element instanceof ReplOutputElement || element instanceof ReplGroup
                        ? sourceSpan(element.sourceData)
                        : [],
            },
            { idPrefix: "repl", stickyTail: true },
        );
        this.refreshScheduler = this.register(
            new RunOnceScheduler(() => {
                this.refresh();
            }, REFRESH_DELAY_MS),
        );

        this.input.addEventListener("keydown", (event) => {
            if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
            if (event.key === "Enter") this.acceptReplInput();
            else if (event.key === "ArrowUp") this.navigateHistory(true);
            else if (event.key === "ArrowDown") this.navigateHistory(false);
            else if (event.key === "Escape" && this.input.inputState.value !== "") this.setInput("");
            else return;
            event.preventDefault();
        });
        const prompt = new TextLabelElement(icons.glyph(EVALUATION_PROMPT_ICON));
        prompt.style = { fg: "debugConsoleInputIcon.foreground" };
        const inputRow = new HFlexElement();
        inputRow.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        inputRow.addChild(prompt, { width: hflexFit(), height: 1 });
        inputRow.addChild(new TextLabelElement(""), { width: hflexFixed(1), height: 1 });
        inputRow.addChild(this.input, { width: hflexFill(), height: 1 });
        const root = new VFlexElement();
        root.addChild(this.tree.element, { height: vflexFill(), width: "fill" });
        root.addChild(inputRow, { height: vflexFixed(1), width: "fill" });
        this.view = root;

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

        this.register(
            views.onDidShowView((id) => {
                if (id === REPL_VIEW_ID && this.stale) this.refresh();
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
            }),
        );
        this.register(
            debugService.onDidChangeState(() => {
                this.updateInput();
            }),
        );
        this.register(
            icons.onDidChange(() => {
                prompt.setText(icons.glyph(EVALUATION_PROMPT_ICON));
                this.tree.rerender();
            }),
        );
        this.selectSession(viewModel.focusedSession);
    }

    public updateContextKeys(contextKeys: ContextKeyService, active: TUIElement | null): void {
        contextKeys.set("inDebugRepl", active?.getAncestorPath().includes(this.view) === true);
    }

    /** Upstream: the focus goes to the input. */
    public focus(): void {
        this.input.focus();
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
            this.replElementsChangeListener.value = shown.onDidChangeReplElements(() => {
                this.refreshReplElements(shown.getReplElements().length === 0);
            });
            this.session = shown;
            this.orphans.length = 0;
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
            }
        }
        this.refresh();
        this.input.focus();
    }

    public acceptReplInput(): void {
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
        const reveal = this.revealLast;
        this.revealLast = false;
        this.tree
            .refresh()
            .then(() => {
                // Upstream `revealLastElement`: the next layout clamps it to the tail.
                if (reveal) this.tree.list.scrollTop = Number.MAX_SAFE_INTEGER;
            })
            .catch(onUnexpectedError);
    }

    private renderRow(element: IReplElement): IRowSpan[] {
        if (element instanceof ReplEvaluationInput) {
            return [
                { text: `${this.icons.glyph(EVALUATION_INPUT_ICON)} `, fg: "debugConsoleInputIcon.foreground" },
                { text: element.value },
            ];
        }
        if (element instanceof ReplEvaluationResult) return this.renderer.renderValue(element, { colorize: true });
        if (element instanceof ReplOutputElement) {
            const badge: IRowSpan[] =
                element.count >= 2
                    ? [
                          { text: ` ${String(element.count)} `, fg: "badge.foreground", bg: "badge.background" },
                          { text: " " },
                      ]
                    : [];
            return [...badge, { text: element.value.replace(/\r?\n$/u, ""), ...SEVERITY_SPAN[element.severity] }];
        }
        if (element instanceof ReplGroup) return [{ text: element.name }];
        if (element instanceof ReplVariableElement) {
            return this.renderer.renderValue(element.expression, { colorize: true });
        }
        const expression = element as IExpression;
        // Upstream `ReplVariablesRenderer`: a child without a name (several objects of one output) shows its value.
        if (!expression.name) return this.renderer.renderValue(expression, { colorize: true });
        return this.renderer.renderVariable(expression, { showChanged: true });
    }
}
