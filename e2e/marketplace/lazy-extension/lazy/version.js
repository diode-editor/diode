"use strict";

// The registry fixture rewrites the manifest version per artifact: this file tells which directory it was loaded from.
module.exports = { version: require("../package.json").version };
