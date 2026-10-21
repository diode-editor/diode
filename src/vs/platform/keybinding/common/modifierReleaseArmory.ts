import { token } from "../../instantiation/common/diContainer.ts";

export const ModifierReleaseArmoryDIToken = token<ModifierReleaseArmory>("ModifierReleaseArmory");

export interface CommandTrigger {
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
}

/** Модификатор, чьё отпускание завершает серию. Shift исключён: в `mod+shift+key` он задаёт направление. */
export function holdModifierOf(trigger: CommandTrigger): string | undefined {
    if (trigger.ctrlKey) return "Control";
    if (trigger.altKey) return "Alt";
    if (trigger.metaKey) return "Meta";
    return undefined;
}

/**
 * «Удерживай модификатор — циклим, отпустил — коммитим» (MRU вкладок). Резолвер аккордов
 * удержания не видит, поэтому механика отдельно. Модификатор берётся из триггера — ребинд на
 * Alt+Tab её не ломает; триггер — контекст вызова, а не аргумент, чтобы не спорить с
 * аргументами команд.
 */
export class ModifierReleaseArmory {
    private pending: { modifier: string; commit: () => void; generation: number } | null = null;
    private currentTrigger: CommandTrigger | undefined;
    /** Растёт на каждый взвод — по нему {@link commitStaleAfter} отличает НОВЫЙ взвод от старого. */
    private generationCounter = 0;

    /** Вложенные вызовы восстанавливают предыдущий контекст. */
    public withTrigger(trigger: CommandTrigger, run: () => void): void {
        const previous = this.currentTrigger;
        this.currentTrigger = trigger;
        try {
            run();
        } finally {
            this.currentTrigger = previous;
        }
    }

    /** No-op без удерживающего модификатора (меню, палитра) — отпускать нечего. */
    public armOnHoldRelease(commit: () => void): void {
        const modifier = this.currentTrigger !== undefined ? holdModifierOf(this.currentTrigger) : undefined;
        if (modifier !== undefined) this.arm(modifier, commit);
    }

    /** Перезаписывает предыдущий взвод. */
    public arm(modifier: string, commit: () => void): void {
        // Stryker disable next-line UpdateOperator: номер взвода нужен только как «тот же / другой» — направление счёта наблюдаемого эффекта не имеет
        this.pending = { modifier, commit, generation: ++this.generationCounter };
    }

    public fireRelease(modifier: string): void {
        if (this.pending?.modifier !== modifier) return;
        const { commit } = this.pending;
        this.pending = null;
        commit();
    }

    /** Снимается ПЕРЕД обработкой нажатия, чтобы потом сравнить в {@link commitStaleAfter}. */
    public get pendingGeneration(): number | null {
        return this.pending?.generation ?? null;
    }

    /**
     * Запасной конец hold-сессии, где keyup модификатора не приходит (legacy-терминал без kitty
     * event types): коммитит взвод, который нажатие не продлило. Повторный аккорд серии
     * перевзводит сессию, поэтому цикл этим не рвётся.
     */
    public commitStaleAfter(generationBefore: number | null): void {
        // `null` (на момент нажатия ничего не было взведено) отсекается тем же
        // сравнением: номер живого взвода — число и с null никогда не совпадёт.
        if (this.pending?.generation !== generationBefore) return;
        const { commit } = this.pending;
        this.pending = null;
        commit();
    }
}
