import { Emitter, type Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { type LanguageSelector, score } from "../../../../editor/common/languageSelector.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Upstream `Severity` as `vscode.LanguageStatusSeverity` sends it: 0 Information, 1 Warning, 2 Error. */
export type LanguageStatusSeverity = 0 | 1 | 2;

export interface ILanguageStatusCommand {
    readonly id: string;
    readonly title: string;
    readonly arguments: readonly unknown[];
}

/** Upstream `ILanguageStatus` without `accessibilityInfo`. */
export interface ILanguageStatus {
    readonly id: string;
    readonly name: string | undefined;
    readonly selector: LanguageSelector;
    readonly severity: LanguageStatusSeverity;
    /** With `$(name)` icon markup. */
    readonly label: string;
    readonly detail: string;
    readonly busy: boolean;
    /** The owning extension: the second sort key after severity. */
    readonly source: string;
    readonly command: ILanguageStatusCommand | undefined;
}

export const LanguageStatusServiceDIToken =
    // Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
    token<LanguageStatusService>("LanguageStatusService");

/** Upstream `LanguageStatusServiceImpl`: the items of every extension, matched against a document by selector. */
export class LanguageStatusService implements IDisposable {
    public static dependencies = [] as const;

    private readonly statuses = new Set<ILanguageStatus>();
    private readonly onDidChangeEmitter = new Emitter<void>();
    public readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    public addStatus(status: ILanguageStatus): IDisposable {
        this.statuses.add(status);
        this.onDidChangeEmitter.fire();
        return {
            dispose: () => {
                if (this.statuses.delete(status)) this.onDidChangeEmitter.fire();
            },
        };
    }

    /** Severity descending, then `source`, then `id`; a selector scoring 0 is left out. */
    public getLanguageStatus(uri: Uri, languageId: string): ILanguageStatus[] {
        return [...this.statuses]
            .filter((status) => score(status.selector, uri, languageId) > 0)
            .sort((a, b) => b.severity - a.severity || compare(a.source, b.source) || compare(a.id, b.id));
    }

    public dispose(): void {
        this.onDidChangeEmitter.dispose();
    }
}

function compare(a: string, b: string): number {
    if (a < b) return -1;
    return a > b ? 1 : 0;
}
