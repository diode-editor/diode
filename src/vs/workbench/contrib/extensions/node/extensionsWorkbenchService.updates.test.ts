import { afterEach, describe, expect, it } from "vitest";

import {
    createUpdatesFixture,
    FakeSource,
    HOST,
    INCOMPATIBLE,
    type IVersionSpec,
} from "../../../../../TestUtils/extensionUpdatesFixture.ts";
import type { IRegistryExtensionMeta } from "../../../../platform/extensionManagement/common/registryFormat.ts";

/** ExtensionUpdates stage 2: the target version, `outdated` by semver, `checkForUpdates` and `updateAll`. */

describe("ExtensionsWorkbenchService — updates (ExtensionUpdates stage 2)", () => {
    const fixture = createUpdatesFixture();
    const { warnings, registry, installed, createService, card, profileState } = fixture;

    afterEach(() => {
        fixture.dispose();
    });

    describe("target version and availability", () => {
        it("a compatible latest is the target; metadata only confirms an update of an installed one", async () => {
            installed("acme.tools", "1.0.0");
            installed("acme.current", "1.1.0");
            const source = await registry({
                "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }],
                "acme.current": [{ version: "1.1.0" }],
                "acme.fresh": [{ version: "1.1.0" }],
            });
            const service = createService(source);

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "1.0.0", state: "outdated" });
            expect(card(service, "acme.current")).toEqual({ latest: "1.1.0", installed: "1.1.0", state: "installed" });
            expect(card(service, "acme.fresh")).toEqual({ latest: "1.1.0", installed: null, state: "available" });
            // The index knows no platform: only an update candidate needs the metadata (QA report #2).
            expect(source.metaCalls).toEqual(["acme.tools"]);
        });

        it("QA #2: a newer version for another platform only is not an update on this host", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({
                "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0", targetPlatform: "win32-arm64" }],
            });
            const service = createService(source, { ...HOST, targetPlatform: "linux-x64" });

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "1.0.0", installed: "1.0.0", state: "installed" });
            expect(service.getOutdated()).toEqual([]);
        });

        it("an update candidate whose metadata fails keeps the index's latest", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            source.failMeta.add("acme.tools");
            const service = createService(source);

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "1.0.0", state: "outdated" });
            expect(warnings).toHaveLength(1);
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

        it("a manifest version that is not semver cannot be compared: installed, not outdated, no failure", async () => {
            installed("acme.tools", "nightly");
            const service = createService(await registry({ "acme.tools": [{ version: "1.1.0" }] }));

            await service.ensureLoaded();

            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "nightly", state: "installed" });
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

        it("every catalog read re-reads the metadata the targets need", async () => {
            const source = await registry({
                "acme.tools": [{ version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
            });
            const service = createService(source);
            await service.ensureLoaded();
            await service.refresh();
            await service.checkForUpdates();

            expect(source.indexCalls).toBe(3);
            expect(source.metaCalls).toEqual(["acme.tools", "acme.tools", "acme.tools"]);
        });

        it("Refresh sees a release in the metadata the page cached earlier (stage 1 QA, US-1.1)", async () => {
            installed("acme.tools", "1.1.0");
            const before = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            const service = createService(before);
            await service.ensureLoaded();
            await service.getCompatibleVersions("acme.tools");

            const after = await registry({
                "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }, { version: "1.2.0" }],
            });
            before.index = after.index;
            before.metas = after.metas;
            await service.refresh();

            expect(card(service, "acme.tools")).toEqual({ latest: "1.2.0", installed: "1.1.0", state: "outdated" });
            expect((await service.getCompatibleVersions("acme.tools")).map((v) => v.version)).toEqual([
                "1.2.0",
                "1.1.0",
                "1.0.0",
            ]);
        });

        it("metadata cached by a page that does not know the index's latest is not used for the target", async () => {
            const before = await registry({ "acme.fresh": [{ version: "1.0.0" }] });
            const service = createService(before);
            await service.getMeta("acme.fresh");

            before.index = (await registry({ "acme.fresh": [{ version: "1.0.0" }, { version: "1.1.0" }] })).index;
            await service.ensureLoaded();

            expect(card(service, "acme.fresh")).toEqual({ latest: "1.1.0", installed: null, state: "available" });
        });

        it("QA #1: checkForUpdates with the registry unreachable keeps the last targets, like Refresh", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({
                "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
            });
            const service = createService(source);
            await service.ensureLoaded();
            const offline = new Error("offline");
            source.getIndex = () => Promise.reject(offline);
            source.failMeta.add("acme.tools");

            await service.checkForUpdates();

            expect(service.getCatalogError()).toBe("offline");
            expect(card(service, "acme.tools")).toEqual({ latest: "1.1.0", installed: "1.0.0", state: "outdated" });
            expect(service.getOutdated().map((e) => e.id)).toEqual(["acme.tools"]);
        });

        it("the first catalog read and Refresh keep the page metadata already fetched", async () => {
            const source = await registry({ "acme.fresh": [{ version: "1.0.0" }] });
            const service = createService(source);
            await service.getMeta("acme.fresh");

            await service.ensureLoaded();
            await service.refresh();
            await service.getMeta("acme.fresh");

            expect(source.metaCalls).toEqual(["acme.fresh"]);
        });

        it("after a successful check the page metadata is fetched anew too", async () => {
            const source = await registry({ "acme.fresh": [{ version: "1.0.0" }] });
            const service = createService(source);
            await service.ensureLoaded();
            await service.getMeta("acme.fresh");
            await service.getMeta("acme.fresh");
            expect(source.metaCalls).toEqual(["acme.fresh"]);

            await service.checkForUpdates();
            await service.getMeta("acme.fresh");

            expect(source.metaCalls).toEqual(["acme.fresh", "acme.fresh"]);
        });

        it("checkForUpdates keeps the previous metadata of an entry whose fresh fetch fails", async () => {
            installed("acme.tools", "1.0.0");
            const source = await registry({
                "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }, { version: "2.0.0", engines: INCOMPATIBLE }],
            });
            const service = createService(source);
            await service.ensureLoaded();
            source.failMeta.add("acme.tools");

            await service.checkForUpdates();

            expect(service.getCatalogError()).toBeNull();
            expect(card(service, "acme.tools")).toMatchObject({ latest: "1.1.0", state: "outdated" });
        });

        it("checkForUpdates sees a version that appeared in the registry", async () => {
            installed("acme.tools", "1.0.0");
            const before = await registry({ "acme.tools": [{ version: "1.0.0" }] });
            const service = createService(before);
            await service.ensureLoaded();
            expect(service.getOutdated()).toEqual([]);

            const after = await registry({ "acme.tools": [{ version: "1.0.0" }, { version: "1.1.0" }] });
            before.index = after.index;
            before.metas = after.metas;
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

        it("QA #3: an extension being installed is not outdated; two Update All at once install each once", async () => {
            installed("acme.plain", "1.0.0");
            installed("acme.other", "1.0.0");
            const service = createService(
                await registry({
                    "acme.plain": [{ version: "1.0.0" }, { version: "1.1.0" }],
                    "acme.other": [{ version: "1.0.0" }, { version: "1.1.0" }],
                }),
            );
            await service.ensureLoaded();

            const first = service.updateAll();
            expect(service.getOutdated()).toEqual([]);
            const second = service.updateAll();

            expect((await first).updated.map((u) => u.id)).toEqual(["acme.plain", "acme.other"]);
            expect(await second).toEqual({ updated: [], failed: [] });
            expect(service.getOutdated()).toEqual([]);
        });

        it("a single install hides its entry from the outdated list until it is done", async () => {
            installed("acme.plain", "1.0.0");
            const service = createService(
                await registry({ "acme.plain": [{ version: "1.0.0" }, { version: "1.1.0" }] }),
            );
            await service.ensureLoaded();

            const pending = service.install("acme.plain");
            expect(service.getOutdated()).toEqual([]);
            await pending;
            expect(card(service, "acme.plain")).toMatchObject({ installed: "1.1.0", state: "installed" });
        });

        it("a failed install makes the entry outdated again", async () => {
            installed("acme.broken", "1.0.0");
            const service = createService(
                await registry({ "acme.broken": [{ version: "1.0.0" }, { version: "1.1.0", corrupt: true }] }),
            );
            await service.ensureLoaded();

            await service.install("acme.broken");

            expect(service.getOutdated().map((e) => e.id)).toEqual(["acme.broken"]);
        });

        it("nothing outdated — nothing to do", async () => {
            installed("acme.tools", "1.0.0");
            const service = createService(await registry({ "acme.tools": [{ version: "1.0.0" }] }));
            await service.ensureLoaded();

            expect(await service.updateAll()).toEqual({ updated: [], failed: [] });
        });
    });
});
