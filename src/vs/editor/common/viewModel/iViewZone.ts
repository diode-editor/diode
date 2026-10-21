/**
 * Аналог `IViewZone` VS Code, высота в строках. Свойство ВЬЮ: позиции остаются документными,
 * каретка на зоне стоять не может by construction.
 */
export interface IViewZone {
    /** 0-based; `-1` — перед первой строкой (upstream `afterLineNumber: 0` в 1-based). */
    readonly afterLine: number;
    readonly size: number;
}

/** `none` — за концом вью. */
export type ViewLineKind = "doc" | "zone" | "none";
