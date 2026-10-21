import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { STATUS_BAR_HIDDEN_STATE } from "../../../common/stateKeys.ts";

/** Аналог VS Code `IStatusbarEntry`. */
export interface IStatusBarEntry {
    readonly id: string;
    readonly text: string;
    /** Для меню видимости; запись без имени (chord-хинт, прогресс) в меню нет и скрыть её нельзя. */
    readonly name?: string;
    readonly alignment: "left" | "right";
    /** Выше priority — левее, для обеих сторон (как в VS Code). */
    readonly priority: number;
    readonly onClick?: () => void;
}

export interface IStatusBarEntryHandle extends IDisposable {
    update(entry: Partial<Omit<IStatusBarEntry, "id">>): void;
}

export const StatusBarServiceDIToken = token<StatusBarService>("StatusBarService");

/**
 * Аналог VS Code `IStatusbarService`. Скрытые пользователем id глобальны
 * ({@link STATUS_BAR_HIDDEN_STATE}) и в {@link entries} не попадают.
 */
export class StatusBarService {
    public static dependencies = [StateServiceDIToken] as const;

    private readonly entryList: IStatusBarEntry[] = [];
    private readonly onDidChangeEntriesEmitter = new Emitter<void>();
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
                if (index < 0) return;
                current = { ...current, ...patch };
                this.entryList[index] = current;
                this.fire();
            },
            dispose: () => {
                const index = this.entryList.indexOf(current);
                if (index < 0) return;
                this.entryList.splice(index, 1);
                this.fire();
            },
        };
    }

    public readonly onDidChangeEntries = this.onDidChangeEntriesEmitter.event;

    public entries(): readonly IStatusBarEntry[] {
        return this.allEntries().filter((entry) => !this.hidden.has(entry.id));
    }

    /** Включая скрытые: left, затем right; внутри — по убыванию priority, при равенстве — порядок добавления. */
    public allEntries(): readonly IStatusBarEntry[] {
        const byPriority = (a: IStatusBarEntry, b: IStatusBarEntry): number => b.priority - a.priority;
        const left = this.entryList.filter((e) => e.alignment === "left").sort(byPriority);
        const right = this.entryList.filter((e) => e.alignment === "right").sort(byPriority);
        return [...left, ...right];
    }

    /** И для ещё не добавленной записи. */
    public isHidden(id: string): boolean {
        return this.hidden.has(id);
    }

    /** Запись без `name` скрыть нельзя: её нет в меню, и вернуть её было бы нечем. */
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
        this.onDidChangeEntriesEmitter.fire();
    }
}
