import { describe, expect, it } from "vitest";

import { CODICON_GLYPHS } from "../../../base/common/codicons.generated.ts";
import { codicon } from "../../../base/common/codicons.ts";
import { getFileIcon } from "../../../base/common/fileIcons.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../../workbench/common/configuration/configurationContributions.ts";
import { ConfigurationRegistry } from "../../configuration/common/configurationRegistry.ts";
import { InMemoryConfigurationService } from "../../configuration/common/inMemoryConfigurationService.ts";

import {
    NERD_FONT_ICONS,
    NERD_FONT_SETTING,
    ProductIconService,
    resolveNerdFont,
    StaticProductIconService,
} from "./productIconService.ts";

function configuration(): InMemoryConfigurationService {
    return new InMemoryConfigurationService(new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS));
}

describe("resolveNerdFont", () => {
    it("auto turns the glyphs off on the Linux console only", () => {
        expect(resolveNerdFont("auto", "linux")).toBe(false);
        expect(resolveNerdFont("auto", "xterm-256color")).toBe(true);
        expect(resolveNerdFont("auto", "xterm-kitty")).toBe(true);
        expect(resolveNerdFont("auto", "wezterm")).toBe(true);
        expect(resolveNerdFont("auto", undefined)).toBe(true);
    });

    it("an explicit value beats the terminal", () => {
        expect(resolveNerdFont("on", "linux")).toBe(true);
        expect(resolveNerdFont("off", "xterm-256color")).toBe(false);
    });

    it("a junk value is auto", () => {
        expect(resolveNerdFont("yes", "linux")).toBe(false);
        expect(resolveNerdFont(42, "xterm")).toBe(true);
    });
});

describe("ProductIconService", () => {
    it("defaults to auto: the Linux console gets Unicode, any other terminal Nerd Font", () => {
        expect(new ProductIconService(configuration(), "linux").nerdFont).toBe(false);
        expect(new ProductIconService(configuration(), "xterm-256color").nerdFont).toBe(true);
    });

    it("a junk value in settings.json is auto", async () => {
        const config = configuration();
        await config.updateValue(NERD_FONT_SETTING, "maybe");
        expect(new ProductIconService(config, "linux").nerdFont).toBe(false);
        expect(new ProductIconService(config, "xterm").nerdFont).toBe(true);
    });

    it("follows the setting live, both ways, and fires only on an actual switch", async () => {
        const config = configuration();
        const service = new ProductIconService(config, "xterm-256color");
        let fired = 0;
        service.onDidChange(() => fired++);

        await config.updateValue(NERD_FONT_SETTING, "off");
        expect(service.nerdFont).toBe(false);
        expect(fired).toBe(1);

        await config.updateValue(NERD_FONT_SETTING, "on");
        expect(service.nerdFont).toBe(true);
        expect(fired).toBe(2);

        // `auto` on a non-Linux terminal is still "on": nothing to redraw.
        await config.updateValue(NERD_FONT_SETTING, "auto");
        expect(fired).toBe(2);

        await config.updateValue("editor.tabSize", 2);
        expect(fired).toBe(2);
        service.dispose();
    });

    it("stops listening after dispose", async () => {
        const config = configuration();
        const service = new ProductIconService(config, "xterm");
        let fired = 0;
        service.onDidChange(() => fired++);
        service.dispose();
        await config.updateValue(NERD_FONT_SETTING, "off");
        expect(fired).toBe(0);
        expect(service.nerdFont).toBe(true);
    });

    it("resolves glyphs, `$(name)` and file icons in the current set", async () => {
        const config = configuration();
        const service = new ProductIconService(config, "xterm");
        expect(service.glyph(codicon("refresh"))).toBe(CODICON_GLYPHS.refresh);
        expect(service.codicon("refresh")).toBe(CODICON_GLYPHS.refresh);
        expect(service.renderCodicons("$(refresh) x")).toBe(`${CODICON_GLYPHS.refresh ?? ""} x`);
        expect(service.fileIcon("a.ts")).toEqual(getFileIcon("a.ts"));

        await config.updateValue(NERD_FONT_SETTING, "off");
        expect(service.glyph(codicon("refresh"))).toBe("↻");
        expect(service.codicon("refresh")).toBe("↻");
        expect(service.renderCodicons("$(refresh) x")).toBe("↻ x");
        expect(service.fileIcon("a.ts")).toBeUndefined();
        service.dispose();
    });

    it("passes a literal glyph through in both sets", () => {
        expect(new StaticProductIconService(false).glyph("★")).toBe("★");
        expect(NERD_FONT_ICONS.glyph("★")).toBe("★");
    });
});

describe("StaticProductIconService", () => {
    it("is a fixed set that never fires", () => {
        const unicode = new StaticProductIconService(false);
        let fired = 0;
        unicode.onDidChange(() => fired++).dispose();
        expect(unicode.nerdFont).toBe(false);
        expect(unicode.fileIcon("a.ts")).toBeUndefined();
        expect(NERD_FONT_ICONS.nerdFont).toBe(true);
        expect(NERD_FONT_ICONS.fileIcon("a.ts")).toEqual(getFileIcon("a.ts"));
        expect(fired).toBe(0);
    });
});
