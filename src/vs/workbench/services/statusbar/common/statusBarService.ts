import type { IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/**
 * Запись статус-бара (аналог VS Code `IStatusbarEntry`). Записи публикуют
 * сервисы-поставщики (contribution'ы) и `WorkbenchComponent` (chord-хинт);
 * сам сервис про содержимое ничего не знает.
 */
export interface IStatusBarEntry {
    /** Стабильный идентификатор записи (VS Code-стиль: `status.editor.encoding`). */
    readonly id: string;
    readonly text: string;
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
 */
export class StatusBarService {
    private readonly entryList: IStatusBarEntry[] = [];
    private readonly listeners = new Set<() => void>();

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
     * Все записи в порядке отрисовки: сперва left, затем right; внутри стороны —
     * по убыванию priority (стабильно — при равенстве порядок добавления).
     */
    public entries(): readonly IStatusBarEntry[] {
        const byPriority = (a: IStatusBarEntry, b: IStatusBarEntry): number => b.priority - a.priority;
        const left = this.entryList.filter((e) => e.alignment === "left").sort(byPriority);
        const right = this.entryList.filter((e) => e.alignment === "right").sort(byPriority);
        return [...left, ...right];
    }

    private fire(): void {
        for (const listener of [...this.listeners]) listener();
    }
}
