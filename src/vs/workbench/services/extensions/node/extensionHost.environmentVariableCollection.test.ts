import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MergedEnvironmentVariableCollection } from "../../../../platform/terminal/common/environmentVariable.ts";

import { createInMemoryEnvironmentVariableCollectionStore } from "./customers/environmentVariableCollectionsCustomer.ts";

describe("ExtensionHost — extension environment variable collections (subprocess)", () => {
    it("replace on activation → store; a new spawn sees what was stored; edits and clear arrive", async () => {
        const store = createInMemoryEnvironmentVariableCollectionStore();
        const harness = await createExtensionTestHarness({
            extensions: [extensionFixture("test.env", "environmentVariableCollection.cjs")],
            environmentVariableCollections: store,
        });
        const applied = (): Record<string, string | undefined> => {
            const env: Record<string, string | undefined> = { PATH: "/usr/bin" };
            new MergedEnvironmentVariableCollection(store.collections).applyToProcessEnvironment(env, undefined, false);
            return env;
        };
        try {
            expect(await harness.commandRegistry.execute("test.env.seenAtActivation")).toEqual({
                seenAtActivation: undefined,
                activations: 1,
            });
            await vi.waitFor(() => {
                expect(applied()).toEqual({ PATH: "/usr/bin", DIODE_TEST_PORT: "4242" });
            });
            expect(store.collections.get("test.env")?.persistent).toBe(true);
            expect([...(store.collections.get("test.env")?.descriptionMap ?? [])]).toEqual([
                ["", { description: "Test port", scope: undefined }],
            ]);

            await harness.host.restartForWorkspaceChange();
            await vi.waitFor(async () => {
                expect(await harness.commandRegistry.execute("test.env.seenAtActivation")).toEqual({
                    seenAtActivation: "4242",
                    activations: 1,
                });
            });

            await harness.commandRegistry.execute("test.env.prependPath");
            await vi.waitFor(() => {
                expect(applied()).toEqual({ PATH: "/opt/test:/usr/bin", DIODE_TEST_PORT: "4242" });
            });

            await harness.commandRegistry.execute("test.env.clear");
            await vi.waitFor(() => {
                expect(store.collections.has("test.env")).toBe(false);
            });
        } finally {
            await harness.dispose();
        }
    });
});
