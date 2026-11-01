import type * as vscode from "vscode";

import { ThemeIcon } from "./vscodeTypes.ts";

// Not in vscodeTypes.ts: that module is shared with the main bundle, and these are only for the extension host.

export enum QuickInputButtonLocation {
    Title = 1,
    Inline = 2,
    Input = 3,
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- vscode.d.ts declares it as a class
export class QuickInputButtons {
    public static readonly Back: vscode.QuickInputButton = { iconPath: new ThemeIcon("arrow-left") };

    private constructor() {
        // Upstream: a holder of predefined buttons, never instantiated.
    }
}
