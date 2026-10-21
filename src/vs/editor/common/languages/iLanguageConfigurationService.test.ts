import { describe, expect, it } from "vitest";

import { NULL_LANGUAGE_CONFIGURATION_SERVICE } from "./iLanguageConfigurationService.ts";
import { EMPTY_LANGUAGE_CONFIGURATION } from "./languageConfiguration.ts";

describe("NULL_LANGUAGE_CONFIGURATION_SERVICE", () => {
    it("отдаёт пустую конфигурацию всем языкам сразу и после загрузки", async () => {
        // EMPTY, not undefined: in test containers features are off rather than waiting forever for a load.
        expect(NULL_LANGUAGE_CONFIGURATION_SERVICE.get("typescript")).toBe(EMPTY_LANGUAGE_CONFIGURATION);
        await expect(NULL_LANGUAGE_CONFIGURATION_SERVICE.ensureLoaded("typescript")).resolves.toBe(
            EMPTY_LANGUAGE_CONFIGURATION,
        );
    });
});
