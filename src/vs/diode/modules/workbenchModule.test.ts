import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { ClipboardDIToken } from "../../platform/clipboard/common/iClipboard.ts";
import { IBulkEditBuffersDIToken } from "../../workbench/contrib/bulkEdit/common/iBulkEditBuffers.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/common/editorService.ts";
import { ExternalOpenerDIToken } from "../../workbench/services/externalOpener/common/iExternalOpener.ts";
import { NotificationServiceDIToken } from "../../workbench/services/notification/browser/notificationService.ts";

import { createTestContainer } from "./testProfile.ts";

let tmpDir: string;
let ws: ITempWorkspace;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-wbmodule-" });
    tmpDir = ws.dir;
});

afterEach(() => {
    ws.dispose();
});

/** A swapped seam yields a working container and a silent editor — checks that the real seams arrive. */
describe("workbenchModule — env.openExternal", () => {
    it("without a graphical session puts the link in the app clipboard and shows a message", async () => {
        const { container } = createTestContainer();
        const noDisplay = { ...process.env };
        delete noDisplay.DISPLAY;
        delete noDisplay.WAYLAND_DISPLAY;
        const restore = process.env;
        try {
            // The environment is read when the service is created — patch it around the resolve.
            process.env = noDisplay as NodeJS.ProcessEnv;
            const opener = container.get(ExternalOpenerDIToken);
            const notifications = container.get(NotificationServiceDIToken);

            await expect(opener.open("https://example.com/activate?token=42")).resolves.toBe(true);

            expect(await container.get(ClipboardDIToken).readText()).toBe("https://example.com/activate?token=42");
            // Severity picks the toast's title and color: "link copied" is info, not an error.
            expect(notifications.passive()).toEqual([
                expect.objectContaining({
                    severity: "info",
                    message: "Link copied to clipboard: https://example.com/activate?token=42",
                }),
            ]);
        } finally {
            process.env = restore;
        }
    });

    it("does not try to open a foreign scheme at all", async () => {
        const { container } = createTestContainer();
        const opener = container.get(ExternalOpenerDIToken);

        await expect(opener.open("file:///etc/passwd")).resolves.toBe(false);
        expect(container.get(NotificationServiceDIToken).passive()).toEqual([]);
    });
});

describe("workbenchModule — bulk edit access to buffers", () => {
    it("an open tab is visible as a buffer, a foreign resource is not", () => {
        const { container } = createTestContainer();
        const editors = container.get(EditorServiceDIToken);
        const buffers = container.get(IBulkEditBuffersDIToken);
        const file = path.join(tmpDir, "open.ts");
        fs.writeFileSync(file, "const a = 1;\n");
        editors.openFile(file);
        const pane = editors.getActiveTabEditor()!;

        const target = buffers.get(pane.uri.toString());
        expect(target).not.toBeNull();
        expect(target).not.toBe("read-only");
        expect(buffers.get("file:///nowhere/closed.ts")).toBeNull();
        expect(buffers.undoParticipants([pane.uri.toString()])).toEqual([
            { context: pane.undoContext, label: pane.label, owner: true },
        ]);
    });
});
