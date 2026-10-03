/**
 * Вес правила кейбинда (имена — как у upstream `KeybindingWeight`). Между
 * записями одной комбинации, чьи `when` проходят разом, побеждает больший вес.
 * Дефолт — `EditorCore`; фичи, которым нужно перебить базовую команду на той
 * же клавише (Escape у попапа против Escape у редактора), берут вес выше.
 */
export const KeybindingWeight = {
    EditorCore: 0,
    EditorContrib: 100,
    WorkbenchContrib: 200,
} as const;

/**
 * Ранг слоя, из которого пришла запись: user сильнее extension, extension
 * сильнее дефолтов — независимо от веса и от того, когда слой зарегистрирован
 * (как у upstream: резолвер склеивает дефолты и расширения, а user-правила
 * кладёт поверх).
 */
export const KeybindingLayerRank = {
    default: 0,
    extension: 1,
    user: 2,
} as const;

/** Что резолверу нужно знать о записи, чтобы упорядочить её. */
export interface IKeybindingPriority {
    /** {@link KeybindingLayerRank} слоя записи. */
    readonly layer: number;
    readonly weight: number;
    /**
     * Порядковый номер правила (вызова регистрации): стабильный тайбрейк при
     * равном весе — позже зарегистрированное правило сильнее.
     */
    readonly seq: number;
}

/** Сравнение по приоритету: отрицательное — `a` слабее `b`. Слой, потом вес, потом номер правила. */
export function compareKeybindingPriority(a: IKeybindingPriority, b: IKeybindingPriority): number {
    return a.layer - b.layer || a.weight - b.weight || a.seq - b.seq;
}

/**
 * Записи по возрастанию приоритета: последняя — самая сильная (так их читает
 * резолвер — с конца). Сортировка устойчивая, исходный массив не меняется.
 */
export function sortByPriority<T extends IKeybindingPriority>(entries: readonly T[]): T[] {
    return [...entries].sort(compareKeybindingPriority);
}
