import { beforeAll, describe, it } from "vitest";

import { settle, waitUntil } from "../../../../../TestUtils/timing.ts";
import {
    buildTypescriptLspExtension,
    type ITypescriptLspFixture,
    openInTypescriptLsp,
} from "../../../../../TestUtils/typescriptLspFixture.ts";
import { DEFAULT_INLAY_HINTS_OPTIONS } from "../../../../editor/contrib/inlayHints/browser/inlayHintsController.ts";

const SOURCE = `function add(left: number, right: number) {
    return left + right;
}
const total = add(1, 2);
export { total };
`;

const WAIT_MS = 60_000;

async function open(
    fileName: string,
    source: string,
    settings: Readonly<Record<string, unknown>> = {},
): Promise<ITypescriptLspFixture> {
    const fixture = await openInTypescriptLsp(fileName, source, settings);
    // The harness has no core configuration service to read `editor.inlayHints.enabled` from.
    fixture.editor.setInlayHints(DEFAULT_INLAY_HINTS_OPTIONS);
    return fixture;
}

describe("ExtensionHost — inlay hints from the stock typescript-language-server", () => {
    beforeAll(buildTypescriptLspExtension, 120_000);

    it("enabled settings put parameter names and variable types on the frame", { timeout: 180_000 }, async () => {
        const { harness, frame } = await open("main.ts", SOURCE, {
            "typescript.inlayHints.parameterNames.enabled": "all",
            "typescript.inlayHints.variableTypes.enabled": true,
        });
        try {
            await waitUntil(
                "the hints",
                () => frame().includes("const total : number = add(left: 1, right: 2);"),
                WAIT_MS,
            );
        } finally {
            await harness.dispose();
        }
    });

    it(
        "the defaults show nothing; a change on the fly brings the hints and takes them away",
        { timeout: 180_000 },
        async () => {
            const { harness, settings, frame } = await open("main.ts", SOURCE);
            try {
                await waitUntil("the text", () => frame().includes("const total = add(1, 2);"), WAIT_MS);
                // An empty answer is also what a loading project gives: the server has time to prove the defaults wrong.
                await settle(3_000);
                if (!frame().includes("const total = add(1, 2);")) throw new Error(`hints by default:\n${frame()}`);

                await settings.updateValue("typescript.inlayHints.variableTypes.enabled", true);
                await waitUntil("the type hint", () => frame().includes("const total : number = add(1, 2);"), WAIT_MS);

                await settings.updateValue("typescript.inlayHints.variableTypes.enabled", false);
                await waitUntil("no hint", () => frame().includes("const total = add(1, 2);"), WAIT_MS);
            } finally {
                await harness.dispose();
            }
        },
    );

    it("a .js file follows the javascript keys", { timeout: 180_000 }, async () => {
        const js =
            "function add(left, right) {\n    return left + right;\n}\nconst total = add(1, 2);\nexport { total };\n";
        const { harness, frame } = await open("main.js", js, {
            "javascript.inlayHints.parameterNames.enabled": "all",
        });
        try {
            await waitUntil("the hints", () => frame().includes("const total = add(left: 1, right: 2);"), WAIT_MS);
        } finally {
            await harness.dispose();
        }
    });
});
