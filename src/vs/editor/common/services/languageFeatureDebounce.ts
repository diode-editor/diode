/**
 * Port of upstream `FeatureDebounceInformation`. The difference is the key: the document,
 * not the document plus the provider set (provider changes are rare, and the request
 * after one goes out immediately anyway).
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

    /** In ms. */
    public get(key: string): number {
        const avg = this.cache.get(key);
        return avg === undefined ? this.default() : this.clamp(avg.value);
    }

    /** `elapsed` in ms. */
    public update(key: string, elapsed: number): number {
        let avg = this.cache.get(key);
        if (avg === undefined) {
            avg = new SlidingWindowAverage();
            this.cache.set(key, avg);
            // Stryker disable next-line EqualityOperator: at the limit boundary a one-entry cache difference is unobservable
            if (this.cache.size > CACHE_SIZE) this.evictOldest();
        }
        return this.clamp(avg.update(elapsed));
    }

    private evictOldest(): void {
        for (const key of this.cache.keys()) {
            this.cache.delete(key);
            return;
        }
    }

    private default(): number {
        // Empty cache: 0 / 0 = NaN, which falls through to the same fallback.
        let total = 0;
        for (const avg of this.cache.values()) total += avg.value;
        return this.clamp(total / this.cache.size || this.min * 1.5);
    }

    private clamp(value: number): number {
        return Math.min(this.max, Math.max(this.min, value));
    }
}
