/** Подставляет `define` в `tsup.config.ts`; под `tsx` его нет. */
declare const __DIODE_VERSION__: string | undefined;

/* v8 ignore start -- ветка с подставленным __DIODE_VERSION__ исполняется только в собранном бандле (tsup define), не в dev/тестах */
export const DIODE_VERSION: string = typeof __DIODE_VERSION__ !== "undefined" ? __DIODE_VERSION__ : "0.0.0-dev";
/* v8 ignore stop */

export const APP_NAME = "Diode";

export const REPO_URL = "https://github.com/diode-editor/diode";
