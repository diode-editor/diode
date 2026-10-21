/** Our own directory instead of `.vscode`: Diode neither reads nor overwrites VS Code's files in the same project. */
export const WORKSPACE_CONFIG_FOLDER_NAME = ".diode";

export function workspaceConfigFilePath(name: string): string {
    return `${WORKSPACE_CONFIG_FOLDER_NAME}/${name}`;
}
