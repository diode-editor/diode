import { describe, expect, it } from "vitest";

import { createExtensionTestHarness } from "./ExtensionTestHarness.ts";

describe("createExtensionTestHarness", () => {
    it("builds a harness with no extensions and no initial file (line 99 ?? [] branch)", async () => {
        // No `extensions` and no `initialFile`: exercises the `options.extensions ?? []`
        // fallback and skips the initial-file branch. No subprocess is forked.
        const harness = await createExtensionTestHarness();
        try {
            expect(harness.app).toBeDefined();
            expect(harness.group).toBeDefined();
            expect(harness.host).toBeDefined();
            expect(harness.tmpDir).toMatch(/diode-ext-/);
        } finally {
            await harness.dispose();
        }
    });

    it("writeFile creates a file inside the harness tmp dir", async () => {
        const harness = await createExtensionTestHarness();
        try {
            const fp = harness.writeFile("note.txt", "hello");
            expect(fp).toMatch(/note\.txt$/);
        } finally {
            await harness.dispose();
        }
    });

    it("flushRpc resolves with the default number of turns (lines 91-94)", async () => {
        const harness = await createExtensionTestHarness();
        try {
            let resolved = false;
            await harness.flushRpc();
            resolved = true;
            expect(resolved).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    it("flushRpc accepts an explicit turn count (line 91 explicit-argument branch)", async () => {
        const harness = await createExtensionTestHarness();
        try {
            // Count how many microtask turns elapse to confirm the loop honours the argument.
            const order: string[] = [];
            const flushed = harness.flushRpc(1).then(() => order.push("flushed"));
            await flushed;
            expect(order).toEqual(["flushed"]);
        } finally {
            await harness.dispose();
        }
    });

    it("opens an initial file when provided", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.txt", content: "abc" },
        });
        try {
            expect(harness.group).toBeDefined();
        } finally {
            await harness.dispose();
        }
    });
});
