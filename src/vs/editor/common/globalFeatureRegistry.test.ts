import { describe, expect, it, vi } from "vitest";

import { GlobalFeatureRegistry } from "./globalFeatureRegistry.ts";

describe("GlobalFeatureRegistry", () => {
    it("all() lists the providers in registration order; dispose removes only its own", () => {
        const registry = new GlobalFeatureRegistry<string>();
        const first = registry.register("a");
        registry.register("b");
        expect(registry.all()).toEqual(["a", "b"]);

        first.dispose();
        expect(registry.all()).toEqual(["b"]);
    });

    it("a repeated dispose does not remove someone else's registration of the same provider", () => {
        const registry = new GlobalFeatureRegistry<string>();
        const first = registry.register("a");
        registry.register("a");
        first.dispose();
        first.dispose();
        expect(registry.all()).toEqual(["a"]);
    });

    it("onDidChange fires on register and on the first dispose only", () => {
        const registry = new GlobalFeatureRegistry<string>();
        const changed = vi.fn();
        registry.onDidChange(changed);

        const registration = registry.register("a");
        expect(changed).toHaveBeenCalledTimes(1);
        registration.dispose();
        registration.dispose();
        expect(changed).toHaveBeenCalledTimes(2);
    });

    it("all() is a copy: registering while iterating does not disturb it", () => {
        const registry = new GlobalFeatureRegistry<string>();
        registry.register("a");
        const snapshot = registry.all();
        registry.register("b");
        expect(snapshot).toEqual(["a"]);
    });
});
