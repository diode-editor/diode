import { describe, expect, it } from "vitest";

import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";

import { onDidChangeTreeIndentGuides, treeIndentGuides } from "./treeIndentGuides.ts";

describe("treeIndentGuides", () => {
    it("reads workbench.tree.renderIndentGuides on every call", async () => {
        const config = createTestConfigurationService();
        const read = treeIndentGuides(config);
        expect(read()).toBe("onHover");
        await config.updateValue("workbench.tree.renderIndentGuides", "always");
        expect(read()).toBe("always");
    });

    it("an invalid value falls back to onHover", () => {
        const read = treeIndentGuides(createTestConfigurationService({ "workbench.tree.renderIndentGuides": "never" }));
        expect(read()).toBe("onHover");
    });

    it("fires only for its own key, until disposed", async () => {
        const config = createTestConfigurationService();
        let fired = 0;
        const subscription = onDidChangeTreeIndentGuides(config, () => fired++);
        await config.updateValue("workbench.tree.expandMode", "doubleClick");
        expect(fired).toBe(0);
        await config.updateValue("workbench.tree.renderIndentGuides", "none");
        expect(fired).toBe(1);
        subscription.dispose();
        await config.updateValue("workbench.tree.renderIndentGuides", "always");
        expect(fired).toBe(1);
    });
});
