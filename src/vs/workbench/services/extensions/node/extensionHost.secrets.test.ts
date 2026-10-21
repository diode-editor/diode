import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    type IExtensionHarness,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";

import { createFileExtensionSecretStore, type IExtensionSecretStore } from "./extensionSecretsStore.ts";

function secretsFixture(id = "test.secrets"): ReturnType<typeof extensionFixture> {
    return extensionFixture(id, "usesSecrets.cjs");
}

describe("ExtensionHost — ExtensionContext.secrets", () => {
    const roots: string[] = [];
    const makeRoot = (): string => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-extsecrets-"));
        roots.push(root);
        return root;
    };

    afterEach(() => {
        for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    });

    const withHarness = async (
        run: (harness: IExtensionHarness) => Promise<void>,
        secrets?: IExtensionSecretStore,
    ): Promise<void> => {
        const harness = await createExtensionTestHarness({
            extensions: [secretsFixture()],
            ...(secrets !== undefined ? { secrets } : {}),
        });
        try {
            await run(harness);
        } finally {
            await harness.dispose();
        }
    };

    it("store → get returns what was stored, delete removes it", async () => {
        await withHarness(async (harness) => {
            expect(await harness.commandRegistry.execute("test.secrets.get", "token")).toBeNull();
            await harness.commandRegistry.execute("test.secrets.store", "token", "s3cr3t");
            expect(await harness.commandRegistry.execute("test.secrets.get", "token")).toBe("s3cr3t");
            await harness.commandRegistry.execute("test.secrets.delete", "token");
            expect(await harness.commandRegistry.execute("test.secrets.get", "token")).toBeNull();
        });
    });

    it("keys() lists the extension's keys", async () => {
        await withHarness(async (harness) => {
            expect(await harness.commandRegistry.execute("test.secrets.keys")).toEqual([]);
            await harness.commandRegistry.execute("test.secrets.store", "token", "a");
            await harness.commandRegistry.execute("test.secrets.store", "refresh", "b");
            expect(await harness.commandRegistry.execute("test.secrets.keys")).toEqual(["token", "refresh"]);
            await harness.commandRegistry.execute("test.secrets.delete", "token");
            expect(await harness.commandRegistry.execute("test.secrets.keys")).toEqual(["refresh"]);
        });
    });

    it("onDidChange fires on both store and delete, with the key but without the value", async () => {
        await withHarness(async (harness) => {
            await harness.commandRegistry.execute("test.secrets.store", "token", "s3cr3t");
            await harness.commandRegistry.execute("test.secrets.delete", "token");
            // The event arrives as a notification, not as a request response: let it arrive.
            await harness.flushRpc(4);
            expect(await harness.commandRegistry.execute("test.secrets.changes")).toEqual(["token", "token"]);
        });
    });

    it("a secret already in the store is available RIGHT in activate()", async () => {
        // This is exactly how a real consumer behaves: it decides from the token's presence
        // whether to ask the human, and decides that before any UI.
        const store = createFileExtensionSecretStore(path.join(makeRoot(), "secrets.json"));
        store.store("test.secrets", "token", "from the previous run");
        await withHarness(async (harness) => {
            expect(await harness.commandRegistry.execute("test.secrets.tokenAtActivate")).toBe("from the previous run");
        }, store);
    });

    it("one extension's secrets are invisible to another", async () => {
        const store = createFileExtensionSecretStore(path.join(makeRoot(), "secrets.json"));
        store.store("test.other", "token", "foreign");
        await withHarness(async (harness) => {
            expect(await harness.commandRegistry.execute("test.secrets.get", "token")).toBeNull();
            await harness.commandRegistry.execute("test.secrets.store", "token", "own");
            expect(store.get("test.other", "token")).toBe("foreign");
            expect(store.get("test.secrets", "token")).toBe("own");
        }, store);
    });

    it("a stored secret survives a restart: it lives in a user-data file", async () => {
        const file = path.join(makeRoot(), "User", "secrets.json");
        await withHarness(async (harness) => {
            await harness.commandRegistry.execute("test.secrets.store", "token", "lives on");
        }, createFileExtensionSecretStore(file));
        // New host, new subprocess, same user-data, as after a restart.
        await withHarness(async (harness) => {
            expect(await harness.commandRegistry.execute("test.secrets.tokenAtActivate")).toBe("lives on");
        }, createFileExtensionSecretStore(file));
    });
});
