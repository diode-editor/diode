/** Больший вес побеждает среди записей одной комбинации с проходящими `when`; перебить базовую команду на той же клавише — вес выше `EditorCore`. */
export const KeybindingWeight = {
    EditorCore: 0,
    EditorContrib: 100,
    WorkbenchContrib: 200,
} as const;

/** User сильнее extension, extension — дефолтов, независимо от веса и порядка регистрации слоя. */
export const KeybindingLayerRank = {
    default: 0,
    extension: 1,
    user: 2,
} as const;

export interface IKeybindingPriority {
    readonly layer: number;
    readonly weight: number;
    /** Тайбрейк при равном весе: позже зарегистрированное правило сильнее. */
    readonly seq: number;
}

/** Слой, потом вес, потом номер правила. */
export function compareKeybindingPriority(a: IKeybindingPriority, b: IKeybindingPriority): number {
    return a.layer - b.layer || a.weight - b.weight || a.seq - b.seq;
}

/** Последняя — самая сильная: резолвер читает с конца. */
export function sortByPriority<T extends IKeybindingPriority>(entries: readonly T[]): T[] {
    return [...entries].sort(compareKeybindingPriority);
}
