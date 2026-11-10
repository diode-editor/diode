import * as nodePath from "node:path";

import {
    decodeWithEncoding,
    DEFAULT_ENCODING,
    encodeWithEncoding,
    explicitOverDetected,
    validateEncoding,
} from "../../../../editor/common/model/encoding.ts";
import { detectEncoding } from "../../../../editor/common/model/encodingDetection.ts";
import { WORKSPACE_CONFIG_FOLDER_NAME } from "../../../../platform/workspace/common/workspaceConfigFolder.ts";
import { hasWorkspaceFileExtension } from "../../../../platform/workspace/common/workspaceFile.ts";

/**
 * Upstream `EncodingOracle` (`services/textfile/browser/textFileService.ts`) and the encoding half of
 * `TextFileService` without DI: the caller hands in the settings of the resource and the folders that
 * are always utf-8. So far only the extension host's `workspace.decode`/`encode` use it.
 */

/** Both `vscode.Uri` and our `Uri` fit. */
export interface IEncodingResource {
    readonly scheme: string;
    readonly path: string;
    readonly fsPath: string;
}

export interface IEncodingContext {
    readonly resource: IEncodingResource | undefined;
    /**
     * Upstream `getDefaultEncodingOverrides`: settings live there and are always utf-8 (the user data
     * directory, `.vscode/` of every folder). Files with the `.code-workspace` extension are utf-8 anywhere.
     */
    readonly utf8Directories: readonly string[];
    /** The value for the resource, its language section included (upstream `ITextResourceConfigurationService`). */
    readonly setting: (key: string) => unknown;
}

/**
 * Upstream `getDefaultEncodingOverrides`: the user data directory and `.vscode/` of every folder. Ours adds
 * `.diode/`, where our folder settings live. No untitled workspaces home: we have no untitled workspaces.
 */
export function defaultUtf8Directories(
    userRoamingDataHome: string | undefined,
    folderPaths: readonly string[],
): string[] {
    return [
        ...(userRoamingDataHome === undefined ? [] : [userRoamingDataHome]),
        ...folderPaths.flatMap((folder) => [
            nodePath.join(folder, ".vscode"),
            nodePath.join(folder, WORKSPACE_CONFIG_FOLDER_NAME),
        ]),
    ];
}

export const BINARY_CONTENT_MESSAGE = "Stream is binary but only text is accepted for decoding";

function isEqualOrParent(filePath: string, directory: string): boolean {
    return (
        filePath === directory ||
        filePath.startsWith(directory.endsWith(nodePath.sep) ? directory : directory + nodePath.sep)
    );
}

function encodingOverride({ resource, utf8Directories }: IEncodingContext): string | undefined {
    if (resource === undefined) return undefined;
    const isFile = resource.scheme === "file";
    if (isFile && utf8Directories.some((directory) => isEqualOrParent(resource.fsPath, directory))) {
        return DEFAULT_ENCODING;
    }
    return hasWorkspaceFileExtension(resource.path) ? DEFAULT_ENCODING : undefined;
}

function configuredEncoding(context: IEncodingContext): string | undefined {
    const value = context.setting("files.encoding");
    // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral: equivalent — a non-string fails validateEncoding and becomes utf8 as well; the check is for the type
    return typeof value === "string" ? value : undefined;
}

/** Upstream `getValidatedEncodingForResource`: the override, then the preferred encoding, then the setting. */
async function validatedEncoding(context: IEncodingContext, preferred: string | undefined): Promise<string> {
    return validateEncoding(encodingOverride(context) ?? preferred ?? configuredEncoding(context) ?? DEFAULT_ENCODING);
}

/**
 * Upstream `getPreferredReadEncoding`: an explicit encoding beats the detected one, except "utf8" on content
 * with a BOM, which stays "utf8bom". Upstream's "`files.encoding` utf8bom without a BOM reads as utf8" is left
 * out: both decode the same text, and `decode` returns nothing else.
 */
async function readEncoding(
    context: IEncodingContext,
    explicit: string | undefined,
    detected: string | null,
): Promise<string> {
    const preferred = explicit !== undefined ? explicitOverDetected(explicit, detected) : (detected ?? undefined);
    return validatedEncoding(context, preferred);
}

function candidateGuessEncodings(context: IEncodingContext): string[] {
    const value = context.setting("files.candidateGuessEncodings");
    // Stryker disable next-line ArrayDeclaration: equivalent — a name that is not guessable is dropped like no name
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Upstream `ExtHostWorkspace.decode`: binary content throws, as `toDecodeStream` with `acceptTextOnly`. */
export async function decodeForResource(
    content: Buffer,
    context: IEncodingContext,
    explicit: string | undefined,
): Promise<string> {
    const detected = await detectEncoding(
        content,
        context.setting("files.autoGuessEncoding") === true,
        candidateGuessEncodings(context),
    );
    if (detected.seemsBinary) throw new Error(BINARY_CONTENT_MESSAGE);
    // Upstream asks for the preferred encoding first only to skip a round trip to the main side.
    return decodeWithEncoding(content, await readEncoding(context, explicit, detected.encoding));
}

/** Upstream `ExtHostWorkspace.encode` with `getWriteEncoding`. */
export async function encodeForResource(
    text: string,
    context: IEncodingContext,
    explicit: string | undefined,
): Promise<Buffer> {
    return encodeWithEncoding(text, await validatedEncoding(context, explicit));
}
