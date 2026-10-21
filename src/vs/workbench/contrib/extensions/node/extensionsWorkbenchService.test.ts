import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { setLazyModuleLoader } from "../../../../base/common/lazyModule.ts";
import type { IExtensionRegistrySource } from "../../../../platform/extensionManagement/common/iExtensionRegistrySource.ts";
import {
    type IRegistryExtensionMeta,
    type IRegistryIndex,
    type IRegistryIndexEntry,
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

const HOST: IHostVersions = { diode: "1.0.0", vscode: "1.90.0" };

function entry(overrides: Partial<IRegistryIndexEntry> & { id: string }): IRegistryIndexEntry {
    const [publisher, name] = overrides.id.split(".");
    return {
        publisher: publisher,
        name: name,
        displayName: name,
        description: "",
        kind: "native",
        latest: { version: "1.0.0", engines: { vscode: "^1.90.0" } },
        ...overrides,
    };
}

function index(...extensions: IRegistryIndexEntry[]): IRegistryIndex {
    return { schemaVersion: REGISTRY_SCHEMA_VERSION, extensions };
}

class FakeSource implements IExtensionRegistrySource {
    public indexCalls = 0;
    public metaCalls = 0;

    public constructor(
        public result: IRegistryIndex | Error,
        private readonly metas: Record<string, IRegistryExtensionMeta> = {},
    ) {}

    public getIndex(): Promise<IRegistryIndex> {
        this.indexCalls++;
        return this.result instanceof Error ? Promise.reject(this.result) : Promise.resolve(this.result);
    }

    public getMeta(id: string): Promise<IRegistryExtensionMeta | undefined> {
        this.metaCalls++;
        return Promise.resolve(this.metas[id]);
    }

    public fetchArtifact(version: IRegistryVersion): Promise<string> {
        if (version.artifact.type !== "path") throw new Error("not used");
        return Promise.resolve(version.artifact.path);
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
        zip.outputStream.on("error", reject);
        zip.outputStream.pipe(out);
        zip.end();
    });
}

/** The service profile's contents (Default: a file in the extensions directory) and another profile's. */
const PROFILE_FILE = "extensions/extensions.json";
const OTHER_PROFILE_FILE = "profiles/other/extensions.json";

function addToProfile(ws: ITempWorkspace, file: string, id: string, version: string): void {
    const entries = readProfileExtensions(ws.path(file)) ?? [];
    writeProfileExtensions(ws.path(file), [...entries, { identifier: { id }, version }]);
}

/** `inProfile: false` means on disk only. */
function installOnDisk(
    ws: ITempWorkspace,
    id: string,
    version: string,
    manifest: Record<string, unknown> = {},
    inProfile = true,
): void {
    const [publisher, name] = id.split(".");
    ws.writeFile(`extensions/${id}-${version}/package.json`, JSON.stringify({ publisher, name, version, ...manifest }));
    if (inProfile) addToProfile(ws, PROFILE_FILE, id, version);
}

function profileIds(ws: ITempWorkspace, file: string): string[] | undefined {
    return readProfileExtensions(ws.path(file))?.map((e) => e.identifier.id);
}

describe("ExtensionsWorkbenchService", () => {
    let ws: ITempWorkspace | undefined;

    afterEach(() => {
        ws?.dispose();
        ws = undefined;
        setLazyModuleLoader(undefined);
    });

    function createService(source: IExtensionRegistrySource): ExtensionsWorkbenchService {
        ws ??= createTempWorkspace({ prefix: "diode-extensions-view-" });
        const root = ws;
        const profile = new ProfileExtensions({
            extensionsDir: root.path("extensions"),
            profileFile: root.path(PROFILE_FILE),
            allProfileFiles: () => [root.path(PROFILE_FILE), root.path(OTHER_PROFILE_FILE)],
        });
        return new ExtensionsWorkbenchService(source, profile, HOST);
    }

    describe("profile contents", () => {
        it("an extension on disk outside the profile is not in the list", () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "1.0.0");
            installOnDisk(ws, "acme.elsewhere", "1.0.0", {}, false);

            const service = createService(new FakeSource(index()));

            expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);
        });

        it("a registry card for an extension of another profile is available", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "1.0.0", {}, false);
            addToProfile(ws, OTHER_PROFILE_FILE, "acme.tools", "1.0.0");
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

            await service.ensureLoaded();

            expect(service.getEntries()[0]?.availability).toBe("available");
            expect(service.getEntries()[0]?.installedVersion).toBeNull();
        });

        it("uninstall removes from the profile but not from disk while another profile needs the extension", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "1.0.0");
            addToProfile(ws, OTHER_PROFILE_FILE, "acme.tools", "1.0.0");
            const service = createService(new FakeSource(index()));

            const result = await service.uninstall("acme.tools");

            expect(result).toEqual({ ok: true });
            expect(profileIds(ws, PROFILE_FILE)).toEqual([]);
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0/package.json"))).toBe(true);
            expect(service.getEntries()).toEqual([]);
        });
    });

    it("before the first show the catalog is empty, but installed extensions are already visible", () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "acme.tools", "1.0.0");
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);
        expect(service.getEntries()[0]?.latestVersion).toBeNull();
    });

    it("ensureLoaded reads the index once, refresh every time", async () => {
        const source = new FakeSource(index(entry({ id: "acme.tools" })));
        const service = createService(source);

        await service.ensureLoaded();
        await service.ensureLoaded();
        expect(source.indexCalls).toBe(1);

        await service.refresh();
        expect(source.indexCalls).toBe(2);
    });

    it("a catalog contents change reaches subscribers", async () => {
        const source = new FakeSource(index(entry({ id: "acme.tools" })));
        const service = createService(source);
        let changes = 0;
        service.onDidChange(() => {
            changes++;
        });

        await service.ensureLoaded();
        expect(changes).toBe(1);
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);

        source.result = index(entry({ id: "acme.tools" }), entry({ id: "acme.other" }));
        await service.refresh();
        expect(changes).toBe(2);
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools", "acme.other"]);
    });

    it("the subscription is removed by disposing the reference", async () => {
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
        let changes = 0;
        const subscription = service.onDidChange(() => {
            changes++;
        });

        subscription.dispose();
        await service.ensureLoaded();
        expect(changes).toBe(0);
    });

    describe("card state", () => {
        it("not installed and compatible — available", async () => {
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
            await service.ensureLoaded();
            expect(service.getEntries()[0]?.availability).toBe("available");
        });

        it("latest version installed — installed", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "1.0.0");
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

            await service.ensureLoaded();
            expect(service.getEntries()[0]).toMatchObject({
                availability: "installed",
                installedVersion: "1.0.0",
                latestVersion: "1.0.0",
            });
        });

        it("installed version older than the registry one — outdated", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "0.9.0");
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

            await service.ensureLoaded();
            expect(service.getEntries()[0]).toMatchObject({
                availability: "outdated",
                installedVersion: "0.9.0",
                latestVersion: "1.0.0",
            });
        });

        it("engines of the latest version do not fit the build — incompatible", async () => {
            const source = new FakeSource(
                index(entry({ id: "acme.tools", latest: { version: "2.0.0", engines: { vscode: "^99.0.0" } } })),
            );
            const service = createService(source);

            await service.ensureLoaded();
            expect(service.getEntries()[0]?.availability).toBe("incompatible");
        });

        it("incompatibility takes precedence over the installed version", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "0.9.0");
            const source = new FakeSource(
                index(entry({ id: "acme.tools", latest: { version: "2.0.0", engines: { vscode: "^99.0.0" } } })),
            );
            const service = createService(source);

            await service.ensureLoaded();
            expect(service.getEntries()[0]?.availability).toBe("incompatible");
        });

        // semver is a lazy chunk: the service is created at workbench startup,
        // and the chunk must not load until someone opens the catalog.
        it("semver loads with the catalog, not at service creation", async () => {
            const requested: string[] = [];
            setLazyModuleLoader(<T>(id: string, importer: () => Promise<T>) => {
                requested.push(id);
                return importer();
            });
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.installed", "1.0.0");
            const service = createService(
                new FakeSource(
                    index(entry({ id: "acme.tools", latest: { version: "2.0.0", engines: { vscode: "^99.0.0" } } })),
                ),
            );

            expect(service.getEntries().map((e) => e.id)).toEqual(["acme.installed"]);
            expect(requested).toEqual([]);

            await service.ensureLoaded();

            expect(requested).toContain("semver");
            expect(service.getEntries()[0]?.availability).toBe("incompatible");
        });
    });

    it("installed from the marketplace — one card, not two", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "acme.tools", "1.0.0");
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

        await service.ensureLoaded();
        // The entry is both in the index and on disk, but there is one entry: otherwise the same
        // extension would show again as "installed outside the marketplace".
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);
    });

    it("installed outside the registry comes after the catalog and takes fields from the manifest", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "local.sideloaded", "0.1.0", {
            displayName: "Sideloaded",
            description: "Installed by hand",
        });
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));

        await service.ensureLoaded();
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools", "local.sideloaded"]);
        expect(service.getEntries()[1]).toMatchObject({
            publisher: "local",
            name: "sideloaded",
            displayName: "Sideloaded",
            description: "Installed by hand",
            kind: undefined,
            latestVersion: null,
            installedVersion: "0.1.0",
            availability: "installed",
        });
    });

    it("a manifest without displayName/description — the card makes do with the id", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "local.bare", "0.1.0");
        const service = createService(new FakeSource(index()));

        await service.ensureLoaded();
        expect(service.getEntries()[0]).toMatchObject({
            displayName: "local.bare",
            description: "",
        });
    });

    it("a network error is not thrown: the catalog is empty, the reason is in getCatalogError", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        installOnDisk(ws, "local.sideloaded", "0.1.0");
        const service = createService(new FakeSource(new Error("getaddrinfo ENOTFOUND example.invalid")));

        await service.ensureLoaded();
        expect(service.getCatalogError()).toBe("getaddrinfo ENOTFOUND example.invalid");
        // Installed extensions are visible without network: otherwise offline would deprive the user
        // of the only list that doesn't need the registry at all.
        expect(service.getEntries().map((e) => e.id)).toEqual(["local.sideloaded"]);
    });

    it("a non-Error failure reason also arrives as text", async () => {
        const source = new FakeSource(index());
        const service = createService(source);
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the suite checks a non-Error rejection SPECIFICALLY
        source.getIndex = () => Promise.reject("boom");

        await service.ensureLoaded();
        expect(service.getCatalogError()).toBe("boom");
    });

    it("a successful refresh clears the previous error", async () => {
        const source = new FakeSource(new Error("offline"));
        const service = createService(source);
        await service.ensureLoaded();
        expect(service.getCatalogError()).toBe("offline");

        source.result = index(entry({ id: "acme.tools" }));
        await service.refresh();
        expect(service.getCatalogError()).toBeNull();
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);
    });

    it("a failed refresh keeps the previous catalog", async () => {
        const source = new FakeSource(index(entry({ id: "acme.tools" })));
        const service = createService(source);
        await service.ensureLoaded();

        source.result = new Error("offline");
        await service.refresh();
        expect(service.getEntries().map((e) => e.id)).toEqual(["acme.tools"]);
        expect(service.getCatalogError()).toBe("offline");
    });

    it("reloadInstalled picks up an extension that appeared on disk", async () => {
        ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
        const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
        await service.ensureLoaded();
        expect(service.getEntries()[0]?.availability).toBe("available");

        installOnDisk(ws, "acme.tools", "1.0.0");
        service.reloadInstalled();
        expect(service.getEntries()[0]?.availability).toBe("installed");
    });

    describe("getMeta", () => {
        const meta: IRegistryExtensionMeta = {
            schemaVersion: REGISTRY_SCHEMA_VERSION,
            id: "acme.tools",
            publisher: "acme",
            name: "tools",
            displayName: "Tools",
            description: "",
            kind: "native",
            versions: [],
        };

        it("caches the registry response", async () => {
            const source = new FakeSource(index(entry({ id: "acme.tools" })), { "acme.tools": meta });
            const service = createService(source);

            expect(await service.getMeta("acme.tools")).toBe(meta);
            expect(await service.getMeta("acme.tools")).toBe(meta);
            expect(source.metaCalls).toBe(1);
        });

        it("caches a miss too — 'no such id' is also an answer", async () => {
            const source = new FakeSource(index());
            const service = createService(source);

            expect(await service.getMeta("acme.missing")).toBeUndefined();
            expect(await service.getMeta("acme.missing")).toBeUndefined();
            expect(source.metaCalls).toBe(1);
        });
    });

    it("dispose removes subscriptions", async () => {
        const source = new FakeSource(index(entry({ id: "acme.tools" })));
        const service = createService(source);
        let changes = 0;
        service.onDidChange(() => {
            changes++;
        });

        service.dispose();
        await service.ensureLoaded();
        expect(changes).toBe(0);
    });

    describe("install and uninstall", () => {
        async function withInstallable(
            version = "1.0.0",
            options: { sha256?: string; dependsOn?: string } = {},
        ): Promise<{ service: ExtensionsWorkbenchService; source: FakeSource }> {
            const metas: Record<string, IRegistryExtensionMeta> = {
                "acme.tools": await registryMeta(
                    "acme.tools",
                    version,
                    options.dependsOn === undefined ? {} : { extensionDependencies: [options.dependsOn] },
                    options.sha256,
                ),
            };
            if (options.dependsOn !== undefined)
                metas[options.dependsOn] = await registryMeta(options.dependsOn, "2.0.0");
            const source = new FakeSource(
                index(entry({ id: "acme.tools", latest: { version, engines: { vscode: "^1.90.0" } } })),
                metas,
            );
            return { service: createService(source), source };
        }

        async function registryMeta(
            id: string,
            version: string,
            manifest: Record<string, unknown> = {},
            sha256?: string,
        ): Promise<IRegistryExtensionMeta> {
            ws ??= createTempWorkspace({ prefix: "diode-extensions-view-" });
            const [publisher, name] = id.split(".");
            const vsix = ws.path(`artifacts/${id}-${version}.vsix`);
            fs.mkdirSync(path.dirname(vsix), { recursive: true });
            await buildVsix(vsix, { publisher, name, version, ...manifest });
            return {
                schemaVersion: REGISTRY_SCHEMA_VERSION,
                id,
                publisher,
                name,
                displayName: id === "acme.tools" ? "Acme Tools" : name,
                description: "",
                kind: "native",
                versions: [
                    {
                        version,
                        engines: { vscode: "^1.90.0" },
                        artifact: { type: "path", path: vsix },
                        sha256: sha256 ?? (await sha256File(vsix)),
                    },
                ],
            };
        }

        it("dependencies install along with the extension and also wait for a reload", async () => {
            const { service } = await withInstallable("1.0.0", { dependsOn: "acme.base" });
            await service.ensureLoaded();

            const result = await service.install("acme.tools");

            expect(result).toEqual({ ok: true, version: "1.0.0" });
            expect(fs.existsSync(ws!.path("extensions/acme.base-2.0.0/package.json"))).toBe(true);
            expect(profileIds(ws!, PROFILE_FILE)).toEqual(["acme.tools", "acme.base"]);
            // The dependency is not in the registry catalog, so its entry is sideloaded,
            // but with the same reload badge as the extension itself.
            const cards = new Map(service.getEntries().map((card) => [card.id, card]));
            expect(cards.get("acme.tools")?.needsReload).toBe(true);
            expect(cards.get("acme.base")?.installedVersion).toBe("2.0.0");
            expect(cards.get("acme.base")?.needsReload).toBe(true);
        });

        it("installs the extension to disk and marks the card as pending reload", async () => {
            const { service } = await withInstallable();
            await service.ensureLoaded();

            const result = await service.install("acme.tools");

            expect(result).toEqual({ ok: true, version: "1.0.0" });
            expect(fs.existsSync(ws!.path("extensions/acme.tools-1.0.0/package.json"))).toBe(true);
            const card = service.getEntries()[0];
            expect(card.installedVersion).toBe("1.0.0");
            expect(card.availability).toBe("installed");
            // Contributions are scanned at startup: the extension doesn't work until a window reload.
            expect(card.needsReload).toBe(true);
        });

        it("install also adds to the profile a dependency already on disk for another profile", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.base", "2.0.0", {}, false);
            addToProfile(ws, OTHER_PROFILE_FILE, "acme.base", "2.0.0");
            const { service } = await withInstallable("1.0.0", { dependsOn: "acme.base" });

            await service.install("acme.tools");

            expect(profileIds(ws, PROFILE_FILE)).toEqual(["acme.tools", "acme.base"]);
            expect(profileIds(ws, OTHER_PROFILE_FILE)).toEqual(["acme.base"]);
            // The registry catalog was not read, so these are entries of installed extensions, by id.
            expect(service.getEntries().map((e) => e.id)).toEqual(["acme.base", "acme.tools"]);
        });

        it("install redraws the list for subscribers", async () => {
            const { service } = await withInstallable();
            await service.ensureLoaded();
            let changes = 0;
            service.onDidChange(() => {
                changes++;
            });

            await service.install("acme.tools");

            expect(changes).toBe(1);
        });

        it("update removes the previous version — one remains on disk", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "0.9.0");
            const { service } = await withInstallable("1.0.0");
            await service.ensureLoaded();
            expect(service.getEntries()[0]?.availability).toBe("outdated");

            await service.install("acme.tools");

            expect(fs.existsSync(ws.path("extensions/acme.tools-0.9.0"))).toBe(false);
            expect(service.getEntries()[0]?.installedVersion).toBe("1.0.0");
        });

        it("a broken artifact is not installed and the reason is returned as text", async () => {
            const { service } = await withInstallable("1.0.0", { sha256: "0".repeat(64) });
            await service.ensureLoaded();

            const result = await service.install("acme.tools");

            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toContain("sha256 mismatch");
            // No trace on disk and no "waiting for reload": nothing happened.
            expect(fs.existsSync(ws!.path("extensions/acme.tools-1.0.0"))).toBe(false);
            expect(service.getEntries()[0]?.needsReload).toBe(false);
        });

        it("an id unknown to the registry is an error value, not an exception", async () => {
            const service = createService(new FakeSource(index()));

            await expect(service.install("acme.missing")).resolves.toEqual({
                ok: false,
                error: 'Extension "acme.missing" not found in registry',
            });
        });

        it("removes the extension from disk and asks for a reload", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "1.0.0");
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
            await service.ensureLoaded();

            const result = await service.uninstall("acme.tools");

            expect(result).toEqual({ ok: true });
            expect(fs.existsSync(ws.path("extensions/acme.tools-1.0.0"))).toBe(false);
            expect(profileIds(ws, PROFILE_FILE)).toEqual([]);
            const card = service.getEntries()[0];
            expect(card.installedVersion).toBeNull();
            expect(card.needsReload).toBe(true);
        });

        it("nothing to uninstall is a refusal, not a silent success", async () => {
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
            await service.ensureLoaded();

            const result = await service.uninstall("acme.tools");

            expect(result).toEqual({ ok: false, error: "Extension acme.tools is not installed" });
            expect(service.getEntries()[0]?.needsReload).toBe(false);
        });

        it.skipIf(process.platform === "win32")("a file system failure arrives as text, not an exception", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "acme.tools", "1.0.0");
            const service = createService(new FakeSource(index(entry({ id: "acme.tools" }))));
            await service.ensureLoaded();

            // The extensions directory is read-only: nothing can be removed from it.
            fs.chmodSync(ws.path("extensions"), 0o500);
            try {
                const result = await service.uninstall("acme.tools");
                expect(result.ok).toBe(false);
                expect(!result.ok && result.error).toMatch(/EACCES|EPERM/);
            } finally {
                fs.chmodSync(ws.path("extensions"), 0o700);
            }
        });

        it("a pending reload survives a catalog Refresh", async () => {
            const { service, source } = await withInstallable();
            await service.ensureLoaded();
            await service.install("acme.tools");

            source.result = index(entry({ id: "acme.tools" }), entry({ id: "acme.other" }));
            await service.refresh();

            expect(service.getEntries().find((e) => e.id === "acme.tools")?.needsReload).toBe(true);
            expect(service.getEntries().find((e) => e.id === "acme.other")?.needsReload).toBe(false);
        });

        it("a sideloaded extension also waits for a reload after uninstall", async () => {
            ws = createTempWorkspace({ prefix: "diode-extensions-view-" });
            installOnDisk(ws, "solo.thing", "0.1.0");
            installOnDisk(ws, "other.thing", "0.1.0");
            const service = createService(new FakeSource(index()));

            await service.uninstall("solo.thing");

            // The removed one is gone from the list; the neighbor entry is not flagged.
            expect(service.getEntries().map((e) => e.id)).toEqual(["other.thing"]);
            expect(service.getEntries()[0]?.needsReload).toBe(false);
        });
    });
});
