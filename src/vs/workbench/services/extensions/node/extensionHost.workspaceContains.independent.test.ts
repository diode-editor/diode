import { afterEach, describe, expect, it } from "vitest";

import { makeLogger } from "../../../../../TestUtils/configurationLayersFixture.ts";
import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { type IFakeRipgrep, isProcessAlive, writeFakeRipgrep } from "../../../../../TestUtils/fakeRipgrep.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";

import { createRipgrepWorkspaceScanner } from "./workspaceContainsActivation.ts";

/**
 * Upstream checks every extension's `workspaceContains` on its own: a match activates that extension at once.
 * One extension's search hung on a slow mount (here: a fake rg that never answers) must not hold back an
 * extension whose pattern already matched — otherwise `diode ~` with a FUSE mount delays every
 * `workspaceContains` extension by the whole timeout.
 */
const MARKER = {
    ...extensionFixture("test.marker", "noopExtension.cjs"),
    activationEvents: ["workspaceContains:marker.txt"],
};
const TERRAFORM = {
    ...extensionFixture("test.terraform", "noopExtension.cjs"),
    activationEvents: ["workspaceContains:**/*.tf"],
};

/** Generous: the subprocess spawn for the first activation must fit well inside it on a loaded machine. */
const TIMEOUT_MS = 6000;

describe.skipIf(process.platform === "win32")("ExtensionHost — workspaceContains extensions are independent", () => {
    let fake: IFakeRipgrep | null = null;

    afterEach(() => {
        for (const pid of fake?.pids() ?? []) if (isProcessAlive(pid)) process.kill(pid, "SIGKILL");
        fake?.dispose();
        fake = null;
    });

    for (const extensions of [
        { order: "matched one first in manifest order", list: [MARKER, TERRAFORM] },
        { order: "hung one first in manifest order", list: [TERRAFORM, MARKER] },
    ]) {
        it(
            `a matched extension activates while another's search still hangs (${extensions.order})`,
            { timeout: 20_000 },
            async () => {
                const rg = writeFakeRipgrep({ hang: true });
                fake = rg;
                const logger = makeLogger();
                const harness = await createExtensionTestHarness({
                    activateEvents: [],
                    logger,
                    workspaceContainsTimeoutMs: TIMEOUT_MS,
                    workspaceScanner: createRipgrepWorkspaceScanner(undefined, () => rg.path),
                    extensions: extensions.list,
                });
                try {
                    harness.writeFile("marker.txt", "");
                    const pass = harness.host.activateByWorkspaceContains();

                    await waitUntil(
                        "test.marker activates",
                        () => harness.host.hasExtension("test.marker"),
                        TIMEOUT_MS + 2000,
                    );
                    // The hung search has not timed out yet: the match did not wait for it.
                    expect(logger.warn).not.toHaveBeenCalled();
                    expect(isProcessAlive(rg.onlyPid())).toBe(true);
                    await pass;
                    expect(harness.host.hasExtension("test.terraform")).toBe(false);
                } finally {
                    await harness.dispose();
                }
            },
        );
    }
});
