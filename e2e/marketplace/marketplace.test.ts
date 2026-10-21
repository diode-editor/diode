import { existsSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { REGISTRY_SCHEMA_VERSION } from "../../src/vs/platform/extensionManagement/common/registryFormat.ts";
import { removeTempDir } from "../helpers/appSession.ts";
import { getBinaryPath } from "../helpers/buildOnce.ts";
import { MARKETPLACE_CHECKS } from "./checks.ts";
import { createMarketplaceRoot, fetchPublishedIndex, PUBLISHED_REGISTRY_URL, runCli } from "./harness.ts";

/**
 * Cases come from the live registry catalog, not from our table of checks: a new entry is covered
 * automatically. The suite depends on the network and publication state and may be noisy — on purpose: it
 * goes red exactly when a user would get a broken marketplace. No retries — they would hide the signal.
 * `DIODE_E2E_OFFLINE=1` skips the suite; CI does not set it.
 */

const OFFLINE = process.env.DIODE_E2E_OFFLINE === "1";

// The catalog is needed at test collection time — one case per extension, so the report
// shows which one broke rather than just "the marketplace is broken".
const catalog = OFFLINE ? undefined : await fetchPublishedIndex();
const published = catalog?.index.extensions ?? [];

describe.skipIf(OFFLINE)("магазин — опубликованные расширения на текущем коде", () => {
    let binary: string;

    beforeAll(async () => {
        binary = await getBinaryPath();
    }, 180_000);

    it("опубликованный индекс читается парсером клиента без замечаний", () => {
        // The registry builder does not see our types: parsing with the normative parser is the only check
        // that its simplified rules have not drifted from the format.
        expect(catalog?.problems).toEqual([]);
        expect(catalog?.index.schemaVersion).toBe(REGISTRY_SCHEMA_VERSION);
        expect(published.length).toBeGreaterThan(0);
    });

    for (const entry of published) {
        const check = MARKETPLACE_CHECKS.find((c) => c.id === entry.id);
        // The check depth shows in the case name: for an entry without a check the run
        // goes as far as unpacking and stops there.
        const what = check === undefined ? "ставится из магазина" : "ставится из магазина и работает в редакторе";
        it(
            `${entry.id}@${entry.latest.version} ${what}`,
            async (testContext) => {
                const { root, userDataDir } = createMarketplaceRoot();
                try {
                    const install = await runCli(binary, [
                        "--user-data-dir",
                        userDataDir,
                        "--registry",
                        PUBLISHED_REGISTRY_URL,
                        "--install-extension",
                        entry.id,
                    ]);
                    expect(install.stderr).toBe("");
                    expect(install.code).toBe(0);
                    // It is the latest published version that gets installed: the registry may
                    // get ahead of the editor, and an incompatibility shows up here, not for the user.
                    expect(install.stdout).toContain(`Installed ${entry.id}@${entry.latest.version}`);

                    const extDir = join(userDataDir, "extensions", `${entry.id}-${entry.latest.version}`);
                    expect(existsSync(join(extDir, "package.json")), `манифест не распакован в ${extDir}`).toBe(true);

                    // The behavioral half is skipped on Windows: ext-host suites are off there anyway, so a red
                    // check would mean a known platform gap. Transport, sha256 and unpacking are checked above,
                    // on every platform.
                    if (check !== undefined && process.platform !== "win32") {
                        for (const rel of check.expectFiles) {
                            expect(existsSync(join(extDir, rel)), `${rel} не распакован в ${extDir}`).toBe(true);
                        }
                        // Without the external tool (Go toolchain) — an explicit skip with a
                        // reason, not a green case: the install above is already verified.
                        const missing = check.requires?.();
                        if (missing !== undefined) testContext.skip(missing);
                        await check.run({ root });
                    }
                } finally {
                    removeTempDir(root);
                }
            },
            // A check with a cold language server start asks for a longer timeout than the default.
            check?.timeoutMs ?? 240_000,
        );
    }

    it("--install-extension без --registry идёт в публичный реестр", async () => {
        // The client's default is the marketplace: the user does not need to know the URL.
        const entry = published.find((e) => e.kind === "native") ?? published[0];
        const { root, userDataDir } = createMarketplaceRoot();
        try {
            const install = await runCli(binary, ["--user-data-dir", userDataDir, "--install-extension", entry.id]);
            expect(install.stderr).toBe("");
            expect(install.code).toBe(0);
            expect(install.stdout).toContain(`Installed ${entry.id}@${entry.latest.version}`);
        } finally {
            removeTempDir(root);
        }
    }, 180_000);
});
