import { describe, expect, it } from "vitest";

import { registerContextKeys } from "../../../../platform/contextkey/common/contextKeys.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { applyTerminalEnvContextKeys, capabilityContextKey, modeContextKey } from "./terminalEnvContextKeys.ts";

describe("terminalEnvContextKeys", () => {
    it("имена ключей: capability в camelCase после cap_, мод — после mode_", () => {
        expect(capabilityContextKey("extended-keys")).toBe("cap_extendedKeys");
        expect(capabilityContextKey("kitty-graphics")).toBe("cap_kittyGraphics");
        expect(capabilityContextKey("osc52")).toBe("cap_osc52");
        expect(modeContextKey("ssh")).toBe("mode_ssh");
    });

    it("выставляет tier/os/isX/macKeys и cap_*/mode_* со значениями из среза", () => {
        registerContextKeys(["mode_envKeysCustom"]);
        const keys = new ContextKeyService();
        applyTerminalEnvContextKeys(keys, {
            tier: "csi-u",
            os: "mac",
            macKeysRung: "cmd",
            capabilities: { "extended-keys": true, super: false },
            modes: { local: true, envKeysCustom: false },
        });

        expect(keys.get("tier")).toBe("csi-u");
        expect(keys.get("os")).toBe("mac");
        expect(keys.get("isMac")).toBe(true);
        expect(keys.get("isLinux")).toBe(false);
        expect(keys.get("isWindows")).toBe(false);
        expect(keys.get("macKeys")).toBe(3);
        expect(keys.get("cap_extendedKeys")).toBe(true);
        expect(keys.get("cap_super")).toBe(false);
        expect(keys.evaluate("mode_local")).toBe(true);
        expect(keys.evaluate("!mode_envKeysCustom")).toBe(true);
    });

    it("isLinux/isWindows следуют за os, macKeys без рунга — ноль", () => {
        const keys = new ContextKeyService();
        const apply = (os: string): void => {
            applyTerminalEnvContextKeys(keys, {
                tier: "legacy",
                os,
                macKeysRung: undefined,
                capabilities: {},
                modes: {},
            });
        };
        apply("linux");
        expect([keys.get("isMac"), keys.get("isLinux"), keys.get("isWindows")]).toEqual([false, true, false]);
        apply("windows");
        expect([keys.get("isMac"), keys.get("isLinux"), keys.get("isWindows")]).toEqual([false, false, true]);
        expect(keys.get("macKeys")).toBe(0);
    });
});
