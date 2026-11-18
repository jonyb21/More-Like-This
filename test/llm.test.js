// "My LLM": a fake OpenAI-compatible server stands in for the real one.
const test = require("node:test");
const assert = require("node:assert");
const express = require("express");

// The fake LLM answers like a reasoning model would: a think block, numbering.
let llmCalls = [];
const fake = express();
fake.use(express.json());
fake.get("/v1/models", (req, res) => {
	if (req.headers.authorization !== "Bearer good") return res.status(401).json({});
	res.json({ data: [{ id: "qwen-test" }] });
});
fake.post("/v1/chat/completions", (req, res) => {
	llmCalls.push({ auth: req.headers.authorization, model: req.body.model });
	res.json({
		choices: [
			{
				message: {
					content: "<think>The user wants films like Heat.</think>\n1. Heat, 1995\n2. Collateral, 2004\n3. \"The Town\" (2010)\n- Thief, 1981\n5. The Town, 2010\n",
				},
			},
		],
	});
});

const titles = { "Heat|1995": "tt0113277", "Collateral|2004": "tt0369339", "The Town|2010": "tt0840361", "Thief|1981": "tt0083190" };
const idConverter = require("../utils/idConverter");
idConverter.titleToImdb = async (title, year) => titles[`${title}|${year}`] || null;
idConverter.imdbToTitleYearType = async (id, type) => (id === "tt0113277" ? { title: "Heat", year: "1995", type } : null);
require("../services/cinemeta").fetchPoster = async (id) => `https://img/${id}.jpg`;

let fakeServer, server, base, fakeBase;
test.before(async () => {
	await new Promise((r) => (fakeServer = fake.listen(0, r)));
	fakeBase = `http://127.0.0.1:${fakeServer.address().port}/v1`;
	process.env.LLM_BASE_URL = fakeBase;
	process.env.LLM_API_KEY = "server-secret";
	process.env.LLM_MODEL = "qwen-test";
	const app = await require("../server").startServer();
	await new Promise((r) => (server = app.listen(0, r)));
	base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
	server.close();
	fakeServer.close();
});

const none = { key: "", valid: false };
const keys = (llm) => ({ tmdb: none, trakt: none, gemini: none, watchmode: none, simkl: none, tastedive: none, rpdb: none, llm });
const seg = (cfg) => encodeURIComponent(JSON.stringify({ catalogOrder: ["llm"], ...cfg }));

test("reads Title, Year lines and drops the think block", () => {
	const { parseLlmReturn } = require("../services/llm");
	assert.deepStrictEqual(parseLlmReturn("<think>x\ny</think>\n1. Heat, 1995\n2) Collateral (2004)\n* \"The Town\", 2010\nNo year here"), [
		{ title: "Heat", year: "1995" },
		{ title: "Collateral", year: "2004" },
		{ title: "The Town", year: "2010" },
		{ title: "No year here", year: "" },
	]);
});

test("Verify checks the address, key and model", async () => {
	const post = (body) => fetch(base + "/verifyKey", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
	assert.strictEqual((await post({ source: "llm", key: "good", baseUrl: fakeBase + "/", model: "qwen-test" })).valid, true);
	assert.strictEqual((await post({ source: "llm", key: "", baseUrl: "" })).valid, false);
	assert.strictEqual((await post({ source: "llm", key: "good", baseUrl: "http://127.0.0.1:1/v1", model: "x" })).valid, false);
});

test("My LLM gets its own catalog with the searched title left out", async () => {
	llmCalls = [];
	const c = seg({ apiKeys: keys({ key: "good", valid: true, baseUrl: fakeBase, model: "qwen-own" }) });
	const m = await fetch(`${base}/${c}/manifest.json`).then((r) => r.json());
	assert.ok(m.catalogs.some((x) => x.id === "mlt-llm-movie-rec" && x.name === "My LLM Recommendations"));
	const cat = await fetch(`${base}/${c}/catalog/movie/mlt-llm-movie-rec/search=tt0113277.json`).then((r) => r.json());
	assert.deepStrictEqual(
		cat.metas.map((x) => x.id),
		["tt0369339", "tt0840361", "tt0083190"],
	);
	assert.deepStrictEqual(llmCalls, [{ auth: "Bearer good", model: "qwen-own" }]);
});

test("the server's LLM works without its key going into the install link", async () => {
	llmCalls = [];
	const c = seg({ useServerLlm: true, apiKeys: keys({ key: "", valid: false, baseUrl: "", model: "" }) });
	const m = await fetch(`${base}/${c}/manifest.json`).then((r) => r.json());
	assert.ok(m.catalogs.some((x) => x.id === "mlt-llm-series-rec"));
	await fetch(`${base}/${c}/catalog/movie/mlt-llm-movie-rec/search=tt0113277.json`).then((r) => r.json());
	assert.strictEqual(llmCalls[0]?.auth, "Bearer server-secret");

	const r = await fetch(`${base}/${c}/configure`, { redirect: "manual" });
	const loc = decodeURIComponent(r.headers.get("location"));
	assert.ok(!loc.includes("server-secret") && !loc.includes(fakeBase), "the configure page never sees the server LLM");

	const info = await fetch(`${base}/serverLlm`).then((x) => x.json());
	assert.deepStrictEqual(info, { available: true, model: "qwen-test" });
	assert.ok(!JSON.stringify(info).includes("secret"));
});

test("the settings form saves My LLM", async () => {
	const form = new URLSearchParams({ catalogOrder: "tmdb", streamOrder: "detail", metadataSource: "cinemeta", llmBaseUrl: " http://10.0.0.5:8080/v1 ", llmModel: "m", llmApiKey: "k", useServerLlm: "on", forCopy: "true" });
	const { manifestUrl } = await fetch(base + "/saveConfig", { method: "POST", body: form }).then((r) => r.json());
	const saved = JSON.parse(decodeURIComponent(manifestUrl.split("/")[3]));
	assert.deepStrictEqual(saved.apiKeys.llm, { key: "k", baseUrl: "http://10.0.0.5:8080/v1", model: "m", valid: true });
	assert.strictEqual(saved.useServerLlm, true);
	assert.deepStrictEqual(saved.catalogOrder, ["tmdb", "llm"]);
});
