import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IEditorGroupsService, IGroupsChangeEvent } from "../common/editorGroupsService.ts";

import { EditorGroup, type GroupId, type MruCycleState } from "./editorGroupModel.ts";

/**
 * Headless-аналог upstream `IEditorGroupsService` (у upstream его реализует view-часть `EditorPart`).
 * Вкладок сам не создаёт: дубль открывает `EditorService` колбэком «наполни группу».
 * Порядок событий — контракт: {@link onDidChangeEditors} → фокус →
 * {@link onDidChangeActivePane} → {@link onDidActiveGroupChange}.
 */
export class EditorGroupsService extends Disposable implements IEditorGroupsService {
    public static dependencies = [ILogServiceDIToken] as const;

    /** Порядок ViewColumn − 1; без сплитов — ровно одна группа. */
    private groupsList: EditorGroup[] = [];
    private activeGroupValue: EditorGroup;
    /** Id групп не переиспользуются. */
    private groupIdCounter = 0;
    private readonly groupSubscriptions = new Map<GroupId, IDisposable[]>();
    private readonly logger: ILogger;

    private readonly onDidActiveGroupChangeEmitter = new Emitter<EditorGroup>();
    private readonly onDidGroupsChangeEmitter = new Emitter<IGroupsChangeEvent>();
    private readonly onDidChangeMruCycleEmitter = new Emitter<MruCycleState | null>();
    private readonly onDidChangeEditorsEmitter = new Emitter<void>();
    private readonly onDidChangeActivePaneEmitter = new Emitter<IEditorPane | null>();

    /** `EditorPartComponent` спрашивает свой `EditorPartElement.canFit`; не задан (headless) — место не проверяется. */
    public canAddGroupHook?: () => boolean;

    /** Нужен ради filler'а пустой группы — сервису он недоступен. Не задан — фокус в активную вкладку. */
    public focusGroupContentHook?: (group: EditorGroup) => void;

    public readonly onDidActiveGroupChange = this.onDidActiveGroupChangeEmitter.event;

    /** Снимок замороженного MRU-списка на каждом шаге серии Ctrl+Tab и `null`, когда серия кончилась. */
    public readonly onDidChangeMruCycle = this.onDidChangeMruCycleEmitter.event;

    public readonly onDidGroupsChange = this.onDidGroupsChangeEmitter.event;

    public readonly onDidChangeEditors = this.onDidChangeEditorsEmitter.event;

    /** Любого вида — сужение до текста делает `EditorService`. */
    public readonly onDidChangeActivePane = this.onDidChangeActivePaneEmitter.event;

    public constructor(logService: ILogService) {
        super();
        // Stryker disable next-line StringLiteral,ObjectLiteral: имя канала и его метка — подпись в селекторе Output, поведения логирования не задают
        this.logger = logService.createLogger("workbench.editorGroups", { label: "Editor Groups" });
        this.activeGroupValue = this.createGroup();
        this.register({
            dispose: () => {
                for (const subscriptions of this.groupSubscriptions.values()) {
                    for (const subscription of subscriptions) subscription.dispose();
                }
                // После выключения карту никто не читает — очистка лишь отпускает ссылки.
                // Stryker disable next-line CallExpression: эквивалентен — см. выше
                this.groupSubscriptions.clear();
            },
        });
    }

    public get groups(): readonly EditorGroup[] {
        return this.groupsList;
    }

    public get activeGroup(): EditorGroup {
        return this.activeGroupValue;
    }

    /** `null` и для detached-панелей: групп у них нет. */
    public groupOf(pane: IEditorPane): EditorGroup | null {
        for (const group of this.groupsList) {
            if (group.getPanes().includes(pane)) return group;
        }
        return null;
    }

    public viewColumnOf(group: EditorGroup): number {
        return this.groupsList.indexOf(group) + 1;
    }

    /**
     * VS Code `workbench.action.splitEditor`. Отказ (пустая активная группа или нет места) — молча,
     * с записью в лог (решение постановки №3). Новая группа активна ДО наполнения: открытая в ней
     * вкладка сразу — активный редактор воркбенча.
     */
    public splitActiveGroup(
        fill: (group: EditorGroup, source: IEditorPane) => void,
        // Любая позиция, кроме "before", — справа: пустая строка ведёт себя как "after".
        // Stryker disable next-line StringLiteral: эквивалентен — см. выше
        { focus = true, position = "after" }: { focus?: boolean; position?: "before" | "after" } = {},
    ): EditorGroup | null {
        const source = this.activeGroupValue;
        const sourcePane = source.activePane;
        if (sourcePane === null) return null;
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("split refused — not enough space");
            return null;
        }

        const anchor = this.groupsList.indexOf(source);
        const index = position === "before" ? anchor : anchor + 1;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index, source });

        this.activeGroupValue = group;
        fill(group, sourcePane);
        if (group.editorCount === 0) {
            this.fireActivePaneChanged(null);
            if (focus) this.focusGroupContent(group);
        }
        this.fireActiveGroupChanged(group);
        return group;
    }

    public newGroup(position: "before" | "after", { focus = true }: { focus?: boolean } = {}): EditorGroup | null {
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("new group refused — not enough space");
            return null;
        }
        const anchor = this.groupsList.indexOf(this.activeGroupValue);
        const index = position === "before" ? anchor : anchor + 1;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index });
        this.activeGroupValue = group;
        this.fireActivePaneChanged(null);
        if (focus) this.focusGroupContent(group);
        this.fireActiveGroupChanged(group);
        return group;
    }

    /** За краем полосы — no-op (US-10). */
    public focusGroup(
        target: GroupId | { index: number } | { direction: "next" | "previous" | "cycle" },
        { focus = true }: { focus?: boolean } = {},
    ): void {
        const group = this.resolveGroupTarget(target);
        if (group === null) return;
        this.makeGroupActive(group);
        if (focus) this.focusGroupContent(group);
    }

    private resolveGroupTarget(
        target: GroupId | { index: number } | { direction: "next" | "previous" | "cycle" },
    ): EditorGroup | null {
        if (typeof target === "number") {
            return this.groupsList.find((group) => group.id === target) ?? null;
        }
        if ("index" in target) {
            return this.groupsList[target.index] ?? null;
        }
        const current = this.groupsList.indexOf(this.activeGroupValue);
        if (target.direction === "cycle") {
            return this.groupsList[(current + 1) % this.groupsList.length];
        }
        const next = target.direction === "next" ? current + 1 : current - 1;
        return this.groupsList[next] ?? null;
    }

    /** Фокус уже там, куда кликнули, — только события. */
    public notifyGroupFocused(group: EditorGroup): void {
        // Тот же гард стоит в makeGroupActive: ранний выход лишь экономит вызов.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (group === this.activeGroupValue) return;
        this.makeGroupActive(group);
    }

    /** У единственной группы создаёт соседку (US-50). Ресурс уже открыт в целевой — сливается с ней. */
    public moveActiveEditorToGroup(direction: "next" | "previous", { focus = true }: { focus?: boolean } = {}): void {
        const source = this.activeGroupValue;
        const index = source.activeIndex;
        if (source.activePane === null) return;
        const target = this.neighborOrNewGroup(direction);
        if (target === null) return;

        // detachPane может схлопнуть опустевший источник — целевая группа взята по ссылке заранее.
        const pane = source.detachPane(index);
        /* v8 ignore start -- activePane проверен выше, индекс валиден */
        // Stryker disable next-line ConditionalExpression: недостижимая ветвь по той же причине
        if (pane === null) return;
        /* v8 ignore stop */
        this.activeGroupValue = target;
        const existing = target.findPaneIndex(pane.uri);
        if (existing >= 0) {
            pane.dispose();
            target.activateTab(existing, { focus });
        } else {
            target.insertPane(pane);
            target.activateTab(target.editorCount - 1, { focus });
        }
        this.fireActiveGroupChanged(target);
    }

    public openInNeighborGroup(direction: "next" | "previous", fill: (group: EditorGroup) => void): void {
        const target = this.neighborOrNewGroup(direction);
        if (target === null) return;
        this.openInGroup(target, () => {
            fill(target);
        });
    }

    /**
     * Группа активна ДО `fill` — открытая вкладка сразу активный редактор воркбенча. Серию Ctrl+Tab
     * прежней группы не завершает: это не уход фокуса, а открытие.
     */
    public openInGroup(group: EditorGroup, fill: () => void): void {
        const wasActive = group === this.activeGroupValue;
        this.activeGroupValue = group;
        fill();
        if (!wasActive) this.fireActiveGroupChanged(group);
    }

    /** Нет места — фолбэк в активную. Активной не становится: это решает открытие. */
    public sideGroup(): EditorGroup {
        const index = this.groupsList.indexOf(this.activeGroupValue);
        const next = this.groupsList.at(index + 1);
        if (next !== undefined) return next;
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("open beside refused — not enough space, opening in the active group");
            return this.activeGroupValue;
        }
        const group = this.createGroup(index + 1);
        this.fireGroupsChanged({ kind: "added", group, index: index + 1, source: this.activeGroupValue });
        return group;
    }

    /** VS Code `joinTwoGroups`: дубликаты ресурса схлопываются (решение постановки №5). */
    public joinTwoGroups(): void {
        const target = this.activeGroupValue;
        const source = this.resolveGroupTarget({ direction: "next" });
        // Сосед по направлению активной группой не бывает: второе условие — страховка.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (source === null || source === target) return;
        this.mergeGroupInto(source, target);
    }

    /** Активная вкладка бывшей активной группы выживает (US-21). */
    public joinAllGroups(): void {
        if (this.groupsList.length < 2) return;
        const rememberedUri = this.activeGroupValue.activePane?.uri ?? null;
        const target = this.groupsList[0];
        this.activeGroupValue = target;
        while (this.groupsList.length > 1) {
            this.mergeGroupInto(this.groupsList[1], target);
        }
        if (rememberedUri !== null) {
            const index = target.findPaneIndex(rememberedUri);
            /* v8 ignore start -- uri взят с живой вкладки, merge с дедупом сохраняет ресурс в target */
            // Stryker disable next-line ConditionalExpression: ресурс в target есть всегда по той же причине
            if (index >= 0) target.activateTab(index);
            /* v8 ignore stop */
        }
        this.fireActiveGroupChanged(target);
    }

    public moveActiveGroup(direction: "next" | "previous"): void {
        const from = this.groupsList.indexOf(this.activeGroupValue);
        const to = direction === "next" ? from + 1 : from - 1;
        if (to < 0 || to >= this.groupsList.length) return;
        const [group] = this.groupsList.splice(from, 1);
        this.groupsList.splice(to, 0, group);
        this.fireGroupsChanged({ kind: "moved", group, index: to });
    }

    /**
     * Глобального MRU-стека нет — он живёт на группе; склейка от активной группы по полосе даёт то,
     * что пикер обещает заголовком: сверху то, где человек только что был.
     */
    public getOpenEditorsMru(): IEditorPane[] {
        const active = this.activeGroupValue;
        const strip = [active, ...this.groupsList.filter((group) => group !== active)];
        return strip.flatMap((group) => group.getMruPanes());
    }

    public revealPane(pane: IEditorPane): void {
        const group = this.groupOf(pane);
        if (group === null) return;
        this.makeGroupActive(group);
        group.activateTab(group.getPanes().indexOf(pane));
    }

    /**
     * VS Code `nextEditor`/`previousEditor`: визуальный порядок всех групп с заворотом. В отличие от
     * Ctrl+Tab hold-сессии нет — каждый шаг сразу коммитится в MRU.
     */
    public cycleEditor(direction: 1 | -1): void {
        const entries: { group: EditorGroup; index: number }[] = [];
        for (const group of this.groupsList) {
            for (let index = 0; index < group.editorCount; index++) entries.push({ group, index });
        }
        if (entries.length < 2) return;

        const active = this.activeGroupValue;
        const current = entries.findIndex((entry) => entry.group === active && entry.index === active.activeIndex);
        const base = current >= 0 ? current + direction : direction === 1 ? 0 : -1;
        const target = entries[((base % entries.length) + entries.length) % entries.length];

        if (target.group === active) {
            active.activateTab(target.index);
            return;
        }
        // Через границу группы: сначала группа, потом вкладка (как moveActiveTabToGroup);
        // серию Ctrl+Tab источника завершаем как при любом уходе из группы.
        active.endMruCycle();
        this.activeGroupValue = target.group;
        target.group.activateTab(target.index);
        this.fireActiveGroupChanged(target.group);
    }

    private mergeGroupInto(source: EditorGroup, target: EditorGroup): void {
        if (source.editorCount === 0) {
            // Пустой сосед: некому схлопнуть его событием — снимаем явно.
            this.collapseGroup(source);
            return;
        }
        // Граница цикла и гард ниже страхуют друг друга: `>= 0` упёрся бы в
        // `null` от пустой группы и вышел тем же break, а при `> 0` гард недостижим.
        // Stryker disable next-line EqualityOperator: эквивалентен — см. выше
        while (source.editorCount > 0) {
            const pane = source.detachPane(0);
            /* v8 ignore start -- editorCount > 0 гарантирует вкладку */
            // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
            if (pane === null) break;
            /* v8 ignore stop */
            if (target.findPaneIndex(pane.uri) >= 0) pane.dispose();
            else target.insertPane(pane);
        }
    }

    private neighborOrNewGroup(direction: "next" | "previous"): EditorGroup | null {
        const existing = this.resolveGroupTarget({ direction });
        // Сосед по направлению активной группой не бывает: второе условие — страховка.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (existing !== null && existing !== this.activeGroupValue) return existing;
        if (this.groupsList.length > 1) return null;
        if (this.canAddGroupHook !== undefined && !this.canAddGroupHook()) {
            this.logger.info("new group refused — not enough space");
            return null;
        }
        const index = direction === "next" ? 1 : 0;
        const group = this.createGroup(index);
        this.fireGroupsChanged({ kind: "added", group, index, source: this.activeGroupValue });
        return group;
    }

    private makeGroupActive(group: EditorGroup): void {
        if (group === this.activeGroupValue) return;
        // Уход фокуса в другую группу завершает серию Ctrl+Tab прежней: выбор фиксируется в MRU.
        this.activeGroupValue.endMruCycle();
        this.activeGroupValue = group;
        // Табы не меняются, но потребители активного редактора (статус-бар, host) обязаны переехать.
        this.fireActivePaneChanged(group.activePane);
        this.fireActiveGroupChanged(group);
    }

    private focusGroupContent(group: EditorGroup): void {
        if (this.focusGroupContentHook !== undefined) this.focusGroupContentHook(group);
        else group.focusEditor();
    }

    /** View (`EditorGroupComponent`) слушает саму группу, потребители активного редактора — сервис. */
    private createGroup(index: number = this.groupsList.length): EditorGroup {
        const group = new EditorGroup(++this.groupIdCounter);
        this.groupsList.splice(index, 0, group);
        const subscriptions: IDisposable[] = [
            group,
            group.onDidChangeEditors(() => {
                this.onDidChangeEditorsEmitter.fire();
            }),
            group.onDidChangeActivePane((pane) => {
                // Смена вкладки неактивной группы активный редактор не трогает (US-13).
                if (group === this.activeGroupValue) this.fireActivePaneChanged(pane);
                // Активной вкладки нет ровно тогда, когда группа пуста: условия взаимозаменяемы.
                // Stryker disable next-line ConditionalExpression,LogicalOperator: эквивалентны — см. выше
                if (pane === null && group.editorCount === 0 && this.groupsList.length > 1) {
                    this.collapseGroup(group);
                }
            }),
            group.onDidChangeMruCycle((state) => {
                this.onDidChangeMruCycleEmitter.fire(state);
            }),
        ];
        this.groupSubscriptions.set(group.id, subscriptions);
        return group;
    }

    /** Последнюю группу не схлопываем — пустая область редактора легальна (US-47). */
    private collapseGroup(group: EditorGroup): void {
        const index = this.groupsList.indexOf(group);
        /* v8 ignore start -- защитный гард: схлопывание зовётся только для группы из полосы */
        // Stryker disable next-line ConditionalExpression: недостижимая ветвь по той же причине
        if (index < 0) return;
        /* v8 ignore stop */
        this.groupsList.splice(index, 1);
        /* v8 ignore start -- подписки заводит createGroup для каждой группы, фолбэк ?? [] недостижим */
        // Stryker disable next-line ArrayDeclaration: недостижимый фолбэк по той же причине
        for (const subscription of this.groupSubscriptions.get(group.id) ?? []) subscription.dispose();
        /* v8 ignore stop */
        // Подписки уже сняты: оставленная запись при выключении снялась бы повторно — no-op.
        // Stryker disable next-line CallExpression: эквивалентен — см. выше
        this.groupSubscriptions.delete(group.id);
        const wasActive = group === this.activeGroupValue;
        this.fireGroupsChanged({ kind: "removed", group, index });
        if (wasActive) {
            const neighbor = this.groupsList[Math.max(0, index - 1)];
            this.activeGroupValue = neighbor;
            this.fireActivePaneChanged(neighbor.activePane);
            this.fireActiveGroupChanged(neighbor);
            this.focusGroupContent(neighbor);
        }
    }

    private fireActivePaneChanged(pane: IEditorPane | null): void {
        this.onDidChangeActivePaneEmitter.fire(pane);
    }

    private fireActiveGroupChanged(group: EditorGroup): void {
        this.onDidActiveGroupChangeEmitter.fire(group);
    }

    private fireGroupsChanged(event: IGroupsChangeEvent): void {
        this.onDidGroupsChangeEmitter.fire(event);
    }
}
