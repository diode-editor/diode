/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/linkedText.ts
// Deviation: no `@memoize` on `toString` (no decorators here); the text is short and read rarely.

export interface ILink {
    readonly label: string;
    readonly href: string;
    readonly title?: string;
}

export type LinkedTextNode = string | ILink;

export class LinkedText {
    public constructor(public readonly nodes: LinkedTextNode[]) {}

    public toString(): string {
        return this.nodes.map((node) => (typeof node === "string" ? node : node.label)).join("");
    }
}

const LINK_REGEX = /\[([^\]]+)\]\(((?:https?:\/\/|command:|file:)[^)\s]+)(?: (["'])(.+?)(\3))?\)/gi;

export function parseLinkedText(text: string): LinkedText {
    const result: LinkedTextNode[] = [];

    let index = 0;
    let match: RegExpExecArray | null;

    while ((match = LINK_REGEX.exec(text))) {
        if (match.index - index > 0) {
            result.push(text.substring(index, match.index));
        }

        const [, label, href, , title] = match;

        if (title) {
            result.push({ label, href, title });
        } else {
            result.push({ label, href });
        }

        index = match.index + match[0].length;
    }

    if (index < text.length) {
        result.push(text.substring(index));
    }

    return new LinkedText(result);
}
