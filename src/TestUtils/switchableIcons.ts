import { NERD_FONT_SETTING, ProductIconService } from "../vs/platform/theme/common/productIconService.ts";

import { createTestConfigurationService } from "./testConfigurationService.ts";

/** The real icon service over an in-memory settings.json: `set` flips `diode.icons.nerdFont` live. */
export interface ISwitchableIcons {
    readonly icons: ProductIconService;
    set(nerdFont: boolean): Promise<void>;
}

export function createSwitchableIcons(nerdFont = true): ISwitchableIcons {
    const config = createTestConfigurationService({ [NERD_FONT_SETTING]: nerdFont ? "on" : "off" });
    const icons = new ProductIconService(config, "xterm-256color");
    return {
        icons,
        set: (value) => config.updateValue(NERD_FONT_SETTING, value ? "on" : "off"),
    };
}
