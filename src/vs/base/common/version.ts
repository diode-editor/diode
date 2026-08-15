/**
 * Версия приложения. Реальное значение «зашивается» при сборке через `define`
 * в `tsup.config.ts` (глобал `__VEXX_VERSION__`). В dev-запуске через `tsx`
 * `define` не применяется, поэтому используем fallback `0.0.0-dev`.
 */
declare const __VEXX_VERSION__: string | undefined;

/* v8 ignore start -- ветка с подставленным __VEXX_VERSION__ исполняется только в собранном бандле (tsup define), не в dev/тестах */
export const VEXX_VERSION: string = typeof __VEXX_VERSION__ !== "undefined" ? __VEXX_VERSION__ : "0.0.0-dev";
/* v8 ignore stop */

/** Отображаемое имя приложения. */
export const APP_NAME = "Vexx";

/** Ссылка на репозиторий проекта (для окна About). */
export const REPO_URL = "https://github.com/diode-editor/diode";
