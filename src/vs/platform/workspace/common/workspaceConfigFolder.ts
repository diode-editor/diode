/**
 * Каталог конфигурации проекта в корне папки воркспейса — у эталона `.vscode`
 * (`settings.json`, `tasks.json`, …). У нас каталог свой: Diode не читает и не
 * перетирает файлы VS Code в том же проекте (`.vscode/` не читается вовсе). Все
 * файлы проекта берут путь отсюда, а не собирают `.diode/…` сами.
 */
export const WORKSPACE_CONFIG_FOLDER_NAME = ".diode";

/** Путь файла каталога конфигурации относительно папки воркспейса: `.diode/<name>`. */
export function workspaceConfigFilePath(name: string): string {
    return `${WORKSPACE_CONFIG_FOLDER_NAME}/${name}`;
}
