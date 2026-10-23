import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IExtensionRegistrySource } from "../../../../platform/extensionManagement/common/iExtensionRegistrySource.ts";
import {
    type IRegistryEngines,
    type IRegistryExtensionMeta,
    type IRegistryIndex,
    type IRegistryVersion,
    REGISTRY_SCHEMA_VERSION,
} from "../../../../platform/extensionManagement/common/registryFormat.ts";
import type { IHostVersions } from "../../../../platform/extensionManagement/common/resolveCompatibleVersion.ts";
import { sha256File } from "../../../../platform/extensionManagement/node/installFromRegistry.ts";
import {
    ProfileExtensions,
    readProfileExtensions,
    writeProfileExtensions,
} from "../../../../platform/extensionManagement/node/profileExtensions.ts";

import { ExtensionsWorkbenchService } from "./extensionsWorkbenchService.ts";

/** ExtensionUpdates stage 2: the target version, `outdated` by semver, `checkForUpdates` and `updateAll`. */

const HOST: IHostVersions = { diode: "1.0.0", vscode: "1.90.0" };
const COMPATIBLE: IRegistryEngines = { vscode: "^1.90.0" };
const INCOMPATIBLE: IRegistryEngines = { vscode: "^2.0.0" };
const PROFILE_FILE = "extensions/extensions.json";

interface IVersionSpec {
    readonly version: string;
    readonly engines?: IRegistryEngines;
    readonly targetPlatform?: string;
    /** A wrong sha256: installing this version fails. */
    readonly corrupt?: boolean;
}

class FakeSource implements IExtensionRegistrySource {
    public indexCalls = 0;
    public readonly metaCalls: string[] = [];
    public failMeta = new Set<string>();

    public constructor(
        public index: IRegistryIndex,
        private readonly metas: Record<string, IRegistryExtensionMeta>,
    ) {}

    public getIndex(): Promise<IRegistryIndex> {
        this.indexCalls++;
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

describe("ExtensionsWorkbenchService — updates (ExtensionUpdates stage 2)", () => {
    let ws: ITempWorkspace | undefined;
    const warnings: string[] = [];

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
        warnings.length = 0;
    });

    function workspace(): ITempWorkspace {
        ws ??= createTempWorkspace({ prefix: "diode-extension-updates-" });
        return ws;
    }

    /** The index's `latest` is the last spec of each id, like a registry built in that order. */
    async function registry(extensions: Record<string, readonly IVersionSpec[]>): Promise<FakeSource> {
        const root = workspace();
        const metas: Record<string, IRegistryExtensionMeta> = {};
        const entries = [];
        for (const [id, specs] of Object.entries(extensions)) {
            const [publisher, name] = id.split(".");
            const versions: IRegistryVersion[] = [];
            for (const spec of specs) {
                const vsix = root.path(`artifacts/${id}-${spec.version}-${spec.targetPlatform ?? "universal"}.vsix`);
                fs.mkdirSync(path.dirname(vsix), { recursive: true });
                await buildVsix(vsix, { publisher, name, version: spec.version });
                versions.push({
                    version: spec.version,
                    engines: spec.engines ?? COMPATIBLE,
                    artifact: { type: "path", path: vsix },
                    sha256: spec.corrupt === true ? "0".repeat(64) : await sha256File(vsix),
                    ...(spec.targetPlatform === undefined ? {} : { targetPlatform: spec.targetPlatform }),
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
    }

    /** `pinned` marks the profile entry as pinned (a version chosen by hand). */
    function installed(id: string, version: string, pinned = false): void {
        const root = workspace();
        const [publisher, name] = id.split(".");
        root.writeFile(`extensions/${id}-${version}/package.json`, JSON.stringify({ publisher, name, version }));
        const entries = readProfileExtensions(root.path(PROFILE_FILE)) ?? [];
        writeProfileExtensions(root.path(PROFILE_FILE), [
            ...entries,
            { identifier: { id }, version, ...(pinned ? { metadata: { pinned: true } } : {}) },
        ]);
    }

    function createService(source: IExtensionRegistrySource, host: IHostVersions = HOST): ExtensionsWorkbenchService {
        const root = workspace();
        const profile = new ProfileExtensions({
            extensionsDir: root.path("extensions"),
            profileFile: root.path(PROFILE_FILE),
            allProfileFiles: () => [root.path(PROFILE_FILE)],
        });
        return new ExtensionsWorkbenchService(source, profile, host, {
            warn: (message: string) => warnings.push(message),
        });
    }

    function card(service: ExtensionsWorkbenchService, id: string): unknown {
        const found = service.getEntries().find((e) => e.id === id);
        return found && { latest: found.latestVersion, installed: found.installedVersion, state: found.availability };
    }

    /** By id: the profile moves a reinstalled entry to its end, which is not what these tests are about. */
    function profileState(): unknown {
        return readProfileExtensions(workspace().path(PROFILE_FILE))
            ?.map((e) => [e.identifier.id, e.version, e.metadata?.pinned ?? false])
            .sort(([a], [b]) => String(a).localeCompare(String(b)));
    }

    describe("target version and availability", () => {
        it("a compatible latest is the target, and no metadata is fetched for it", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(source);

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "1.0.0", state: "outdated" });
            expect(source.metaCalls).toEqual([]);
        });

        it("US-2.1: an incompatible latest with a newer compatible version — outdated to that version", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({
                "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
            });
            const service = createService(source);

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "1.0.0", state: "outdated" });
            expect(source.metaCalls).toEqual(["acme.tools"]);
        });

        it("US-2.2: not installed with an incompatible latest but a compatible older one — available", async () => {
            const source = await registry({
                "acme.tools": [{ version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
            });
            const service = createService(source);

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: null, state: "available" });
        });

        it("US-2.2: no compatible version at all — incompatible, and the latest stays for the reason text", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({
                "acme.tools": [
                    { version: "1.5.0", engines: INCOMPATIBLE },
                    { version: "2.0.0", engines: INCOMPATIBLE },
                ],
                "acme.fresh": [{ version: "2.0.0", engines: INCOMPATIBLE }],
            });
            const service = createService(source);

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "2.0.0", installed: "1.0.0", state: "incompatible" });
            expect(card(service, "acme.fresh")).toEqual({ latest: "2.0.0", installed: null, state: "incompatible" });
        });

        it("US-2.3: an installed version newer than the target is not outdated", async () => {
            installed("acme.tools", "1.5.0");
            installed("acme.ahead", "3.0.0");
            const source = await registry({
                "acme.tools": [{ version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
                "acme.ahead": [{ version: "2.0.0" }],
            });
            const service = createService(source);

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "1.5.0", state: "installed" });
            expect(card(service, "acme.ahead")).toEqual({ latest: "2.0.0", installed: "3.0.0", state: "installed" });
            expect(service.getOutdated()).toEqual([]);
        });

        it("US-2.3: a pinned older version is outdated and stays pinned", async () => {
            installed("acme.tools", "1.0.0", true);
            const service = createService(
                await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] }),
            );

            await service.ensureLoaded();

            expect(service.getOutdated().map((e) => [e.id, e.pinned])).toEqual([["acme.tools", true]]);
        });

        it("a platform record counts only on its platform", async () => {
            const specs: IVersionSpec[] = [
                { version: "1.1.0" },
                { version: "1.2.0", targetPlatform: "linux-x64" },
                { version: "2.0.0", engines: INCOMPATIBLE },
            ];
            const universal = createService(await registry({ "acme.tools": specs }));
            await universal.ensureLoaded();
            expect(card(universal, "acme.tools")).toMatchObject({ latest: "1.1.0" });

            const linux = createService(await registry({ "acme.tools": specs }), {
                ...HOST,
                targetPlatform: "linux-x64",
            });
            await linux.ensureLoaded();
            expect(card(linux, "acme.tools")).toMatchObject({ latest: "1.2.0" });
        });

        it("a metadata failure leaves the entry incompatible, goes to the log and is not a catalog error", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({
                "acme.tools": [{ version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
                "acme.other": [{ version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
            });
            source.failMeta.add("acme.tools");
            const service = createService(source);

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "2.0.0", installed: "1.0.0", state: "incompatible" });
            expect(card(service, "acme.other")).toMatchObject({ latest: "1.1.0", state: "available" });
            expect(service.getCatalogError()).toBeNull();
            expect(warnings).toEqual(["Could not read the metadata of acme.tools: meta of acme.tools is unreachable"]);
        });

        it("metadata the registry does not have — incompatible", async () => {
            const source = await registry({ "acme.tools": [{ version: "2.0.0", engines: INCOMPATIBLE }] });
            const service = createService(
                new FakeSource(source.index, {} satisfies Record<string, IRegistryExtensionMeta>),
            );

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toMatchObject({ latest: "2.0.0", state: "incompatible" });
        });

        it("no network at startup: metadata waits for the catalog", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({
                "acme.tools": [{ version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
            });

            createService(source);

            expect(source.indexCalls).toBe(0);
            expect(source.metaCalls).toEqual([]);
        });

        it("refresh reuses the metadata cache; checkForUpdates re-reads the index and the metadata", async () => {
            const source = await registry({
                "acme.tools": [{ version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
            });
            const service = createService(source);
            await service.ensureLoaded();
            await service.refresh();
            expect(source.metaCalls).toEqual(["acme.tools"]);
            expect(source.indexCalls).toBe(2);

            await service.checkForUpdates();

            expect(source.indexCalls).toBe(3);
            expect(source.metaCalls).toEqual(["acme.tools", "acme.tools"]);
        });

        it("checkForUpdates sees a version that appeared in the registry", async () => {
            installed("acme.tools", "1.0.0");
            const before = await registry({ "acme.tools": [{ version: "1.0.0" }] });
            const service = createService(before);
            await service.ensureLoaded();
            expect(service.getOutdated()).toEqual([]);

            before.index = (await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] })).index;
            await service.checkForUpdates();

            expect(service.getOutdated().map((e) => e.id)).toEqual(["acme.tools"]);
        });
    });

    describe("getOutdated", () => {
        it("US-2.10: only profile entries the registry knows; sideloaded and uninstalled ones are not", async () => {
            installed("acme.tools", "1.0.0");
            installed("local.sideloaded", "0.1.0");
            const service = createService(
                await registry({
                    "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }],
                    "acme.other": [{ version: "1.0.0" }],
                }),
            );

            expect(service.getOutdated()).toEqual([]);
            await service.ensureLoaded();

            expect(service.getOutdated().map((e) => e.id)).toEqual(["acme.tools"]);
        });
    });

    describe("updateAll", () => {
        it("US-2.6: updates every outdated entry in list order, pinned ones too, keeping the pin", async () => {
            installed("acme.pinned", "1.0.0", true);
            installed("acme.plain", "1.0.0");
            installed("acme.current", "1.0.0");
            installed("local.sideloaded", "0.1.0");
            const service = createService(
                await registry({
                    "acme.plain": [{ version: "1.0.0" }, { version: "1.1.0" }],
                    "acme.pinned": [
                        { version: "1.0.0" },
                        { version: "1.1.0" },
                        { version: "2.0.0", engines: INCOMPATIBLE },
                    ],
                    "acme.current": [{ version: "1.0.0" }],
                }),
            );
            await service.ensureLoaded();

            const result = await service.updateAll();

            expect(result).toEqual({
                updated: [
                    { id: "acme.plain", version: "1.1.0" },
                    { id: "acme.pinned", version: "1.1.0" },
                ],
                failed: [],
            });
            expect(profileState()).toEqual([
                ["acme.current", "1.0.0", false],
                ["acme.pinned", "1.1.0", true],
                ["acme.plain", "1.1.0", false],
                ["local.sideloaded", "0.1.0", false],
            ]);
            expect(service.getOutdated()).toEqual([]);
            expect(
                service
                    .getEntries()
                    .filter((e) => e.needsReload)
                    .map((e) => e.id),
            ).toEqual(["acme.plain", "acme.pinned"]);
        });

        it("US-2.6: one failure does not stop the rest", async () => {
            installed("acme.broken", "1.0.0");
            installed("acme.plain", "1.0.0");
            const service = createService(
                await registry({
                    "acme.broken": [{ version: "1.0.0" }, { version: "1.1.0", corrupt: true }],
                    "acme.plain": [{ version: "1.0.0" }, { version: "1.1.0" }],
                }),
            );
            await service.ensureLoaded();

            const result = await service.updateAll();

            expect(result.updated).toEqual([{ id: "acme.plain", version: "1.1.0" }]);
            expect(result.failed.map((f) => f.id)).toEqual(["acme.broken"]);
            expect(result.failed[0]?.error).toContain("sha256 mismatch");
            expect(profileState()).toEqual([
                ["acme.broken", "1.0.0", false],
                ["acme.plain", "1.1.0", false],
            ]);
        });

        it("nothing outdated — nothing to do", async () => {
            installed("acme.tools", "1.0.0");
            const service = createService(await registry({ "acme.tools": [{ version: "1.0.0" }] }));
            await service.ensureLoaded();

            expect(await service.updateAll()).toEqual({ updated: [], failed: [] });
        });
    });
});
