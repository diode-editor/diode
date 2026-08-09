import { describe, expect, it } from "vitest";

import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import { STATUS_BAR_HIDDEN_STATE } from "../../../common/stateKeys.ts";

import { StatusBarService } from "./statusBarService.ts";

/** Стор в памяти: переживает пересоздание сервиса — это и есть персист. */
function memoryState(): IStateService {
    const store = new Map<string, unknown>();
    return {
        get: <T>(descriptor: IStateDescriptor<T>): T => (store.get(descriptor.key) as T) ?? descriptor.default,
        store: <T>(descriptor: IStateDescriptor<T>, value: T): void => void store.set(descriptor.key, value),
        openWorkspace: () => undefined,
        flushSync: () => undefined,
    };
}

function ids(entries: readonly { id: string }[]): string[] {
    return entries.map((entry) => entry.id);
}

describe("StatusBarService — видимость записей", () => {
    it("скрытая запись уходит из entries, но остаётся в allEntries", () => {
        const service = new StatusBarService(memoryState());
        service.addEntry({ id: "a", name: "A", text: "A", alignment: "left", priority: 10 });
        service.addEntry({ id: "b", name: "B", text: "B", alignment: "left", priority: 5 });

        service.setHidden("a", true);

        expect(ids(service.entries())).toEqual(["b"]);
        expect(ids(service.allEntries())).toEqual(["a", "b"]);
        expect(service.isHidden("a")).toBe(true);
    });

    it("скрытие и возврат уведомляют подписчиков", () => {
        const service = new StatusBarService(memoryState());
        service.addEntry({ id: "a", name: "A", text: "A", alignment: "left", priority: 10 });
        let fired = 0;
        service.onDidChangeEntries(() => fired++);

        service.setHidden("a", true);
        service.setHidden("a", false);

        expect(fired).toBe(2);
        expect(ids(service.entries())).toEqual(["a"]);
    });

    it("повторное скрытие уже скрытой записи — no-op", () => {
        const service = new StatusBarService(memoryState());
        service.addEntry({ id: "a", name: "A", text: "A", alignment: "left", priority: 10 });
        service.setHidden("a", true);
        let fired = 0;
        service.onDidChangeEntries(() => fired++);

        service.setHidden("a", true);

        expect(fired).toBe(0);
    });

    it("запись без name скрыть нельзя — её нечем вернуть из меню", () => {
        const service = new StatusBarService(memoryState());
        service.addEntry({ id: "hint", text: "hint", alignment: "left", priority: 10 });

        service.setHidden("hint", true);

        expect(service.isHidden("hint")).toBe(false);
        expect(ids(service.entries())).toEqual(["hint"]);
    });

    it("скрытие переживает пересоздание сервиса, запись добавляется уже скрытой", () => {
        const state = memoryState();
        const first = new StatusBarService(state);
        first.addEntry({ id: "a", name: "A", text: "A", alignment: "left", priority: 10 });
        first.setHidden("a", true);
        expect(state.get(STATUS_BAR_HIDDEN_STATE)).toEqual(["a"]);

        const second = new StatusBarService(state);
        second.addEntry({ id: "a", name: "A", text: "A", alignment: "left", priority: 10 });

        expect(ids(second.entries())).toEqual([]);
        expect(ids(second.allEntries())).toEqual(["a"]);
    });

    it("возврат записи чистит стор", () => {
        const state = memoryState();
        const service = new StatusBarService(state);
        service.addEntry({ id: "a", name: "A", text: "A", alignment: "left", priority: 10 });

        service.setHidden("a", true);
        service.setHidden("a", false);

        expect(state.get(STATUS_BAR_HIDDEN_STATE)).toEqual([]);
    });
});
