import assert from "node:assert/strict";
import test from "node:test";
import { createStagingTsconfig } from "../scripts/create-staging-tsconfig.mjs";

const releaseTarget = ".mexo-releases/93a227bde9a67ef60123456789abcdef01234567-20261010T120000Z-1234";

test("staging tsconfig checks only the staged release route types, not active .next", () => {
  const { configPath, contents } = createStagingTsconfig(".mexo-tsconfig-20261010T120000Z-1234.json", releaseTarget);
  const config = JSON.parse(contents);

  assert.match(configPath, /portfel-inwestora[\\/]\.mexo-tsconfig-20261010T120000Z-1234\.json$/);
  assert.equal(config.extends, "./tsconfig.json");
  assert.ok(config.include.includes(`${releaseTarget}/types/**/*.ts`));
  assert.ok(config.exclude.includes(".next"));
  assert.ok(!config.include.includes(".next/types/**/*.ts"));
});

test("staging tsconfig refuses paths outside the generated release/config patterns", () => {
  assert.throws(() => createStagingTsconfig("../tsconfig.json", releaseTarget));
  assert.throws(() => createStagingTsconfig(".mexo-tsconfig-safe.json", "../.next"));
});
