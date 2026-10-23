import * as fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { createUpdatesFixture } from "../../../../../TestUtils/extensionUpdatesFixture.ts";

/** ExtensionUpdates stage 3: what auto-update needs from the service — a silent check, batches, pins. */

describe("ExtensionsWorkbenchService — auto update (ExtensionUpdates stage 3)", () => {
    const fixture = createUpdatesFixture();
    const { warnings, registry, installed, createService, card, profileState, workspace } = fixture;

    afterEach(() => {
        fixture.dispose();
    });

    describe("the target's publish date", () => {
        it("comes from the metadata of the target version", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({
                "acme.tools": [
                    { version: "1.0.0", publishedAt: "2026-01-01T00:00:00Z" },
                    { version: "1.1.0", publishedAt: "2026-02-01T00:00:00Z" },
                ],
            });
            const service = createService(source);

            await service.ensureLoaded();

            expect(service.getOutdated().map((e) => [e.id, e.latestVersion, e.latestPublishedAt])).toEqual([
                ["acme.tools", "1.1.0", "2026-02-01T00:00:00Z"],
            ]);
        });

        it("is unset without a date in the registry, and for an entry outside it", async () => {
            installed("acme.tools", "1.0.0");
            installed("acme.local", "1.0.0");
            const source = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(source);

            await service.ensureLoaded();

            expect(service.getEntries().map((e) => [e.id, e.latestPublishedAt])).toEqual([
                ["acme.tools", undefined],
                ["acme.local", undefined],
            ]);
        });
    });

    describe("checkForUpdates in the background (US-3.1, US-3.10)", () => {
        it("a success is the catalog the first show uses: no second request", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(source);

            await service.checkForUpdates({ background: true });
            await service.ensureLoaded();

            expect(source.indexCalls).toBe(1);
            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "1.0.0", state: "outdated" });
        });

        it("a failure over a list keeps the list and shows no error: only a warning in the log", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(source);
            await service.ensureLoaded();
            source.indexError = "registry is offline";

            await service.checkForUpdates({ background: true });

            expect(service.getCatalogError()).toBeNull();
            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "1.0.0", state: "outdated" });
            expect(warnings).toEqual(["Could not check for extension updates: registry is offline"]);
            // The list is the answer: showing the viewlet again does not read the catalog.
            await service.ensureLoaded();
            expect(source.indexCalls).toBe(2);
        });

        it("a failed manual check before any list is the answer of the first show: its error, no second read", async () => {
            const source = await registry({ "acme.tools": [{ version: "1.1.0" }] });
            const service = createService(source);
            source.indexError = "registry is offline";

            await service.checkForUpdates();
            await service.ensureLoaded();

            expect(source.indexCalls).toBe(1);
            expect(service.getCatalogError()).toBe("registry is offline");
        });

        it("a Refresh started while a background check was failing keeps its own answer", async () => {
            const source = await registry({ "acme.tools": [{ version: "1.1.0" }] });
            const service = createService(source);
            source.indexError = "registry is offline";

            const background = service.checkForUpdates({ background: true });
            const refresh = service.refresh();
            await Promise.all([background, refresh]);
            await service.ensureLoaded();

            expect(source.indexCalls).toBe(2);
            expect(service.getCatalogError()).toBe("registry is offline");
        });

        it("a failure before any list shows no error either, and the first show reads the catalog itself", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(source);
            source.indexError = "registry is offline";

            await service.checkForUpdates({ background: true });
            expect(service.getCatalogError()).toBeNull();
            source.indexError = undefined;
            await service.ensureLoaded();

            expect(source.indexCalls).toBe(2);
            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "1.0.0", state: "outdated" });
        });

        it("a first show waiting for a failing background check reads the catalog itself", async () => {
            const source = await registry({ "acme.tools": [{ version: "1.1.0" }] });
            const service = createService(source);
            source.indexError = "registry is offline";

            const background = service.checkForUpdates({ background: true });
            const shown = service.ensureLoaded();
            source.indexError = undefined;
            await Promise.all([background, shown]);

            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: null, state: "available" });
        });

        it("a manual check still reports the failure", async () => {
            const source = await registry({ "acme.tools": [{ version: "1.1.0" }] });
            const service = createService(source);
            source.indexError = "registry is offline";

            await service.checkForUpdates();

            expect(service.getCatalogError()).toBe("registry is offline");
            expect(warnings).toEqual([]);
        });
    });

    describe("onDidReadCatalog", () => {
        it("tells every catalog read and whether it succeeded: show, Refresh, Check, background", async () => {
            const source = await registry({ "acme.tools": [{ version: "1.1.0" }] });
            const service = createService(source);
            const reads: boolean[] = [];
            service.onDidReadCatalog((ok) => reads.push(ok));

            await service.ensureLoaded();
            await service.ensureLoaded();
            await service.refresh();
            source.indexError = "offline";
            await service.checkForUpdates();
            await service.checkForUpdates({ background: true });

            expect(reads).toEqual([true, true, false, false]);
        });

        it("fires after the entries are rebuilt: a listener sees the new outdated list", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(source);
            let seen: string[] = [];
            service.onDidReadCatalog(() => {
                seen = service.getOutdated().map((e) => e.id);
            });

            await service.ensureLoaded();

            expect(seen).toEqual(["acme.tools"]);
        });
    });

    describe("updateExtensions(ids)", () => {
        it("updates only the given ids", async () => {
            installed("acme.a", "1.0.0");
            installed("acme.b", "1.0.0");
            const source = await registry({
                "acme.a": [{ version: "1.0.0" }, { version: "1.1.0" }],
                "acme.b": [{ version: "1.0.0" }, { version: "1.1.0" }],
            });
            const service = createService(source);
            await service.ensureLoaded();

            const result = await service.updateExtensions(["acme.b"]);

            expect(result).toEqual({ updated: [{ id: "acme.b", version: "1.1.0" }], failed: [] });
            expect(profileState()).toEqual([
                ["acme.a", "1.0.0", false],
                ["acme.b", "1.1.0", false],
            ]);
        });

        it("US-3.12: an entry another window already updated is skipped and is not in the result", async () => {
            installed("acme.a", "1.0.0");
            installed("acme.b", "1.0.0");
            const source = await registry({
                "acme.a": [{ version: "1.0.0" }, { version: "1.1.0" }],
                "acme.b": [{ version: "1.0.0" }, { version: "1.1.0" }],
            });
            const mine = createService(source);
            const other = createService(source);
            await mine.ensureLoaded();
            await other.ensureLoaded();
            await other.updateExtensions(["acme.a"]);
            const artifactReads = source.metaCalls.length;

            const result = await mine.updateExtensions(["acme.a", "acme.b"]);

            expect(result).toEqual({ updated: [{ id: "acme.b", version: "1.1.0" }], failed: [] });
            // One entry per id, nothing lost.
            expect(profileState()).toEqual([
                ["acme.a", "1.1.0", false],
                ["acme.b", "1.1.0", false],
            ]);
            // The skipped one is not installed again: only acme.b went to the registry.
            expect(source.metaCalls.slice(artifactReads)).toEqual(["acme.b"]);
            // This window runs the old version of acme.a: it is no longer outdated, and it needs a reload.
            expect(mine.getEntries().find((e) => e.id === "acme.a")).toMatchObject({
                installedVersion: "1.1.0",
                availability: "installed",
                needsReload: true,
            });
        });

        it("an entry skipped as updated elsewhere is outdated again when a newer version comes out", async () => {
            installed("acme.a", "1.0.0");
            const source = await registry({ "acme.a": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const mine = createService(source);
            const other = createService(source);
            await mine.ensureLoaded();
            await other.ensureLoaded();
            await other.updateExtensions(["acme.a"]);
            expect(await mine.updateExtensions(["acme.a"])).toEqual({ updated: [], failed: [] });

            const meta = source.metas["acme.a"];
            source.metas["acme.a"] = {
                ...meta,
                versions: [...meta.versions, { ...meta.versions[1], version: "1.2.0" }],
            };
            source.index = {
                ...source.index,
                extensions: source.index.extensions.map((e) => ({ ...e, latest: { ...e.latest, version: "1.2.0" } })),
            };
            await mine.checkForUpdates();

            expect(mine.getOutdated().map((e) => [e.id, e.latestVersion])).toEqual([["acme.a", "1.2.0"]]);
        });

        it("an entry another window uninstalled is not installed back", async () => {
            installed("acme.a", "1.0.0");
            const source = await registry({ "acme.a": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const mine = createService(source);
            await mine.ensureLoaded();
            await createService(source).uninstall("acme.a");

            expect(await mine.updateExtensions(["acme.a"])).toEqual({ updated: [], failed: [] });
            expect(profileState()).toEqual([]);
        });

        it("the whole batch counts as being installed from the start (US-3.11)", async () => {
            installed("acme.a", "1.0.0");
            installed("acme.b", "1.0.0");
            const source = await registry({
                "acme.a": [{ version: "1.0.0" }, { version: "1.1.0" }],
                "acme.b": [{ version: "1.0.0" }, { version: "1.1.0" }],
            });
            const service = createService(source);
            await service.ensureLoaded();

            const batch = service.updateExtensions(["acme.a", "acme.b"]);
            const outdatedDuringBatch = service.getOutdated().map((e) => e.id);
            const second = await service.updateAll();
            await batch;

            expect(outdatedDuringBatch).toEqual([]);
            expect(second).toEqual({ updated: [], failed: [] });
        });

        it("an id that is not outdated anymore is skipped", async () => {
            installed("acme.a", "1.1.0");
            const source = await registry({ "acme.a": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(source);
            await service.ensureLoaded();

            expect(await service.updateExtensions(["acme.a", "acme.unknown"])).toEqual({ updated: [], failed: [] });
        });
    });

    describe("setPinned (the page's Auto Update toggle)", () => {
        it("pins and unpins the entry without a reload: nothing changes in the running host", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(source);
            await service.ensureLoaded();
            let changes = 0;
            service.onDidChange(() => changes++);

            expect(await service.setPinned("acme.tools", true)).toEqual({ ok: true });
            const pinned = service.getEntries().find((e) => e.id === "acme.tools");
            expect(await service.setPinned("acme.tools", false)).toEqual({ ok: true });
            const unpinned = service.getEntries().find((e) => e.id === "acme.tools");

            expect(pinned).toMatchObject({ pinned: true, needsReload: false, availability: "outdated" });
            expect(unpinned).toMatchObject({ pinned: false, needsReload: false });
            expect(changes).toBe(2);
            expect(profileState()).toEqual([["acme.tools", "1.0.0", false]]);
        });

        it("an unreadable profile is an error, not a rewrite", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(source);
            const file = workspace().path("extensions/extensions.json");
            fs.writeFileSync(file, "not json");

            const result = await service.setPinned("acme.tools", true);

            expect(result).toEqual({ ok: false, error: `Invalid extensions profile content in ${file}` });
            expect(fs.readFileSync(file, "utf8")).toBe("not json");
        });

        it("an extension that is not installed is an error", async () => {
            const source = await registry({ "acme.tools": [{ version: "1.1.0" }] });
            const service = createService(source);

            expect(await service.setPinned("acme.tools", true)).toEqual({
                ok: false,
                error: "Extension acme.tools is not installed",
            });
        });
    });
});
