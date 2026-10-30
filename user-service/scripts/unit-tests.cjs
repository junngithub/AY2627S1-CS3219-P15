const { readdirSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function discoverTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return discoverTests(filename);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [filename] : [];
  });
}

// Do not depend on shell glob expansion or Node 22's test-runner glob support:
// development runs on Windows, while CI and the production image use Node 20.
const files = discoverTests(path.join(root, "src")).sort();
if (files.length === 0) {
  console.error("No .test.ts files found under User Service src; refusing an empty test run.");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  cwd: root, stdio: "inherit", env: process.env,
});
if (result.error) console.error("Unable to start the User Service unit test runner:", result.error.message);
process.exit(result.status ?? 1);
