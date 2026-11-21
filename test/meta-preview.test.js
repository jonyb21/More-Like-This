// Posters carry the details Stremio shows beside a focused poster.
const test = require("node:test");
const assert = require("node:assert");

const cinemeta = require("../services/cinemeta");
const tmdb = require("../services/tmdb");
const idConverter = require("../utils/idConverter");
const { createMetaPreview } = require("../src/metaPreview");

const keys = { rpdb: { valid: false }, tmdb: { key: "k", valid: true } };

test("Cinemeta posters carry background, plot, year, rating and genres", async () => {
	cinemeta.fetchPreview = async () =>
		cinemeta.previewFrom({ poster: "P", background: "B", logo: "L", name: "Heat", description: "Cops and robbers.", releaseInfo: "1995", imdbRating: "8.3", genres: ["Crime"], runtime: "170 min" });
	const m = await createMetaPreview({ imdbId: "tt0113277" }, "movie", keys, { source: "cinemeta" });
	assert.deepStrictEqual(m, {
		id: "tt0113277",
		type: "movie",
		poster: "P",
		background: "B",
		logo: "L",
		name: "Heat",
		description: "Cops and robbers.",
		releaseInfo: "1995",
		imdbRating: "8.3",
		genres: ["Crime"],
		runtime: "170 min",
	});
});

test("with no background the poster is used, and empty fields are left out", async () => {
	cinemeta.fetchPreview = async () => cinemeta.previewFrom({ poster: "P", name: "X" });
	const m = await createMetaPreview({ imdbId: "tt1" }, "series", keys, { source: "cinemeta" });
	assert.deepStrictEqual(m, { id: "tt1", type: "series", poster: "P", background: "P", name: "X" });
});

test("no poster means no entry", async () => {
	cinemeta.fetchPreview = async () => null;
	assert.strictEqual(await createMetaPreview({ imdbId: "tt2" }, "movie", keys, { source: "cinemeta" }), null);
});

test("TMDB posters carry TMDB's plot and backdrop in the chosen language", async () => {
	let asked = null;
	tmdb.fetchPoster = async () => "TP";
	tmdb.fetchPreviewDetails = async (id, type, key, lang) => {
		asked = lang;
		return { name: "Fogo", description: "Enredo.", background: "TB", releaseInfo: "1995", imdbRating: "7.9", genres: ["Crime"] };
	};
	idConverter.imdbToTmdb = async () => 949;
	const m = await createMetaPreview({ imdbId: "tt0113277" }, "movie", keys, { source: "tmdb", language: "pt" });
	assert.strictEqual(asked, "pt");
	assert.deepStrictEqual(m, { id: "mlt-meta-tt0113277", type: "movie", poster: "TP", background: "TB", name: "Fogo", description: "Enredo.", releaseInfo: "1995", imdbRating: "7.9", genres: ["Crime"] });
});
