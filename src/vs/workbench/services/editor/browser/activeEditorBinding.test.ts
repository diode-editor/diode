import { describe, expect, it } from "vitest";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";

import { bindActiveEditor, type IActiveEditorSource } from "./activeEditorBinding.ts";

interface IFakeEditor {
    readonly name: string;
}

/** Источник-заглушка: активный редактор меняется руками, подписчики видны. */
function fakeSource(initial: IFakeEditor | null): IActiveEditorSource<IFakeEditor> & {
    activate(editor: IFakeEditor | null): void;
    readonly listeners: number;
} {
    let active = initial;
    const listeners = new Set<(editor: IFakeEditor | null) => void>();
    return {
        getActiveEditor: () => active,
        onActiveEditorChanged: (listener) => {
            listeners.add(listener);
            return { dispose: () => listeners.delete(listener) };
        },
        activate: (editor) => {
            active = editor;
            for (const listener of [...listeners]) listener(editor);
        },
        get listeners() {
            return listeners.size;
        },
    };
}

/** Подписка, которая помнит, снята ли она. */
function trackedSubscription(log: string[], name: string): IDisposable {
    return {
        dispose: () => {
            log.push(`dispose ${name}`);
        },
    };
}

describe("bindActiveEditor", () => {
    const a: IFakeEditor = { name: "a" };
    const b: IFakeEditor = { name: "b" };

    it("привязывает уже активный редактор сразу", () => {
        const bound: (string | null)[] = [];
        bindActiveEditor(fakeSource(a), (editor) => bound.push(editor?.name ?? null));
        expect(bound).toEqual(["a"]);
    });

    it("без активного редактора тело зовётся с null", () => {
        const bound: (string | null)[] = [];
        bindActiveEditor(fakeSource(null), (editor) => bound.push(editor?.name ?? null));
        expect(bound).toEqual([null]);
    });

    it("смена редактора снимает подписки прежнего ДО привязки нового", () => {
        const log: string[] = [];
        const source = fakeSource(a);
        bindActiveEditor(source, (editor, store) => {
            log.push(`bind ${editor?.name ?? "null"}`);
            if (editor !== null) store.add(trackedSubscription(log, editor.name));
        });

        source.activate(b);
        source.activate(null);

        expect(log).toEqual(["bind a", "dispose a", "bind b", "dispose b", "bind null"]);
    });

    it("dispose снимает слежение за сменой и подписки текущего редактора", () => {
        const log: string[] = [];
        const source = fakeSource(a);
        const binding = bindActiveEditor(source, (editor, store) => {
            log.push(`bind ${editor?.name ?? "null"}`);
            if (editor !== null) store.add(trackedSubscription(log, editor.name));
        });
        expect(source.listeners).toBe(1);

        binding.dispose();
        source.activate(b);

        expect(source.listeners).toBe(0);
        expect(log).toEqual(["bind a", "dispose a"]);
    });
});
