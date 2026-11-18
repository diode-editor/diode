import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { explorerTitle } from "./helpers/explorerTitle.ts";
import { frameToText } from "./helpers/frame.ts";
import { createRegistryFixture } from "./helpers/registryFixture.ts";
import { RegistryServer } from "./helpers/registryServer.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

/**
 * QA of #1198 from the outside: the install state lives in the service, so the extension's page shows it whichever
 * tab started the install. The registry holds every `.vsix` at its half, so a frame in the middle of a download is
 * stable.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const SAMPLE = resolve(here, "marketplace", "sample-extension");

/** Declares a wrong sha256: its install fails once the download ends. */
const BROKEN = "test.qa-broken";
const BROKEN_PAGE = "#extensionPage-test-qa-broken";
const BROKEN_ROW = "#extensionsGroup-marketplace-test-qa-broken";

let root: string;
let registry: RegistryServer;

interface IButton {
    label: string;
    enabled: boolean;
}

describe("Extensions install progress (QA #1198)", () => {
    beforeAll(async () => {
        await getBinaryPath();
        root = mkdtempSync(join(tmpdir(), "diode-qa-1198-"));
        const dir = await createRegistryFixture(join(root, "registry"), [
            { id: BROKEN, version: "1.0.0", sourceDir: SAMPLE, corruptSha: true, displayName: "QA Broken" },
        ]);
        registry = new RegistryServer(dir, { holdArtifacts: true });
        await registry.listen();
    }, 300_000);

    afterAll(async () => {
        await registry.close();
        removeTempDir(root);
    });

    it("a page reopened in the middle of an install shows that install's failure", async () => {
        const app = await useHeadlessApp({
            files: { "hello.txt": "hello\n" },
            extraArgs: [`--registry=${registry.url}`],
            keybindings: [
                { key: "f6", command: "workbench.view.extensions" },
                { key: "f8", command: "workbench.action.closeActiveEditor" },
            ],
            cols: 120,
            rows: 30,
        });
        const s = app.session;
        await s.waitForText((t) => t.includes(explorerTitle(app.env.workspaceDir)));
        await s.key("F6");
        await s.waitForNode(BROKEN_ROW);
        await s.clickNode(BROKEN_ROW);
        await s.waitForNode(BROKEN_PAGE);
        await s.waitForText((t) => t.includes("Not installed"));

        // Install from the page, then close it while the download is held at its half and open it again.
        await s.key("Enter");
        await s.waitForText((t) => /Installing \d+%/u.test(t));
        await s.key("F8");
        await s.waitForNoNode(BROKEN_PAGE);
        await s.clickNode(BROKEN_ROW);
        await s.waitForNode(BROKEN_PAGE);
        await s.waitForText((t) => /Installing \d+%/u.test(t) && t.includes("Installing…"));

        // The rest of the file arrives, the sha256 does not match: the install fails.
        registry.release();
        await s.waitForState("#extensionPageHeader", (state) => {
            const buttons = (state as { buttons?: IButton[] } | undefined)?.buttons ?? [];
            return buttons[0]?.label === "Install" && buttons[0].enabled;
        });

        // The user is looking at the extension's page: the reason must be there, as in the tab that started it.
        expect(frameToText(await s.captureFrame())).toContain("sha256 mismatch");
    });
});
