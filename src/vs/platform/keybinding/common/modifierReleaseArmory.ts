import { token } from "../../instantiation/common/diContainer.ts";

export const ModifierReleaseArmoryDIToken = token<ModifierReleaseArmory>("ModifierReleaseArmory");

/**
 * Модификаторы аккорда, которым команда была запущена. Совместимо по структуре с
 * `TUIKeyboardEvent`, так что триггер можно передать в {@link ModifierReleaseArmory.withTrigger}
 * напрямую из события.
 */
export interface CommandTrigger {
    readonly ctrlKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
}

/**
 * «Удерживающий» модификатор аккорда — тот, чьё отпускание завершает серию
 * (Ctrl+Tab → Control, Alt+Tab → Alt). Shift намеренно исключён: в парах
 * `mod+shift+key` он задаёт направление, а не удержание. Возвращает имя клавиши
 * (`event.key`), совпадающее с тем, что приходит в keyup.
 */
export function holdModifierOf(trigger: CommandTrigger): string | undefined {
    if (trigger.ctrlKey) return "Control";
    if (trigger.altKey) return "Alt";
    if (trigger.metaKey) return "Meta";
    return undefined;
}

/**
 * Общий шов для команд типа «удерживай модификатор — циклим, отпустил — коммитим»
 * (MRU-переключение вкладок и т.п.). Команда при запуске «взводит» коммит через
 * {@link armOnHoldRelease}; WorkbenchComponent оборачивает запуск команды в
 * {@link withTrigger} (чтобы взвод знал модификатор аккорда) и на каждый keyup
 * дёргает {@link fireRelease}. Модификатор берётся из триггера, поэтому ребинд
 * (например, на Alt+Tab) не ломает механику.
 *
 * Живёт вне механики биндов: резолвер аккордов знает только «нажали → выполнили»
 * и не отслеживает удержание/отпускание модификатора. Триггер передаётся не
 * позиционным аргументом команды (чтобы не конфликтовать с командами, у которых
 * есть свои аргументы), а как контекст текущего вызова.
 */
export class ModifierReleaseArmory {
    private pending: { modifier: string; commit: () => void; generation: number } | null = null;
    private currentTrigger: CommandTrigger | undefined;
    /** Растёт на каждый взвод — по нему {@link commitStaleAfter} отличает НОВЫЙ взвод от старого. */
    private generationCounter = 0;

    /**
     * Выполняет `run` с активным контекстом триггера — внутри него команда может
     * взвести коммит через {@link armOnHoldRelease}. Вложенные вызовы восстанавливают
     * предыдущий контекст.
     */
    public withTrigger(trigger: CommandTrigger, run: () => void): void {
        const previous = this.currentTrigger;
        this.currentTrigger = trigger;
        try {
            run();
        } finally {
            this.currentTrigger = previous;
        }
    }

    /**
     * Взводит коммит на отпускание удерживающего модификатора текущего вызова.
     * No-op, если команда запущена без модификатора (из меню/палитры или без
     * контекста триггера) — тогда отпускать нечего.
     */
    public armOnHoldRelease(commit: () => void): void {
        const modifier = this.currentTrigger !== undefined ? holdModifierOf(this.currentTrigger) : undefined;
        if (modifier !== undefined) this.arm(modifier, commit);
    }

    /** Взводит коммит, который сработает при отпускании `modifier`. Перезаписывает предыдущий. */
    public arm(modifier: string, commit: () => void): void {
        // Stryker disable next-line UpdateOperator: номер взвода нужен только как «тот же / другой» — направление счёта наблюдаемого эффекта не имеет
        this.pending = { modifier, commit, generation: ++this.generationCounter };
    }

    /** Вызывается на keyup: если отпущенный модификатор совпал со взведённым — коммитит. */
    public fireRelease(modifier: string): void {
        if (this.pending?.modifier !== modifier) return;
        const { commit } = this.pending;
        this.pending = null;
        commit();
    }

    /**
     * Номер текущего взвода (null — ничего не взведено). Снимается ПЕРЕД обработкой
     * нажатия, чтобы потом сравнить с {@link commitStaleAfter}.
     */
    public get pendingGeneration(): number | null {
        return this.pending?.generation ?? null;
    }

    /**
     * Коммитит взвод, который нажатие НЕ продлило (номер не изменился) — запасной
     * путь к концу hold-сессии там, где keyup модификатора не приходит вовсе
     * (legacy-терминал без kitty event types: серия Ctrl+Tab иначе висела бы до
     * следующего обычного переключения, а её видимый список — до него же поверх
     * редактора). Повторный аккорд серии перевзводит сессию и получает новый
     * номер, поэтому сам цикл этим не рвётся.
     */
    public commitStaleAfter(generationBefore: number | null): void {
        // `null` (на момент нажатия ничего не было взведено) отсекается тем же
        // сравнением: номер живого взвода — число и с null никогда не совпадёт.
        if (this.pending === null || this.pending.generation !== generationBefore) return;
        const { commit } = this.pending;
        this.pending = null;
        commit();
    }
}
