// Search speed with a slow local LLM.
process.env.LLM_COMBINED_WAIT_MS = "300";
const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

let calls = [];
let delayMs = 0;
const fake = express();
fake.use(express.json());
fake.post("/v1/chat/completions", (req, res) => {
	calls.push(req.body);
	setTimeout(() => res.json({ choices: [{ message: { content: "Collateral, 2004\nThief, 1981\n" } }] }), delayMs);
});

const titles = { "Collateral|2004": "tt0369339", "Thief|1981": "tt0083190" };
const idConverter = require("../utils/idConverter");
idConverter.titleToImdb = async (title, year) => titles[`${title}|${year}`] || null;

const recManager = require("../src/recManager");
const none = { key: "", valid: false };
let fakeServer, llm;
test.before(async () => {
	await new Promise((r) => (fakeServer = fake.listen(0, r)));
	llm = { key: "", valid: true, baseUrl: `http://127.0.0.1:${fakeServer.address().port}/v1`, model: "slow" };
});
test.after(() => fakeServer.close());

const keys = () => ({ tmdb: none, trakt: none, gemini: none, watchmode: none, simkl: none, tastedive: none, rpdb: none, llm });

test("the combined row does not wait for a slow LLM, and has it next time", async () => {
	calls = [];
	delayMs = 1000;
	const t0 = Date.now();
	const first = await recManager.getCombinedRecs("Heat", "1995", "movie", "tt0000003", keys(), false, null, "combined");
	assert.ok(Date.now() - t0 < 900, `took ${Date.now() - t0} ms`);
	assert.deepStrictEqual(first, []);

	await new Promise((r) => setTimeout(r, 1200)); // the LLM answer arrives and is cached
	const again = await recManager.getCombinedRecs("Heat", "1995", "movie", "tt0000003", keys(), false, null, "combined");
	assert.deepStrictEqual(
		again.map((r) => r.imdbId),
		["tt0369339", "tt0083190"],
	);
	assert.strictEqual(calls.length, 1, "the second search used the cached answer");
});

test("rows asking at the same time share one LLM request", async () => {
	calls = [];
	delayMs = 200;
	const [a, b] = await Promise.all([
		recManager.getLlmRecs("Heat", "1995", "movie", "tt0000004", llm, null),
		recManager.getLlmRecs("Heat", "1995", "movie", "tt0000004", llm, null),
	]);
	assert.strictEqual(calls.length, 1);
	assert.deepStrictEqual(a, b);
});
