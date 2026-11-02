import { describe, expect, it } from "vitest";

import { TF_LANGUAGE_SERVICE } from "./terraformFixture.ts";

// The network part (`installTerraform`, a real terraform-ls) is covered by the extensionHost.terraform* suites.

describe("terraformFixture — language service", () => {
    it(".tf gets the terraform language, anything else undefined", () => {
        expect(TF_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/main.tf")).toBe("terraform");
        // If the service tagged the lock file as `terraform`, the extension would get didOpen for it.
        expect(TF_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/.terraform.lock.hcl")).toBeUndefined();
    });
});
