import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { makeLogger } from "../../../../../TestUtils/configurationLayersFixture.ts";
import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { type IFakeRipgrep, isProcessAlive, writeFakeRipgrep } from "../../../../../TestUtils/fakeRipgrep.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";

import { createRipgrepWorkspaceScanner } from "./workspaceContainsActivation.ts";

/**
 * The host over the real rg scanner: a real subprocess per search, and nobody may outlive the search that
 * started it — a timeout, the window's exit and a match all kill it (issue #825: a `readdir` hung on a FUSE
 * mount held `process.exit` for tens of seconds).
 */
const TERRAFORM = {
    ...extensionFixture("test.terraform", "noopExtension.cjs"),
    activationEvents: ["workspaceContains:**/*.tf", "workspaceContains:**/*.tfvars"],
};

describe("ExtensionHost — workspaceContains over the real rg", () => {
    it("`**/*.tf` four levels deep activates the extension with the matched glob as the reason", async () => {
        const logger = makeLogger();
        const harness = await createExtensionTestHarness({ activateEvents: [], logger, extensions: [TERRAFORM] });
        try {
            fs.mkdirSync(path.join(harness.tmpDir, "deep", "a", "b", "c"), { recursive: true });
            harness.writeFile(path.join("deep", "a", "b", "c", "main.tf"), "");

            await harness.host.activateByWorkspaceContains();

            expect(harness.host.hasExtension("test.terraform")).toBe(true);
            expect(logger.info).toHaveBeenCalledWith(
                'activated extension "test.terraform" (workspaceContains:**/*.tf)',
            );
        } finally {
            await harness.dispose();
        }
    });

    it("a `.tf` only under `.gitignore` does not activate", async () => {
        const harness = await createExtensionTestHarness({ activateEvents: [], extensions: [TERRAFORM] });
        try {
            harness.writeFile(".gitignore", "generated/\n");
            fs.mkdirSync(path.join(harness.tmpDir, "generated"));
            harness.writeFile(path.join("generated", "main.tf"), "");

            await harness.host.activateByWorkspaceContains();

            expect(harness.host.hasExtension("test.terraform")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });
});

describe.skipIf(process.platform === "win32")("ExtensionHost — workspaceContains against a fake rg", () => {
    let fake: IFakeRipgrep | null = null;

    afterEach(() => {
        for (const pid of fake?.pids() ?? []) if (isProcessAlive(pid)) process.kill(pid, "SIGKILL");
        fake?.dispose();
        fake = null;
    });

    function scannerOver(
        options: Parameters<typeof writeFakeRipgrep>[0],
    ): ReturnType<typeof createRipgrepWorkspaceScanner> {
        const rg = writeFakeRipgrep(options);
        fake = rg;
        return createRipgrepWorkspaceScanner(undefined, () => rg.path);
    }

    function onlyPid(): number {
        if (fake === null) throw new Error("no fake rg");
        return fake.onlyPid();
    }

    it("a hung rg is killed by the timeout: a warning, the extension stays inactive", async () => {
        const logger = makeLogger();
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            logger,
            workspaceContainsTimeoutMs: 300,
            workspaceScanner: scannerOver({ hang: true }),
            extensions: [TERRAFORM],
        });
        try {
            await harness.host.activateByWorkspaceContains();

            expect(logger.warn).toHaveBeenCalledWith(
                "Not activating extension 'test.terraform': Timed out while searching for 'workspaceContains' pattern **/*.tf,**/*.tfvars",
            );
            expect(harness.host.hasExtension("test.terraform")).toBe(false);
            const pid = onlyPid();
            await waitUntil("the hung rg is killed", () => !isProcessAlive(pid), 2000);
        } finally {
            await harness.dispose();
        }
    });

    it("the first printed path activates the extension; rg is killed before it ends on its own", async () => {
        const logger = makeLogger();
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            logger,
            workspaceScanner: scannerOver({ stdoutLines: ["a/b/main.tf"], hang: true }),
            extensions: [TERRAFORM],
        });
        try {
            await harness.host.activateByWorkspaceContains();

            expect(harness.host.hasExtension("test.terraform")).toBe(true);
            expect(logger.info).toHaveBeenCalledWith(
                'activated extension "test.terraform" (workspaceContains:**/*.tf)',
            );
            const pid = onlyPid();
            await waitUntil("rg is killed after the first line", () => !isProcessAlive(pid), 2000);
        } finally {
            await harness.dispose();
        }
    });

    it("window exit while rg hangs: the search is killed with the host, no timeout needed", async () => {
        const logger = makeLogger();
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            logger,
            workspaceScanner: scannerOver({ hang: true }),
            extensions: [TERRAFORM],
        });

        try {
            const pass = harness.host.activateByWorkspaceContains();
            await waitUntil("rg starts", () => (fake?.pids().length ?? 0) === 1);
            const pid = onlyPid();
            expect(isProcessAlive(pid)).toBe(true);

            harness.host.disposeNow();

            await waitUntil("rg dies with the window", () => !isProcessAlive(pid), 2000);
            await pass;
            expect(logger.warn).not.toHaveBeenCalled();
        } finally {
            await harness.dispose();
        }
    });
});
