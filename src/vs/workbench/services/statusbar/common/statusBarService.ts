import type { IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { STATUS_BAR_HIDDEN_STATE } from "../../../common/stateKeys.ts";

/**
 * Запись статус-бара (аналог VS Code `IStatusbarEntry`). Записи публикуют
 * сервисы-поставщики (contribution'ы) и `WorkbenchComponent` (chord-хинт);
 * сам сервис про содержимое ничего не знает.
 */
export interface IStatusBarEntry {
    /** Стабильный идентификатор записи (VS Code-стиль: `status.editor.encoding`). */
    readonly id: string;
    readonly text: string;
    /**
     * Человекочитаемое имя записи для меню видимости полосы (аналог `name` в
     * `IStatusbarEntry` VS Code). Записи без имени в меню не показываются и
     * скрыть их нельзя — это транзиентные сегменты (chord-хинт, прогресс
     * расширения с динамическим id), которым переключатель не нужен.
     */
    readonly name?: string;
    readonly alignment: "left" | "right";
    /**
     * Порядок внутри своей стороны: чем выше priority, тем левее запись
     * (как в VS Code — и для left-, и для right-выравнивания).
     */
    readonly priority: number;
    /** Колбэк клика; записи без него инертны. */
    readonly onClick?: () => void;
}

/**
 * Ручка добавленной записи: `update()` частично обновляет запись,
 * `dispose()` снимает её со статус-бара. После dispose ручка инертна.
 */
export interface IStatusBarEntryHandle extends IDisposable {
    update(entry: Partial<Omit<IStatusBarEntry, "id">>): void;
}

export const StatusBarServiceDIToken = token<StatusBarService>("StatusBarService");

/**
 * Реестр записей статус-бара (аналог `IStatusbarService` VS Code): поставщики
 * добавляют/обновляют записи, компонент подписывается на `onDidChangeEntries`
 * и перерисовывает их. Сервис не знает ни про контролы, ни про поставщиков.
 *
 * Здесь же живёт видимость записей: скрытые пользователем id хранятся
 * глобально ({@link STATUS_BAR_HIDDEN_STATE}) и не доезжают до {@link entries},
 * которые рисует компонент. Полный список для меню — {@link allEntries}.
 */
export class StatusBarService {
    public static dependencies = [StateServiceDIToken] as const;

    private readonly entryList: IStatusBarEntry[] = [];
    private readonly listeners = new Set<() => void>();
    private readonly hidden: Set<string>;

    public constructor(private readonly stateService: IStateService) {
        this.hidden = new Set(this.stateService.get(STATUS_BAR_HIDDEN_STATE));
    }

    public addEntry(entry: IStatusBarEntry): IStatusBarEntryHandle {
        let current = entry;
        this.entryList.push(current);
        this.fire();
        return {
            update: (patch) => {
                const index = this.entryList.indexOf(current);
                if (index < 0) return; // уже снята — ручка инертна
                current = { ...current, ...patch };
                this.entryList[index] = current;
                this.fire();
            },
            dispose: () => {
                const index = this.entryList.indexOf(current);
                if (index < 0) return; // повторный dispose — no-op
                this.entryList.splice(index, 1);
                this.fire();
            },
        };
    }

    /** Подписка на любое изменение набора записей (add/update/dispose). */
    public onDidChangeEntries(listener: () => void): IDisposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    /**
     * Видимые записи в порядке отрисовки — то, что рисует компонент.
     * Порядок — как у {@link allEntries}, скрытые пользователем отфильтрованы.
     */
    public entries(): readonly IStatusBarEntry[] {
        return this.allEntries().filter((entry) => !this.hidden.has(entry.id));
    }

    /**
     * Все записи в порядке отрисовки, включая скрытые: сперва left, затем right;
     * внутри стороны — по убыванию priority (стабильно — при равенстве порядок
     * добавления). Источник пунктов меню видимости.
     */
    public allEntries(): readonly IStatusBarEntry[] {
        const byPriority = (a: IStatusBarEntry, b: IStatusBarEntry): number => b.priority - a.priority;
        const left = this.entryList.filter((e) => e.alignment === "left").sort(byPriority);
        const right = this.entryList.filter((e) => e.alignment === "right").sort(byPriority);
        return [...left, ...right];
    }

    /** Скрыта ли запись с этим id (в т.ч. ещё не добавленная). */
    public isHidden(id: string): boolean {
        return this.hidden.has(id);
    }

    /**
     * Показывает/скрывает запись — с write-through персиста. Запись без `name`
     * скрыть нельзя: её нет в меню, и вернуть её пользователю было бы нечем.
     */
    public setHidden(id: string, hidden: boolean): void {
        if (this.hidden.has(id) === hidden) return;
        if (hidden && !this.entryList.some((entry) => entry.id === id && entry.name !== undefined)) return;
        if (hidden) {
            this.hidden.add(id);
        } else {
            this.hidden.delete(id);
        }
        this.stateService.store(STATUS_BAR_HIDDEN_STATE, [...this.hidden]);
        this.fire();
    }

    private fire(): void {
        for (const listener of [...this.listeners]) listener();
    }
}
