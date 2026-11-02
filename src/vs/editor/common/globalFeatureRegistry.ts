import { Emitter } from "../../base/common/event.ts";
import type { IDisposable } from "../../base/common/lifecycle.ts";

/** For features with no document to score against (upstream `WorkspaceSymbolProviderRegistry`). */
export class GlobalFeatureRegistry<T> {
    private readonly providers: T[] = [];
    private readonly onDidChangeEmitter = new Emitter<void>();

    /** Fires on every register and dispose. */
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public register(provider: T): IDisposable {
        this.providers.push(provider);
        this.onDidChangeEmitter.fire();
        let registered = true;
        return {
            dispose: () => {
                if (!registered) return;
                registered = false;
                this.providers.splice(this.providers.indexOf(provider), 1);
                this.onDidChangeEmitter.fire();
            },
        };
    }

    /** In registration order; a copy, so a registration during iteration is safe. */
    public all(): readonly T[] {
        return [...this.providers];
    }
}
