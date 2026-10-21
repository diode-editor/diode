import { describe, expect, it } from "vitest";

import { OutputChannelRegistry } from "./outputChannelRegistry.ts";

describe("OutputChannelRegistry", () => {
    it("хранит каналы в порядке регистрации — он же порядок селектора", () => {
        const registry = new OutputChannelRegistry();
        registry.registerChannel({ id: "b", label: "B" });
        registry.registerChannel({ id: "a", label: "A" });

        expect(registry.getChannels().map((c) => c.id)).toEqual(["b", "a"]);
    });

    it("повторная регистрация не перетирает label", () => {
        // Otherwise the "declared with a name in bootstrap / created on first write" race
        // would replace "Extension Host" with the raw id.
        const registry = new OutputChannelRegistry();
        registry.registerChannel({ id: "extensions.host", label: "Extension Host" });

        registry.registerChannel({ id: "extensions.host", label: "extensions.host" });

        expect(registry.getChannel("extensions.host")?.label).toBe("Extension Host");
        expect(registry.getChannels()).toHaveLength(1);
    });

    it("повторная регистрация не файрит событие второй раз", () => {
        const registry = new OutputChannelRegistry();
        let fired = 0;
        registry.onDidRegisterChannel(() => fired++);

        registry.registerChannel({ id: "a", label: "A" });
        registry.registerChannel({ id: "a", label: "A" });

        expect(fired).toBe(1);
    });

    it("событие несёт дескриптор нового канала", () => {
        const registry = new OutputChannelRegistry();
        const seen: string[] = [];
        registry.onDidRegisterChannel((d) => seen.push(d.label));

        registry.registerChannel({ id: "a", label: "Alpha" });

        expect(seen).toEqual(["Alpha"]);
    });

    it("подписка снимается по dispose", () => {
        const registry = new OutputChannelRegistry();
        let fired = 0;
        const sub = registry.onDidRegisterChannel(() => fired++);

        sub.dispose();
        registry.registerChannel({ id: "a", label: "A" });

        expect(fired).toBe(0);
    });

    it("getChannel по неизвестному id — undefined", () => {
        expect(new OutputChannelRegistry().getChannel("nope")).toBeUndefined();
    });
});
