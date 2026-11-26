/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/linkDetector.ts
// Links in debug output: web links and file paths with an optional `:line:col`, found as upstream finds them.
// Deviations: a link is a styled piece of a row, not an `<a>`; it is underlined always (a list row has no hover) and
// opens on a plain click — the list hands only clicks without modifiers to its rows, upstream asks for Ctrl+click. A
// path is checked when it is clicked, not when it is shown (upstream stats every path to decide whether to decorate
// it): a missing file or a folder opens nothing. No hover with the full path; no `linkifyLocation` (DAP
// `locationReference`); `file://` links open as paths, other web links go to the system's opener.

import { join, normalize } from "node:path";

import { StyleFlags } from "@tuidom/core/common/styleFlags";

import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Uri } from "../../../../base/common/uri.ts";
import {
    type IEnvironmentService,
    IEnvironmentServiceDIToken,
} from "../../../../platform/environment/common/environment.ts";
import { type IFileService, IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IRowSpan } from "../../../browser/parts/views/lazyTreeControl.ts";
import { openUriAtPosition } from "../../../services/editor/browser/openUriAtPosition.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import {
    ExternalOpenerDIToken,
    type IExternalOpener,
} from "../../../services/externalOpener/common/iExternalOpener.ts";
import { type IJumpRecorder, JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";

export const LinkDetectorDIToken = token<LinkDetector>("LinkDetector");

const CONTROL_CODES = "\\u0000-\\u0020\\u007f-\\u009f";
const WEB_LINK_REGEX = new RegExp(
    "(?:[a-zA-Z][a-zA-Z0-9+.-]{2,}:\\/\\/|data:|www\\.)[^\\s" +
        CONTROL_CODES +
        '"]{2,}[^\\s' +
        CONTROL_CODES +
        "\"')}\\],:;.!?]",
    "ug",
);

const WIN_ABSOLUTE_PATH = /(?:[a-zA-Z]:(?:(?:\\|\/)[\w\s.@\-()[\]{}!#$%^&'`~+=]+)+)/u;
const WIN_RELATIVE_PATH = /(?:(?:~|\.+)(?:(?:\\|\/)[\w\s.@\-()[\]{}!#$%^&'`~+=]+)+)/u;
const WIN_PATH = new RegExp(`(${WIN_ABSOLUTE_PATH.source}|${WIN_RELATIVE_PATH.source})`, "u");
const POSIX_PATH = /((?:~|\.+)?(?:\/[\w\s.@\-()[\]{}!#$%^&'`~+=]+)+)/u;
// Support both ":line 123" and ":123:45" formats for line/column numbers
const LINE_COLUMN = /(?::(?:line\s+)?(\d+))?(?::(\d+))?/u;
const LINE_COLUMN_REGEX = /:(?:line\s+)?(\d+)(?::(\d+))?$/u;

const MAX_LENGTH = 2000;

type LinkKind = "web" | "path" | "text";
export interface ILinkPart {
    readonly kind: LinkKind;
    readonly value: string;
    readonly captures: readonly (string | undefined)[];
    readonly index: number;
}

/** Upstream's paths of the platform with their optional position: group 1 the path, 2 the line, 3 the column. */
export function pathLinkRegex(windows: boolean): RegExp {
    return new RegExp(`${windows ? WIN_PATH.source : POSIX_PATH.source}${LINE_COLUMN.source}`, "gu");
}

/** Read on first use, not when the module loads (the startup snapshot). */
let platformPathLinkRegex: RegExp | undefined;

/** Upstream `detectLinks`: the text in parts, web links found first, then paths in what is left. */
export function detectLinks(text: string): ILinkPart[] {
    if (text.length > MAX_LENGTH) {
        return [{ kind: "text", value: text, captures: [], index: 0 }];
    }

    // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral: the tests run on one platform; both regexes are under test through pathLinkRegex
    platformPathLinkRegex ??= pathLinkRegex(process.platform === "win32");
    const regexes: RegExp[] = [WEB_LINK_REGEX, platformPathLinkRegex];
    const kinds: LinkKind[] = ["web", "path"];
    const result: ILinkPart[] = [];

    const splitOne = (part: string, regexIndex: number, baseIndex: number): void => {
        if (regexIndex >= regexes.length) {
            result.push({ value: part, kind: "text", captures: [], index: baseIndex });
            return;
        }
        const regex = regexes[regexIndex];
        let currentIndex = 0;
        regex.lastIndex = 0;
        for (let match = regex.exec(part); match !== null; match = regex.exec(part)) {
            const stringBeforeMatch = part.substring(currentIndex, match.index);
            if (stringBeforeMatch) {
                splitOne(stringBeforeMatch, regexIndex + 1, baseIndex + currentIndex);
            }
            const value = match[0];
            result.push({ value, kind: kinds[regexIndex], captures: match.slice(1), index: baseIndex + match.index });
            currentIndex = match.index + value.length;
        }
        const stringAfterMatches = part.substring(currentIndex);
        if (stringAfterMatches) {
            splitOne(stringAfterMatches, regexIndex + 1, baseIndex + currentIndex);
        }
    };

    splitOne(text, 0, 0);
    return result;
}

/** A 1-based line and column as printed; 0 is none. */
function positionOf(line: number, column: number): { line: number; column: number } | undefined {
    return line > 0 ? { line: line - 1, column: column > 0 ? column - 1 : 0 } : undefined;
}

export class LinkDetector {
    public static dependencies = [
        IFileServiceDIToken,
        EditorServiceDIToken,
        JumpRecorderDIToken,
        ExternalOpenerDIToken,
        IEnvironmentServiceDIToken,
    ] as const;

    public constructor(
        private readonly files: Pick<IFileService, "stat">,
        private readonly editors: IEditorService,
        private readonly jumps: IJumpRecorder,
        private readonly opener: IExternalOpener,
        private readonly environment: Pick<IEnvironmentService, "userHome">,
    ) {}

    /**
     * Upstream `linkify` over styled pieces: the links of their joined text become pieces of their own, underlined,
     * with what a click on them does. `workspaceFolder` resolves the relative paths; without it they stay text.
     */
    public linkify(spans: readonly IRowSpan[], workspaceFolder: IWorkspaceFolder | undefined): IRowSpan[] {
        const text = spans.map((span) => span.text).join("");
        const links = detectLinks(text).flatMap((part) => {
            const open = this.openerOf(part, workspaceFolder);
            return open === undefined ? [] : [{ start: part.index, end: part.index + part.value.length, open }];
        });
        const result: IRowSpan[] = [];
        let offset = 0;
        for (const span of spans) {
            const spanEnd = offset + span.text.length;
            let cut = offset;
            for (const link of links) {
                const from = Math.max(cut, link.start);
                const to = Math.min(spanEnd, link.end);
                if (from >= to) continue;
                if (from > cut) result.push({ ...span, text: text.slice(cut, from) });
                result.push({
                    ...span,
                    text: text.slice(from, to),
                    style: (span.style ?? StyleFlags.None) | StyleFlags.Underline,
                    link: link.open,
                });
                cut = to;
            }
            if (cut < spanEnd) result.push({ ...span, text: text.slice(cut, spanEnd) });
            offset = spanEnd;
        }
        return result;
    }

    private openerOf(part: ILinkPart, workspaceFolder: IWorkspaceFolder | undefined): (() => void) | undefined {
        if (part.kind === "web")
            return () => {
                this.run(this.openWebLink(part.value));
            };
        if (part.kind !== "path") return undefined;
        // A path match always has its group 1; a missing line or column is NaN, which positionOf takes as none.
        let path = String(part.captures[0]);
        const position = positionOf(Number(part.captures[1]), Number(part.captures[2]));
        if (path.startsWith(".")) {
            if (workspaceFolder === undefined) return undefined;
            const uri = Uri.joinPath(workspaceFolder.uri, path);
            return () => {
                this.run(this.openFile(uri, position));
            };
        }
        // What is left starts at the root: upstream's `//` and not-absolute checks have no path to reject.
        if (path.startsWith("~")) path = join(this.environment.userHome, path.substring(1));
        const uri = Uri.file(normalize(path));
        return () => {
            this.run(this.openFile(uri, position));
        };
    }

    private async openWebLink(url: string): Promise<void> {
        let uri = Uri.parse(url);
        if (uri.scheme !== "file") {
            await this.opener.open(url);
            return;
        }
        // if the URI ends with something like `foo.js:12:3`, parse that into the location to reveal
        const lineCol = LINE_COLUMN_REGEX.exec(uri.path);
        if (lineCol) uri = uri.with({ path: uri.path.slice(0, lineCol.index) });
        // The column is optional: its group is undefined without it, NaN as a number.
        await this.openFile(uri, lineCol ? positionOf(Number(lineCol[1]), Number(lineCol[2])) : undefined);
    }

    /** A folder or a missing file opens nothing, as upstream leaves such a path undecorated. */
    private async openFile(uri: Uri, position: { line: number; column: number } | undefined): Promise<void> {
        const stat = await this.files.stat(uri).catch(() => undefined);
        if (stat === undefined || stat.isDirectory) return;
        await openUriAtPosition(this.editors, this.jumps, uri, position);
    }

    private run(promise: Promise<void>): void {
        promise.catch(onUnexpectedError);
    }
}
