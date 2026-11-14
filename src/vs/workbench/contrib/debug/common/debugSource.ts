/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/common/debugSource.ts
// Deviations: no `IUriIdentityService` (there is none here; a uri is taken as the adapter gives it), a logger
// instead of `ILogService`, and no `openInEditor` yet: it comes with the editor service it needs.

import { isAbsolute, normalize } from "node:path";

import { Uri as URI, UriUtils } from "../../../../base/common/uri.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";

import { DEBUG_SCHEME } from "./debug.ts";
import { isUriString } from "./debugUtils.ts";

export const UNKNOWN_SOURCE_LABEL = "Unknown Source";

/**
 * Debug URI format
 *
 * a debug URI represents a Source object and the debug session where the Source comes from.
 *
 *       debug:arbitrary_path?session=123e4567-e89b-12d3-a456-426655440000&ref=1016
 *       \___/ \____________/ \__________________________________________/ \______/
 *         |          |                             |                          |
 *      scheme   source.path                    session id            source.reference
 *
 *
 */

export class Source {
    public readonly uri: URI;
    public available: boolean;
    public raw: DebugProtocol.Source;

    public constructor(raw_: DebugProtocol.Source | undefined, sessionId: string, logService: ILogger) {
        let path: string;
        if (raw_) {
            this.raw = raw_;
            // `||`: an empty path or name is none, as upstream.
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            path = this.raw.path || this.raw.name || "";
            this.available = true;
        } else {
            this.raw = { name: UNKNOWN_SOURCE_LABEL };
            this.available = false;
            path = `${DEBUG_SCHEME}:${UNKNOWN_SOURCE_LABEL}`;
        }

        this.uri = getUriFromSource(this.raw, path, sessionId, logService);
    }

    public get name(): string {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- an empty name is none, as upstream
        return this.raw.name || UriUtils.basenameOrAuthority(this.uri);
    }

    public get origin(): string | undefined {
        return this.raw.origin;
    }

    public get presentationHint(): DebugProtocol.Source["presentationHint"] {
        return this.raw.presentationHint;
    }

    public get reference(): number | undefined {
        return this.raw.sourceReference;
    }

    public get inMemory(): boolean {
        return this.uri.scheme === DEBUG_SCHEME;
    }

    public static getEncodedDebugData(modelUri: URI): {
        name: string;
        path: string;
        sessionId?: string;
        sourceReference?: number;
    } {
        let path: string;
        let sourceReference: number | undefined;
        let sessionId: string | undefined;

        switch (modelUri.scheme) {
            case "file":
                path = normalize(modelUri.fsPath);
                break;
            case DEBUG_SCHEME:
                path = modelUri.path;
                if (modelUri.query) {
                    const keyvalues = modelUri.query.split("&");
                    for (const keyvalue of keyvalues) {
                        const pair = keyvalue.split("=");
                        if (pair.length === 2) {
                            switch (pair[0]) {
                                case "session":
                                    sessionId = pair[1];
                                    break;
                                case "ref":
                                    sourceReference = parseInt(pair[1]);
                                    break;
                            }
                        }
                    }
                }
                break;
            default:
                path = modelUri.toString();
                break;
        }

        return {
            name: UriUtils.basenameOrAuthority(modelUri),
            path,
            sourceReference,
            sessionId,
        };
    }
}

export function getUriFromSource(
    raw: DebugProtocol.Source,
    path: string | undefined,
    sessionId: string,
    logService: ILogger,
): URI {
    const _getUriFromSource = (path: string | undefined): URI => {
        if (typeof raw.sourceReference === "number" && raw.sourceReference > 0) {
            return URI.from({
                scheme: DEBUG_SCHEME,
                path: path?.replace(/^\/+/g, "/"), // #174054
                query: `session=${sessionId}&ref=${raw.sourceReference}`,
            });
        }

        if (path && isUriString(path)) {
            // path looks like a uri
            return URI.parse(path);
        }
        // assume a filesystem path
        if (path && isAbsolute(path)) {
            return URI.file(path);
        }
        // path is relative: since VS Code cannot deal with this by itself
        // create a debug url that will result in a DAP 'source' request when the url is resolved.
        return URI.from({
            scheme: DEBUG_SCHEME,
            path,
            query: `session=${sessionId}`,
        });
    };

    try {
        return _getUriFromSource(path);
    } catch {
        // `vscode-uri` throws on a path starting with `//` without an authority (`ab:////x`).
        logService.error(`Invalid path from debug adapter: ${String(path)}`);
        return _getUriFromSource("/invalidDebugSource");
    }
}
