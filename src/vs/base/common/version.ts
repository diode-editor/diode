/** Substituted by `define` in `tsup.config.ts`; absent under `tsx`. */
declare const __DIODE_VERSION__: string | undefined;

/* v8 ignore start -- the branch with __DIODE_VERSION__ substituted runs only in the built bundle (tsup define), not in dev/tests */
export const DIODE_VERSION: string = typeof __DIODE_VERSION__ !== "undefined" ? __DIODE_VERSION__ : "0.0.0-dev";
/* v8 ignore stop */

export const APP_NAME = "Diode";

export const REPO_URL = "https://github.com/diode-editor/diode";
