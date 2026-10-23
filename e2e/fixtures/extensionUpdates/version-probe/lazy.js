"use strict";

// Reads the manifest at require time too: a directory replaced in place would report the new version.
const path = require("path");

module.exports = {
    version: require("./package.json").version,
    dir: path.basename(__dirname),
};
