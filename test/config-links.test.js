// Install links when ENCRYPTION_KEY is on.
process.env.ENCRYPTION_KEY = "test-password";
const test = require("node:test");
const assert = require("node:assert");
const { loadUserConfig } = require("../server");
const { encryptData } = require("../utils/encryption");

const settings = { apiKeys: { tmdb: { key: "abc", valid: true } }, combineCatalogs: true };

test("an encrypted link is read", async () => {
	const seg = encodeURIComponent(JSON.stringify(await encryptData(settings)));
	const cfg = await loadUserConfig(seg);
	assert.strictEqual(cfg.apiKeys.tmdb.key, "abc");
	assert.strictEqual(cfg.combineCatalogs, true);
});

test("a plain link made before encryption was turned on still works", async () => {
	const cfg = await loadUserConfig(encodeURIComponent(JSON.stringify(settings)));
	assert.strictEqual(cfg.apiKeys.tmdb.key, "abc");
	assert.strictEqual(cfg.combineCatalogs, true);
});

test("a damaged encrypted link gives the defaults, not an error", async () => {
	const enc = await encryptData(settings);
	const cfg = await loadUserConfig(encodeURIComponent(JSON.stringify({ ...enc, authTag: "00".repeat(16) })));
	assert.strictEqual(cfg.apiKeys.tmdb.key, "");
});
