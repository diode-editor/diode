import { describe, expect, it } from "vitest";

import { TF_LANGUAGE_SERVICE, tfSampleFiles } from "./terraformFixture.ts";

// The network part (`installTerraform`, a real terraform-ls) is covered by the extensionHost.terraform* suites.

describe("terraformFixture — sample files", () => {
    it("every file of the fixture, nested ones by a relative path with forward slashes", () => {
        const files = tfSampleFiles();
        expect(Object.keys(files).sort()).toEqual(["main.tf", "modules/net/main.tf", "network.tf"]);
        expect(files["network.tf"]).toContain('module "net"');
    });
});

describe("terraformFixture — language service", () => {
    it(".tf gets the terraform language, anything else undefined", () => {
        expect(TF_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/main.tf")).toBe("terraform");
        // If the service tagged the lock file as `terraform`, the extension would get didOpen for it.
        expect(TF_LANGUAGE_SERVICE.getLanguageIdForResource("/tmp/.terraform.lock.hcl")).toBeUndefined();
    });
});
