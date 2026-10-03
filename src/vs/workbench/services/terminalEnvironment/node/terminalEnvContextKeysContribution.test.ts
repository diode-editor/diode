import { describe, expect, it } from "vitest";

import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";

import { TerminalEnvContextKeysContribution } from "./terminalEnvContextKeysContribution.ts";
import type { TerminalEnvironmentService } from "./terminalEnvironmentService.ts";

function fakeEnv() {
    let listener: (() => void) | null = null;
    const env = {
        tier: "legacy",
        os: "linux",
        macKeysRung: "cmd",
        activeModes: new Set(["local"]),
        getKnownModeNames: () => ["local", "envContribCustom"],
        isModeActive: (name: string) => env.activeModes.has(name),
        // Только super: ключ cap_super обязан спросить именно его.
        hasCapability: (cap: string) => cap === "super",
        onDidChange: (l: () => void) => {
            listener = l;
            return { dispose: () => (listener = null) };
        },
    };
    return { env, fire: () => listener?.() };
}

describe("TerminalEnvContextKeysContribution", () => {
    it("выставляет ключи окружения сразу при создании и регистрирует свои моды", () => {
        const { env } = fakeEnv();
        const keys = new ContextKeyService();
        new TerminalEnvContextKeysContribution(keys, env as unknown as TerminalEnvironmentService);

        expect(keys.get("tier")).toBe("legacy");
        expect(keys.get("isLinux")).toBe(true);
        expect(keys.get("cap_super")).toBe(true);
        expect(keys.get("cap_extendedKeys")).toBe(false);
        expect(keys.get("macKeys")).toBe(3);
        expect(keys.evaluate("mode_local")).toBe(true);
        // Незарегистрированное имя в when даёт false целиком — `!` на нём не спасает.
        expect(keys.evaluate("!mode_envContribCustom")).toBe(true);
    });

    it("пушит ключи заново по onDidChange окружения, после dispose — нет", () => {
        const { env, fire } = fakeEnv();
        const keys = new ContextKeyService();
        const contribution = new TerminalEnvContextKeysContribution(keys, env as unknown as TerminalEnvironmentService);

        env.tier = "kitty";
        env.activeModes.add("envContribCustom");
        fire();
        expect(keys.get("tier")).toBe("kitty");
        expect(keys.evaluate("mode_envContribCustom")).toBe(true);

        contribution.dispose();
        env.tier = "csi-u";
        fire();
        expect(keys.get("tier")).toBe("kitty");
    });
});
