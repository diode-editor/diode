import { findFirstIdxMonotonousOrArrLen } from "../../../../base/common/arraysFind.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { comparePositions } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { rangesEqual } from "../../../../editor/common/core/iRange.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import { BackgroundFind, type IBackgroundFindProgress } from "../../../../editor/contrib/find/backgroundFind.ts";
import {
    findMatches,
    findNextMatch,
    findPreviousMatch,
    type ITextMatchOptions,
    MATCHES_LIMIT,
} from "../../../../editor/contrib/find/findMatches.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorGroup, GroupId } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IEditorGroupsService } from "../../../services/editor/common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import type { FindComponent, FindWidget } from "./findComponent.ts";
import { FindComponentDIToken } from "./findComponent.ts";

export const FindServiceDIToken = token<FindService>("FindService");

/** The widget has no case/word toggles yet: the same options `findMatches` uses. */
// Stryker disable next-line ObjectLiteral: the walks read the fields as truthy values, and a missing field equals false
const FIND_OPTIONS: ITextMatchOptions = { matchCase: false, wholeWord: false };

/** Search session state of one group (the widget may be closed: F3). */
interface IFindSession {
    matches: IRange[];
    currentIndex: number;
    /**
     * Pinned on open and never re-resolved: focus moves into the widget, and `getActiveEditor()` follows
     * focus, which made `Ctrl+F` from the Output panel search the file behind it.
     */
    target: TextEditorPane | null;
    paneSubscription: IDisposable | null;
    /** The walk over a document on disk while it runs (docs/arch/Editor.md); the matches are what it found so far. */
    search: BackgroundFind | null;
    /** Where the cursor was when the search started: the current match is the first one from here on. */
    anchor: IPosition;
}

/** One session per group (US-33): find in group A keeps its query while group B is searched. */
export class FindService extends Disposable implements IContextKeyContributor {
    public static dependencies = [FindComponentDIToken, EditorServiceDIToken, EditorGroupsServiceDIToken] as const;

    private readonly component: FindComponent;
    private readonly editorService: IEditorService;
    private readonly groups: IEditorGroupsService;

    private readonly sessions = new Map<GroupId, IFindSession>();

    public constructor(component: FindComponent, editorService: IEditorService, groups: IEditorGroupsService) {
        super();
        this.component = component;
        this.editorService = editorService;
        this.groups = groups;
        component.onQueryChange = (groupId) => {
            this.recompute(groupId);
        };
        component.onNext = (groupId) => {
            this.navigate(groupId, 1);
        };
        component.onPrev = (groupId) => {
            this.navigate(groupId, -1);
        };
        component.onClose = (groupId) => {
            this.closeGroup(groupId);
        };
        this.register(
            this.groups.onDidGroupsChange((event) => {
                if (event.kind !== "removed") return;
                this.dropSession(event.group.id);
                this.component.disposeWidget(event.group.id);
            }),
        );
        this.register({
            dispose: () => {
                for (const groupId of [...this.sessions.keys()]) this.dropSession(groupId);
            },
        });
    }

    public isVisible(): boolean {
        return this.component.isOpen(this.groups.activeGroup.id);
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("findWidgetVisible", this.isVisible());
    }

    public open(): void {
        const group = this.groups.activeGroup;
        const widget = this.component.widgetFor(group.id);
        if (widget === null) return;
        if (widget.isOpen()) {
            widget.focus();
            widget.selectQuery();
            return;
        }

        const session = this.sessionFor(group);
        // Pin the session target BEFORE showing the widget: showing moves focus into its input.
        session.target = this.editorService.getActiveEditor();

        // Seed the query from a single-line, non-empty selection (VS Code behaviour).
        const editor = session.target;
        if (editor) {
            const selected = editor.viewState.getSelectedText();
            if (selected.length > 0 && !selected.includes("\n")) {
                widget.setQuery(selected);
            }
        }

        this.recompute(group.id);
        widget.show();
        widget.selectQuery();
    }

    public close(): void {
        this.closeGroup(this.groups.activeGroup.id);
    }

    public next(): void {
        this.navigate(this.groups.activeGroup.id, 1);
    }

    public prev(): void {
        this.navigate(this.groups.activeGroup.id, -1);
    }

    private sessionFor(group: EditorGroup): IFindSession {
        const existing = this.sessions.get(group.id);
        if (existing !== undefined) return existing;
        const session: IFindSession = {
            matches: [],
            currentIndex: -1,
            target: null,
            paneSubscription: null,
            search: null,
            anchor: { line: 0, character: 0 },
        };
        // Switching tabs in THIS group closes its session; other groups are unaffected (US-33).
        session.paneSubscription = group.onDidChangeActivePane((pane) => {
            if (pane !== session.target) this.closeGroup(group.id);
        });
        this.sessions.set(group.id, session);
        return session;
    }

    private dropSession(groupId: GroupId): void {
        const session = this.sessions.get(groupId);
        if (session === undefined) return;
        session.paneSubscription?.dispose();
        this.stopSearch(session);
        this.sessions.delete(groupId);
    }

    private stopSearch(session: IFindSession): void {
        session.search?.dispose();
        session.search = null;
    }

    private closeGroup(groupId: GroupId): void {
        const widget = this.component.widgetIfExists(groupId);
        const session = this.sessions.get(groupId);
        if (widget === null || session === undefined || !widget.isOpen()) return;

        // Close the session by its own target: by now the active editor is a different one
        // (focus is in the widget input), and highlights would be cleared from the wrong one.
        const editor = session.target;
        session.target = null;
        this.stopSearch(session);
        if (editor) {
            // Leave the cursor on the current match (VS Code behaviour), then clear highlights.
            if (session.currentIndex >= 0 && session.currentIndex < session.matches.length) {
                const m = session.matches[session.currentIndex];
                editor.viewState.selections = [
                    createSelection(m.start.line, m.start.character, m.end.line, m.end.character),
                ];
            }
            editor.setSearchDecorations([], -1);
        }

        session.matches = [];
        session.currentIndex = -1;
        widget.hide();
    }

    /**
     * F3 keys off text focus, not widget visibility (upstream `NextMatchFindAction`). With the
     * widget closed the match becomes the selection right away; with it open `close()` places the cursor.
     */
    private navigate(groupId: GroupId, direction: 1 | -1): void {
        const widget = this.component.widgetFor(groupId);
        if (widget === null) return;
        const group = this.groups.groups.find((candidate) => candidate.id === groupId);
        /* v8 ignore start -- a widget exists only for a live group */
        if (group === undefined) return;
        /* v8 ignore stop */
        const session = this.sessionFor(group);

        if (widget.isOpen()) {
            if (session.matches.length === 0) return;
            this.setCurrent(groupId, this.step(session, widget, direction));
            return;
        }

        const startedNewSession =
            session.matches.length === 0 || session.target !== this.editorService.getActiveEditor();
        if (startedNewSession && !this.startDetachedSession(group, widget)) return;
        if (session.matches.length === 0) return;

        // The first press goes to the nearest match from the cursor (picked by
        // recompute), subsequent ones step. Backward steps right away: the nearest "forward"
        // match would move the wrong way for Shift+F3.
        const index =
            startedNewSession && direction === 1 && session.currentIndex >= 0
                ? session.currentIndex
                : this.step(session, widget, direction);
        this.setCurrent(groupId, index);
        this.selectMatch(session, index);
    }

    /**
     * The next index in the list, wrapping around. Once the collection stopped at {@link MATCHES_LIMIT} the
     * list is not the whole document: past its ends the document itself is searched from the current match
     * (upstream `_moveToNextMatch` → `findNextMatch`), and the match found joins the list in its place.
     */
    private step(session: IFindSession, widget: FindWidget, direction: 1 | -1): number {
        const { matches, currentIndex, target } = session;
        // `atEnd` implies a current match: the list is not empty here, so its ends are real indices.
        const atEnd = direction === 1 ? currentIndex === matches.length - 1 : currentIndex === 0;
        // Stryker disable next-line ConditionalExpression: `target` lives and dies with `matches` (see recompute/close); the check is for the type
        if (matches.length >= MATCHES_LIMIT && atEnd && target !== null) {
            const current = matches[currentIndex];
            const document = target.viewState.document;
            const found =
                direction === 1
                    ? findNextMatch(document, current.end, widget.getQuery(), FIND_OPTIONS)
                    : findPreviousMatch(document, current.start, widget.getQuery(), FIND_OPTIONS);
            /* v8 ignore start -- the list is non-empty, so the document has a match to wrap to */
            // Stryker disable next-line ConditionalExpression: unreachable for the same reason as for coverage
            if (found === null) return currentIndex;
            /* v8 ignore stop */
            return this.indexOfOrInsert(session, found);
        }
        // A session without a current match yet (the walk has not reached the cursor): Next starts at the top.
        if (currentIndex < 0) return direction === 1 ? 0 : matches.length - 1;
        return (currentIndex + direction + matches.length) % matches.length;
    }

    private indexOfOrInsert(session: IFindSession, range: IRange): number {
        const { matches } = session;
        const at = findFirstIdxMonotonousOrArrLen(matches, (match) => comparePositions(match.start, range.start) >= 0);
        if (at < matches.length && rangesEqual(matches[at], range)) return at;
        session.matches = [...matches.slice(0, at), range, ...matches.slice(at)];
        return at;
    }

    /** An empty query is seeded from a single-line selection (`seedSearchStringFromSelection`); false means stop navigating. */
    private startDetachedSession(group: EditorGroup, widget: FindWidget): boolean {
        const editor = this.editorService.getActiveEditor();
        if (!editor) return false;

        if (widget.getQuery().length === 0) {
            const selected = editor.viewState.getSelectedText();
            if (selected.length === 0 || selected.includes("\n")) {
                this.open();
                return false;
            }
            widget.setQuery(selected);
        }

        const session = this.sessionFor(group);
        session.target = editor;
        this.recompute(group.id);
        return true;
    }

    private selectMatch(session: IFindSession, index: number): void {
        const editor = session.target;
        /* v8 ignore start -- navigate() gets here only with a live session, so the target exists */
        if (!editor) return;
        /* v8 ignore stop */
        const match = session.matches[index];
        editor.viewState.selections = [
            createSelection(match.start.line, match.start.character, match.end.line, match.end.character),
        ];
    }

    /**
     * In memory the walk is synchronous, as before. A document on disk is walked in the background from the
     * cursor's line on (docs/arch/Editor.md, OpenPerformance 4.3): the matches show up as they are found, the
     * counter grows, and the walk waits at the indexed end while the index is still being built.
     */
    private recompute(groupId: GroupId): void {
        const widget = this.component.widgetIfExists(groupId);
        const session = this.sessions.get(groupId);
        if (widget === null || session === undefined) return;
        this.stopSearch(session);
        const editor = session.target;
        if (!editor) {
            session.matches = [];
            session.currentIndex = -1;
            widget.setCounter(0, 0);
            return;
        }

        session.anchor = editor.viewState.selections[0].active;
        // Stryker disable next-line UnaryOperator: the new list holds new range objects, so a stale index finds nothing in it either way
        session.currentIndex = -1;
        const query = widget.getQuery();
        const model = editor.fileModel;
        // Stryker disable next-line OptionalChaining: a pane without a file model (untitled) has no document on disk; the chain is for the type
        if (model?.isOnDisk !== true) {
            const matches = findMatches(editor.viewState.document, query);
            this.applyMatches(session, widget, editor, { matches, done: true, wrapped: true });
            return;
        }
        session.search = new BackgroundFind(
            editor.viewState.document,
            query,
            FIND_OPTIONS,
            (progress) => {
                if (progress.done) this.stopSearch(session);
                this.applyMatches(session, widget, editor, progress);
            },
            {
                startLine: session.anchor.line,
                growth: {
                    isGrowing: () => model.diskIndexing?.done === false,
                    onDidGrow: (listener) => model.onDidChangeDiskIndexing(listener),
                },
            },
        );
        session.search.start();
    }

    /**
     * The current match survives a progress report (the list only grows, the range objects are the same); the
     * first current one is the nearest after the cursor, which the walk from the cursor's line finds first.
     * Revealed only when it changes: a report must not scroll the user back.
     */
    private applyMatches(
        session: IFindSession,
        widget: FindWidget,
        editor: TextEditorPane,
        progress: IBackgroundFindProgress,
    ): void {
        const previous = session.currentIndex >= 0 ? session.matches[session.currentIndex] : null;
        session.matches = progress.matches;
        const kept = previous === null ? -1 : session.matches.indexOf(previous);
        session.currentIndex =
            kept >= 0 ? kept : this.pickCurrentIndex(session.matches, session.anchor, progress.wrapped);

        editor.setSearchDecorations(session.matches, session.currentIndex);
        if (session.currentIndex >= 0 && session.matches[session.currentIndex] !== previous) {
            editor.revealRange(session.matches[session.currentIndex]);
        }
        widget.setCounter(session.currentIndex + 1, session.matches.length, !progress.done);
    }

    private setCurrent(groupId: GroupId, index: number): void {
        const widget = this.component.widgetIfExists(groupId);
        const session = this.sessions.get(groupId);
        /* v8 ignore start -- called only for a live session */
        if (widget === null || session === undefined) return;
        /* v8 ignore stop */
        session.currentIndex = index;
        const editor = session.target;
        /* v8 ignore start -- `matches` and `target` live and die together (see recompute/close), and we only get here with a non-empty match list */
        // Stryker disable next-line ConditionalExpression: the branch is unreachable for the same reason as for coverage
        if (editor === null) return;
        /* v8 ignore stop */
        editor.setSearchDecorations(session.matches, index);
        editor.revealRange(session.matches[index]);
        widget.setCounter(index + 1, session.matches.length, session.search !== null);
    }

    /**
     * The first match at or after the cursor; when there is none, the first of the document (the wrap) — but
     * only once the walk has seen the lines after the cursor: before that, the match to reveal is still to come.
     */
    private pickCurrentIndex(matches: IRange[], cursor: IPosition, wrapped: boolean): number {
        if (matches.length === 0) return -1;
        const index = findFirstIdxMonotonousOrArrLen(matches, (match) => comparePositions(match.start, cursor) >= 0);
        if (index < matches.length) return index;
        return wrapped ? 0 : -1;
    }
}
