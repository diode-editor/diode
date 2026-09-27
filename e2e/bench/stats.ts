/**
 * Статистика прогонов бенча: медиана, квартили, IQR и флаг шума.
 * Отдельный модуль — чтобы отчёт (`benchOpen.ts`) и перф-гейт
 * (`startupBudget.bench.ts`) считали цифры одним и тем же способом.
 */

export function quantile(values: readonly number[], q: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    const idx = (sorted.length - 1) * q;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(values: readonly number[]): number {
    return quantile(values, 0.5);
}

export interface Stats {
    readonly median: number;
    readonly q1: number;
    readonly q3: number;
    /** Межквартильный размах — мера шума прогонов. */
    readonly iqr: number;
    readonly min: number;
    readonly max: number;
    readonly count: number;
    /** IQR > {@link NOISY_IQR_RATIO} медианы — цифру нельзя читать как точную. */
    readonly noisy: boolean;
}

/** Порог шума: IQR больше пятой части медианы — прогон помечается «шумным». */
export const NOISY_IQR_RATIO = 0.2;

export function stats(values: readonly number[]): Stats | null {
    if (values.length === 0) return null;
    const med = median(values);
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const iqr = q3 - q1;
    return {
        median: med,
        q1,
        q3,
        iqr,
        min: Math.min(...values),
        max: Math.max(...values),
        count: values.length,
        noisy: med > 0 && iqr > NOISY_IQR_RATIO * med,
    };
}

/** Статистика по значениям, где null (не измерено) выброшен; null — если измерять было нечего. */
export function statsOf(values: readonly (number | null | undefined)[]): Stats | null {
    return stats(values.filter((v): v is number => typeof v === "number"));
}
