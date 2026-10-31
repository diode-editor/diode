import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange, rangeContainsPosition } from "../../../../editor/common/core/iRange.ts";
import { findWordRangeAt } from "../../../../editor/common/core/wordClassification.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    EditorStateCancellationTokenSource,
    EditorStateFlag,
} from "../../../browser/parts/editor/editorStateCancellation.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { NotificationService } from "../../../services/notification/browser/notificationService.ts";
import { NotificationServiceDIToken } from "../../../services/notification/browser/notificationService.ts";
import type { ReferencesService } from "../../references/browser/referencesService.ts";
import { ReferencesServiceDIToken } from "../../references/browser/referencesService.ts";

import { createLocationModel, getDefinitions, type ILocationModel } from "./goToSymbol.ts";

export const DefinitionServiceDIToken = token<DefinitionService>("DefinitionService");

export type GoToLocationMode = "peek" | "gotoAndPeek" | "goto";

export interface IGoToLocationsArguments {
    readonly uri: Uri;
    readonly position: IPosition;
    readonly locations: readonly ICoreDefinitionLocation[];
    /** Defaults to `editor.gotoLocation.multipleReferences`. */
    readonly multiple?: string;
    /** Without it an empty list is silent, as upstream's `muteMessage`. */
    readonly noResultsMessage?: string;
    readonly openInPeek?: boolean;
}

interface IShowOptions {
    readonly title: string;
    readonly multiple: unknown;
    readonly toSide: boolean;
    readonly openInPeek: boolean;
}

const DEFINITION_COMMAND_ID = "editor.action.revealDefinition";

export class DefinitionService {
    public static dependencies = [
        EditorServiceDIToken,
        JumpRecorderDIToken,
        LanguageFeaturesServiceDIToken,
        IConfigurationServiceDIToken,
        NotificationServiceDIToken,
        ReferencesServiceDIToken,
        CommandRegistryDIToken,
    ] as const;

    /** A repeated F12 supersedes the previous request: only the latest one jumps. */
    private readonly latest = new LatestRequest();
    /** Upstream `_activeAlternativeCommands`: an alternative pointing back at its origin doesn't loop. */
    private readonly activeAlternatives = new Set<string>();

    public constructor(
        private readonly group: IEditorService,
        private readonly jumps: IJumpRecorder,
        private readonly languageFeatures: ILanguageFeaturesService,
        private readonly configuration: IConfigurationService,
        private readonly notifications: NotificationService,
        private readonly references: ReferencesService,
        private readonly commands: CommandRegistry,
    ) {}

    /**
     * A response after an edit or a cursor move is not applied (upstream `EditorStateCancellationTokenSource`):
     * otherwise a slow provider (jdtls on a cold start) would retroactively carry the user off to another file.
     */
    public async revealDefinition({ toSide = false }: { toSide?: boolean } = {}): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;

        const state = new EditorStateCancellationTokenSource(editor, EditorStateFlag.Value | EditorStateFlag.Position);
        const ticket = this.latest.start(state.token);
        const caret = editor.viewState.selections[0].active;
        let model: ILocationModel;
        // Cleanup of a finished request's subscriptions is unobservable: a forgotten subscription would only
        // cancel a token nobody needs anymore.
        // Stryker disable BlockStatement: see above, the empty-finally mutant
        try {
            model = await getDefinitions(
                this.languageFeatures.definitionProvider,
                editor,
                {
                    uri: editor.uri.toString(),
                    languageId: editor.languageId,
                    versionId: editor.model.document.versionId,
                    line: caret.line,
                    character: caret.character,
                },
                ticket.token,
            );
        } finally {
            // Stryker disable next-line CallExpression: see above
            state.dispose();
        }
        // Stryker restore BlockStatement
        if (ticket.isStale()) return;

        const overrides = { overrideIdentifier: editor.languageId };
        if (model.references.length === 0) {
            const word = wordAt(editor.getText(), caret);
            this.showInfo(word === null ? "No definition found" : `No definition found for '${word}'`);
            return;
        }
        if (model.references.length === 1) {
            const key = editor.uri.toString();
            const atCaret = model.references.some(
                ({ uri, range }) => Uri.parse(uri).toString() === key && rangeContainsPosition(range, caret),
            );
            if (atCaret) {
                const alternative = this.configuration.get(
                    "editor.gotoLocation.alternativeDefinitionCommand",
                    overrides,
                );
                if (await this.runAlternative(alternative, DEFINITION_COMMAND_ID)) return;
            }
        }
        await this.show(model, {
            title: "Definitions",
            multiple: this.configuration.get("editor.gotoLocation.multipleDefinitions", overrides),
            toSide,
            openInPeek: false,
        });
    }

    /** `editor.action.goToLocations`: go to `position` of `uri`, then handle `locations` like a go-to result. */
    public async goToLocations(args: IGoToLocationsArguments): Promise<void> {
        await this.doRevealLocation(
            {
                uri: args.uri.toString(),
                range: createRange(
                    args.position.line,
                    args.position.character,
                    args.position.line,
                    args.position.character,
                ),
            },
            false,
        );
        const model = createLocationModel(args.locations);
        if (model.references.length === 0) {
            if (args.noResultsMessage !== undefined && args.noResultsMessage !== "") {
                this.showInfo(args.noResultsMessage);
            }
            return;
        }
        const multiple =
            args.multiple ??
            this.configuration.get("editor.gotoLocation.multipleReferences", {
                overrideIdentifier: this.group.getActiveEditor()?.languageId,
            });
        await this.show(model, {
            title: "Locations",
            multiple,
            toSide: false,
            openInPeek: args.openInPeek === true,
        });
    }

    /** The answer is whether the alternative took over; otherwise the result is handled as usual. */
    private async runAlternative(alternative: string, origin: string): Promise<boolean> {
        if (alternative === "" || !this.commands.has(alternative) || this.activeAlternatives.has(alternative)) {
            return false;
        }
        this.activeAlternatives.add(origin);
        try {
            await this.commands.execute(alternative);
        } finally {
            this.activeAlternatives.delete(origin);
        }
        return true;
    }

    /** Upstream `_onResult`; the Peek widget's role is played by the References panel. */
    private async show(model: ILocationModel, options: IShowOptions): Promise<void> {
        const { references, first } = model;
        /* v8 ignore start -- callers handle the empty model, `first` exists whenever `references` isn't empty */
        // Stryker disable next-line ConditionalExpression: unreachable for the same reason
        if (first === undefined) return;
        /* v8 ignore stop */
        const several = references.length > 1;
        const mode = toMode(options.multiple);
        if (options.openInPeek || (mode === "peek" && several)) {
            await this.references.showLocations(options.title, references, first);
            return;
        }
        await this.revealLocation(first, options.toSide);
        if (!several) return;
        await this.references.showLocations(options.title, references, first, { reveal: mode === "gotoAndPeek" });
    }

    private showInfo(message: string): void {
        this.notifications.show({ severity: "info", message, modal: false, items: [] });
    }

    /**
     * `jumpAsync`, not `jump`: a non-disk target (`jdt:`) opens via the scheme provider, and the
     * destination can be recorded only after that, without an intermediate "opened the file at the top".
     */
    private revealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        return this.jumps.jumpAsync(() => this.doRevealLocation(location, toSide));
    }

    private async doRevealLocation(location: ICoreDefinitionLocation, toSide: boolean): Promise<void> {
        // Don't compare against the `location.uri` string: `Uri` normalizes percent-encoding, and for
        // `jdt:` targets with a huge query the strings NEVER match.
        const uri = Uri.parse(location.uri);
        const key = uri.toString();
        // Open unconditionally, even in the same file: dedup by resource lives in `openUri`.
        await this.group.openUri(uri, toSide ? { group: "beside" } : {});
        const editor = this.group.getActiveEditor();
        // The resource may have failed to open: a non-disk target comes from the scheme provider, which
        // may be missing (the user has already seen a message, see `onDidFailOpen`).
        if (editor?.uri.toString() !== key) return;
        editor.goToPosition(location.range.start.line, location.range.start.character);
        editor.revealRange(location.range);
    }
}

/** Anything else in the settings file means the default, like upstream's `stringSet`. */
function toMode(value: unknown): GoToLocationMode {
    return value === "gotoAndPeek" || value === "goto" ? value : "peek";
}

function wordAt(text: string, caret: IPosition): string | null {
    const line = text.split("\n").at(caret.line) ?? "";
    const word = findWordRangeAt(line, caret.character);
    return word === null ? null : line.slice(word.start, word.end);
}
