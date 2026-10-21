import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";

import type { TextFileModel } from "./textFileModel.ts";

/** The last reference disposes the model. Disposing a reference twice is a no-op. */
export interface ITextFileModelReference extends IDisposable {
    readonly model: TextFileModel;
}

interface IModelEntry {
    model: TextFileModel;
    refs: number;
    /** Current key in {@link TextFileModelRegistry.byUri}; `null`: evicted by a saveAs collision. */
    key: string | null;
}

/**
 * Counterpart of the reference-counting `ITextModelService`: one model per resource, no matter
 * how many tabs show it. Untitled and synthetic buffers never get here.
 */
export class TextFileModelRegistry {
    private readonly entries = new Set<IModelEntry>();
    private readonly byUri = new Map<string, IModelEntry>();

    public constructor(private readonly factory: (uri: Uri) => TextFileModel) {}

    /** A per-call factory is for a resource whose bytes are already read. The owner must release the reference. */
    public acquire(uri: Uri, factory: (uri: Uri) => TextFileModel = this.factory): ITextFileModelReference {
        const key = uri.toString();
        let entry = this.byUri.get(key);
        if (entry === undefined) {
            const model = factory(uri);
            entry = { model, refs: 0, key };
            this.entries.add(entry);
            this.byUri.set(key, entry);
        }
        entry.refs++;

        let released = false;
        return {
            model: entry.model,
            dispose: () => {
                if (released) return;
                released = true;
                this.release(entry);
            },
        };
    }

    public get(uri: Uri): TextFileModel | null {
        return this.byUri.get(uri.toString())?.model ?? null;
    }

    public refCount(uri: Uri): number {
        return this.byUri.get(uri.toString())?.refs ?? 0;
    }

    public models(): readonly TextFileModel[] {
        return [...this.entries].map((entry) => entry.model);
    }

    /**
     * If the target key is taken by another model, the moved one is left keyless: the next
     * `acquire` creates a fresh model, and live references still release correctly.
     */
    public handleUriChanged(model: TextFileModel): void {
        const entry = [...this.entries].find((candidate) => candidate.model === model);
        if (entry === undefined) return;
        const newKey = model.uri.toString();
        if (entry.key === newKey) return;
        if (entry.key !== null) this.byUri.delete(entry.key);
        if (this.byUri.has(newKey)) {
            entry.key = null;
            return;
        }
        entry.key = newKey;
        this.byUri.set(newKey, entry);
    }

    private release(entry: IModelEntry): void {
        entry.refs--;
        if (entry.refs > 0) return;
        this.entries.delete(entry);
        if (entry.key !== null) this.byUri.delete(entry.key);
        entry.model.dispose();
    }
}
