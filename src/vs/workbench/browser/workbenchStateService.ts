import * as fs from "node:fs";
import * as path from "node:path";

import { Disposable } from "../../../../tuidom/common/disposable.ts";
import { Uri } from "../../base/common/uri.ts";
import { token } from "../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../common/coreTokens.ts";
import type { IEditorGroupSnapshot, IEditorGroupsState } from "../common/stateKeys.ts";
import { EDITOR_GROUPS_STATE, OPEN_EDITORS_STATE } from "../common/stateKeys.ts";
import type { EditorGroup } from "../services/editor/browser/editorGroupModel.ts";
import type { EditorService } from "../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../services/editor/browser/editorService.ts";

import type { TextEditorPane } from "./parts/editor/textEditorPane.ts";

export const WorkbenchStateServiceDIToken = token<WorkbenchStateService>("WorkbenchStateService");

/**
 * Срез view-раскладки полосы групп для персиста — ставит владелец view
 * (`WorkbenchComponent`) через {@link WorkbenchStateService.attachEditorLayout};
 * `EditorPartComponent` соответствует структурно. Без него (headless-тесты)
 * ось/доли пишутся дефолтными, а рестор не проверяет вместимость.
 */
export interface IEditorGroupsLayoutView {
    readonly orientation: "columns" | "rows";
    readonly weights: readonly number[];
    canFitGroups(count: number): boolean;
    applyPersistedLayout(orientation: "columns" | "rows", weights: readonly number[]): void;
}

/**
 * Персистентность открытых редакторов (headless, без `view`): снимает полосу
 * групп (файлы и активную вкладку каждой, ось, доли, активную группу) в
 * {@link IStateService} и реплеит при старте (см. docs/arch/State.md).
 * Write-through — подписки на `EditorService.onActiveEditorChanged` /
 * `onDidGroupsChange` + хук layout-изменений от view-части (ставит
 * `WorkbenchComponent`).
 *
 * Плоский {@link OPEN_EDITORS_STATE} продолжает писаться (снимок активной
 * группы): сессия, открытая сборкой без сплитов, ничего не теряет.
 *
 * Layout-состояние (сайдбар/панель) персистит `LayoutService` — он владеет
 * швом к `WorkbenchLayoutElement`.
 */
export class WorkbenchStateService extends Disposable {
    public static dependencies = [StateServiceDIToken, EditorServiceDIToken] as const;

    private layoutView: IEditorGroupsLayoutView | null = null;
    /** Взведён на время рестора: реплей открытий не должен перезаписывать снимок. */
    private restoring = false;

    public constructor(
        private readonly state: IStateService,
        private readonly editorGroup: EditorService,
    ) {
        super();
        this.register(
            this.editorGroup.onActiveEditorChanged(() => {
                this.captureOpenEditors();
            }),
        );
        // Сплит/схлопывание/перестановка групп — тоже часть снимка.
        this.register(
            this.editorGroup.onDidGroupsChange(() => {
                this.captureOpenEditors();
            }),
        );
    }

    /** Прикрепляет срез view-раскладки (ось/доли/вместимость) — до рестора. */
    public attachEditorLayout(view: IEditorGroupsLayoutView): void {
        this.layoutView = view;
    }

    /** Открывает/переключает per-project стор состояния на папку `folderPath`. */
    public openWorkspace(folderPath: string): void {
        this.state.openWorkspace(folderPath);
    }

    /**
     * Пути, которые реально откроет {@link restoreOpenEditors} — сохранённые в
     * сессии файлы ВСЕХ групп, пережившие удаление с диска. Отдельно от
     * `restoreOpenEditors`, потому что бутстрапу нужно узнать их **до**
     * открытия: он прогревает их грамматики, чтобы первый кадр вкладки был уже
     * подсвеченным.
     */
    public getOpenEditorsToRestore(): string[] {
        const snapshot = this.groupsSnapshotToRestore();
        const flat: string[] = [];
        for (const group of snapshot.groups) {
            for (const file of group.files) {
                if (!flat.includes(file)) flat.push(file);
            }
        }
        return flat;
    }

    /**
     * Восстанавливает полосу групп: реплеит файлы каждой группы через
     * `openFile`, активирует сохранённые вкладки и группу, применяет ось и доли.
     * Отсутствующие на диске файлы пропущены, опустевшие группы схлопнуты, а
     * группы сверх вместимости терминала слиты в последнюю влезающую — всё в
     * {@link groupsSnapshotToRestore} (US-42/43).
     */
    public restoreOpenEditors(): void {
        const snapshot = this.groupsSnapshotToRestore();
        if (snapshot.groups.length === 0) return;

        this.restoring = true;
        try {
            for (const [index, group] of snapshot.groups.entries()) {
                // Отказ по месту при рассинхроне с canFit даёт null — файлы
                // группы дольются в текущую (деградация того же смысла).
                if (index > 0) this.editorGroup.newGroup("after", { focus: false });
                for (const file of group.files) {
                    this.editorGroup.openFile(file, { focus: false });
                }
                const active = this.editorGroup.activeGroup;
                const target = this.mapActiveIndex(active, group);
                if (target >= 0) active.activateTab(target, { focus: false });
            }
            const groups = this.editorGroup.groups;
            const activeIndex = Math.min(Math.max(0, snapshot.activeGroup), groups.length - 1);
            this.editorGroup.focusGroup({ index: activeIndex }, { focus: false });
            this.layoutView?.applyPersistedLayout(snapshot.orientation, snapshot.weights);
        } finally {
            this.restoring = false;
        }
        // Снимок после рестора: фактическая полоса (с учётом слияний) и есть истина.
        this.captureOpenEditors();
    }

    /** Снимает полосу групп + плоский legacy-снимок активной группы в стор. */
    public captureOpenEditors(): void {
        if (this.restoring) return;
        const groups = this.editorGroup.groups;
        const snapshots = groups.map((group) => this.snapshotGroup(group));
        const state: IEditorGroupsState = {
            orientation: this.layoutView?.orientation ?? "columns",
            groups: snapshots,
            weights: this.layoutView?.weights ?? snapshots.map(() => 1 / Math.max(1, snapshots.length)),
            activeGroup: groups.indexOf(this.editorGroup.activeGroup),
        };
        this.state.store(EDITOR_GROUPS_STATE, state);

        // Плоский legacy-снимок активной группы — совместимость со сборками до сплитов.
        const activeSnapshot = this.snapshotGroup(this.editorGroup.activeGroup);
        this.state.store(OPEN_EDITORS_STATE, {
            files: activeSnapshot.files,
            activeIndex: activeSnapshot.activeIndex,
        });
    }

    /** Файлы вкладок группы + активная вкладка, переиндексированная в `files`. */
    private snapshotGroup(group: EditorGroup): IEditorGroupSnapshot {
        const files: string[] = [];
        let activeIndex = -1;
        for (const pane of group.getPanes()) {
            // Дак-тайп вместо instanceof: путь есть только у текстовой вкладки
            // файла; дифф и безымянные буферы не восстановить по пути — пропуск.
            const filePath = (pane as Partial<TextEditorPane>).absoluteFilePath ?? null;
            if (filePath === null) continue;
            if (pane === group.activePane) activeIndex = files.length;
            files.push(filePath);
        }
        return { files, activeIndex };
    }

    /**
     * Снимок к рестору: новый ключ либо конверсия плоского legacy; файлы
     * фильтруются существованием на диске, пустые группы выпадают (US-42),
     * группы сверх вместимости терминала сливаются в последнюю влезшую (US-43).
     */
    private groupsSnapshotToRestore(): IEditorGroupsState {
        const stored = this.state.get(EDITOR_GROUPS_STATE) ?? this.legacySnapshot();

        const groups: IEditorGroupSnapshot[] = [];
        const weights: number[] = [];
        for (const [index, group] of stored.groups.entries()) {
            const activePath =
                group.activeIndex >= 0 && group.activeIndex < group.files.length
                    ? group.files[group.activeIndex]
                    : undefined;
            const files = group.files.filter((file) => fs.existsSync(file));
            if (files.length === 0) continue;
            const canFitMore = this.layoutView?.canFitGroups(groups.length + 1) ?? true;
            if (groups.length > 0 && !canFitMore) {
                // Терминал уже полосы: доливаем файлы в последнюю влезшую группу.
                const last = groups[groups.length - 1];
                groups[groups.length - 1] = {
                    files: [...last.files, ...files.filter((file) => !last.files.includes(file))],
                    activeIndex: last.activeIndex,
                };
                continue;
            }
            groups.push({
                files,
                activeIndex: activePath !== undefined ? files.indexOf(activePath) : -1,
            });
            weights.push(stored.weights[index] ?? 1);
        }
        return {
            orientation: stored.orientation,
            groups,
            weights,
            activeGroup: stored.activeGroup,
        };
    }

    /** Конверсия плоского legacy-ключа в одногрупповой снимок. */
    private legacySnapshot(): IEditorGroupsState {
        const flat = this.state.get(OPEN_EDITORS_STATE);
        return {
            orientation: "columns",
            groups: flat.files.length > 0 ? [{ files: [...flat.files], activeIndex: flat.activeIndex }] : [],
            weights: [1],
            activeGroup: 0,
        };
    }

    /** Активная вкладка снапшота → позиция в фактически открытой группе. */
    private mapActiveIndex(group: EditorGroup, snapshot: IEditorGroupSnapshot): number {
        if (snapshot.activeIndex < 0 || snapshot.activeIndex >= snapshot.files.length) {
            return group.editorCount > 0 ? 0 : -1;
        }
        // openFile резолвит путь тем же path.resolve — ресурс совпадёт с вкладкой.
        return group.findPaneIndex(Uri.file(path.resolve(snapshot.files[snapshot.activeIndex])));
    }
}
