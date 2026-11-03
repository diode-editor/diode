import * as path from "node:path";

import { commonPrefixLength, splitLines } from "../../../../base/common/strings.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { generateUuid } from "../../../../base/common/uuid.ts";
import type { ICommentRule } from "../../../../platform/extensions/common/iLanguageConfiguration.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { workspaceFileLabel } from "../../../../platform/workspace/common/workspaceFile.ts";
import type { IRange } from "../../../common/core/iRange.ts";
import { DEFAULT_WORD_REGEXP, getWordAtText } from "../../../common/core/wordHelper.ts";
import { getLeadingWhitespace } from "../../../common/languages/autoIndent.ts";
import type { ITextDocument } from "../../../common/model/iTextDocument.ts";

import { Text, type TextmateSnippet, type Variable, type VariableResolver } from "./snippetParser.ts";

/**
 * Port of upstream `snippetVariables.ts`. Deviations: paths are the plain file system path (there is no label
 * service, so no `~` for the home directory), the comment tokens are the document language's, `CLIPBOARD` always
 * spreads (there is no `editor.multiCursorPaste`), `RANDOM` and `RANDOM_HEX` always have six digits.
 */

/** What the resolvers read besides the document; a missing source resolves its variables to nothing. */
export interface ISnippetVariableSources {
    /** The document's resource. */
    readonly resource?: Uri;
    /** Read before the insert: the insert itself is synchronous. */
    readonly clipboardText?: string;
    /** Of the document's language. */
    readonly comments?: ICommentRule;
    readonly workspace?: Pick<IWorkspaceContextService, "getWorkspace" | "getWorkspaceFolder">;
}

export type ISnippetVariableDocument = Pick<ITextDocument, "getLineContent" | "getTextInRange">;

/** The first resolver with a value wins. */
export class CompositeSnippetVariableResolver implements VariableResolver {
    public constructor(private readonly delegates: readonly VariableResolver[]) {}

    public resolve(variable: Variable): string | undefined {
        for (const delegate of this.delegates) {
            const value = delegate.resolve(variable);
            if (value !== undefined) return value;
        }
        return undefined;
    }
}

/**
 * Upstream `SelectionBasedVariableResolver` for an edit's range (a left-to-right selection: its position is the
 * range end), without the overtyping capturer.
 */
export class SelectionBasedVariableResolver implements VariableResolver {
    public constructor(
        private readonly document: ISnippetVariableDocument,
        private readonly snippet: TextmateSnippet,
        private readonly range: IRange,
        private readonly index: number,
    ) {}

    public resolve(variable: Variable): string | undefined {
        const { line, character } = this.range.end;
        switch (variable.name) {
            case "SELECTION":
            case "TM_SELECTED_TEXT":
                return this.selectedText(variable);
            case "TM_CURRENT_LINE":
                return this.document.getLineContent(line);
            case "TM_CURRENT_WORD": {
                const text = this.document.getLineContent(line);
                const word = getWordAtText(character, DEFAULT_WORD_REGEXP, text);
                return word === null ? undefined : text.slice(word.start, word.end);
            }
            case "TM_LINE_INDEX":
                return String(line);
            case "TM_LINE_NUMBER":
                return String(line + 1);
            case "CURSOR_INDEX":
                return String(this.index);
            case "CURSOR_NUMBER":
                return String(this.index + 1);
        }
        return undefined;
    }

    /**
     * A multi-line selection gets the indentation the variable has in the snippet on top of the indentation of the
     * selection's first line.
     */
    private selectedText(variable: Variable): string | undefined {
        const value = this.document.getTextInRange(this.range);
        if (value === "") return undefined;
        const lineLeadingWhitespace = getLeadingWhitespace(
            this.document.getLineContent(this.range.start.line).slice(0, this.range.start.character),
        );
        let variableLeadingWhitespace = lineLeadingWhitespace;
        this.snippet.walk((marker) => {
            if (marker === variable) return false;
            if (marker instanceof Text) {
                const lines = splitLines(marker.value);
                variableLeadingWhitespace = getLeadingWhitespace(lines[lines.length - 1]);
            }
            return true;
        });
        const extra = variableLeadingWhitespace.slice(
            commonPrefixLength(variableLeadingWhitespace, lineLeadingWhitespace),
        );
        return value.replace(/\r\n|\r|\n/g, (newline) => newline + extra);
    }
}

/** Upstream `ModelBasedVariableResolver`: the document's resource. */
export class ModelBasedVariableResolver implements VariableResolver {
    public constructor(
        private readonly resource: Uri,
        private readonly workspace: ISnippetVariableSources["workspace"],
    ) {}

    public resolve(variable: Variable): string | undefined {
        const { fsPath } = this.resource;
        switch (variable.name) {
            case "TM_FILENAME":
                return path.basename(fsPath);
            case "TM_FILENAME_BASE": {
                const name = path.basename(fsPath);
                const index = name.lastIndexOf(".");
                return index <= 0 ? name : name.slice(0, index);
            }
            case "TM_DIRECTORY": {
                const directory = path.dirname(fsPath);
                return directory === "." ? "" : directory;
            }
            case "TM_DIRECTORY_BASE": {
                const directory = path.dirname(fsPath);
                return directory === "." ? "" : path.basename(directory);
            }
            case "TM_FILEPATH":
                return fsPath;
            case "RELATIVE_FILEPATH": {
                const folder = this.workspace?.getWorkspaceFolder(this.resource);
                return folder == null ? fsPath : path.relative(folder.uri.fsPath, fsPath);
            }
        }
        return undefined;
    }
}

/**
 * Upstream `ClipboardBasedVariableResolver` with `editor.multiCursorPaste: spread`: when the clipboard has a
 * non-blank line per edit, each edit gets its own line.
 */
export class ClipboardBasedVariableResolver implements VariableResolver {
    public constructor(
        private readonly clipboardText: string | undefined,
        private readonly index: number,
        private readonly count: number,
    ) {}

    public resolve(variable: Variable): string | undefined {
        if (variable.name !== "CLIPBOARD" || !this.clipboardText) return undefined;
        const lines = this.clipboardText.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "");
        return lines.length === this.count ? lines[this.index] : this.clipboardText;
    }
}

/** Upstream `CommentBasedVariableResolver`. */
export class CommentBasedVariableResolver implements VariableResolver {
    public constructor(private readonly comments: ICommentRule | undefined) {}

    public resolve(variable: Variable): string | undefined {
        switch (variable.name) {
            case "LINE_COMMENT":
                return this.comments?.lineComment;
            case "BLOCK_COMMENT_START":
                return this.comments?.blockComment?.[0];
            case "BLOCK_COMMENT_END":
                return this.comments?.blockComment?.[1];
        }
        return undefined;
    }
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const twoDigits = (value: number): string => String(value).padStart(2, "0");

/** Upstream `TimeBasedVariableResolver`: one moment for the whole insert, English names as upstream without a language pack. */
export class TimeBasedVariableResolver implements VariableResolver {
    private readonly date = new Date();

    public resolve(variable: Variable): string | undefined {
        const { date } = this;
        switch (variable.name) {
            case "CURRENT_YEAR":
                return String(date.getFullYear());
            case "CURRENT_YEAR_SHORT":
                return String(date.getFullYear()).slice(-2);
            case "CURRENT_MONTH":
                return twoDigits(date.getMonth() + 1);
            case "CURRENT_DATE":
                return twoDigits(date.getDate());
            case "CURRENT_HOUR":
                return twoDigits(date.getHours());
            case "CURRENT_MINUTE":
                return twoDigits(date.getMinutes());
            case "CURRENT_SECOND":
                return twoDigits(date.getSeconds());
            case "CURRENT_MILLISECOND":
                return String(date.getMilliseconds()).padStart(3, "0");
            case "CURRENT_DAY_NAME":
                return DAY_NAMES[date.getDay()];
            case "CURRENT_DAY_NAME_SHORT":
                return DAY_NAMES[date.getDay()].slice(0, 3);
            case "CURRENT_MONTH_NAME":
                return MONTH_NAMES[date.getMonth()];
            case "CURRENT_MONTH_NAME_SHORT":
                return MONTH_NAMES[date.getMonth()].slice(0, 3);
            case "CURRENT_SECONDS_UNIX":
                return String(Math.floor(date.getTime() / 1000));
            case "CURRENT_MILLISECONDS_UNIX":
                return String(date.getTime());
            case "CURRENT_TIMEZONE_OFFSET": {
                const offset = date.getTimezoneOffset();
                const minutes = Math.abs(offset);
                return `${offset > 0 ? "-" : "+"}${twoDigits(Math.trunc(minutes / 60))}:${twoDigits(minutes % 60)}`;
            }
            case "CURRENT_TIMEZONE_NAME":
                return Intl.DateTimeFormat().resolvedOptions().timeZone;
        }
        return undefined;
    }
}

/** Upstream `WorkspaceBasedVariableResolver`: nothing without a folder. */
export class WorkspaceBasedVariableResolver implements VariableResolver {
    public constructor(private readonly workspace: ISnippetVariableSources["workspace"]) {}

    public resolve(variable: Variable): string | undefined {
        const workspace = this.workspace?.getWorkspace();
        const folder = workspace?.folders.at(0);
        if (folder === undefined) return undefined;
        const configuration = workspace?.configuration?.fsPath;
        switch (variable.name) {
            case "WORKSPACE_NAME":
                return configuration === undefined
                    ? path.basename(folder.uri.fsPath)
                    : workspaceFileLabel(configuration);
            case "WORKSPACE_FOLDER":
                return configuration === undefined ? folder.uri.fsPath : path.dirname(configuration);
        }
        return undefined;
    }
}

/** Upstream `RandomBasedVariableResolver`. */
export class RandomBasedVariableResolver implements VariableResolver {
    public resolve(variable: Variable): string | undefined {
        switch (variable.name) {
            case "RANDOM":
                return String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
            case "RANDOM_HEX":
                return Math.floor(Math.random() * 0x1000000)
                    .toString(16)
                    .padStart(6, "0");
            case "UUID":
                return generateUuid();
        }
        return undefined;
    }
}
