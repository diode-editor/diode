import { Uri } from "../../../../base/common/uri.ts";
import { createPosition, type IPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreDefinitionLocation } from "../../../../editor/common/languages/iDefinitionSource.ts";

import type { IGoToLocationsArguments } from "./definitionService.ts";

/**
 * Arguments come from extensions JSON-serialized: `uri` as a string or `{scheme, path, ...}`, positions as
 * `{line, character}`. Malformed input throws, like upstream's `assertType`: the caller gets the rejection.
 */
export function parseGoToLocationsArguments(
    uri: unknown,
    position: unknown,
    locations: unknown,
    multiple?: unknown,
    noResultsMessage?: unknown,
    openInPeek?: unknown,
): IGoToLocationsArguments {
    if (!Array.isArray(locations)) throw new TypeError("locations must be an array");
    return {
        uri: parseUri(uri),
        position: parsePosition(position),
        locations: locations.map(parseLocation),
        multiple: typeof multiple === "string" ? multiple : undefined,
        noResultsMessage: typeof noResultsMessage === "string" ? noResultsMessage : undefined,
        openInPeek: openInPeek === true,
    };
}

function parseUri(value: unknown): Uri {
    if (typeof value === "string") return Uri.parse(value);
    if (!isRecord(value) || typeof value.scheme !== "string") throw new TypeError("uri must be a uri");
    return Uri.from({
        scheme: value.scheme,
        authority: optionalString(value.authority),
        path: optionalString(value.path),
        query: optionalString(value.query),
        fragment: optionalString(value.fragment),
    });
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function parsePosition(value: unknown): IPosition {
    if (!isRecord(value) || typeof value.line !== "number" || typeof value.character !== "number") {
        throw new TypeError("position must be {line, character}");
    }
    return createPosition(value.line, value.character);
}

function parseLocation(value: unknown): ICoreDefinitionLocation {
    if (!isRecord(value) || !isRecord(value.range)) throw new TypeError("location must be {uri, range}");
    const start = parsePosition(value.range.start);
    const end = parsePosition(value.range.end);
    return {
        uri: parseUri(value.uri).toString(),
        range: createRange(start.line, start.character, end.line, end.character),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
