// End-to-end checks of the places, through the real HTTP routes.
// TMDB, Cinemeta and the rec sources are replaced by fixed sample data.
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.HISTORY_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mlt-")), "history.json");
delete process.env.ENCRYPTION_KEY;
delete process.env.PUBLIC_URL;

const tmdb = require("../services/tmdb");
const idConverter = require("../utils/idConverter");
const catalog = require("../src/catalogHandler");
const history = require("../utils/history");

// Sample data: TMDB id n <-> IMDb id "tt" + n
const COLLECTION = { 155: [{ id: 272 }, { id: 49026 }] }; // Dark Knight -> Batman Begins, Rises
const MAKER = { 155: [{ id: 27205 }, { id: 157336 }, { id: 272 }], 95396: [{ id: 1100 }] };
const SIMILAR = { tt155: ["tt272", "tt27205", "tt680", "tt807"], tt95396: ["tt1100", "tt1399", "tt66732"] };
const calls = { combined: 0 };

tmdb.fetchCollectionRecs = async (id) => COLLECTION[id] || null;
tmdb.fetchSameMakerRecs = async (id) => MAKER[id] || null;
idConverter.imdbToTmdb = async (imdb) => Number(imdb.slice(2));
idConverter.tmdbToImdb = async (id) => "tt" + id;
catalog.createRecCatalog = async (recs, type) => recs.map((r) => ({ id: r.imdbId, type, poster: "p" }));
catalog.catalogHandler = async (type, id, extra) => {
	calls.combined++;
	const imdb = extra.split("search=")[1];
	return { metas: (SIMILAR[imdb] || []).map((x) => ({ id: x, type, poster: "p" })) };
};

const { startServer } = require("../server");

const keys = {
	tmdb: { key: "k", valid: true },
	trakt: { key: "", valid: false },
	gemini: { key: "", valid: false },
	watchmode: { key: "", valid: false },
	simkl: { key: "", valid: false },
	tastedive: { key: "", valid: false },
	rpdb: { key: "", valid: false },
};
const cfg = (extra = {}) => encodeURIComponent(JSON.stringify({ apiKeys: keys, catalogOrder: ["tmdb"], ...extra }));

let base;
let server;
test.before(async () => {
	const app = await startServer();
	await new Promise((r) => (server = app.listen(0, r)));
	base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const get = async (p, opts) => {
	const r = await fetch(base + p, opts);
	return { status: r.status, body: r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text(), headers: r.headers };
};
const ids = (b) => b.metas.map((m) => m.id);

test("manifest lists the rows, the picker and tt pages when places are on", async () => {
	const { body } = await get(`/${cfg()}/manifest.json`);
	const cat = body.catalogs.map((c) => `${c.type}/${c.id}/${c.name}`);
	assert.ok(cat.includes("movie/mlt-reason-series-movie/Same series"));
	assert.ok(cat.includes("movie/mlt-reason-director-movie/More from the director"));
	assert.ok(cat.includes("movie/mlt-reason-similar-movie/Similar story"));
	assert.ok(cat.includes("series/mlt-reason-director-series/More from the creator"));
	assert.ok(!cat.includes("series/mlt-reason-series-series/Same series"), "no Same series row for series");
	const picker = body.catalogs.find((c) => c.id === "mlt-picker-movie");
	assert.deepStrictEqual(picker.extra, [{ name: "genre", isRequired: true, options: ["Last opened", "2 titles ago", "3 titles ago", "4 titles ago", "5 titles ago"] }]);
	const meta = body.resources.find((r) => r.name === "meta");
	assert.deepStrictEqual(meta.idPrefixes, ["mlt-", "tt"]);
	// the reason rows come first so they sit at the top of this addon's rows
	assert.strictEqual(body.catalogs[0].id, "mlt-reason-series-movie");
});

test("each switch removes its place", async () => {
	const off = { homeRows: false, discoverPicker: false, gridButton: false, trackSeries: false };
	const { body } = await get(`/${cfg({ places: off })}/manifest.json`);
	assert.ok(!body.catalogs.some((c) => c.id.startsWith("mlt-reason-") || c.id.startsWith("mlt-picker-")));
	assert.deepStrictEqual(body.resources.find((r) => r.name === "meta").idPrefixes, ["mlt-"]);

	const rowsOnly = await get(`/${cfg({ places: { ...off, homeRows: true } })}/manifest.json`);
	assert.ok(rowsOnly.body.catalogs.some((c) => c.id.startsWith("mlt-reason-")));
	assert.ok(!rowsOnly.body.catalogs.some((c) => c.id.startsWith("mlt-picker-")));

	const noTmdb = await get(`/${encodeURIComponent(JSON.stringify({ apiKeys: { ...keys, tmdb: { key: "", valid: false }, trakt: { key: "t", valid: true } }, catalogOrder: ["trakt"] }))}/manifest.json`);
	const reasonIds = noTmdb.body.catalogs.filter((c) => c.id.startsWith("mlt-reason-")).map((c) => c.id);
	assert.deepStrictEqual(reasonIds, ["mlt-reason-similar-movie", "mlt-reason-similar-series"], "without TMDB only Similar story");
});

test("the default manifest (no config) has no places", async () => {
	const { body } = await get(`/manifest.json`);
	assert.ok(!body.catalogs.some((c) => c.id.startsWith("mlt-")));
});

test("rows are empty before anything is opened", async () => {
	const { body, headers } = await get(`/${cfg()}/catalog/movie/mlt-reason-similar-movie.json`);
	assert.deepStrictEqual(body, { metas: [], cacheMaxAge: 0 });
	assert.strictEqual(headers.get("cache-control"), "no-store");
});

test("opening a movie fills the three movie rows, each title under one reason", async () => {
	const c = cfg();
	const s = await get(`/${c}/stream/movie/tt155.json`, { headers: { origin: "https://web.stremio.com" } });
	const grid = s.body.streams[0];
	assert.strictEqual(grid.name, "More Like This");
	assert.strictEqual(grid.description, "Open the list in Discover");
	const transport = encodeURIComponent(`${base}/${c}/manifest.json`);
	assert.strictEqual(grid.externalUrl, `https://web.stremio.com/#/discover/${transport}/movie/mlt-picker-movie?genre=tt155`);

	const series = await get(`/${c}/catalog/movie/mlt-reason-series-movie.json`);
	const director = await get(`/${c}/catalog/movie/mlt-reason-director-movie.json`);
	const similar = await get(`/${c}/catalog/movie/mlt-reason-similar-movie.json`);
	assert.deepStrictEqual(ids(series.body), ["tt272", "tt49026"]);
	assert.deepStrictEqual(ids(director.body), ["tt27205", "tt157336"], "Batman Begins is already under Same series");
	assert.deepStrictEqual(ids(similar.body), ["tt680", "tt807"], "titles already shown above are left out");
	const tvRow = await get(`/${c}/catalog/series/mlt-reason-similar-series.json`);
	assert.deepStrictEqual(tvRow.body.metas, [], "the series rows stay empty after a movie");
});

test("the TV app gets a stremio:// link", async () => {
	const s = await get(`/${cfg()}/stream/series/tt95396:1:1.json`);
	assert.match(s.body.streams[0].externalUrl, /^stremio:\/\/\/discover\/.+\/series\/mlt-picker-series\?genre=tt95396$/);
});

test("opening a series page is noticed through the meta request", async () => {
	const c = cfg();
	const m = await get(`/${c}/meta/series/tt95396.json`);
	assert.strictEqual(m.status, 404, "Cinemeta shows the page, not this addon");
	assert.strictEqual(history.latest(history.installKey(c)).id, "tt95396");
	const rows = await get(`/${c}/catalog/series/mlt-reason-director-series.json`);
	assert.deepStrictEqual(ids(rows.body), ["tt1100"]);
	const movieRow = await get(`/${c}/catalog/movie/mlt-reason-similar-movie.json`);
	assert.deepStrictEqual(movieRow.body.metas, [], "the movie rows follow the newest title");
});

test("the Discover picker reads the last titles of that type", async () => {
	const c = cfg();
	await get(`/${c}/stream/movie/tt680.json`);
	const last = await get(`/${c}/catalog/movie/mlt-picker-movie/genre=Last%20opened.json`);
	assert.ok(!ids(last.body).includes("tt680"));
	const two = await get(`/${c}/catalog/movie/mlt-picker-movie/genre=2%20titles%20ago.json`);
	assert.deepStrictEqual(ids(two.body), ["tt272", "tt49026", "tt27205", "tt157336", "tt680", "tt807"], "Dark Knight list: Same series, director, Similar story");
	const byId = await get(`/${c}/catalog/movie/mlt-picker-movie/genre=tt155.json`);
	assert.deepStrictEqual(ids(byId.body), ids(two.body), "an IMDb id works as the value too");
	const none = await get(`/${c}/catalog/movie/mlt-picker-movie/genre=5%20titles%20ago.json`);
	assert.deepStrictEqual(none.body.metas, []);
	const page2 = await get(`/${c}/catalog/movie/mlt-picker-movie/genre=tt155&skip=100.json`);
	assert.deepStrictEqual(page2.body.metas, []);
});

test("each install has its own history", async () => {
	const other = cfg({ language: "en" });
	const rows = await get(`/${other}/catalog/movie/mlt-reason-similar-movie.json`);
	assert.deepStrictEqual(rows.body.metas, []);
});

test("switches off: nothing is recorded and no entry is added", async () => {
	const off = cfg({ places: { homeRows: false, discoverPicker: false, gridButton: false, trackSeries: false } });
	const s = await get(`/${off}/stream/movie/tt155.json`);
	assert.deepStrictEqual(s.body.streams, []);
	assert.strictEqual(history.latest(history.installKey(off)), null);
	const m = await get(`/${off}/meta/movie/tt155.json`);
	assert.strictEqual(m.status, 404);
	assert.strictEqual(history.latest(history.installKey(off)), null);
});

test("an older config without places gets them all on", async () => {
	const { body } = await get(`/${cfg()}/manifest.json`);
	assert.ok(body.catalogs.some((c) => c.id === "mlt-picker-series"));
});

test("the settings form saves the four switches", async () => {
	const form = new URLSearchParams({ tmdbApiKey: "k", catalogOrder: "tmdb", streamOrder: "detail,app,web,recs", metadataSource: "cinemeta", placeHomeRows: "on", placeGridButton: "on", forCopy: "true" });
	const r = await fetch(base + "/saveConfig", { method: "POST", body: form, headers: { "content-type": "application/x-www-form-urlencoded" } });
	const { manifestUrl } = await r.json();
	assert.ok(manifestUrl.startsWith("http://127.0.0.1:"), "home-network addresses get http");
	const segment = manifestUrl.split("/")[3];
	const saved = JSON.parse(decodeURIComponent(segment));
	assert.deepStrictEqual(saved.places, { homeRows: true, discoverPicker: false, gridButton: true, trackSeries: false });
	const m = await get(`/${segment}/manifest.json`);
	assert.ok(m.body.catalogs.some((c) => c.id === "mlt-picker-movie"), "the title-page entry keeps the picker it opens");
});

test("history keeps 20 titles, newest first, no repeats", () => {
	const key = history.installKey("x");
	for (let i = 0; i < 25; i++) history.record(key, "movie", "tt" + i);
	history.record(key, "movie", "tt3:1:2");
	const list = history.list(key);
	assert.strictEqual(list.length, 20);
	assert.strictEqual(list[0].id, "tt3");
	assert.strictEqual(list.filter((e) => e.id === "tt3").length, 1);
	assert.strictEqual(history.record(key, "movie", "kitsu:1"), false);
	assert.strictEqual(history.record(key, "channel", "tt1"), false);
});
