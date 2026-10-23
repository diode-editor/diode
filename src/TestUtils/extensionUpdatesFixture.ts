import * as fs from "node:fs";
import * as path from "node:path";

import yazl from "yazl";

import type { IExtensionRegistrySource } from "../vs/platform/extensionManagement/common/iExtensionRegistrySource.ts";
import {
    type IRegistryEngines,
    type IRegistryExtensionMeta,
    type IRegistryIndex,
    type IRegistryVersion,
    REGISTRY_SCHEMA_VERSION,
} from "../vs/platform/extensionManagement/common/registryFormat.ts";
import type { IHostVersions } from "../vs/platform/extensionManagement/common/resolveCompatibleVersion.ts";
import { sha256File } from "../vs/platform/extensionManagement/node/installFromRegistry.ts";
import {
    ProfileExtensions,
    readProfileExtensions,
    writeProfileExtensions,
} from "../vs/platform/extensionManagement/node/profileExtensions.ts";
import { ExtensionsWorkbenchService } from "../vs/workbench/contrib/extensions/node/extensionsWorkbenchService.ts";

import { createTempWorkspace, type ITempWorkspace } from "./TempWorkspace.ts";

/** A registry of real `.vsix` files and a profile on disk for the update tests of the service. */

export const HOST: IHostVersions = { diode: "1.0.0", vscode: "1.90.0" };
export const COMPATIBLE: IRegistryEngines = { vscode: "^1.90.0" };
export const INCOMPATIBLE: IRegistryEngines = { vscode: "^2.0.0" };
const PROFILE_FILE = "extensions/extensions.json";

export interface IVersionSpec {
    readonly version: string;
    readonly engines?: IRegistryEngines;
    readonly targetPlatform?: string;
    /** A wrong sha256: installing this version fails. */
    readonly corrupt?: boolean;
    readonly publishedAt?: string;
}

export class FakeSource implements IExtensionRegistrySource {
    public indexCalls = 0;
    public readonly metaCalls: string[] = [];
    public failMeta = new Set<string>();
    /** The index read fails with this reason. */
    public indexError: string | undefined;

    public constructor(
        public index: IRegistryIndex,
        public metas: Record<string, IRegistryExtensionMeta>,
    ) {}

    public getIndex(): Promise<IRegistryIndex> {
        this.indexCalls++;
        if (this.indexError !== undefined) return Promise.reject(new Error(this.indexError));
        return Promise.resolve(this.index);
    }

    public getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        this.metaCalls.push(id);
        if (this.failMeta.has(id)) return Promise.reject(new Error(`meta of ${id} is unreachable`));
        return Promise.resolve(this.metas[id]);
    }

    public fetchArtifact(version: IRegistryVersion): Promise<string> {
        return Promise.resolve((version.artifact as { path: string }).path);
    }
}

function buildVsix(file: string, manifest: object): Promise<void> {
    return new Promise((resolve, reject) => {
        const zip = new yazl.ZipFile();
        zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "extension/package.json");
        const out = fs.createWriteStream(file);
        out.on("close", () => {
            resolve();
        });
        out.on("error", reject);
        zip.outputStream.pipe(out);
        zip.end();
    });
}

export interface IUpdatesFixture {
    readonly warnings: string[];
    workspace(): ITempWorkspace;
    /** The index's `latest` is the last spec of each id, like a registry built in that order. */
    registry(extensions: Record<string, readonly IVersionSpec[]>): Promise<FakeSource>;
    /** `pinned` marks the profile entry as pinned (a version chosen by hand). */
    installed(id: string, version: string, pinned?: boolean): void;
    createService(source: IExtensionRegistrySource, host?: IHostVersions): ExtensionsWorkbenchService;
    card(service: ExtensionsWorkbenchService, id: string): unknown;
    /** By id: the profile moves a reinstalled entry to its end, which is not what these tests are about. */
    profileState(): unknown;
    /** A second service over the same profile: another window. */
    profile(): ProfileExtensions;
    dispose(): void;
}

export function createUpdatesFixture(): IUpdatesFixture {
    let ws: ITempWorkspace | undefined;
    const warnings: string[] = [];

    const workspace = (): ITempWorkspace => {
        ws ??= createTempWorkspace({ prefix: "diode-extension-updates-" });
        return ws;
    };

    const profile = (): ProfileExtensions => {
        const root = workspace();
        return new ProfileExtensions({
            extensionsDir: root.path("extensions"),
            profileFile: root.path(PROFILE_FILE),
            allProfileFiles: () => [root.path(PROFILE_FILE)],
        });
    };

    return {
        warnings,
        workspace,
        profile,
        async registry(extensions) {
            const root = workspace();
            const metas: Record<string, IRegistryExtensionMeta> = {};
            const entries = [];
            for (const [id, specs] of Object.entries(extensions)) {
                const [publisher, name] = id.split(".");
                const versions: IRegistryVersion[] = [];
                for (const spec of specs) {
                    const vsix = root.path(
                        `artifacts/${id}-${spec.version}-${spec.targetPlatform ?? "universal"}.vsix`,
                    );
                    fs.mkdirSync(path.dirname(vsix), { recursive: true });
                    await buildVsix(vsix, { publisher, name, version: spec.version });
                    versions.push({
                        version: spec.version,
                        engines: spec.engines ?? COMPATIBLE,
                        artifact: { type: "path", path: vsix },
                        sha256: spec.corrupt === true ? "0".repeat(64) : await sha256File(vsix),
                        ...(spec.targetPlatform === undefined ? {} : { targetPlatform: spec.targetPlatform }),
                        ...(spec.publishedAt === undefined ? {} : { publishedAt: spec.publishedAt }),
                    });
                }
                const latest = specs[specs.length - 1];
                metas[id] = {
                    schemaVersion: REGISTRY_SCHEMA_VERSION,
                    id,
                    publisher,
                    name,
                    displayName: name,
                    description: "",
                    kind: "native",
                    versions,
                };
                entries.push({
                    id,
                    publisher,
                    name,
                    displayName: name,
                    description: "",
                    kind: "native" as const,
                    latest: { version: latest.version, engines: latest.engines ?? COMPATIBLE },
                });
            }
            return new FakeSource({ schemaVersion: REGISTRY_SCHEMA_VERSION, extensions: entries }, metas);
        },
        installed(id, version, pinned = false) {
            const root = workspace();
            const [publisher, name] = id.split(".");
            root.writeFile(`extensions/${id}-${version}/package.json`, JSON.stringify({ publisher, name, version }));
            const entries = readProfileExtensions(root.path(PROFILE_FILE)) ?? [];
            writeProfileExtensions(root.path(PROFILE_FILE), [
                ...entries,
                { identifier: { id }, version, ...(pinned ? { metadata: { pinned: true } } : {}) },
            ]);
        },
        createService(source, host = HOST) {
            return new ExtensionsWorkbenchService(source, profile(), host, {
                warn: (message: string) => warnings.push(message),
            });
        },
        card(service, id) {
            const found = service.getEntries().find((e) => e.id === id);
            return (
                found && { latest: found.latestVersion, installed: found.installedVersion, state: found.availability }
            );
        },
        profileState() {
            return readProfileExtensions(workspace().path(PROFILE_FILE))
                ?.map((e) => [e.identifier.id, e.version, e.metadata?.pinned ?? false])
                .sort(([a], [b]) => String(a).localeCompare(String(b)));
        },
        dispose() {
            ws?.dispose();
            ws = undefined;
            warnings.length = 0;
        },
    };
}
