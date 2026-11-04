import assert from "node:assert/strict";
import test from "node:test";

import { localizeNls } from "./generate-settings-schema.mjs";

test("localizeNls: a %key% description takes its text from package.nls.json", () => {
    assert.equal(
        localizeNls("%config.codeLensEnabled%", { "config.codeLensEnabled": "Create a CodeLens." }),
        "Create a CodeLens.",
    );
});

test("localizeNls: plain text, a missing key, a non-string entry and a non-string value stay as they are", () => {
    assert.equal(localizeNls("Plain text.", { "Plain text.": "x" }), "Plain text.");
    assert.equal(localizeNls("%missing%", {}), "%missing%");
    assert.equal(localizeNls("%n%", { n: 1 }), "%n%");
    assert.equal(localizeNls("%%", { "": "x" }), "%%");
    assert.equal(localizeNls(undefined, {}), undefined);
});
