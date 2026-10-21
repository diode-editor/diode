export interface IThemeContribution {
    readonly id?: string;

    /** Theme key in the registry and in `workbench.colorTheme`, as in VS Code; `name` from the theme file is ignored. */
    readonly label: string;

    /** Missing or unknown means dark, with a warning in the log. */
    readonly uiTheme?: "vs" | "vs-dark" | "hc-black" | "hc-light";

    /** Relative to the extension root. */
    readonly path: string;
}
