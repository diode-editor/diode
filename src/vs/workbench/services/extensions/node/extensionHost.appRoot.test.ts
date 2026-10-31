import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { ExtensionStatusBarAdapter } from "../../../api/browser/extensionStatusBarAdapter.ts";
import { loadRipgrepAppRoot } from "../../search/node/loadRipgrep.ts";
import { StatusBarService } from "../../statusbar/common/statusBarService.ts";

/** The same probe as the binary's e2e (`sea-extensions.test.ts`); here the app root is the dev symlink layout. */
const PROBE_MAIN = path.resolve(
    import.meta.dirname,
    "../../../../../../e2e/fixtures/user-data-with-app-root/extensions/app-root-probe/extension.js",
);

describe("ExtensionHost — env.appRoot (subprocess, from sources)", () => {
    it("activate() finds rg at VS Code's path under appRoot, like Todo Tree", async () => {
        const bar = new StatusBarService(NULL_STATE_SERVICE);
        const harness = await createExtensionTestHarness({
            extensions: [
                {
                    id: "test.app-root-probe",
                    manifest: { name: "app-root-probe", publisher: "test", version: "0.0.1" },
                    mainPath: PROBE_MAIN,
                    activationEvents: ["*"],
                },
            ],
            statusBarItemSink: new ExtensionStatusBarAdapter(bar, {
                execute: () => Promise.resolve(undefined),
                listCommandIds: () => [],
                registerProxy: () => ({ dispose: () => undefined }),
            }),
        });
        try {
            await vi.waitFor(() => {
                expect(bar.entries().map((e) => e.text)).toContain("appRoot-ok");
            });
            expect(await harness.commandRegistry.execute("test.appRoot.probe")).toStrictEqual({
                appRoot: loadRipgrepAppRoot(),
                found: true,
            });
        } finally {
            await harness.dispose();
        }
    });
});
