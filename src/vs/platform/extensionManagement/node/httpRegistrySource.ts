import * as fs from "node:fs/promises";
import * as path from "node:path";

import { loadSemver } from "../../../base/common/semver.ts";
import { DIODE_VERSION } from "../../../base/common/version.ts";
import type { IExtensionRegistrySource } from "../common/iExtensionRegistrySource.ts";
import {
    EXTENSION_ID_RE,
    type IRegistryExtensionMeta,
    type IRegistryIndex,
    type IRegistryVersion,
    parseRegistryIndex,
    parseRegistryMeta,
} from "../common/registryFormat.ts";

/**
 * The caller ({@link installFromRegistry}) verifies the download's `sha256`. Integrity
 * rests on that, not on the transport, so `http:` is allowed alongside `https:`: a local
 * directory over http and a private mirror are legitimate setups.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
// Stryker disable next-line ArithmeticOperator: the arithmetic only spells out "8 MiB"; the default itself is unobservable in tests, which set the limit explicitly so the over-limit case doesn't push megabytes
const DEFAULT_MAX_JSON_BYTES = 8 * 1024 * 1024;
/** With headroom: redhat.java with a bundled JRE 21 already weighs ~133 MiB and grows with each version. */
export const DEFAULT_MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;

export interface IHttpRegistrySourceOptions {
    readonly timeoutMs?: number;
    readonly maxJsonBytes?: number;
    readonly maxArtifactBytes?: number;
}

function toBaseUrl(raw: string): URL {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`Invalid registry URL: "${raw}"`);
    }
    requireHttp(url, `Registry URL must be http(s): "${raw}"`);
    // `new URL("index.json", base)` drops the base's last segment unless it ends with a
    // slash: without normalization `…/registry/v1` would give `…/registry/index.json`.
    if (!url.pathname.endsWith("/")) {
        url.pathname += "/";
    }
    return url;
}

function requireHttp(url: URL, message: string): void {
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(message);
    }
}

/** `fetch` reports "fetch failed" and hides the real reason (DNS, TLS, …) in `cause`. */
function describeFetchError(error: unknown): string {
    const message = (error as Error).message;
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? `${message} (${cause.message})` : message;
}

/** Counts actual bytes, not `Content-Length`: the header is optional and may lie. */
async function consumeCapped(
    response: Response,
    limit: number,
    url: URL,
    onChunk: (chunk: Uint8Array) => Promise<void> | void,
): Promise<void> {
    if (response.body === null) {
        return;
    }
    const reader = response.body.getReader();
    let total = 0;
    for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
            chunk = await reader.read();
        } catch (error) {
            throw new Error(`${url.href}: download failed: ${(error as Error).message}`, { cause: error });
        }
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > limit) {
            await reader.cancel();
            throw new Error(`${url.href}: response exceeds the ${String(limit)}-byte limit`);
        }
        await onChunk(chunk.value);
    }
}

async function readCapped(response: Response, limit: number, url: URL): Promise<Buffer> {
    const chunks: Buffer[] = [];
    await consumeCapped(response, limit, url, (chunk) => {
        chunks.push(Buffer.from(chunk));
    });
    return Buffer.concat(chunks);
}

/** Streaming risks a half-written file: an incomplete download is removed so it can't pass for a valid artifact. */
async function downloadCapped(
    response: Response,
    limit: number,
    url: URL,
    target: string,
    onProgress: () => void,
): Promise<void> {
    const file = await fs.open(target, "w");
    let complete = false;
    try {
        await consumeCapped(response, limit, url, async (chunk) => {
            onProgress();
            await file.write(chunk);
        });
        complete = true;
    } finally {
        await file.close();
        if (!complete) {
            // Stryker disable next-line BooleanLiteral,ObjectLiteral: the file was created by `open` earlier in this function, so the target always exists and changing `force` is unobservable; the flag stays so a cleanup failure never masks the original error, which is what the caller gets
            await fs.rm(target, { force: true });
        }
    }
}

export class HttpExtensionRegistrySource implements IExtensionRegistrySource {
    private readonly baseUrl: URL;
    private readonly onProblem: ((message: string) => void) | undefined;
    private readonly timeoutMs: number;
    private readonly maxJsonBytes: number;
    private readonly maxArtifactBytes: number;

    public constructor(
        baseUrl: string,
        onProblem?: (message: string) => void,
        options: IHttpRegistrySourceOptions = {},
    ) {
        this.baseUrl = toBaseUrl(baseUrl);
        this.onProblem = onProblem;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.maxJsonBytes = options.maxJsonBytes ?? DEFAULT_MAX_JSON_BYTES;
        this.maxArtifactBytes = options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    }

    /** `signal` is for callers that can't use the overall timeout (`fetchArtifact`). */
    private async request(url: URL, signal?: AbortSignal): Promise<Response> {
        try {
            return await fetch(url, {
                headers: { "user-agent": `diode/${DIODE_VERSION}` },
                signal: signal ?? AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error) {
            throw new Error(`${url.href}: ${describeFetchError(error)}`, { cause: error });
        }
    }

    private ensureOk(response: Response, url: URL): void {
        if (!response.ok) {
            throw new Error(`${url.href}: HTTP ${String(response.status)} ${response.statusText}`);
        }
    }

    private parse<T>(url: URL, parse: () => { value: T; problems: string[] }): T {
        try {
            const { value, problems } = parse();
            for (const problem of problems) {
                this.onProblem?.(problem);
            }
            return value;
        } catch (error) {
            throw new Error(`${url.href}: ${(error as Error).message}`, { cause: error });
        }
    }

    private async readJson(response: Response, url: URL): Promise<string> {
        this.ensureOk(response, url);
        return (await readCapped(response, this.maxJsonBytes, url)).toString("utf8");
    }

    public async getIndex(): Promise<IRegistryIndex> {
        const url = new URL("index.json", this.baseUrl);
        const text = await this.readJson(await this.request(url), url);
        const semver = await loadSemver();
        return this.parse(url, () => {
            const { index, problems } = parseRegistryIndex(text, semver);
            return { value: index, problems };
        });
    }

    public async getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        if (!EXTENSION_ID_RE.test(id)) {
            throw new Error(`Invalid extension id: "${id}"`);
        }
        const url = new URL(`meta/${id}.json`, this.baseUrl);
        const response = await this.request(url);
        // 404 is like ENOENT for the file source; any other non-2xx is a registry failure.
        if (response.status === 404) {
            return undefined;
        }
        const text = await this.readJson(response, url);
        const semver = await loadSemver();
        return this.parse(url, () => {
            const { meta, problems } = parseRegistryMeta(text, semver, id);
            return { value: meta, problems };
        });
    }

    public async fetchArtifact(version: IRegistryVersion, tempDir: string): Promise<string> {
        const artifact = version.artifact;
        if (artifact.type !== "url") {
            throw new Error(`Artifact type "${artifact.type}" is not supported by the HTTP registry source`);
        }
        let url: URL;
        try {
            url = new URL(artifact.url);
        } catch {
            throw new Error(`Invalid artifact URL: "${artifact.url}"`);
        }
        requireHttp(url, `Artifact URL must be http(s): "${artifact.url}"`);

        // Watch for SILENCE, not total time: the timer re-arms on every chunk.
        // CI went red when the 139 MB redhat.java didn't fit in 30s on the Windows runner.
        const stall = new AbortController();
        const arm = (): ReturnType<typeof setTimeout> =>
            setTimeout(() => {
                stall.abort(new Error(`no data for ${String(this.timeoutMs)}ms`));
            }, this.timeoutMs);
        // Armed IMMEDIATELY so waiting for headers is covered just like the body.
        let watchdog = arm();
        const rearm = (): void => {
            clearTimeout(watchdog);
            watchdog = arm();
        };

        try {
            const response = await this.request(url, stall.signal);
            this.ensureOk(response, url);

            // The name doesn't come from the URL: a name from foreign data is one more avenue for tricks.
            const target = path.join(tempDir, "artifact.vsix");
            await downloadCapped(response, this.maxArtifactBytes, url, target, rearm);
            return target;
        } finally {
            clearTimeout(watchdog);
        }
    }
}
