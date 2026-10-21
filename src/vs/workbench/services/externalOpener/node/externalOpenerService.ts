import { spawn } from "node:child_process";

import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { IExternalOpener } from "../common/iExternalOpener.ts";

export interface IExternalOpenerEnvironment {
    readonly platform: NodeJS.Platform;
    readonly env: Readonly<Partial<Record<string, string>>>;
    /** `false` if the launch failed. */
    readonly launch: (command: string, args: readonly string[]) => Promise<boolean>;
    readonly clipboard: IClipboard;
    /** A callback, not a service: the notification surface lives in `browser`, and `node → browser` is forbidden. */
    readonly showInfo: (message: string) => void;
}

const OPENABLE_SCHEMES = ["http:", "https:", "mailto:"];

/**
 * Without a system handler the link is handed to the user (clipboard + message). This is the
 * main case: the editor runs in a terminal, a browser across ssh can't be launched, and a
 * silent `false` would leave the user without the link (AI completion sign-up).
 * On Linux `xdg-open` runs only with a live graphical session: otherwise it opens a text
 * browser on top of our terminal.
 */
export class ExternalOpenerService implements IExternalOpener {
    public constructor(private readonly environment: IExternalOpenerEnvironment) {}

    public async open(url: string): Promise<boolean> {
        if (!isOpenableUrl(url)) return false;
        const handler = systemHandler(this.environment);
        if (handler !== null && (await this.environment.launch(handler.command, [...handler.args, url]))) {
            return true;
        }
        return this.handOver(url);
    }

    /** The message carries the URL itself so it can be selected with the mouse even if the clipboard never reached the terminal. */
    private async handOver(url: string): Promise<boolean> {
        await this.environment.clipboard.writeText(url);
        this.environment.showInfo(`Ссылка скопирована в буфер обмена: ${url}`);
        return true;
    }
}

export function isOpenableUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    return OPENABLE_SCHEMES.includes(parsed.protocol);
}

export function systemHandler(
    environment: Pick<IExternalOpenerEnvironment, "platform" | "env">,
): { readonly command: string; readonly args: readonly string[] } | null {
    if (environment.platform === "darwin") return { command: "open", args: [] };
    if (environment.platform === "win32") return { command: "cmd", args: ["/c", "start", ""] };
    if (!hasGraphicalSession(environment.env)) return null;
    return { command: "xdg-open", args: [] };
}

/** `DISPLAY` may be forwarded over ssh, but opening a browser at the far end of the tunnel is not what the user expects. */
export function hasGraphicalSession(env: Readonly<Partial<Record<string, string>>>): boolean {
    if (nonEmpty(env.SSH_CONNECTION) || nonEmpty(env.SSH_TTY)) return false;
    return nonEmpty(env.DISPLAY) || nonEmpty(env.WAYLAND_DISPLAY);
}

function nonEmpty(value: string | undefined): boolean {
    return value !== undefined && value !== "";
}

/** `stdio: "ignore"`: browser output would clobber the TUI frame; `detached`: the browser outlives the editor. */
export const HANDLER_SPAWN_OPTIONS = { detached: true, stdio: "ignore" } as const;

export function spawnDetached(command: string, args: readonly string[]): Promise<boolean> {
    return new Promise<boolean>((settle) => {
        // No "already settled" flag: promise `resolve` is idempotent, and the spec
        // ignores a second call (e.g. `error` after `spawn`).
        try {
            const child = spawn(command, [...args], HANDLER_SPAWN_OPTIONS);
            // The `error` listener is REQUIRED: without it ENOENT (no handler on
            // PATH) goes unhandled and crashes the editor process.
            child.on("error", () => {
                settle(false);
            });
            child.on("spawn", () => {
                // Stryker disable next-line CallExpression: unref stops the child from holding our exit, which is unobservable inside the test process
                child.unref();
                settle(true);
            });
        } catch {
            settle(false);
        }
    });
}
