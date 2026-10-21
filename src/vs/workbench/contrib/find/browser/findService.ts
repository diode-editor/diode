import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { comparePositions } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import { findMatches } from "../../../../editor/contrib/find/findMatches.ts";
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
        const session: IFindSession = { matches: [], currentIndex: -1, target: null, paneSubscription: null };
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
        this.sessions.delete(groupId);
    }

    private closeGroup(groupId: GroupId): void {
        const widget = this.component.widgetIfExists(groupId);
        const session = this.sessions.get(groupId);
        if (widget === null || session === undefined || !widget.isOpen()) return;

        // Close the session by its own target: by now the active editor is a different one
        // (focus is in the widget input), and highlights would be cleared from the wrong one.
        const editor = session.target;
        session.target = null;
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
            this.setCurrent(groupId, this.step(session, direction));
            return;
        }

        const startedNewSession =
            session.matches.length === 0 || session.target !== this.editorService.getActiveEditor();
        if (startedNewSession && !this.startDetachedSession(group, widget)) return;
        if (session.matches.length === 0) return;

        // The first press goes to the nearest match from the cursor (picked by
        // recompute), subsequent ones step. Backward steps right away: the nearest "forward"
        // match would move the wrong way for Shift+F3.
        const index = startedNewSession && direction === 1 ? session.currentIndex : this.step(session, direction);
        this.setCurrent(groupId, index);
        this.selectMatch(session, index);
    }

    private step(session: IFindSession, direction: 1 | -1): number {
        return (session.currentIndex + direction + session.matches.length) % session.matches.length;
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

    private recompute(groupId: GroupId): void {
        const widget = this.component.widgetIfExists(groupId);
        const session = this.sessions.get(groupId);
        if (widget === null || session === undefined) return;
        const editor = session.target;
        if (!editor) {
            session.matches = [];
            session.currentIndex = -1;
            widget.setCounter(0, 0);
            return;
        }

        session.matches = findMatches(editor.viewState.document, widget.getQuery());

        if (session.matches.length === 0) {
            session.currentIndex = -1;
        } else {
            session.currentIndex = this.pickCurrentIndex(session.matches, editor.viewState.selections[0].active);
        }

        editor.setSearchDecorations(session.matches, session.currentIndex);
        if (session.currentIndex >= 0) {
            editor.revealRange(session.matches[session.currentIndex]);
        }
        widget.setCounter(session.currentIndex + 1, session.matches.length);
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
        widget.setCounter(index + 1, session.matches.length);
    }

    private pickCurrentIndex(matches: IRange[], cursor: IPosition): number {
        for (let i = 0; i < matches.length; i++) {
            if (comparePositions(matches[i].start, cursor) >= 0) return i;
        }
        return 0;
    }
}
