/** Свой каталог вместо `.vscode`: Diode не читает и не перетирает файлы VS Code в том же проекте. */
export const WORKSPACE_CONFIG_FOLDER_NAME = ".diode";

export function workspaceConfigFilePath(name: string): string {
    return `${WORKSPACE_CONFIG_FOLDER_NAME}/${name}`;
}
