import { describe, expect, it } from "vitest";

import { ConfigurationModel } from "../../../platform/configuration/common/configurationModel.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";
import { sanitizeConfiguration } from "../../../platform/configuration/common/configurationValidation.ts";

import { extensionsConfiguration } from "./extensionsConfiguration.ts";

/** ExtensionUpdates stage 3: the three keys of upstream's `extensions.contribution.ts`. */
describe("extensionsConfiguration — updates", () => {
    const schemas = new ConfigurationRegistry([extensionsConfiguration]).getConfigurationProperties();

    function read(key: string, value: unknown): unknown {
        return sanitizeConfiguration(ConfigurationModel.fromRaw({ [key]: value }), schemas).get(key);
    }

    it("defaults are upstream's: auto check, auto update on, a 2-hour delay", () => {
        expect(schemas.get("extensions.autoCheckUpdates")?.default).toBe(true);
        expect(schemas.get("extensions.autoUpdate")?.default).toBe("on");
        expect(schemas.get("extensions.autoUpdateDelay")?.default).toBe(2);
    });

    it("`extensions.autoUpdate` keeps the older true/false: they read as on/off, not as the default (decision J1)", () => {
        expect(read("extensions.autoUpdate", "off")).toBe("off");
        expect(read("extensions.autoUpdate", false)).toBe(false);
        expect(read("extensions.autoUpdate", true)).toBe(true);
        expect(read("extensions.autoUpdate", "sometimes")).toBe("on");
    });

    it("a negative delay is out of the schema: the default", () => {
        expect(read("extensions.autoUpdateDelay", -1)).toBe(2);
        expect(read("extensions.autoUpdateDelay", 0)).toBe(0);
    });
});
