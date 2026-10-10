/**
 * Адаптивная пауза перед повторным запросом языковой фичи — перенос
 * `FeatureDebounceInformation` эталона (`languageFeatureDebounce.ts`): среднее
 * по последним шести длительностям ответа, зажатое в `[min, max]`; без истории —
 * общее среднее по документам либо `1.5 × min`.
 *
 * Отличие от эталона — ключ: документ, а не документ плюс набор провайдеров
 * (смена провайдеров здесь редка, а запрос после неё и так уходит сразу).
 */

const WINDOW = 6;
const CACHE_SIZE = 50;

class SlidingWindowAverage {
    private readonly values = new Array<number>(WINDOW).fill(0);
    private index = 0;
    private count = 0;
    private sum = 0;
    public value = 0;

    public update(value: number): number {
        this.sum += value - this.values[this.index];
        this.values[this.index] = value;
        this.index = (this.index + 1) % WINDOW;
        if (this.count < WINDOW) this.count++;
        this.value = this.sum / this.count;
        return this.value;
    }
}

export class FeatureDebounce {
    private readonly cache = new Map<string, SlidingWindowAverage>();

    public constructor(
        private readonly min: number,
        private readonly max: number,
    ) {}

    /** Пауза для документа `key`, мс. */
    public get(key: string): number {
        const avg = this.cache.get(key);
        return avg === undefined ? this.default() : this.clamp(avg.value);
    }

    /** Учесть длительность очередного ответа по документу `key`, мс. */
    public update(key: string, elapsed: number): number {
        let avg = this.cache.get(key);
        if (avg === undefined) {
            avg = new SlidingWindowAverage();
            this.cache.set(key, avg);
            // Stryker disable next-line EqualityOperator: на границе лимита разница в одну запись кэша ненаблюдаема
            if (this.cache.size > CACHE_SIZE) this.evictOldest();
        }
        return this.clamp(avg.update(elapsed));
    }

    /** Map помнит порядок вставки: первый ключ — самый старый документ. */
    private evictOldest(): void {
        for (const key of this.cache.keys()) {
            this.cache.delete(key);
            return;
        }
    }

    private default(): number {
        // Пустой кэш: 0 / 0 = NaN, и срабатывает тот же запасной вариант.
        let total = 0;
        for (const avg of this.cache.values()) total += avg.value;
        return this.clamp(total / this.cache.size || this.min * 1.5);
    }

    private clamp(value: number): number {
        return Math.min(this.max, Math.max(this.min, value));
    }
}
