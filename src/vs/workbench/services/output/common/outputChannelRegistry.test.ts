import { describe, expect, it } from "vitest";

import { OutputChannelRegistry } from "./outputChannelRegistry.ts";

describe("OutputChannelRegistry", () => {
    it("keeps channels in registration order, which is also the selector order", () => {
        const registry = new OutputChannelRegistry();
        registry.registerChannel({ id: "b", label: "B" });
        registry.registerChannel({ id: "a", label: "A" });

        expect(registry.getChannels().map((c) => c.id)).toEqual(["b", "a"]);
    });

    it("a repeated registration does not overwrite the label", () => {
        // Otherwise the "declared with a name in bootstrap / created on first write" race
        // would replace "Extension Host" with the raw id.
        const registry = new OutputChannelRegistry();
        registry.registerChannel({ id: "extensions.host", label: "Extension Host" });

        registry.registerChannel({ id: "extensions.host", label: "extensions.host" });

        expect(registry.getChannel("extensions.host")?.label).toBe("Extension Host");
        expect(registry.getChannels()).toHaveLength(1);
    });

    it("a repeated registration does not fire the event a second time", () => {
        const registry = new OutputChannelRegistry();
        let fired = 0;
        registry.onDidRegisterChannel(() => fired++);

        registry.registerChannel({ id: "a", label: "A" });
        registry.registerChannel({ id: "a", label: "A" });

        expect(fired).toBe(1);
    });

    it("the event carries the new channel's descriptor", () => {
        const registry = new OutputChannelRegistry();
        const seen: string[] = [];
        registry.onDidRegisterChannel((d) => seen.push(d.label));

        registry.registerChannel({ id: "a", label: "Alpha" });

        expect(seen).toEqual(["Alpha"]);
    });

    it("the subscription is removed on dispose", () => {
        const registry = new OutputChannelRegistry();
        let fired = 0;
        const sub = registry.onDidRegisterChannel(() => fired++);

        sub.dispose();
        registry.registerChannel({ id: "a", label: "A" });

        expect(fired).toBe(0);
    });

    it("getChannel by an unknown id gives undefined", () => {
        expect(new OutputChannelRegistry().getChannel("nope")).toBeUndefined();
    });
});
