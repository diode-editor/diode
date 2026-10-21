import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFileExtensionSecretStore, createInMemoryExtensionSecretStore } from "./extensionSecretsStore.ts";

const roots: string[] = [];

function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-secretstore-"));
    roots.push(root);
    return root;
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("createInMemoryExtensionSecretStore", () => {
    it("stores, returns and deletes by (extension, key) pair", () => {
        const store = createInMemoryExtensionSecretStore();
        expect(store.get("pub.one", "token")).toBeUndefined();
        store.store("pub.one", "token", "s3cr3t");
        expect(store.get("pub.one", "token")).toBe("s3cr3t");
        expect(store.get("pub.two", "token")).toBeUndefined();
        store.store("pub.two", "token", "other");
        expect(store.get("pub.one", "token")).toBe("s3cr3t");
        store.delete("pub.one", "token");
        expect(store.get("pub.one", "token")).toBeUndefined();
        expect(store.get("pub.two", "token")).toBe("other");
    });

    it("keys lists the extension's keys and empties along with it", () => {
        const store = createInMemoryExtensionSecretStore();
        expect(store.keys("pub.one")).toEqual([]);
        store.store("pub.one", "token", "a");
        store.store("pub.one", "refresh", "b");
        expect(store.keys("pub.one")).toEqual(["token", "refresh"]);
        store.delete("pub.one", "token");
        expect(store.keys("pub.one")).toEqual(["refresh"]);
    });

    it("deleting a missing key is a silent no-op", () => {
        const store = createInMemoryExtensionSecretStore();
        expect(() => {
            store.delete("pub.one", "token");
        }).not.toThrow();
        store.store("pub.one", "token", "a");
        store.delete("pub.one", "no such key");
        expect(store.get("pub.one", "token")).toBe("a");
    });
});

describe("createFileExtensionSecretStore", () => {
    it("written data survives store re-creation: it lives in a file", () => {
        const file = path.join(makeRoot(), "User", "secrets.json");
        createFileExtensionSecretStore(file).store("pub.one", "token", "s3cr3t");
        expect(createFileExtensionSecretStore(file).get("pub.one", "token")).toBe("s3cr3t");
    });

    it("deletion reaches the file too", () => {
        const file = path.join(makeRoot(), "secrets.json");
        const first = createFileExtensionSecretStore(file);
        first.store("pub.one", "token", "s3cr3t");
        first.store("pub.one", "refresh", "r");
        first.delete("pub.one", "token");
        const second = createFileExtensionSecretStore(file);
        expect(second.get("pub.one", "token")).toBeUndefined();
        expect(second.keys("pub.one")).toEqual(["refresh"]);
    });

    it("an emptied extension leaves no empty bucket behind", () => {
        const file = path.join(makeRoot(), "secrets.json");
        const store = createFileExtensionSecretStore(file);
        store.store("pub.one", "token", "s3cr3t");
        store.delete("pub.one", "token");
        expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({});
    });

    it("the file is created with mode 0600 and stays so even if it arrived with other permissions", () => {
        const root = makeRoot();
        const file = path.join(root, "secrets.json");
        fs.writeFileSync(file, "{}", { encoding: "utf-8", mode: 0o644 });
        createFileExtensionSecretStore(file).store("pub.one", "token", "s3cr3t");
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });

    it("a missing file yields an empty store and is NOT an error: onError stays silent", () => {
        // Logging a complaint on a clean install would be a false alarm on every first launch.
        const seen: string[] = [];
        const store = createFileExtensionSecretStore(path.join(makeRoot(), "missing", "secrets.json"), (message) =>
            seen.push(message),
        );
        expect(store.get("pub.one", "token")).toBeUndefined();
        expect(store.keys("pub.one")).toEqual([]);
        expect(seen).toEqual([]);
    });

    it("a corrupt file without onError also yields an empty store, not a crash", () => {
        // `onError` is optional (harnesses don't pass it): without a listener a failure doesn't become an exception.
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, "{not json", "utf-8");
        const store = createFileExtensionSecretStore(file);
        expect(() => store.get("pub.one", "token")).not.toThrow();
        expect(store.keys("pub.one")).toEqual([]);
    });

    it("an unwritable path without onError does not crash either", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.mkdirSync(file);
        const store = createFileExtensionSecretStore(file);
        expect(() => {
            store.store("pub.one", "token", "s3cr3t");
        }).not.toThrow();
    });

    it("a top-level `null` file yields an empty store, not a crash", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, "null", "utf-8");
        const store = createFileExtensionSecretStore(file);
        expect(() => store.keys("pub.one")).not.toThrow();
        expect(store.keys("pub.one")).toEqual([]);
    });

    it("corrupt JSON yields an empty store and an error message without values", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, "{not json", "utf-8");
        const seen: string[] = [];
        const store = createFileExtensionSecretStore(file, (message) => seen.push(message));
        expect(store.get("pub.one", "token")).toBeUndefined();
        expect(seen).toHaveLength(1);
        expect(seen[0]).toContain("failed to parse");
    });

    it("a foreign file shape (array, non-object buckets, non-string values) is dropped piece by piece", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(
            file,
            JSON.stringify({
                "pub.one": { token: "s3cr3t", broken: 42, alsoBroken: null },
                "pub.array": ["not a bucket"],
                "pub.null": null,
                // Without the check the string's characters would spread into "keys" "0", "1", ….
                "pub.scalar": "string",
                "pub.empty": { onlyBroken: 1 },
            }),
            "utf-8",
        );
        const store = createFileExtensionSecretStore(file);
        expect(store.keys("pub.one")).toEqual(["token"]);
        expect(store.get("pub.one", "token")).toBe("s3cr3t");
        expect(store.keys("pub.array")).toEqual([]);
        expect(store.keys("pub.null")).toEqual([]);
        expect(store.keys("pub.scalar")).toEqual([]);
        expect(store.keys("pub.empty")).toEqual([]);
    });

    it("a top-level array file also yields an empty store", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, "[]", "utf-8");
        expect(createFileExtensionSecretStore(file).keys("pub.one")).toEqual([]);
    });

    it("a NON-empty top-level array does not become index-keyed buckets", () => {
        // An array is also `typeof === "object"`: without the check its elements would become "extensions" "0", "1", ….
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, JSON.stringify([{ token: "s3cr3t" }, { other: "x" }]), "utf-8");
        const store = createFileExtensionSecretStore(file);
        expect(store.keys("0")).toEqual([]);
        expect(store.get("0", "token")).toBeUndefined();
    });

    it("an emptied bucket does not reappear in the file on the next write", () => {
        const file = path.join(makeRoot(), "secrets.json");
        fs.writeFileSync(file, JSON.stringify({ "pub.gone": { onlyBroken: 1 } }), "utf-8");
        const store = createFileExtensionSecretStore(file);
        store.store("pub.other", "token", "s3cr3t");
        expect(JSON.parse(fs.readFileSync(file, "utf-8"))).toEqual({ "pub.other": { token: "s3cr3t" } });
    });

    it("an unwritable path does not crash the host: the failure goes to onError", () => {
        // A directory in place of the file: writeFileSync on it always fails.
        const file = path.join(makeRoot(), "secrets.json");
        fs.mkdirSync(file);
        const seen: string[] = [];
        const store = createFileExtensionSecretStore(file, (message) => seen.push(message));
        expect(() => {
            store.store("pub.one", "token", "s3cr3t");
        }).not.toThrow();
        expect(seen.some((m) => m.includes("failed to write"))).toBe(true);
        expect(store.get("pub.one", "token")).toBe("s3cr3t");
    });

    it("deleting a missing bucket does not write the file at all", () => {
        const file = path.join(makeRoot(), "secrets.json");
        const store = createFileExtensionSecretStore(file);
        store.delete("pub.one", "token");
        expect(fs.existsSync(file)).toBe(false);
    });
});
