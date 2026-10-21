import { Emitter } from "../../base/common/event.ts";
import type { IDisposable } from "../../base/common/lifecycle.ts";
import type { Uri } from "../../base/common/uri.ts";

import { isExclusive, type LanguageSelector, score } from "./languageSelector.ts";

/** Structural minimum of upstream `ITextModel` needed for scoring. */
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
 * Upstream `languageFeatureRegistry.ts` without the notebook resolver, `recursive`, `all`
 * and builtin provider demotion: there are neither notebooks nor builtin extensions.
 */
export class LanguageFeatureRegistry<T> {
    private clock = 0;
    private readonly entries: Entry<T>[] = [];
    private readonly onDidChangeEmitter = new Emitter<number>();
    /** Document the `entry.score` values were computed for; `undefined` means recompute. */
    private lastCandidate: { readonly uri: string; readonly languageId: string } | undefined;

    public register(selector: LanguageSelector, provider: T): IDisposable {
        let entry: Entry<T> | undefined = { selector, provider, score: 0, time: this.clock++ };
        this.entries.push(entry);
        this.lastCandidate = undefined;
        this.fireDidChange();

        return {
            dispose: () => {
                if (entry === undefined) return;
                // Only its own dispose removes the entry, and only once, so it is always present.
                this.entries.splice(this.entries.indexOf(entry), 1);
                entry = undefined;
                this.lastCandidate = undefined;
                this.fireDidChange();
            },
        };
    }

    /** Fires on every register and dispose, not only on empty↔non-empty; the argument is the registration count. */
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public has(target: ILanguageFeatureTarget): boolean {
        return this.ordered(target).length > 0;
    }

    /** By descending score; on ties, newest first. */
    public ordered(target: ILanguageFeatureTarget): T[] {
        this.updateScores(target);
        const result: T[] = [];
        for (const entry of this.entries) {
            if (entry.score > 0) result.push(entry.provider);
        }
        return result;
    }

    /** Upstream `orderedGroups`: groups of equal score, in descending order. */
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
