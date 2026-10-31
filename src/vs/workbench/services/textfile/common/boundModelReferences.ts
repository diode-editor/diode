import { Disposable } from "../../../../base/common/lifecycle.ts";

import type { TextFileModel } from "./textFileModel.ts";
import type { ITextFileModelReference } from "./textFileModelRegistry.ts";

interface IBoundReference {
    readonly reference: ITextFileModelReference;
    readonly length: number;
    timer: ReturnType<typeof setTimeout>;
}

const MAX_AGE_MS = 3 * 60 * 1000;
const MAX_TOTAL_LENGTH = 80 * 1024 * 1024;
const MAX_COUNT = 50;

/**
 * Upstream `BoundModelReferenceCollection` (`mainThreadDocuments.ts`): keeps documents opened by extensions alive
 * without a tab, bounded by age, total length and count. A dirty model is never let go: upstream's model manager
 * refuses to dispose it, and here its edits exist nowhere else.
 */
export class BoundModelReferences extends Disposable {
    private readonly entries = new Map<TextFileModel, IBoundReference>();
    private totalLength = 0;

    /** `onChange` runs whenever {@link models} shrinks by itself, on expiry or eviction. */
    public constructor(private readonly onChange: () => void) {
        super();
        this.register({
            dispose: () => {
                for (const model of [...this.entries.keys()]) this.drop(model);
            },
        });
    }

    public models(): readonly TextFileModel[] {
        return [...this.entries.keys()];
    }

    public has(model: TextFileModel): boolean {
        return this.entries.has(model);
    }

    /** A model already held keeps its reference: the extra one is released. */
    public add(reference: ITextFileModelReference): void {
        const { model } = reference;
        if (this.entries.has(model)) {
            reference.dispose();
            return;
        }
        const length = model.document.getValueLength();
        this.entries.set(model, { reference, length, timer: this.startTimer(model) });
        this.totalLength += length;
        this.evict();
    }

    /** The model is disposed here unless a tab or a diff side still refers to it. */
    public release(model: TextFileModel): void {
        this.drop(model);
    }

    private startTimer(model: TextFileModel): ReturnType<typeof setTimeout> {
        const timer = setTimeout(() => {
            this.expire(model);
        }, MAX_AGE_MS);
        timer.unref();
        return timer;
    }

    private expire(model: TextFileModel): void {
        const entry = this.entries.get(model);
        if (entry === undefined) return;
        if (model.isModified) {
            entry.timer = this.startTimer(model);
            return;
        }
        this.drop(model);
        this.onChange();
    }

    private evict(): void {
        const clean = [...this.entries.keys()].filter((model) => !model.isModified);
        const before = this.entries.size;
        for (const model of clean) {
            if (this.totalLength <= MAX_TOTAL_LENGTH && this.entries.size <= MAX_COUNT) break;
            this.drop(model);
        }
        if (this.entries.size !== before) this.onChange();
    }

    private drop(model: TextFileModel): void {
        const entry = this.entries.get(model);
        if (entry === undefined) return;
        clearTimeout(entry.timer);
        this.entries.delete(model);
        this.totalLength -= entry.length;
        entry.reference.dispose();
    }
}
