import { OperatingSystem } from "../vs/base/common/platform.ts";
import type { Uri } from "../vs/base/common/uri.ts";
import type { IFileService, IFileStat } from "../vs/platform/files/common/files.ts";
import { ExtensionPtySession } from "../vs/workbench/contrib/terminal/node/extensionPtySession.ts";
import { TerminalLinkProvider } from "../vs/workbench/contrib/terminalContrib/links/common/terminalLinkProvider.ts";
import { TerminalLinkResolver } from "../vs/workbench/contrib/terminalContrib/links/common/terminalLinkResolver.ts";

/** Paths that exist: `"file"` or `"dir"`; everything else fails `stat` like a missing file. */
export type FakeDisk = Readonly<Record<string, "file" | "dir">>;

export function fakeFileService(disk: FakeDisk, stats: string[] = []): Pick<IFileService, "stat"> {
    return {
        stat: (uri: Uri) => {
            stats.push(uri.fsPath);
            const kind = disk[uri.fsPath] as "file" | "dir" | undefined;
            if (kind === undefined) return Promise.reject(new Error(`ENOENT: ${uri.fsPath}`));
            return Promise.resolve({ isDirectory: kind === "dir" } as IFileStat);
        },
    };
}

export interface IFakeLinkContext {
    readonly disk: FakeDisk;
    readonly cwds?: readonly string[];
    readonly workspace?: string;
    readonly userHome?: string;
}

export function fakeLinkProvider(context: IFakeLinkContext): TerminalLinkProvider {
    const workspace = context.workspace ?? "/ws";
    return new TerminalLinkProvider({
        resolver: new TerminalLinkResolver(fakeFileService(context.disk), {
            os: OperatingSystem.Linux,
            userHome: context.userHome ?? "/home/user",
            getCwds: () => Promise.resolve(context.cwds ?? [workspace]),
        }),
        os: OperatingSystem.Linux,
        isInWorkspace: (uri) => uri.fsPath === workspace || uri.fsPath.startsWith(`${workspace}/`),
    });
}

/** A real emulator without a process: what the output looks like in the buffer, wraps and wide chars included. */
export async function emulatorWith(output: string, cols = 80, rows = 10): Promise<ExtensionPtySession> {
    const session = new ExtensionPtySession({
        cols,
        rows,
        name: "test",
        onInput: () => undefined,
        onResize: () => undefined,
    });
    await session.xtermReady;
    await feed(session, output);
    return session;
}

/** Resolves once the emulator has parsed `output`. */
export function feed(session: ExtensionPtySession, output: string): Promise<void> {
    return new Promise((resolve) => {
        const subscription = session.onUpdate(() => {
            subscription.dispose();
            resolve();
        });
        session.feed(output);
    });
}
