import { Point, Rect, Size } from "../common/geometryPromitives.ts";

/** Сливает пересекающиеся rect'ы на месте до неподвижной точки. */
function mergeIntersecting(out: Rect[]): void {
    let merged = true;
    while (merged) {
        merged = false;
        outer: for (let i = 0; i < out.length; i++) {
            for (let j = i + 1; j < out.length; j++) {
                if (out[i].intersects(out[j])) {
                    out[i] = out[i].union(out[j]);
                    out.splice(j, 1);
                    merged = true;
                    break outer;
                }
            }
        }
    }
}

/**
 * Кап списка damage-областей кадра. Больше — слишком дробный кадр (оверхед
 * прохода на каждый rect), меньше — слияния накрывают чистые виджеты между
 * повреждёнными. 8 хватает на типичный кадр воркбенча: виджет + статусбар +
 * пара лейблов.
 */
export const MAX_DAMAGE_RECTS = 8;

/**
 * Накопитель повреждённых областей кадра (в экранных координатах).
 *
 * `add` поглощает вложенные rect'ы (damage-обход идёт pre-order, родитель
 * раньше детей — вложенные добавления схлопываются дёшево). `finalize` даёт
 * итоговые области прохода отрисовки: дилатация ±1 колонка (запись wide-char
 * ячейки мутирует соседа в Grid.updateCell — голова/продолжение), клип к
 * экрану, слияние пересекающихся, кап {@link MAX_DAMAGE_RECTS} слиянием пары
 * с минимальным приростом площади.
 *
 * Инвариант потребителя (renderFrame): множество очищаемых ячеек обязано
 * совпадать с множеством, по которому идёт прунинг прохода, — поэтому и
 * очистка, и клип каждого прохода берут ровно rect'ы из finalize().
 */
export class DamageList {
    private rects: Rect[] = [];

    public add(rect: Rect): void {
        if (rect.isEmpty) return;
        for (let i = 0; i < this.rects.length; i++) {
            const existing = this.rects[i];
            if (existing.containsRect(rect)) return;
            if (rect.containsRect(existing)) {
                this.rects[i] = rect;
                return;
            }
        }
        this.rects.push(rect);
    }

    public get isEmpty(): boolean {
        return this.rects.length === 0;
    }

    /** Сырые накопленные rect'ы (до дилатации/слияния) — для тестов и инспектора. */
    public snapshot(): readonly Rect[] {
        return this.rects;
    }

    public finalize(screenBounds: Rect): Rect[] {
        let out: Rect[] = [];
        for (const rect of this.rects) {
            const dilated = new Rect(
                new Point(rect.x - 1, rect.y),
                new Size(rect.width + 2, rect.height),
            ).intersect(screenBounds);
            if (!dilated.isEmpty) out.push(dilated);
        }

        mergeIntersecting(out);

        while (out.length > MAX_DAMAGE_RECTS) {
            // Слить пару с минимальным приростом площади объединения.
            let bestI = 0;
            let bestJ = 1;
            let bestGrowth = Infinity;
            for (let i = 0; i < out.length; i++) {
                for (let j = i + 1; j < out.length; j++) {
                    const union = out[i].union(out[j]);
                    const growth =
                        union.width * union.height -
                        out[i].width * out[i].height -
                        out[j].width * out[j].height;
                    if (growth < bestGrowth) {
                        bestGrowth = growth;
                        bestI = i;
                        bestJ = j;
                    }
                }
            }
            out[bestI] = out[bestI].union(out[bestJ]);
            out.splice(bestJ, 1);
            // Объединение могло пересечься с остальными.
            mergeIntersecting(out);
        }
        return out;
    }
}
