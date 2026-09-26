/**
 * Описание цветовой темы из `package.json` → `contributes.themes[]`
 * (формат VS Code, 1:1).
 *
 * Ключ темы в реестре и в `workbench.colorTheme` — `label`, как у VS Code;
 * `name` внутри JSON-файла темы игнорируется. Файл темы (`path`) — JSON/JSONC с
 * `colors`/`tokenColors`/`include`, см. `platform/theme/common/iThemeFile.ts`.
 */
export interface IThemeContribution {
    /** Необязательный машинный id темы (VS Code использует для settings-схемы). */
    readonly id?: string;

    /** Подпись темы в пикере и значение `workbench.colorTheme`. */
    readonly label: string;

    /**
     * Базовый вид: `vs` (светлая), `vs-dark` (тёмная), `hc-black`, `hc-light`.
     * Отсутствует или неизвестен → тёмная (с warning в лог).
     */
    readonly uiTheme?: "vs" | "vs-dark" | "hc-black" | "hc-light";

    /** Путь к файлу темы относительно корня расширения (`./themes/dark.json`). */
    readonly path: string;
}
