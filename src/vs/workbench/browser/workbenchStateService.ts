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

/** Без него (headless-тесты) ось/доли пишутся дефолтными, а рестор не проверяет вместимость. */
export interface IEditorGroupsLayoutView {
    readonly orientation: "columns" | "rows";
    readonly weights: readonly number[];
    canFitGroups(count: number): boolean;
    applyPersistedLayout(orientation: "columns" | "rows", weights: readonly number[]): void;
}

/**
 * Плоский {@link OPEN_EDITORS_STATE} продолжает писаться (снимок активной
 * группы): сессия, открытая сборкой без сплитов, ничего не теряет. Layout
 * сайдбара/панели персистит `LayoutService`.
 */
export class WorkbenchStateService extends Disposable {
    public static dependencies = [StateServiceDIToken, EditorServiceDIToken, EditorGroupsServiceDIToken] as const;

    private layoutView: IEditorGroupsLayoutView | null = null;
    /** Взведён на время рестора: реплей открытий не должен перезаписывать снимок. */
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

    /** До рестора. */
    public attachEditorLayout(view: IEditorGroupsLayoutView): void {
        this.layoutView = view;
    }

    public openWorkspace(workspaceId: WorkspaceId): void {
        this.state.openWorkspace(workspaceId);
    }

    /**
     * Отдельно от `restoreOpenEditors`: бутстрапу пути нужны **до** открытия,
     * чтобы прогреть грамматики и первый кадр вкладки был уже подсвеченным.
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
                // Отказ по месту при рассинхроне с canFit даёт null — вкладки
                // группы дольются в текущую (деградация того же смысла).
                // Stryker disable next-line StringLiteral: позиция "" ведёт себя как "after" — эквивалентен
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
        // Фактическая полоса (с учётом слияний) и есть истина.
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

        // Совместимость со сборками до сплитов.
        const activeSnapshot = this.snapshotGroup(this.groups.activeGroup);
        this.state.store(OPEN_EDITORS_STATE, {
            files: activeSnapshot.files,
            activeIndex: activeSnapshot.activeIndex,
        });
    }

    /** `files` — для сборок, которые `editors` не знают. */
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
     * Неповторимые записи и пустые группы выпадают (US-42), группы сверх
     * вместимости терминала сливаются в последнюю влезшую (US-43).
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
                // Дубли не отсеиваем: повторное открытие вкладки её лишь активирует.
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
        // `>= 0`, а не `.at` без проверки: у `.at(-1)` семантика «последняя».
        // Stryker disable next-line EqualityOperator: `> 0` эквивалентен — без активной открывается первая, индекс 0
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
