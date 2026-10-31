import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { Disposable } from "../../../base/common/lifecycle.ts";
import { Uri } from "../../../base/common/uri.ts";
import { clampPositionToDocument } from "../../../editor/common/core/iPosition.ts";
import { createSelection } from "../../../editor/common/core/iSelection.ts";
import { type ILanguageService, NULL_LANGUAGE_SERVICE } from "../../../editor/common/languages/iLanguageService.ts";
import { DiffEditorPane2 } from "../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../browser/parts/editor/iEditorPane.ts";
import { isTextEditorPane, TextEditorPane } from "../../browser/parts/editor/textEditorPane.ts";
import type { BaseTextEditorModel } from "../../common/editor/textEditorModel.ts";
import type { EditorGroup } from "../../services/editor/browser/editorGroupModel.ts";
import { ACTIVE_GROUP, columnToEditorGroup } from "../../services/editor/common/editorGroupColumn.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IEditorLayoutService } from "../common/iEditorLayoutService.ts";
import type {
    IWireChangeLanguageParams,
    IWireChangeLanguageResult,
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
    /** The document had no model when the extension set its language: the choice waits for the tab. */
    private readonly pendingLanguages = new Map<string, string>();
    /**
     * The newest call that takes focus: a slower, older open must not end up on top of it. Kept only while
     * calls are in flight: after that, focus belongs to the user.
     */
    private latestFocusedShow: { readonly group: EditorGroup; readonly uri: Uri } | null = null;
    private showsInFlight = 0;
    private activeBeforeShows: EditorGroup;

    public constructor(
        private readonly editors: IEditorService,
        private readonly groups: IEditorGroupsService,
        private readonly languages: Pick<
            ILanguageService,
            "getRegisteredLanguageIds" | "getLanguageIdForResource"
        > = NULL_LANGUAGE_SERVICE,
    ) {
        super();
        this.activeBeforeShows = groups.activeGroup;
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
                this.applyPendingLanguages();
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
        // Calls in flight have already moved the active group: the one to go back to predates all of them.
        if (this.showsInFlight === 0) this.activeBeforeShows = this.groups.activeGroup;
        const previousActive = this.activeBeforeShows;
        const target = columnToEditorGroup(this.groups, params.viewColumn ?? ACTIVE_GROUP, uri);

        const show = { group: target, uri };
        if (focus) this.latestFocusedShow = show;

        this.groups.focusGroup(target.id, { focus: false });
        // Await the open: a non-disk resource (`jdt:`) arrives from the scheme provider
        // as a promise, and the selection from `params` must be applied to it. The group is explicit:
        // the column is already resolved, and a locked one the extension named must not redirect.
        this.showsInFlight++;
        await this.editors.openUri(uri, { focus, group: target });
        this.showsInFlight--;

        // The target group and its tab, not "whatever is active now": requests of one tick all open
        // before this continuation runs, so the active group already belongs to the last of them.
        const editor = target.getPane(target.findPaneIndex(uri));
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
        // A call made in the meantime moved focus on purpose.
        this.yieldToLatestShow(show);
        if (this.showsInFlight === 0) this.latestFocusedShow = null;

        // Upstream `extHostTextEditors.showTextDocument`: a failed open rejects instead of naming another editor.
        if (editor === null) throw new Error(`Could NOT open editor for "${params.uri}".`);

        // The reply must go out AFTER layoutChanged: the host flushes before the reply.
        return {
            uri: editor.uri.toString(),
            groupId: target.id,
            viewColumn: this.groups.viewColumnOf(target),
        };
    }

    /** Only a non-disk open can finish after a newer call: it activated itself, the newer call stays on top. */
    private yieldToLatestShow(finished: { readonly group: EditorGroup; readonly uri: Uri }): void {
        const latest = this.latestFocusedShow;
        // Stryker disable next-line ConditionalExpression: equivalent, the newest call activating itself again changes nothing
        if (latest === null || latest === finished) return;
        const index = latest.group.findPaneIndex(latest.uri);
        if (index < 0) return;
        this.groups.focusGroup(latest.group.id);
        latest.group.activateTab(index);
    }

    public getLanguages(): readonly string[] {
        return this.languages.getRegisteredLanguageIds();
    }

    public getLanguageOfDocument(uri: string): string | null {
        return this.pendingLanguages.get(uri) ?? this.languages.getLanguageIdForResource(Uri.parse(uri).path) ?? null;
    }

    public changeDocumentLanguage({ uri, languageId }: IWireChangeLanguageParams): IWireChangeLanguageResult {
        if (!this.languages.getRegisteredLanguageIds().includes(languageId)) {
            throw new Error(`Unknown language id: ${languageId}`);
        }
        const model = this.findModel(uri);
        if (model === undefined) {
            this.pendingLanguages.set(uri, languageId);
            return { applied: false };
        }
        model.setLanguage(languageId);
        return { applied: true };
    }

    /** However the tab appeared: `showTextDocument`, quick open, the explorer. */
    private applyPendingLanguages(): void {
        for (const [uri, languageId] of this.pendingLanguages) {
            const model = this.findModel(uri);
            if (model === undefined) continue;
            this.pendingLanguages.delete(uri);
            model.setLanguage(languageId);
        }
    }

    private findModel(uri: string): BaseTextEditorModel | undefined {
        const surface = this.editors.getTextSurfaces().find((editor) => editor.model.uri.toString() === uri);
        return (
            surface?.model ??
            [...this.editors.getUntitledModelsWithoutEditor(), ...this.editors.getFileModelsWithoutEditor()].find(
                (model) => model.uri.toString() === uri,
            )
        );
    }

    public createUntitledDocument(params: IWireCreateUntitledParams): IWireUriParams {
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
