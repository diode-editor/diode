export interface IThemeContribution {
    readonly id?: string;

    /** Ключ темы в реестре и в `workbench.colorTheme`, как у VS Code; `name` из файла темы игнорируется. */
    readonly label: string;

    /** Нет или неизвестен — тёмная, с warning в лог. */
    readonly uiTheme?: "vs" | "vs-dark" | "hc-black" | "hc-light";

    /** Относительно корня расширения. */
    readonly path: string;
}
