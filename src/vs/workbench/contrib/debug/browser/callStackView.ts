/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/callStackView.ts
// The CALL STACK tree: sessions (only with several; a child under its parent, a `compact` one folded into its parent's
// row as upstream's compressed tree), threads (only with several) with their state on the right in
// upstream's state label colors, frames, the first 20 of a thread and "Load More" for the rest, runs of
// deemphasized frames folded into "Show N More Stack Frames", the error of a failed stack trace. The state of a
// single thread goes to the view's title, as upstream's header message. Moving the cursor to a frame focuses it
// (upstream opens it with `preserveFocus` on a keyboard selection), so VARIABLES and WATCH follow. Deviations (the
// approved look of the debug views spike, decision 2026-11-14): a frame reads "name, then `file:line` muted", not
// upstream's `file line:col` pinned to the right, which a narrow sidebar would let eat the name; the frame the
// editor marks carries the marker of the editor's glyph margin in front; "Load More" says how many frames are left
// when the adapter tells the total; a `label` frame is italic but not centered (the engine's flex cannot center).
// The context of a row's menu is upstream's (`getContext`, `getContextForContributedActions`). Not here yet: opening
// the focused frame in the editor (#1148), the inline actions of the rows.

import { StyleFlags } from "@tuidom/core/common/styleFlags";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { commonSuffixLength } from "../../../../base/common/strings.ts";
import type { IRange } from "../../../../editor/common/core/range.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { type IRowSpan, LazyTreeControl } from "../../../browser/parts/views/lazyTreeControl.ts";
import {
    type IDebugService,
    type IDebugSession,
    type IRawStoppedDetails,
    isFrameDeemphasized,
    type IStackFrame,
    type IThread,
    State,
} from "../common/debug.ts";
import { StackFrame, Thread, ThreadAndSessionIds } from "../common/debugModel.ts";

export type CallStackItem = IStackFrame | IThread | IDebugSession | string | ThreadAndSessionIds | IStackFrame[];

/** Upstream's coalescing of the call stack changes of a stop, so the tree does not flash. */
export const CALL_STACK_REFRESH_DELAY_MS = 50;

const SESSION_ICON = codicon("bug");
const TOP_FRAME_ICON = codicon("debug-stackframe");
const FOCUSED_FRAME_ICON = codicon("debug-stackframe-focused");
const MUTED = "descriptionForeground";
const LINK = "textLink.foreground";

/** What the built-in commands of a row's menu get after the contributed argument. */
export interface ICallStackItemContext {
    sessionId: string;
    threadId?: string;
    frameId?: string;
    frameName?: string;
    frameLocation?: { range: IRange; source: DebugProtocol.Source };
}

function getSessionContext(element: IDebugSession): ICallStackItemContext {
    return {
        sessionId: element.getId(),
    };
}

function getThreadContext(element: IThread): ICallStackItemContext {
    return {
        ...getSessionContext(element.session),
        threadId: element.getId(),
    };
}

function getStackFrameContext(element: StackFrame): ICallStackItemContext {
    return {
        ...getThreadContext(element.thread),
        frameId: element.getId(),
        frameName: element.name,
        frameLocation: { range: element.range, source: element.source.raw },
    };
}

export function getContext(element: CallStackItem | null): ICallStackItemContext | undefined {
    if (element instanceof StackFrame) {
        return getStackFrameContext(element);
    } else if (element instanceof Thread) {
        return getThreadContext(element);
    } else if (isDebugSession(element)) {
        return getSessionContext(element);
    }
    return undefined;
}

// Extensions depend on this context, should not be changed even though it is not fully deterministic
export function getContextForContributedActions(element: CallStackItem | null): string | number {
    if (element instanceof StackFrame) {
        if (element.source.inMemory) {
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- upstream: an empty string is none too
            return element.source.raw.path || element.source.reference || element.source.name;
        }

        return element.source.uri.toString();
    }
    if (element instanceof Thread) {
        return element.threadId;
    }
    if (isDebugSession(element)) {
        return element.getId();
    }

    return "";
}

export function isDebugSession(obj: unknown): obj is IDebugSession {
    return typeof (obj as Partial<IDebugSession> | null | undefined)?.getAllThreads === "function";
}

function stoppedDescription(stoppedDetails: IRawStoppedDetails): string {
    // `||`: an empty description is none, as upstream.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    return stoppedDetails.description || (stoppedDetails.reason ? `Paused on ${stoppedDetails.reason}` : "Paused");
}

/** Upstream `getSpecificSourceName`: the file name, with as much of its path as tells it from another frame's. */
export function getSpecificSourceName(stackFrame: IStackFrame): string {
    // To reduce flashing of the path name and the way we fetch stack frames
    // We need to compute the source name based on the other frames in the stale call stack
    let callStack = (stackFrame.thread as Thread).getStaleCallStack();
    callStack = callStack.length > 0 ? callStack : stackFrame.thread.getCallStack();
    const otherSources = callStack.map((sf) => sf.source).filter((s) => s !== stackFrame.source);
    let suffixLength = 0;
    for (const s of otherSources) {
        if (s.name === stackFrame.source.name) {
            suffixLength = Math.max(suffixLength, commonSuffixLength(stackFrame.source.uri.path, s.uri.path));
        }
    }
    if (suffixLength === 0) {
        return stackFrame.source.name;
    }

    const path = stackFrame.source.uri.path;
    const from = Math.max(0, path.lastIndexOf("/", path.length - suffixLength - 1));
    return (from > 0 ? "..." : "") + path.substring(from);
}

/** Upstream `CallStackDataSource` over the model: what the tree shows under the model, a session and a thread. */
export class CallStackDataSource {
    /** Deemphasized frames the user unfolded with "Show N More". */
    public deemphasizedStackFramesToShow = new WeakSet<IStackFrame>();

    public constructor(private readonly debugService: IDebugService) {}

    public hasChildren(element: CallStackItem): boolean {
        if (isDebugSession(element)) {
            const threads = element.getAllThreads();
            return (
                threads.length > 1 ||
                (threads.length === 1 && threads[0].stopped) ||
                this.debugService
                    .getModel()
                    .getSessions()
                    .some((s) => s.parentSession === element)
            );
        }
        return element instanceof Thread && element.stopped;
    }

    public async getRoots(): Promise<CallStackItem[]> {
        const sessions = this.debugService.getModel().getSessions();
        if (sessions.length === 0) {
            return [];
        }
        if (sessions.length > 1 || this.debugService.getViewModel().isMultiSessionView()) {
            return Promise.all(sessions.filter((s) => !s.parentSession).map((s) => this.compress(s)));
        }

        const threads = sessions[0].getAllThreads();
        // Only show the threads in the call stack if there is more than 1 thread.
        return threads.length === 1 ? this.getThreadChildren(threads[0] as Thread) : threads;
    }

    public async getChildren(element: CallStackItem): Promise<CallStackItem[]> {
        return Promise.all((await this.uncompressedChildren(element)).map((child) => this.compress(child)));
    }

    /**
     * Upstream's compressed tree (`CallStackCompressionDelegate`): an element whose only child is a compressible
     * session — a compact one, or the parent of one — shows as that child (upstream renders the last element).
     */
    private async compress(element: CallStackItem): Promise<CallStackItem> {
        let shown = element;
        while (isDebugSession(shown)) {
            const children = await this.uncompressedChildren(shown);
            const [only] = children;
            if (children.length !== 1 || !isDebugSession(only) || this.isIncompressible(only)) break;
            shown = only;
        }
        return shown;
    }

    private isIncompressible(session: IDebugSession): boolean {
        if (session.compact) {
            return false;
        }
        return !this.debugService
            .getModel()
            .getSessions()
            .some((s) => s.parentSession === session && s.compact);
    }

    private async uncompressedChildren(element: CallStackItem): Promise<CallStackItem[]> {
        if (isDebugSession(element)) {
            const childSessions = this.debugService
                .getModel()
                .getSessions()
                .filter((s) => s.parentSession === element);
            const threads: CallStackItem[] = element.getAllThreads();
            if (threads.length === 1) {
                // Do not show thread when there is only one to be compact.
                const children = await this.getThreadChildren(threads[0] as Thread);
                return children.concat(childSessions);
            }

            return threads.concat(childSessions);
        }
        return this.getThreadChildren(element as Thread);
    }

    private async getThreadChildren(thread: Thread): Promise<CallStackItem[]> {
        const children = await this.getThreadCallstack(thread);
        // Check if some stack frames should be hidden under a parent element since they are deemphasized
        const result: CallStackItem[] = [];
        children.forEach((child, index) => {
            if (
                child instanceof StackFrame &&
                isFrameDeemphasized(child) &&
                !this.deemphasizedStackFramesToShow.has(child)
            ) {
                const last = result.at(-1);
                if (Array.isArray(last)) {
                    // Collect all the stackframes that will be "collapsed"
                    last.push(child);
                    return;
                }
                const nextChild = children[index + 1];
                if (nextChild instanceof StackFrame && isFrameDeemphasized(nextChild)) {
                    // Start collecting stackframes that will be "collapsed"
                    result.push([child]);
                    return;
                }
            }
            result.push(child);
        });
        return result;
    }

    private async getThreadCallstack(thread: Thread): Promise<(IStackFrame | string | ThreadAndSessionIds)[]> {
        let callStack: (IStackFrame | string | ThreadAndSessionIds)[] = [...thread.getCallStack()];
        if (callStack.length === 0) {
            await thread.fetchCallStack();
            callStack = [...thread.getCallStack()];
        }

        const stoppedDetails = thread.stoppedDetails;
        if (
            callStack.length === 1 &&
            thread.session.capabilities.supportsDelayedStackTraceLoading &&
            (stoppedDetails?.totalFrames ?? 0) > 1
        ) {
            // To reduce flashing of the call stack view simply append the stale call stack
            // once we have the correct data the tree will refresh and we will no longer display it.
            callStack = callStack.concat(thread.getStaleCallStack().slice(1));
        }

        if (stoppedDetails?.framesErrorMessage) {
            callStack = callStack.concat([stoppedDetails.framesErrorMessage]);
        }
        if (!thread.reachedEndOfCallStack && stoppedDetails) {
            callStack = callStack.concat([new ThreadAndSessionIds(thread.session.getId(), thread.threadId)]);
        }

        return callStack;
    }
}

export class CallStackView extends Disposable {
    public readonly tree: LazyTreeControl<CallStackItem>;
    private readonly dataSource: CallStackDataSource;
    private readonly onCallStackChangeScheduler: RunOnceScheduler;
    /** The focus moved before the rows read it. A view opened during a stop starts on the focused frame. */
    private selectionNeedsUpdate = true;
    /** The view's own focus change: the cursor is already there. */
    private ignoreFocusStackFrameEvent = false;
    /** Threads the focus opened (upstream's `expand` of the focused thread); the user's collapse still wins. */
    private readonly expandedThreads = new Set<string>();

    public constructor(
        private readonly debugService: IDebugService,
        private readonly icons: Pick<IProductIconService, "glyph">,
        /** Upstream's state message in the view header: the state of the only thread, or `undefined` to hide it. */
        private readonly setStateMessage: (message: string | undefined) => void,
        /** `workbench.list.openMode` is `singleClick`: a click opens the row, as Enter (upstream's tree default). */
        openOnSingleClick: () => boolean,
    ) {
        super();
        this.dataSource = new CallStackDataSource(debugService);
        const viewModel = debugService.getViewModel();
        this.tree = new LazyTreeControl<CallStackItem>(
            {
                getRoots: () => this.dataSource.getRoots(),
                getChildren: (element) => this.dataSource.getChildren(element),
                getKey: (element) => {
                    if (typeof element === "string") return element;
                    if (Array.isArray(element)) return `showMore ${element[0].getId()}`;
                    return element.getId();
                },
                hasChildren: (element) => this.dataSource.hasChildren(element),
                // Upstream expands the sessions and the focused thread (`expandTo` and `expand` of the selection).
                isInitiallyExpanded: (element) =>
                    isDebugSession(element) || (element instanceof Thread && this.expandedThreads.has(element.getId())),
                renderRow: (element) => this.renderRow(element),
                renderRowEnd: (element) => this.renderStateLabel(element),
                getLabel: (element) => this.getKeyboardNavigationLabel(element),
            },
            // Stryker disable next-line StringLiteral: the prefix keeps the row ids apart from other views'; no other view in the window has a call stack element's key
            { idPrefix: "callstack" },
        );
        // A click on Load More or Show N More reads the frames, not only puts the cursor there.
        this.tree.list.openOnSingleClick = openOnSingleClick;
        // A frame the user moves to is focused (upstream opens it with `preserveFocus` on a keyboard selection).
        this.tree.onSelect = (element) => {
            this.focusElement(element);
        };
        this.tree.onActivate = (element) => {
            void this.open(element).catch(onUnexpectedError);
        };

        // Create scheduler to prevent unnecessary flashing of tree when reacting to changes
        this.onCallStackChangeScheduler = this.register(
            new RunOnceScheduler(() => {
                this.updateStateMessage();
                void this.tree
                    .refresh()
                    .then(async () => {
                        if (this.selectionNeedsUpdate) {
                            this.selectionNeedsUpdate = false;
                            await this.updateTreeSelection();
                        }
                    })
                    .catch(onUnexpectedError);
            }, CALL_STACK_REFRESH_DELAY_MS),
        );
        this.register(
            debugService.getModel().onDidChangeCallStack(() => {
                if (!this.onCallStackChangeScheduler.isScheduled()) {
                    this.onCallStackChangeScheduler.schedule();
                }
            }),
        );
        const onFocusChange = (): void => {
            if (this.ignoreFocusStackFrameEvent) {
                // The markers follow the focus.
                this.tree.rerender();
                return;
            }
            if (this.onCallStackChangeScheduler.isScheduled()) {
                this.selectionNeedsUpdate = true;
                return;
            }
            this.updateTreeSelection().catch(onUnexpectedError);
        };
        this.register(viewModel.onDidFocusStackFrame(onFocusChange));
        this.register(viewModel.onDidFocusSession(onFocusChange));
        // The viewlet may open after a session started: show what is there.
        this.onCallStackChangeScheduler.schedule(0);
    }

    public focus(): void {
        this.tree.list.focus();
    }

    /** Upstream's `focusStackFrame` of an opened row: the frame, the thread or the session becomes the focused one. */
    private focusElement(element: CallStackItem): void {
        const options = { explicit: true, preserveFocus: true };
        this.ignoreFocusStackFrameEvent = true;
        try {
            if (element instanceof StackFrame) {
                void this.debugService.focusStackFrame(element, element.thread, element.thread.session, options);
            } else if (element instanceof Thread) {
                void this.debugService.focusStackFrame(undefined, element, element.session, options);
            } else if (isDebugSession(element)) {
                void this.debugService.focusStackFrame(undefined, undefined, element, options);
            }
        } finally {
            this.ignoreFocusStackFrameEvent = false;
        }
    }

    private async open(element: CallStackItem): Promise<void> {
        if (element instanceof ThreadAndSessionIds) {
            const thread = this.loadMoreThread(element);
            if (thread) {
                // Get all the remaining frames
                await thread.fetchCallStack(remainingFrames(thread));
                await this.tree.refresh();
            }
            return;
        }
        if (Array.isArray(element)) {
            for (const sf of element) this.dataSource.deemphasizedStackFramesToShow.add(sf);
            await this.tree.refresh();
            return;
        }
        this.focusElement(element);
    }

    /** Upstream `updateTreeSelection`: the focused thread open, the cursor on its frame, else on the session. */
    private async updateTreeSelection(): Promise<void> {
        const viewModel = this.debugService.getViewModel();
        const thread = viewModel.focusedThread;
        if (thread) this.expandedThreads.add(thread.getId());
        // Also for the markers, which follow the focus.
        await this.tree.refresh();
        const toReveal = viewModel.focusedStackFrame ?? viewModel.focusedSession;
        if (toReveal) this.tree.reveal(toReveal);
    }

    /** Upstream's header message: shown only while the threads are not (one session with one thread). */
    private updateStateMessage(): void {
        const sessions = this.debugService.getModel().getSessions();
        this.setStateMessage(sessions.length === 1 ? sessionStateMessage(sessions[0]) : undefined);
    }

    private renderRow(element: CallStackItem): IRowSpan[] {
        if (isDebugSession(element)) {
            return [{ text: `${this.icons.glyph(SESSION_ICON)} ` }, { text: element.getLabel() }];
        }
        if (element instanceof Thread) return [{ text: element.name }];
        if (element instanceof StackFrame) return this.renderStackFrame(element);
        if (typeof element === "string") return [{ text: element, style: StyleFlags.Italic }];
        if (element instanceof ThreadAndSessionIds) return [{ text: this.loadMoreLabel(element), fg: LINK }];
        return [{ text: showMoreLabel(element as IStackFrame[]), fg: LINK }];
    }

    private renderStackFrame(frame: IStackFrame): IRowSpan[] {
        if (frame.presentationHint === "label") {
            return [{ text: frame.name, style: StyleFlags.Italic }];
        }
        const marker = this.frameMarker(frame);
        if (!frame.source.available) {
            return [marker, { text: frame.name, fg: MUTED, style: StyleFlags.Italic }];
        }
        const location = `  ${getSpecificSourceName(frame)}:${String(frame.range.startLineNumber)}`;
        return [
            marker,
            isFrameDeemphasized(frame) ? { text: frame.name, fg: MUTED } : { text: frame.name },
            { text: location, fg: MUTED },
        ];
    }

    /** The editor's glyph-margin arrow: the top frame of the focused thread, and the focused frame below it. */
    private frameMarker(frame: IStackFrame): IRowSpan {
        const viewModel = this.debugService.getViewModel();
        const thread = viewModel.focusedThread;
        if (thread === frame.thread && thread.getTopStackFrame() === frame) {
            return {
                text: `${this.icons.glyph(TOP_FRAME_ICON)} `,
                fg: "debugIcon.breakpointCurrentStackframeForeground",
            };
        }
        if (viewModel.focusedStackFrame === frame) {
            return {
                text: `${this.icons.glyph(FOCUSED_FRAME_ICON)} `,
                fg: "debugIcon.breakpointStackframeForeground",
            };
        }
        return { text: "  " };
    }

    /** Upstream's state label, uppercase as its CSS: a thread's, or a session's (its stop or a stopped thread's). */
    private renderStateLabel(element: CallStackItem): IRowSpan[] {
        let stoppedDetails: IRawStoppedDetails | undefined;
        if (element instanceof Thread) {
            stoppedDetails = element.stoppedDetails;
        } else if (isDebugSession(element)) {
            stoppedDetails =
                element.getStoppedDetails() ?? element.getAllThreads().find((t) => t.stopped)?.stoppedDetails;
        } else {
            return [];
        }
        const text = stoppedDetails ? stoppedDescription(stoppedDetails) : "Running";
        const exception = stoppedDetails?.reason === "exception";
        return [
            {
                text: ` ${text.toUpperCase()} `,
                fg: exception ? "debugView.exceptionLabelForeground" : "debugView.stateLabelForeground",
                bg: exception ? "debugView.exceptionLabelBackground" : "debugView.stateLabelBackground",
            },
        ];
    }

    private loadMoreThread(element: ThreadAndSessionIds): Thread | undefined {
        return this.debugService.getModel().getSession(element.sessionId)?.getThread(element.threadId) as
            | Thread
            | undefined;
    }

    private loadMoreLabel(element: ThreadAndSessionIds): string {
        const thread = this.loadMoreThread(element);
        const remaining = thread && remainingFrames(thread);
        return remaining === undefined ? "Load More Stack Frames" : `Load ${String(remaining)} More Stack Frames`;
    }

    /**
     * Typing finds a session and a frame by their names, without the icon or the marker in front; the other rows by
     * their text. Upstream's thread label adds the state, which typing could not reach: the list takes no space.
     */
    private getKeyboardNavigationLabel(element: CallStackItem): string {
        if (isDebugSession(element)) return element.getLabel();
        // Stryker disable next-line ConditionalExpression: a thread's name is its row's text, and the other rows have no `name`, so the tree falls back to their text, as the line below gives
        if (element instanceof StackFrame) return element.name;
        return this.renderRow(element)[0].text;
    }
}

/** Upstream's header message: the stop of a session whose threads are not shown, else "Running" or nothing. */
function sessionStateMessage(session: IDebugSession): string | undefined {
    const stoppedDetails = session.getStoppedDetails();
    if (stoppedDetails && (session.getAllThreads().length === 1 || typeof stoppedDetails.threadId !== "number")) {
        return stoppedDescription(stoppedDetails);
    }
    return session.state === State.Running ? "Running" : undefined;
}

/** The frames the adapter holds past the ones read, when it told the total. */
function remainingFrames(thread: IThread): number | undefined {
    const totalFrames = thread.stoppedDetails?.totalFrames;
    return totalFrames === undefined ? undefined : totalFrames - thread.getCallStack().length;
}

function showMoreLabel(stackFrames: readonly IStackFrame[]): string {
    const origin = stackFrames[0].source.origin;
    if (origin !== undefined && stackFrames.every((sf) => sf.source.origin === origin)) {
        return `Show ${String(stackFrames.length)} More: ${origin}`;
    }
    return `Show ${String(stackFrames.length)} More Stack Frames`;
}
