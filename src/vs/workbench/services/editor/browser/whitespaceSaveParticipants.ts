import {
    trailingWhitespaceStart,
    trimTrailingWhitespaceRanges,
} from "../../../../editor/common/commands/trimTrailingWhitespace.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { ISaveEdit, SaveParticipant } from "../../textfile/common/iSaveParticipant.ts";

import type { IOnSaveParticipantHost } from "./onSaveParticipants.ts";

// Upstream `saveParticipants.ts`: `TrimWhitespaceParticipant`, `FinalNewLineParticipant`,
// `TrimFinalNewLinesParticipant`. Settings are read at save time with the file's language override;
// each participant reads the fresh snapshot (the previous ones may have edited the buffer).

export type WhitespaceSaveSetting =
    | "files.trimTrailingWhitespace"
    | "files.insertFinalNewline"
    | "files.trimFinalNewlines";

export function isWhitespaceSaveSettingOn(
    configuration: IConfigurationService,
    setting: WhitespaceSaveSetting,
    languageId: string,
): boolean {
    return configuration.get(setting, { overrideIdentifier: languageId });
}

/** Tokens come from the pane; a save without a tab has none, so `InRegexAndStrings: false` skips every line. */
export function createTrimWhitespaceOnSaveParticipant(host: IOnSaveParticipantHost): SaveParticipant {
    return (snapshot) => {
        const trimInRegexAndStrings = host.configuration.get("files.trimTrailingWhitespaceInRegexAndStrings", {
            overrideIdentifier: snapshot.languageId,
        });
        const tokens = host.paneForUri(snapshot.uri)?.viewState.tokenStore;
        const ranges = trimTrailingWhitespaceRanges(snapshot.text.split("\n"), trimInRegexAndStrings, tokens);
        return Promise.resolve(ranges.map((range): ISaveEdit => ({ kind: "text", range, text: "" })));
    };
}

/**
 * A last line that is empty or only spaces/tabs gets nothing, as upstream. The buffer is LF; the
 * file's EOL is applied on write, so a CRLF file ends with CRLF on disk.
 */
export function createInsertFinalNewlineOnSaveParticipant(): SaveParticipant {
    return (snapshot) => {
        const lines = snapshot.text.split("\n");
        const last = lines.length - 1;
        const content = lines[last];
        if (trailingWhitespaceStart(content) === 0) return Promise.resolve([]);
        return Promise.resolve([
            { kind: "text", range: createRange(last, content.length, last, content.length), text: "\n" },
        ]);
    };
}

/** Deletes the empty lines after the last non-empty one, keeping the final newline; "non-empty" is length > 0. */
export function createTrimFinalNewlinesOnSaveParticipant(): SaveParticipant {
    return (snapshot) => {
        const lines = snapshot.text.split("\n");
        const last = lines.length - 1;
        let lastNonEmpty = last;
        while (lastNonEmpty >= 0 && lines[lastNonEmpty].length === 0) lastNonEmpty--;
        // A file not ending with a newline (`lastNonEmpty === last`) or ending with exactly one keeps its text.
        if (lastNonEmpty + 1 >= last) return Promise.resolve([]);
        return Promise.resolve([{ kind: "text", range: createRange(lastNonEmpty + 1, 0, last, 0), text: "" }]);
    };
}
