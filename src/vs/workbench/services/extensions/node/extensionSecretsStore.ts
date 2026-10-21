import * as fs from "node:fs";
import * as path from "node:path";

/**
 * A bucket is addressed by the extension id the subprocess supplies, not by the call itself: an extension can't
 * reach another's bucket.
 */
export interface IExtensionSecretStore {
    keys(extensionId: string): readonly string[];
    get(extensionId: string, key: string): string | undefined;
    store(extensionId: string, key: string, value: string): void;
    delete(extensionId: string, key: string): void;
}

type SecretBucket = Partial<Record<string, string>>;

/** `Partial`: keys are arbitrary, so the defensive checks below are real, not decorative. */
type SecretsFile = Partial<Record<string, SecretBucket>>;

/** One copy of the rules for both stores: two copies would drift apart. */
function secretStoreOps(read: () => SecretsFile, afterWrite: (data: SecretsFile) => void): IExtensionSecretStore {
    return {
        keys: (extensionId) => Object.keys(read()[extensionId] ?? {}),
        get: (extensionId, key) => read()[extensionId]?.[key],
        store: (extensionId, key, value) => {
            const data = read();
            (data[extensionId] ??= {})[key] = value;
            afterWrite(data);
        },
        delete: (extensionId, key) => {
            const data = read();
            const own = data[extensionId];
            if (own === undefined) return;
            Reflect.deleteProperty(own, key);
            // Remove an emptied bucket, otherwise the file would accumulate empty ones.
            if (Object.keys(own).length === 0) Reflect.deleteProperty(data, extensionId);
            afterWrite(data);
        },
    };
}

export function createInMemoryExtensionSecretStore(): IExtensionSecretStore {
    const data: SecretsFile = {};
    return secretStoreOps(
        () => data,
        () => undefined,
    );
}

/**
 * **No encryption**: we have no OS keychain, values are stored in plain text under `0600`
 * (same in the API readiness matrix), so secret values never reach any log.
 * Writes are synchronous on every change: a token must not be lost on an unexpected exit.
 *
 * @param onError never receives values, only the path and the reason
 */
export function createFileExtensionSecretStore(
    filePath: string,
    onError?: (message: string, err: unknown) => void,
): IExtensionSecretStore {
    let data: SecretsFile | null = null;

    const load = (): SecretsFile => {
        if (data !== null) return data;
        data = readSecretsFile(filePath, onError);
        return data;
    };

    const flush = (next: SecretsFile): void => {
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            // Stryker disable next-line ObjectLiteral,StringLiteral: `encoding` is the default, `mode` is repeated by chmodSync below; it only closes the race window before chmod, which tests cannot observe
            fs.writeFileSync(filePath, JSON.stringify(next, null, 2), { encoding: "utf-8", mode: 0o600 });
            // `mode` applies only when the file is created: an existing one (from another copy
            // of user-data) would keep world-readable permissions.
            fs.chmodSync(filePath, 0o600);
        } catch (err) {
            onError?.(`failed to write extension secrets to "${filePath}"`, err);
        }
    };

    return secretStoreOps(load, flush);
}

/** Any failure yields an empty store: an unreadable secret is worth asking the user again, not killing the editor. */
function readSecretsFile(filePath: string, onError?: (message: string, err: unknown) => void): SecretsFile {
    let raw: string;
    try {
        // Stryker disable next-line StringLiteral: Node treats an empty encoding as "no encoding" and returns a Buffer, which JSON.parse below coerces to the same string (verified), so the mutant is equivalent
        raw = fs.readFileSync(filePath, "utf-8");
    } catch {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        onError?.(`failed to parse extension secrets at "${filePath}"`, err);
        return {};
    }
    // Stryker disable next-line ConditionalExpression: equivalent: a JSON scalar yields an empty result anyway (`Object.entries(42)` is empty, the bucket check drops a string's characters)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const result: SecretsFile = {};
    for (const [extensionId, own] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof own !== "object" || own === null || Array.isArray(own)) continue;
        const bucket: SecretBucket = {};
        for (const [key, value] of Object.entries(own as Record<string, unknown>)) {
            if (typeof value === "string") bucket[key] = value;
        }
        if (Object.keys(bucket).length > 0) result[extensionId] = bucket;
    }
    return result;
}
