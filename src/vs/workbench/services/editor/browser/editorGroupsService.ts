import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ILogService } from "../../../../platform/log/common/iLogService.ts";
import { ILogServiceDIToken } from "../../../../platform/log/common/iLogServiceDIToken.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IEditorGroupsService, IGroupsChangeEvent } from "../common/editorGroupsService.ts";

import { EditorGroup, type GroupId, type MruCycleState } from "./editorGroupModel.ts";

/**
 * Полоса групп редакторов — аналог upstream `IEditorGroupsService`, но
 * headless (у upstream его реализует view-часть `EditorPart`): список групп в
 * порядке ViewColumn, активная группа, сплиты, фокус, перенос и слияние
 * вкладок между группами, схлопывание опустевших. Вкладочные операции живут на
 * самой группе ({@link EditorGroup}).
 *
 * Вкладок сам не создаёт: дубль вкладки (сплит, копия в соседнюю группу)
 * открывает `EditorService` по рецепту — сюда он приходит колбэком «наполни
 * группу» ({@link splitActiveGroup}, {@link openInNeighborGroup}).
 *
 * Порядок событий — контракт: {@link onDidChangeEditors} → фокус →
 * {@link onDidChangeActivePane} → {@link onDidActiveGroupChange}.
 */
export class EditorGroupsService extends Disposable implements IEditorGroupsService {
    public static dependencies = [ILogServiceDIToken] as const;

    /** Полоса групп в порядке ViewColumn − 1; без сплитов — ровно одна. */
    private groupsList: EditorGroup[] = [];
    private activeGroupValue: EditorGroup;
    /** Монотонный счётчик стабильных id групп (не переиспользуется). */
    private groupIdCounter = 0;
    /**
     * Подписки сервиса на события каждой группы — снимаются при схлопывании
     * группы и при выключении сервиса.
     */
    private readonly groupSubscriptions = new Map<GroupId, IDisposable[]>();
    private readonly logger: ILogger;

    private readonly onDidActiveGroupChangeEmitter = new Emitter<EditorGroup>();
    private readonly onDidGroupsChangeEmitter = new Emitter<IGroupsChangeEvent>();
    private readonly onDidChangeMruCycleEmitter = new Emitter<MruCycleState | null>();
    private readonly onDidChangeEditorsEmitter = new Emitter<void>();
    private readonly onDidChangeActivePaneEmitter = new Emitter<IEditorPane | null>();

    /**
     * Хук view-слоя «влезет ли ещё одна группа» (`EditorPartComponent`
     * спрашивает свой `EditorPartElement.canFit`). Не задан (headless-тесты) —
     * место не проверяется.
     */
    public canAddGroupHook?: () => boolean;

    /**
     * Хук view-слоя «сфокусируй содержимое группы»: активную вкладку либо filler
     * пустой группы — сервису filler недоступен. Не задан — фокус в активную
     * вкладку напрямую.
     */
    public focusGroupContentHook?: (group: EditorGroup) => void;

    /** Смена активной группы (сплит, фокус-команды, клик мышью в другую группу). */
    public readonly onDidActiveGroupChange = this.onDidActiveGroupChangeEmitter.event;

    /**
     * Жизнь серии Ctrl+Tab любой группы полосы (практически — активной: цикл
     * запускают команды по активной группе): снимок замороженного MRU-списка с
     * позицией цикла на каждом шаге и `null`, когда серия кончилась. Подписчик —
     * оверлей переключателя вкладок (`TabSwitcherComponent`).
     */
    public readonly onDidChangeMruCycle = this.onDidChangeMruCycleEmitter.event;

    /** Структурное изменение полосы: группа добавлена/удалена/переставлена. */
    public readonly onDidGroupsChange = this.onDidGroupsChangeEmitter.event;

    /** Агрегат `onDidChangeEditors` всех групп: вкладки, метки, активная вкладка. */
    public readonly onDidChangeEditors = this.onDidChangeEditorsEmitter.event;

    /**
     * Активная вкладка полосы сменилась: другая вкладка активной группы либо
     * другая активная группа. Любого вида — сужение до текста делает
     * `EditorService`.
     */
    public readonly onDidChangeActivePane = this.onDidChangeActivePaneEmitter.event;

    public constructor(logService: ILogService) {
        super();
        // Stryker disable next-line StringLiteral,ObjectLiteral: имя канала и его метка — подпись в селекторе Output, поведения логирования не задают
        this.logger = logService.createLogger("workbench.editorGroups", { label: "Editor Groups" });
        // Полоса групп начинается с единственной — она же активная.
        this.activeGroupValue = this.createGroup();
        // Владение оставшимися группами: схлопнутые чистятся по ходу, остальные —
        // при выключении сервиса.
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

    /** Полоса групп в порядке ViewColumn − 1. */
    public get groups(): readonly EditorGroup[] {
        return this.groupsList;
    }

    /** Активная группа — та, куда открываются ресурсы и по которой работают команды вкладок. */
    public get activeGroup(): EditorGroup {
        return this.activeGroupValue;
    }

    /** Группа, содержащая вкладку, либо `null` (detached-панели групп не имеют). */
    public groupOf(pane: IEditorPane): EditorGroup | null {
        for (const group of this.groupsList) {
            if (group.getPanes().includes(pane)) return group;
        }
        return null;
    }

    /** Номер колонки группы (1..N) — производный от позиции в полосе. */
    public viewColumnOf(group: EditorGroup): number {
        return this.groupsList.indexOf(group) + 1;
    }

    /**
     * Сплит: новая группа рядом с активной, наполняемая колбэком `fill`
     * (`EditorService` открывает в ней дубль активной вкладки по рецепту) —
     * VS Code `workbench.action.splitEditor`. Отказ: пустая активная группа
     * либо не хватает места ({@link canAddGroupHook}; молча, с записью в лог —
     * решение постановки №3). Возвращает новую группу либо `null` при отказе.
     *
     * Новая группа становится активной ДО наполнения: открытая в ней вкладка
     * сразу считается активным редактором воркбенча. Осталась пустой (вкладку
     * повторить нельзя) — активного редактора нет, фокус в её filler.
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

    /**
     * Пустая группа рядом с активной (`workbench.action.newGroup*`). Отказ по
     * месту — как у {@link splitActiveGroup}.
     */
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

    /**
     * Фокус группы: по стабильному id, позиции в полосе, соседству или циклом.
     * Делает группу активной и передаёт фокус её содержимому (активной вкладке
     * либо filler'у пустой группы). За краем полосы — no-op (US-10).
     */
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

    /**
     * Мышь/фокус сделали группу активной (capture-listener на поддереве группы —
     * ставит `EditorPartComponent`). Фокус уже там, куда кликнули, — только
     * события; группа уже активна — no-op.
     */
    public notifyGroupFocused(group: EditorGroup): void {
        // Тот же гард стоит в makeGroupActive: ранний выход лишь экономит вызов.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (group === this.activeGroupValue) return;
        this.makeGroupActive(group);
    }

    /**
     * Переносит активную вкладку в соседнюю группу; у единственной группы
     * создаёт соседку и переносит (US-50). Фокус едет со вкладкой; опустевшая
     * группа-источник схлопывается сама. Ресурс уже открыт в целевой группе —
     * переносимая вкладка сливается с существующей (пер-группный дедуп).
     */
    public moveActiveEditorToGroup(direction: "next" | "previous", { focus = true }: { focus?: boolean } = {}): void {
        const source = this.activeGroupValue;
        const index = source.activeIndex;
        if (source.activePane === null) return;
        const target = this.neighborOrNewGroup(direction);
        if (target === null) return;

        // detachPane может схлопнуть опустевший источник (collapse внутри) —
        // целевая группа взята по ссылке заранее и переживает перестройку полосы.
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

    /**
     * Соседняя группа по направлению (у единственной — новая, с проверкой
     * места) становится активной и наполняется колбэком `fill` — копия
     * активной вкладки по рецепту (US-17). Соседа нет и создать нельзя — no-op.
     */
    public openInNeighborGroup(direction: "next" | "previous", fill: (group: EditorGroup) => void): void {
        const target = this.neighborOrNewGroup(direction);
        if (target === null) return;
        this.openInGroup(target, () => {
            fill(target);
        });
    }

    /**
     * Открытие в группу: она становится активной ДО наполнения `fill` — так
     * открытая вкладка сразу считается активным редактором воркбенча, — а
     * {@link onDidActiveGroupChange} уходит после, если группа сменилась.
     * Серию Ctrl+Tab прежней группы не завершает: это не уход фокуса, а
     * открытие.
     */
    public openInGroup(group: EditorGroup, fill: () => void): void {
        const wasActive = group === this.activeGroupValue;
        this.activeGroupValue = group;
        fill();
        if (!wasActive) this.fireActiveGroupChanged(group);
    }

    /**
     * Группа справа от активной для «Open to the Side»; нет — создаётся (нет
     * места — фолбэк в активную). Активной не становится: это решает открытие.
     */
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

    /**
     * Вливает СЛЕДУЮЩУЮ группу в активную (VS Code `joinTwoGroups`): вкладки
     * переезжают в конец, дубликаты ресурса схлопываются (решение постановки
     * №5), опустевший сосед схлопывается сам. У края полосы — no-op.
     */
    public joinTwoGroups(): void {
        const target = this.activeGroupValue;
        const source = this.resolveGroupTarget({ direction: "next" });
        // Сосед по направлению активной группой не бывает: второе условие — страховка.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (source === null || source === target) return;
        this.mergeGroupInto(source, target);
    }

    /** Сливает все группы в первую; активная вкладка бывшей активной группы выживает (US-21). */
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

    /** Переставляет активную группу по полосе (US-18); у края — no-op. */
    public moveActiveGroup(direction: "next" | "previous"): void {
        const from = this.groupsList.indexOf(this.activeGroupValue);
        const to = direction === "next" ? from + 1 : from - 1;
        if (to < 0 || to >= this.groupsList.length) return;
        const [group] = this.groupsList.splice(from, 1);
        this.groupsList.splice(to, 0, group);
        this.fireGroupsChanged({ kind: "moved", group, index: to });
    }

    /**
     * Вкладки ВСЕХ групп для пикера открытых редакторов: активная группа первой
     * (её активная вкладка — во главе списка), за ней остальные в порядке
     * полосы; внутри группы — MRU-порядок ({@link EditorGroup.getMruPanes}).
     * Глобального MRU-стека у нас нет — он живёт на группе, — и склейка по
     * полосе от активной группы даёт ровно то, что пикер обещает заголовком:
     * сверху то, где пользователь только что был.
     */
    public getOpenEditorsMru(): IEditorPane[] {
        const active = this.activeGroupValue;
        const strip = [active, ...this.groupsList.filter((group) => group !== active)];
        return strip.flatMap((group) => group.getMruPanes());
    }

    /**
     * Показывает уже открытую вкладку: делает её группу активной и активирует
     * саму вкладку с фокусом (пикер открытых редакторов). Панель не из полосы
     * (detached-редактор, уже закрытая вкладка) — no-op.
     */
    public revealPane(pane: IEditorPane): void {
        const group = this.groupOf(pane);
        if (group === null) return;
        this.makeGroupActive(group);
        group.activateTab(group.getPanes().indexOf(pane));
    }

    /**
     * Шаг по вкладкам в ВИЗУАЛЬНОМ порядке (VS Code `nextEditor` /
     * `previousEditor`, Ctrl+PgDn/PgUp): вкладки всех групп слева направо, с
     * заворотом на краях полосы. В отличие от MRU-цикла Ctrl+Tab здесь нет
     * hold-сессии — каждый шаг сразу коммитится (обычный `activateTab` сам
     * двигает цель в начало MRU). У пустой активной группы «вперёд» начинает с
     * первой вкладки полосы, «назад» — с последней.
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
        // Переход через границу группы: цель становится активной группой (тот же
        // порядок, что у moveActiveTabToGroup — сначала группа, потом вкладка).
        // Идущую серию Ctrl+Tab источника завершаем как при любом уходе из группы.
        active.endMruCycle();
        this.activeGroupValue = target.group;
        target.group.activateTab(target.index);
        this.fireActiveGroupChanged(target.group);
    }

    /** Переливает вкладки source в target (дедуп по ресурсу) до схлопывания source. */
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

    /**
     * Сосед активной группы по направлению; у единственной группы создаёт его
     * (с проверкой места), у края многогрупповой полосы — `null`.
     */
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

    /** Смена активной группы + события (без передачи фокуса). */
    private makeGroupActive(group: EditorGroup): void {
        if (group === this.activeGroupValue) return;
        // Уход фокуса в другую группу завершает идущую серию Ctrl+Tab прежней:
        // выбранная в серии вкладка фиксируется в MRU, оверлей переключателя
        // получает `null` и гаснет.
        this.activeGroupValue.endMruCycle();
        this.activeGroupValue = group;
        // Табы/контент групп не меняются, но потребители «активного редактора
        // воркбенча» обязаны переехать: статус-бар, host, autoReveal.
        this.fireActivePaneChanged(group.activePane);
        this.fireActiveGroupChanged(group);
    }

    /** Фокус содержимого группы: через view-хук (умеет filler), иначе — вкладка. */
    private focusGroupContent(group: EditorGroup): void {
        if (this.focusGroupContentHook !== undefined) this.focusGroupContentHook(group);
        else group.focusEditor();
    }

    /**
     * Создаёт группу на позиции `index`, включает в полосу и переподнимает её
     * события на сервисные: view-слой (`EditorGroupComponent`) слушает саму
     * группу, а потребители «активного редактора» — сервис. Группа, оставшаяся
     * без вкладок, схлопывается (кроме последней — US-47).
     */
    private createGroup(index: number = this.groupsList.length): EditorGroup {
        const group = new EditorGroup(++this.groupIdCounter);
        this.groupsList.splice(index, 0, group);
        const subscriptions: IDisposable[] = [
            group,
            group.onDidChangeEditors(() => {
                this.onDidChangeEditorsEmitter.fire();
            }),
            group.onDidChangeActivePane((pane) => {
                // Смена вкладки неактивной группы не трогает активный редактор
                // воркбенча (US-13: MRU и активность — пер-группные).
                if (group === this.activeGroupValue) this.fireActivePaneChanged(pane);
                // Активной вкладки нет ровно тогда, когда группа пуста: условия
                // на `pane` и на `editorCount` взаимозаменяемы.
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

    /**
     * Схлопывает опустевшую группу: полоса сжимается, соседка получает фокус,
     * если схлопнулась активная. Последнюю группу не схлопываем — пустая область
     * редактора легальна (US-47).
     */
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
