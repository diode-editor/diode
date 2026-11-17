import { Emitter } from "../../../../base/common/event.ts";
import { type IDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { STATUS_BAR_HIDDEN_STATE } from "../../../common/stateKeys.ts";

/** Counterpart of VS Code `IStatusbarEntry`. */
export interface IStatusBarEntry {
    readonly id: string;
    readonly text: string;
    /** For the visibility menu; an entry without a name (chord hint, progress) is not in the menu and can't be hidden. */
    readonly name?: string;
    readonly alignment: "left" | "right";
    /** Higher priority is further left, on both sides (as in VS Code). */
    readonly priority: number;
    readonly onClick?: () => void;
}

/** Upstream `IStatusbarStyleOverride` without `border`: the status bar is a single row with no border to color. */
export interface IStatusBarStyleOverride {
    /** Lower has higher priority. */
    readonly priority: number;
    /** Theme color ids. */
    readonly foreground?: string;
    readonly background?: string;
}

export interface IStatusBarEntryHandle extends IDisposable {
    update(entry: Partial<Omit<IStatusBarEntry, "id">>): void;
}

export const StatusBarServiceDIToken = token<StatusBarService>("StatusBarService");

/**
 * Counterpart of VS Code `IStatusbarService`. Ids hidden by the user are global
 * ({@link STATUS_BAR_HIDDEN_STATE}) and excluded from {@link entries}.
 */
export class StatusBarService {
    public static dependencies = [StateServiceDIToken] as const;

    private readonly entryList: IStatusBarEntry[] = [];
    private readonly onDidChangeEntriesEmitter = new Emitter<void>();
    private readonly styleOverrides = new Set<IStatusBarStyleOverride>();
    private readonly onDidChangeStyleEmitter = new Emitter<void>();
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

    /** Includes hidden ones: left, then right; within a side by descending priority, ties in insertion order. */
    public allEntries(): readonly IStatusBarEntry[] {
        const byPriority = (a: IStatusBarEntry, b: IStatusBarEntry): number => b.priority - a.priority;
        const left = this.entryList.filter((e) => e.alignment === "left").sort(byPriority);
        const right = this.entryList.filter((e) => e.alignment === "right").sort(byPriority);
        return [...left, ...right];
    }

    /** Upstream `overrideStyle`: the colors of the whole bar (debugging); the override with the lowest priority wins. */
    public overrideStyle(style: IStatusBarStyleOverride): IDisposable {
        this.styleOverrides.add(style);
        this.onDidChangeStyleEmitter.fire();
        return toDisposable(() => {
            this.styleOverrides.delete(style);
            this.onDidChangeStyleEmitter.fire();
        });
    }

    public readonly onDidChangeStyle = this.onDidChangeStyleEmitter.event;

    public styleOverride(): IStatusBarStyleOverride | undefined {
        return [...this.styleOverrides].sort((a, b) => a.priority - b.priority).at(0);
    }

    /** Also for an entry not added yet. */
    public isHidden(id: string): boolean {
        return this.hidden.has(id);
    }

    /** An entry without `name` can't be hidden: it's not in the menu, so nothing could bring it back. */
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
