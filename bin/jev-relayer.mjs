#!/usr/bin/env node
import { migrateLegacyDirs } from "../src/legacy.mjs";
import { runCli } from "../src/toggle.mjs";

migrateLegacyDirs();

try {
  console.log(runCli(process.argv.slice(2)));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
