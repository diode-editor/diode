/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/processes.ts

const keysToRemove = [
    /^ELECTRON_.+$/,
    /^VSCODE_(?!(PORTABLE|SHELL_LOGIN|ENV_REPLACE|ENV_APPEND|ENV_PREPEND)).+$/,
    /^SNAP(|_.*)$/,
    /^GDK_PIXBUF_.+$/,
];

/**
 * Sanitizes a VS Code process environment by removing all Electron/VS Code-related values.
 */
export function sanitizeProcessEnvironment(env: Record<string, string | undefined>, ...preserve: string[]): void {
    for (const envKey of Object.keys(env)) {
        if (preserve.includes(envKey)) continue;
        if (keysToRemove.some((pattern) => pattern.test(envKey))) Reflect.deleteProperty(env, envKey);
    }
}
