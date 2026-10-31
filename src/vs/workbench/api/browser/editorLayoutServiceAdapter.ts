import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";
import { clampPositionToDocument } from "../../../editor/common/core/iPosition.ts";
import { createSelection } from "../../../editor/common/core/iSelection.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../browser/parts/editor/iEditorPane.ts";
import { isTextEditorPane, TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import { ACTIVE_GROUP, columnToEditorGroup } from "../../services/editor/common/editorGroupColumn.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IEditorLayoutService } from "../common/iEditorLayoutService.ts";
import type {
    IWireCloseGroupsParams,
    IWireCloseTabsParams,
    IWireCreateUntitledParams,
    IWireEditorLayout,
    IWireSelection,
    IWireShowTextDocumentParams,
    IWireShowTextDocumentResult,
    IWireTabGroupSnapshot,
    IWireTabSnapshot,
    IWireUriParams,
} from "../common/wireTypes.ts";

/** A `showTextDocument` ViewColumn beyond the group count catches up by creating trailing groups (AS-5). */
export class EditorLayoutServiceAdapter extends Disposable implements IEditorLayoutService {
    private readonly onDidChangeLayoutEmitter = this.register(new Emitter<IWireEditorLayout>());
    private flushScheduled = false;
    private pendingLayout = false;

    public constructor(
        private readonly editors: IEditorService,
        private readonly groups: IEditorGroupsService,
    ) {
        super();
        this.register(
            groups.onDidGroupsChange(() => {
                this.scheduleLayoutPush();
            }),
        );
        this.register(
            groups.onDidActiveGroupChange(() => {
                this.scheduleLayoutPush();
            }),
        );
        this.register(
            editors.onDidChangeEditors(() => {
                this.scheduleLayoutPush();
            }),
        );
    }

    public getLayoutSnapshot(): IWireEditorLayout {
        const groups = this.groups.groups.map((group) => this.snapshotGroup(group));
        return { groups };
    }

    public readonly onDidChangeLayout = this.onDidChangeLayoutEmitter.event;

    public flushPendingLayout(): void {
        if (!this.pendingLayout) return;
        this.pendingLayout = false;
        const layout = this.getLayoutSnapshot();
        this.onDidChangeLayoutEmitter.fire(layout);
    }

    public async showTextDocument(params: IWireShowTextDocumentParams): Promise<IWireShowTextDocumentResult> {
        const uri = Uri.parse(params.uri);
        const focus = params.preserveFocus !== true;
        const previousActive = this.groups.activeGroup;
        const target = columnToEditorGroup(this.groups, params.viewColumn ?? ACTIVE_GROUP, uri);

        this.groups.focusGroup(target.id, { focus: false });
        // Upstream `isUntitledWithAssociatedResource`: `Untitled-N` is a name, anything else a path to save to.
        if (uri.scheme === "untitled") {
            this.editors.createUntitled({ uri, associated: uri.path.length > 1 && !/Untitled-\d+/.test(uri.path) });
        }
        // Await the open: a non-disk resource (`jdt:`) arrives from the scheme provider
        // as a promise, and the selection from `params` must be applied to it. The group is explicit:
        // the column is already resolved, and a locked one the extension named must not redirect.
        await this.editors.openUri(uri, { focus, group: target });

        const opened = this.groups.activeGroup;
        const editor = opened.activePane;
        if (isTextEditorPane(editor) && params.selection !== undefined) {
            const s = params.selection;
            // The extension's positions may not match our text (stale index, another revision):
            // a cursor past the end of line crashes the first frame in occurrence highlighting.
            const doc = editor.model.document;
            const anchor = clampPositionToDocument(doc, { line: s.anchorLine, character: s.anchorCharacter });
            const active = clampPositionToDocument(doc, { line: s.activeLine, character: s.activeCharacter });
            editor.viewState.selections = [
                createSelection(anchor.line, anchor.character, active.line, active.character),
            ];
            editor.revealRange({ start: active, end: active });
        }

        // preserveFocus: the active group and focus stay unchanged, as in VS Code.
        if (!focus) this.groups.focusGroup(previousActive.id, { focus: false });

        // The reply must go out AFTER layoutChanged: the host flushes before the reply.
        return Promise.resolve({
            /* v8 ignore start -- openUri always inserts and activates the tab: activePane is never null here */
            uri: editor?.uri.toString() ?? params.uri,
            /* v8 ignore stop */
            groupId: opened.id,
            viewColumn: this.groups.viewColumnOf(opened),
        });
    }

    public async createUntitledDocument(params: IWireCreateUntitledParams): Promise<IWireUriParams> {
        if (params.uri !== undefined) {
            const opened = await this.editors.openUntitledDocument(Uri.parse(params.uri), {
                encoding: params.encoding,
            });
            return { uri: opened.toString() };
        }
        const uri = this.editors.createUntitled({
            content: params.content,
            languageId: params.language,
            encoding: params.encoding,
        });
        return { uri: uri.toString() };
    }

    public async openTextDocument(params: IWireUriParams): Promise<IWireUriParams | null> {
        return (await this.editors.openTextDocumentWithoutEditor(Uri.parse(params.uri))) ? { uri: params.uri } : null;
    }

    /** The same confirm flow as for the user (upstream `MainThreadEditorTabs.$closeTab`); an already closed tab is a success. */
    public async closeTabs(params: IWireCloseTabsParams): Promise<boolean> {
        const targets: { group: EditorGroup; pane: IEditorPane }[] = [];
        for (const target of params.tabs) {
            const group = this.groups.groups.find((candidate) => candidate.id === target.groupId);
            if (group === undefined) continue;
            const pane = group.getPane(group.findPaneIndex(Uri.parse(target.uri)));
            if (pane !== null) targets.push({ group, pane });
        }
        let allClosed = true;
        for (const [group, entries] of Map.groupBy(targets, (entry) => entry.group)) {
            const panes = entries.map((entry) => entry.pane);
            if (!(await this.editors.closeEditors(group, panes))) allClosed = false;
        }
        return allClosed;
    }

    /** A veto in one group does not prevent closing the others (upstream `$closeGroup`). */
    public async closeGroups(params: IWireCloseGroupsParams): Promise<boolean> {
        let allClosed = true;
        for (const groupId of params.groupIds) {
            const group = this.groups.groups.find((candidate) => candidate.id === groupId);
            if (group === undefined) continue;
            if (!(await this.editors.closeAllEditors(group))) allClosed = false;
        }
        return allClosed;
    }

    private scheduleLayoutPush(): void {
        this.pendingLayout = true;
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        queueMicrotask(() => {
            this.flushScheduled = false;
            this.flushPendingLayout();
        });
    }

    private snapshotGroup(group: EditorGroup): IWireTabGroupSnapshot {
        return {
            groupId: group.id,
            viewColumn: this.groups.viewColumnOf(group),
            isActive: group === this.groups.activeGroup,
            tabs: group.getPanes().map((pane) => this.snapshotTab(group, pane)),
        };
    }

    private snapshotTab(group: EditorGroup, pane: IEditorPane): IWireTabSnapshot {
        const isActive = pane === group.activePane;
        const base = {
            uri: pane.uri.toString(),
            label: pane.label,
            isActive,
            isDirty: pane.isModified,
        };
        if (pane instanceof DiffEditorPane2) {
            return {
                ...base,
                kind: "diff",
                ...(pane.originalUri !== null ? { original: pane.originalUri.toString() } : {}),
                ...(pane.modifiedUri !== null ? { modified: pane.modifiedUri.toString() } : {}),
                sideEditors: diffSideEditors(pane),
            };
        }
        // Neither text nor diff (`TabInputUnknown` in vscode): it must not be passed off as text by uri.
        if (!(pane instanceof TextEditorPane)) {
            return { ...base, kind: "unknown" };
        }
        return {
            ...base,
            kind: "text",
            languageId: pane.languageId,
            // Selections only for the active tab: its selection is seeded to the extension from the snapshot.
            ...(isActive ? { selections: pane.viewState.selections.map(toWireSelection) } : {}),
        };
    }
}

function diffSideEditors(pane: DiffEditorPane2): string[] {
    const snapshots = pane.snapshotSides();
    const [original, modified] = pane.sidePanes();
    return [
        ...(snapshots.includes("original") ? [] : [original.uri.toString()]),
        ...(snapshots.includes("modified") ? [] : [modified.uri.toString()]),
    ];
}

function toWireSelection(selection: {
    anchor: { line: number; character: number };
    active: { line: number; character: number };
}): IWireSelection {
    return {
        anchorLine: selection.anchor.line,
        anchorCharacter: selection.anchor.character,
        activeLine: selection.active.line,
        activeCharacter: selection.active.character,
    };
}
