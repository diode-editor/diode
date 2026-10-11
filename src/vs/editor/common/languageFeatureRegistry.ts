import { Emitter } from "../../base/common/event.ts";
import type { IDisposable } from "../../base/common/lifecycle.ts";
import type { Uri } from "../../base/common/uri.ts";

import { isExclusive, type LanguageSelector, score } from "./languageSelector.ts";

/**
 * Документ, для которого ищутся провайдеры: структурный минимум upstream
 * `ITextModel` (`uri` + `getLanguageId()`), которого реестру хватает для скоринга.
 */
export interface ILanguageFeatureTarget {
    readonly uri: Uri;
    readonly languageId: string;
}

interface Entry<T> {
    readonly selector: LanguageSelector;
    readonly provider: T;
    score: number;
    readonly time: number;
}

/**
 * Реестр провайдеров одной языковой фичи (upstream
 * `vs/editor/common/languageFeatureRegistry.ts`): провайдер регистрируется с
 * селектором документов, потребитель спрашивает «кто подходит этому документу».
 *
 * Порядок {@link ordered}: по убыванию score селектора, при равном — более поздняя
 * регистрация первой. Эксклюзивный селектор, подошедший документу, обнуляет
 * всех остальных. Пересчёт score кэширован по последнему документу.
 *
 * Не перенесены notebook-резолвер, `recursive`, `all` и понижение
 * встроенных провайдеров — у нас нет ни ноутбуков, ни builtin-расширений.
 */
export class LanguageFeatureRegistry<T> {
    private clock = 0;
    private readonly entries: Entry<T>[] = [];
    private readonly onDidChangeEmitter = new Emitter<number>();
    /** Документ, под который сейчас посчитаны `entry.score`; `undefined` — пересчитать. */
    private lastCandidate: { readonly uri: string; readonly languageId: string } | undefined;

    public register(selector: LanguageSelector, provider: T): IDisposable {
        let entry: Entry<T> | undefined = { selector, provider, score: 0, time: this.clock++ };
        this.entries.push(entry);
        this.lastCandidate = undefined;
        this.fireDidChange();

        return {
            dispose: () => {
                if (entry === undefined) return;
                // Запись снимает только свой dispose и только раз (см. `entry` выше),
                // поэтому она всегда на месте.
                this.entries.splice(this.entries.indexOf(entry), 1);
                entry = undefined;
                this.lastCandidate = undefined;
                this.fireDidChange();
            },
        };
    }

    /**
     * Событие «состав провайдеров изменился» — на каждую регистрацию и снятие
     * (а не только на переходе пусто↔непусто). Аргумент — число регистраций.
     */
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public has(target: ILanguageFeatureTarget): boolean {
        return this.ordered(target).length > 0;
    }

    /** Подходящие документу провайдеры: по убыванию score, при равном — новые первыми. */
    public ordered(target: ILanguageFeatureTarget): T[] {
        this.updateScores(target);
        const result: T[] = [];
        for (const entry of this.entries) {
            if (entry.score > 0) result.push(entry.provider);
        }
        return result;
    }

    /**
     * Подходящие провайдеры, сгруппированные по равному score, группы — по
     * убыванию score (upstream `orderedGroups`): семантические токены берут
     * только старшую группу.
     */
    public orderedGroups(target: ILanguageFeatureTarget): T[][] {
        this.updateScores(target);
        const groups: { score: number; providers: T[] }[] = [];
        for (const entry of this.entries) {
            if (entry.score <= 0) continue;
            const last = groups.at(-1);
            if (last?.score === entry.score) last.providers.push(entry.provider);
            else groups.push({ score: entry.score, providers: [entry.provider] });
        }
        return groups.map((group) => group.providers);
    }

    private updateScores(target: ILanguageFeatureTarget): void {
        const uri = target.uri.toString();
        const { languageId } = target;
        if (this.lastCandidate?.uri === uri && this.lastCandidate.languageId === languageId) return;
        this.lastCandidate = { uri, languageId };

        for (const entry of this.entries) {
            entry.score = score(entry.selector, target.uri, languageId);
            if (entry.score > 0 && isExclusive(entry.selector)) {
                // Эксклюзивный селектор перекрывает всех остальных.
                for (const other of this.entries) other.score = 0;
                entry.score = 1000;
                break;
            }
        }

        this.entries.sort(compareByScoreAndTime);
    }

    private fireDidChange(): void {
        this.onDidChangeEmitter.fire(this.entries.length);
    }
}

function compareByScoreAndTime(a: Entry<unknown>, b: Entry<unknown>): number {
    if (a.score !== b.score) return b.score - a.score;
    return b.time - a.time;
}
