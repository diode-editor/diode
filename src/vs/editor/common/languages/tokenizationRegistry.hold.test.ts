import { describe, expect, it } from "vitest";

import { NULL_STATE } from "./iState.ts";
import type { ITokenizationSupport } from "./iTokenizationSupport.ts";
import { TokenizationRegistry } from "./tokenizationRegistry.ts";

function makeStubSupport(): ITokenizationSupport {
    return {
        getInitialState: () => NULL_STATE,
        tokenizeLine: () => ({ tokens: { tokens: [] }, endState: NULL_STATE }),
    };
}

// Придержка до первого кадра: support'ы грузятся, но не выдаются, а отпуск
// пересаживает потребителей тем же `onDidChange`, что и поздняя грамматика.
describe("TokenizationRegistry — hold", () => {
    it("под придержкой get() отдаёт undefined, после отпуска — support", () => {
        const reg = new TokenizationRegistry();
        const css = makeStubSupport();
        reg.register("css", css);

        const held = reg.hold();
        expect(reg.get("css")).toBeUndefined();

        held.dispose();
        expect(reg.get("css")).toBe(css);
    });

    it("загрузка под придержкой идёт, но молчит; отпуск фаерит по каждому языку", async () => {
        const reg = new TokenizationRegistry();
        const ts = makeStubSupport();
        reg.register("css", makeStubSupport());
        reg.registerLazy("typescript", () => Promise.resolve(ts));
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        const held = reg.hold();
        expect(await reg.load("typescript")).toBe(ts);
        expect(seen).toEqual([]);

        held.dispose();
        expect(seen).toEqual(["css", "typescript"]);
        expect(reg.get("typescript")).toBe(ts);
    });

    it("язык, снятый под придержкой, тоже получает событие на отпуске", () => {
        const reg = new TokenizationRegistry();
        const registration = reg.register("css", makeStubSupport());
        const held = reg.hold();
        registration.dispose();
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        held.dispose();

        expect(seen).toEqual(["css"]);
        expect(reg.get("css")).toBeUndefined();
    });

    it("повторный отпуск — no-op, вторая придержка при живой первой — ошибка", () => {
        const reg = new TokenizationRegistry();
        reg.register("css", makeStubSupport());
        const held = reg.hold();
        expect(() => reg.hold()).toThrow("already held");
        held.dispose();
        const seen: string[] = [];
        reg.onDidChange((id) => seen.push(id));

        held.dispose();

        expect(seen).toEqual([]);
        // Отпущенная придержка не мешает новой.
        const again = reg.hold();
        expect(reg.get("css")).toBeUndefined();
        again.dispose();
    });
});
