import * as path from "node:path";

import { Disposable } from "../../base/common/lifecycle.ts";
import { Uri } from "../../base/common/uri.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../platform/state/common/iStateService.ts";
import type { WorkspaceId } from "../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IEditorGroupSnapshot, IEditorGroupsState, ISerializedEditor } from "../common/stateKeys.ts";
import { EDITOR_GROUPS_STATE, OPEN_EDITORS_STATE } from "../common/stateKeys.ts";
import type { EditorGroup } from "../services/editor/browser/editorGroupModel.ts";
import { TEXT_EDITOR_PANE_TYPE_ID } from "../services/editor/browser/editorPaneFactory.ts";
import type { IEditorGroupsService } from "../services/editor/common/editorGroupsService.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/common/editorService.ts";

import type { TextEditorPane } from "./parts/editor/textEditorPane.ts";

export const WorkbenchStateServiceDIToken = token<WorkbenchStateService>("WorkbenchStateService");

interface IRestoreGroup {
    readonly editors: readonly ISerializedEditor[];
    readonly active: ISerializedEditor | undefined;
}

interface IRestoreState {
    readonly orientation: "columns" | "rows";
    readonly groups: readonly IRestoreGroup[];
    readonly weights: readonly number[];
    readonly activeGroup: number;
}

/** Without it (headless tests) orientation/weights are written as defaults and restore skips the capacity check. */
export interface IEditorGroupsLayoutView {
    readonly orientation: "columns" | "rows";
    readonly weights: readonly number[];
    canFitGroups(count: number): boolean;
    applyPersistedLayout(orientation: "columns" | "rows", weights: readonly number[]): void;
}

/**
 * The flat {@link OPEN_EDITORS_STATE} is still written (a snapshot of the active
 * group), so a session opened by a build without splits loses nothing. The sidebar/panel
 * layout is persisted by `LayoutService`.
 */
export class WorkbenchStateService extends Disposable {
    public static dependencies = [StateServiceDIToken, EditorServiceDIToken, EditorGroupsServiceDIToken] as const;

    private layoutView: IEditorGroupsLayoutView | null = null;
    /** Set during restore: replaying the opens must not overwrite the snapshot. */
    private restoring = false;

    public constructor(
        private readonly state: IStateService,
        private readonly editorGroup: IEditorService,
        private readonly groups: IEditorGroupsService,
    ) {
        super();
        this.register(
            this.editorGroup.onActiveEditorChanged(() => {
                this.captureOpenEditors();
            }),
        );
        this.register(
            this.groups.onDidGroupsChange(() => {
                this.captureOpenEditors();
            }),
        );
    }

    /** Call before restore. */
    public attachEditorLayout(view: IEditorGroupsLayoutView): void {
        this.layoutView = view;
    }

    public openWorkspace(workspaceId: WorkspaceId): void {
        this.state.openWorkspace(workspaceId);
    }

    /**
     * Separate from `restoreOpenEditors`: bootstrap needs the paths **before** opening
     * to warm up grammars, so the tab's first frame is already highlighted.
     */
    public getOpenEditorsToRestore(): string[] {
        const snapshot = this.groupsSnapshotToRestore();
        const flat: string[] = [];
        for (const group of snapshot.groups) {
            for (const editor of group.editors) {
                if (editor.typeId !== TEXT_EDITOR_PANE_TYPE_ID) continue;
                const file = Uri.parse(editor.value).fsPath;
                if (!flat.includes(file)) flat.push(file);
            }
        }
        return flat;
    }

    public restoreOpenEditors(): void {
        const snapshot = this.groupsSnapshotToRestore();
        if (snapshot.groups.length === 0) return;

        this.restoring = true;
        try {
            for (const [index, group] of snapshot.groups.entries()) {
                // A placement refusal on a desync with canFit yields null — the group's tabs
                // are appended to the current one (a degradation with the same meaning).
                // Stryker disable next-line StringLiteral: position "" behaves like "after" — equivalent
                if (index > 0) this.groups.newGroup("after", { focus: false });
                const target = { group: this.groups.activeGroup, focus: false };
                for (const editor of group.editors) this.editorGroup.openSerializedEditor(editor, target);
                this.editorGroup.openSerializedEditor(group.active ?? group.editors[0], target);
            }
            const groups = this.groups.groups;
            const activeIndex = Math.min(Math.max(0, snapshot.activeGroup), groups.length - 1);
            this.groups.focusGroup({ index: activeIndex }, { focus: false });
            this.layoutView?.applyPersistedLayout(snapshot.orientation, snapshot.weights);
        } finally {
            this.restoring = false;
        }
        // The actual strip (after merges) is the source of truth.
        this.captureOpenEditors();
    }

    public captureOpenEditors(): void {
        if (this.restoring) return;
        const groups = this.groups.groups;
        const snapshots = groups.map((group) => this.snapshotGroup(group));
        const state: IEditorGroupsState = {
            orientation: this.layoutView?.orientation ?? "columns",
            groups: snapshots,
            weights: this.layoutView?.weights ?? snapshots.map(() => 1 / Math.max(1, snapshots.length)),
            activeGroup: groups.indexOf(this.groups.activeGroup),
        };
        this.state.store(EDITOR_GROUPS_STATE, state);

        // Compatibility with builds from before splits.
        const activeSnapshot = this.snapshotGroup(this.groups.activeGroup);
        this.state.store(OPEN_EDITORS_STATE, {
            files: activeSnapshot.files,
            activeIndex: activeSnapshot.activeIndex,
        });
    }

    /** `files` is for builds that don't know `editors`. */
    private snapshotGroup(group: EditorGroup): IEditorGroupSnapshot {
        const files: string[] = [];
        let activeIndex = -1;
        const editors: ISerializedEditor[] = [];
        let activeEditor = -1;
        for (const pane of group.getPanes()) {
            const isActive = pane === group.activePane;
            const editor = this.editorGroup.serializeEditor(pane);
            if (editor === undefined) continue;
            if (isActive) activeEditor = editors.length;
            editors.push(editor);
            if (editor.typeId !== TEXT_EDITOR_PANE_TYPE_ID) continue;
            if (isActive) activeIndex = files.length;
            files.push(pane.uri.fsPath);
        }
        return { files, activeIndex, editors, activeEditor };
    }

    /**
     * Non-restorable entries and empty groups are dropped (US-42); groups beyond
     * the terminal's capacity merge into the last one that fits (US-43).
     */
    private groupsSnapshotToRestore(): IRestoreState {
        const stored = this.state.get(EDITOR_GROUPS_STATE) ?? this.legacySnapshot();

        const groups: IRestoreGroup[] = [];
        const weights: number[] = [];
        for (const [index, group] of stored.groups.entries()) {
            const { editors: all, active } = this.storedEditors(group);
            const editors = all.filter((editor) => this.editorGroup.deserializeEditor(editor) !== undefined);
            if (editors.length === 0) continue;
            const canFitMore = this.layoutView?.canFitGroups(groups.length + 1) ?? true;
            if (groups.length > 0 && !canFitMore) {
                // Duplicates are kept: reopening a tab only activates it.
                const last = groups[groups.length - 1];
                groups[groups.length - 1] = { editors: [...last.editors, ...editors], active: last.active };
                continue;
            }
            groups.push({ editors, active: editors.find((editor) => editor === active) });
            weights.push(stored.weights[index] ?? 1);
        }
        return {
            orientation: stored.orientation,
            groups,
            weights,
            activeGroup: stored.activeGroup,
        };
    }

    private storedEditors(group: IEditorGroupSnapshot): IRestoreGroup {
        const editors =
            group.editors ??
            group.files.map((file) => ({
                typeId: TEXT_EDITOR_PANE_TYPE_ID,
                value: Uri.file(path.resolve(file)).toString(),
            }));
        const activeAt = group.editors !== undefined ? (group.activeEditor ?? -1) : group.activeIndex;
        // `>= 0` instead of an unchecked `.at`: `.at(-1)` means "last".
        // Stryker disable next-line EqualityOperator: `> 0` is equivalent — with no active editor the first opens, index 0
        return { editors, active: activeAt >= 0 ? editors.at(activeAt) : undefined };
    }

    private legacySnapshot(): IEditorGroupsState {
        const flat = this.state.get(OPEN_EDITORS_STATE);
        return {
            orientation: "columns",
            groups: flat.files.length > 0 ? [{ files: [...flat.files], activeIndex: flat.activeIndex }] : [],
            weights: [1],
            activeGroup: 0,
        };
    }
}
