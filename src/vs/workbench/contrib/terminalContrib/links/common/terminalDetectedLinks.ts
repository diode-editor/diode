import type { ITerminalBuffer } from "../../../terminal/common/terminalBuffer.ts";

import type { ITerminalLink } from "./terminalLinkProvider.ts";

export interface ITerminalLinkLineSource {
    provideLinks(buffer: ITerminalBuffer, row: number): Promise<ITerminalLink[]>;
}

/** Upstream `IDetectedLinks` without word and URL links: we detect local paths only. */
export interface IDetectedLinks {
    readonly fileLinks: readonly ITerminalLink[];
    readonly folderLinks: readonly ITerminalLink[];
}

/**
 * Upstream `TerminalLinkManager.getLinks`: the viewport's links bottom-up, at once; the rest of the buffer —
 * below the viewport, then above it — later. Every row of a wrapped line yields the links of the whole line,
 * so a link is kept once.
 */
export function getDetectedLinks(
    buffer: ITerminalBuffer,
    source: ITerminalLinkLineSource,
): { readonly viewport: Promise<IDetectedLinks>; readonly all: Promise<IDetectedLinks> } {
    const bottom = buffer.viewportY + buffer.rows - 1;
    const viewportRows = rowsDown(bottom, buffer.viewportY);
    const viewport = linksOf(buffer, source, viewportRows);
    const all = linksOf(buffer, source, [
        ...viewportRows,
        ...rowsDown(buffer.length - 1, bottom + 1),
        ...rowsDown(buffer.viewportY - 1, 0),
    ]);
    return { viewport, all };
}

/**
 * Upstream `openRecentLink('localFile')`: the bottom row with a file link, from the end of the buffer up to the
 * viewport top — the scrollback above the viewport is not searched. The first link of that line.
 */
export async function getRecentFileLink(
    buffer: ITerminalBuffer,
    source: ITerminalLinkLineSource,
): Promise<ITerminalLink | undefined> {
    for (let row = buffer.length - 1; row >= buffer.viewportY; row--) {
        const links = (await source.provideLinks(buffer, row)).filter((link) => link.type === "LocalFile");
        if (links.length > 0) return links[0];
    }
    return undefined;
}

function rowsDown(from: number, to: number): number[] {
    const rows: number[] = [];
    for (let row = from; row >= to; row--) rows.push(row);
    return rows;
}

/** Rows in the given order; each row's links are reversed, as upstream: the list reads bottom-up. */
async function linksOf(
    buffer: ITerminalBuffer,
    source: ITerminalLinkLineSource,
    rows: readonly number[],
): Promise<IDetectedLinks> {
    const byRow = await Promise.all(rows.map((row) => source.provideLinks(buffer, row)));
    const seen = new Set<string>();
    const fileLinks: ITerminalLink[] = [];
    const folderLinks: ITerminalLink[] = [];
    for (const links of byRow) {
        for (const link of [...links].reverse()) {
            const key = `${String(link.start.x)},${String(link.start.y)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            (link.type === "LocalFile" ? fileLinks : folderLinks).push(link);
        }
    }
    return { fileLinks, folderLinks };
}
