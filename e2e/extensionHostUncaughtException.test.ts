import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const userData = resolve(here, "fixtures", "user-data-with-timer-throw");

// The extension host subprocess flakes in e2e on Windows (see docs/TESTING.md).
const describeLinuxOnly = process.platform === "linux" ? describe : describe.skip;

/**
 * #861: a throw from an extension's timer, outside any promise, is logged as upstream does
 * and does not take the extension host subprocess down with every other extension.
 */
describeLinuxOnly("extension host — uncaught exception in extension code", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("is logged to stderr, the extension keeps running, nothing is reactivated", async () => {
        const { session } = await useHeadlessApp({ seedUserData: userData, open: [] });

        // The item appears a second after the throw: the subprocess survived it.
        await session.waitForText((text) => text.includes("Survived the throw"), { timeoutMs: 30_000 });

        const stderr = await session.getOutput("extensions.host.stderr");
        expect(stderr).toContain("[ext-host] uncaught exception in extension code: Error: boom");
        const host = await session.getOutput("extensions.host");
        expect(host).not.toContain("subprocess died");
        expect(host.match(/activated extension "test\.bystander"/g)).toHaveLength(1);
        expect(host.match(/activated extension "test\.timer-throw"/g)).toHaveLength(1);
    }, 120_000);
});
