/** Higher weight wins among entries of one chord with passing `when`; overriding a core command needs a weight above `EditorCore`. */
export const KeybindingWeight = {
    EditorCore: 0,
    EditorContrib: 100,
    WorkbenchContrib: 200,
} as const;

/** User beats extension, extension beats defaults, regardless of weight and layer registration order. */
export const KeybindingLayerRank = {
    default: 0,
    extension: 1,
    user: 2,
} as const;

export interface IKeybindingPriority {
    readonly layer: number;
    readonly weight: number;
    /** Tie-breaker at equal weight: a later registered rule is stronger. */
    readonly seq: number;
}

/** Layer, then weight, then rule sequence number. */
export function compareKeybindingPriority(a: IKeybindingPriority, b: IKeybindingPriority): number {
    return a.layer - b.layer || a.weight - b.weight || a.seq - b.seq;
}

/** The last is the strongest: the resolver reads from the end. */
export function sortByPriority<T extends IKeybindingPriority>(entries: readonly T[]): T[] {
    return [...entries].sort(compareKeybindingPriority);
}
