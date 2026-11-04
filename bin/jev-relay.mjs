#!/usr/bin/env node
import { runCli } from "../src/toggle.mjs";

try {
  console.log(runCli(process.argv.slice(2)));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
