import * as fs from "node:fs";
import * as path from "node:path";

import { loadSemver } from "../../../base/common/semver.ts";
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
 * `node:fs`, not `IAssetAccess`: the registry directory is external data, and
 * `fetchArtifact` must return a physical path for `installVsix`.
 */

export class FileExtensionRegistrySource implements IExtensionRegistrySource {
    private readonly rootDir: string;
    private readonly onProblem: ((message: string) => void) | undefined;

    public constructor(rootDir: string, onProblem?: (message: string) => void) {
        this.rootDir = path.resolve(rootDir);
        this.onProblem = onProblem;
    }

    private report(problems: readonly string[]): void {
        for (const problem of problems) {
            this.onProblem?.(problem);
        }
    }

    private async readAndParse<T>(
        filePath: string,
        parse: (text: string) => { value: T; problems: string[] },
    ): Promise<T> {
        // Stryker disable next-line StringLiteral: the content goes to JSON.parse, which stringifies a Buffer as utf8 anyway; changing the encoding on registry paths (JSON is always utf8) makes no observable difference
        const text = await fs.promises.readFile(filePath, "utf8");
        try {
            const { value, problems } = parse(text);
            this.report(problems);
            return value;
        } catch (error) {
            throw new Error(`${filePath}: ${(error as Error).message}`, { cause: error });
        }
    }

    public async getIndex(): Promise<IRegistryIndex> {
        const semver = await loadSemver();
        return this.readAndParse(path.join(this.rootDir, "index.json"), (text) => {
            const { index, problems } = parseRegistryIndex(text, semver);
            return { value: index, problems };
        });
    }

    public async getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        if (!EXTENSION_ID_RE.test(id)) {
            throw new Error(`Invalid extension id: "${id}"`);
        }
        const metaPath = path.join(this.rootDir, "meta", `${id}.json`);
        const semver = await loadSemver();
        try {
            return await this.readAndParse(metaPath, (text) => {
                const { meta, problems } = parseRegistryMeta(text, semver, id);
                return { value: meta, problems };
            });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return undefined;
            }
            throw error;
        }
    }

    public async fetchArtifact(version: IRegistryVersion, tempDir: string): Promise<string> {
        void tempDir;
        const artifact = version.artifact;
        if (artifact.type !== "path") {
            throw new Error(`Artifact type "${artifact.type}" is not supported by the file registry source`);
        }
        const resolved = path.resolve(this.rootDir, artifact.path);
        // The parser rejects `..`, but an IRegistryVersion may be built programmatically.
        if (resolved !== this.rootDir && !resolved.startsWith(this.rootDir + path.sep)) {
            throw new Error(`Refusing artifact path outside the registry root: ${artifact.path}`);
        }
        try {
            await fs.promises.access(resolved);
        } catch (error) {
            throw new Error(`Artifact file not found in registry: ${resolved}`, { cause: error });
        }
        return resolved;
    }
}
