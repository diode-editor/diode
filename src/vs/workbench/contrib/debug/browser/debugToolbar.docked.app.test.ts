// `debug.toolBarLocation: docked` on the whole workbench with the synthetic debugger: the buttons in the Run and
// Debug title keep the debug icon colors, as upstream's `.part > .title > .title-actions` rules in debugColors.ts.

import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { MenuRegistryDIToken } from "../../../../platform/actions/common/menuRegistry.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import { registerExtensionMenus } from "../../../services/extensions/common/extensionMenuContributor.ts";

const FILE = "docked-sample.txt";

describe("the docked debug toolbar", () => {
    let ws: ITempWorkspace;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ files: { [FILE]: "alpha\nbeta\n" } });
        t = await createDebugViewletHarness(ws.dir);
        t.h.workbench.openFile(ws.path(FILE));
    });

    afterEach(async () => {
        await t.dispose();
        ws.dispose();
    });

    function titleGlyph(glyph: string): Point {
        const lines = t.lines();
        // The title row: the only one with the Stop glyph.
        const y = lines.findIndex((line) => line.includes("■"));
        expect(y).toBeGreaterThanOrEqual(0);
        expect(lines[y].indexOf(glyph)).toBeGreaterThanOrEqual(0);
        return new Point(lines[y].indexOf(glyph), y);
    }

    it("the buttons in the Run and Debug title are colored debugIcon.*Foreground", async () => {
        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.toolBarLocation", "docked");
        await t.startStopped();

        const vars = t.vars();
        const backend = t.h.testApp.backend;
        const title = t.lines().find((line) => line.includes("■"));
        expect(title).toContain("▶");

        expect(backend.getFgAt(titleGlyph("▶"))).toBe(vars["debugIcon.continueForeground"]);
        expect(backend.getFgAt(titleGlyph("↷"))).toBe(vars["debugIcon.stepOverForeground"]);
        expect(backend.getFgAt(titleGlyph("↻"))).toBe(vars["debugIcon.restartForeground"]);
        expect(backend.getFgAt(titleGlyph("■"))).toBe(vars["debugIcon.stopForeground"]);
    });

    it("an extension's debug/toolBar button is in the Run and Debug title too", async () => {
        const extension = {
            id: "test.demo",
            isBuiltin: false,
            manifest: {
                contributes: {
                    commands: [{ command: "demo.ping", title: "Ping", icon: "$(bell)" }],
                    menus: { "debug/toolBar": [{ command: "demo.ping", group: "navigation@80" }] },
                },
            },
        } as unknown as IExtension;
        const registration = registerExtensionMenus([extension], t.h.container.get(MenuRegistryDIToken));
        try {
            await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.toolBarLocation", "docked");
            await t.startStopped();

            const bell = t.h.container.get(ProductIconServiceDIToken).codicon("bell");
            expect(t.lines().find((line) => line.includes("■"))).toContain(bell);
        } finally {
            registration.dispose();
        }
    });
});
