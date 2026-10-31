import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoundModelReferences } from "./boundModelReferences.ts";
import type { TextFileModel } from "./textFileModel.ts";

const MINUTE = 60_000;

function reference(length = 1, isModified = false) {
    const model = { isModified, document: { getValueLength: () => length } } as unknown as TextFileModel & {
        isModified: boolean;
    };
    return { model, dispose: vi.fn<() => void>() };
}

describe("BoundModelReferences", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("keeps a clean model for three minutes, then releases it and reports", () => {
        const onChange = vi.fn();
        const references = new BoundModelReferences(onChange);
        const ref = reference();
        references.add(ref);

        vi.advanceTimersByTime(3 * MINUTE - 1);
        expect(references.models()).toEqual([ref.model]);
        expect(ref.dispose).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(references.models()).toEqual([]);
        expect(ref.dispose).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledOnce();
    });

    it("a dirty model outlives its age and goes once clean", () => {
        const references = new BoundModelReferences(() => undefined);
        const ref = reference(1, true);
        references.add(ref);

        vi.advanceTimersByTime(10 * MINUTE);
        expect(references.has(ref.model)).toBe(true);

        ref.model.isModified = false;
        vi.advanceTimersByTime(3 * MINUTE);
        expect(references.has(ref.model)).toBe(false);
    });

    it("a second reference to a held model is released at once", () => {
        const references = new BoundModelReferences(() => undefined);
        const first = reference();
        references.add(first);
        const second = { model: first.model, dispose: vi.fn<() => void>() };

        references.add(second);

        expect(second.dispose).toHaveBeenCalledOnce();
        expect(first.dispose).not.toHaveBeenCalled();
        expect(references.models()).toHaveLength(1);
    });

    it("beyond fifty models the oldest clean ones go, dirty ones stay", () => {
        const onChange = vi.fn();
        const references = new BoundModelReferences(onChange);
        const dirty = reference(1, true);
        references.add(dirty);
        const clean = Array.from({ length: 50 }, () => reference());
        for (const ref of clean) references.add(ref);

        expect(references.models()).toHaveLength(50);
        expect(references.has(dirty.model)).toBe(true);
        expect(clean[0].dispose).toHaveBeenCalledOnce();
        expect(clean[1].dispose).not.toHaveBeenCalled();
        expect(onChange).toHaveBeenCalledOnce();
    });

    it("beyond 80 MB of text the oldest clean ones go until it fits", () => {
        const references = new BoundModelReferences(() => undefined);
        const old = reference(50 * 1024 * 1024);
        const fresh = reference(50 * 1024 * 1024);
        references.add(old);
        references.add(fresh);

        expect(old.dispose).toHaveBeenCalledOnce();
        expect(references.models()).toEqual([fresh.model]);
    });

    it("exactly at the limits nothing goes", () => {
        const onChange = vi.fn();
        const references = new BoundModelReferences(onChange);
        references.add(reference(80 * 1024 * 1024));
        expect(references.models()).toHaveLength(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("release and dispose let go of the references and stop the timers", () => {
        const onChange = vi.fn();
        const references = new BoundModelReferences(onChange);
        const released = reference();
        const remaining = reference();
        references.add(released);
        references.add(remaining);

        references.release(released.model);
        references.release(released.model);
        expect(released.dispose).toHaveBeenCalledOnce();

        references.dispose();
        expect(remaining.dispose).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(10 * MINUTE);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("letting a model go leaves no timer behind", () => {
        const references = new BoundModelReferences(() => undefined);
        const ref = reference();
        references.add(ref);
        expect(vi.getTimerCount()).toBe(1);
        references.release(ref.model);
        expect(vi.getTimerCount()).toBe(0);
    });
});
