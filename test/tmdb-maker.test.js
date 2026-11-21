// fetchSameMakerRecs against canned TMDB replies (no network).
const test = require("node:test");
const assert = require("node:assert");

const replies = {
	"/movie/155/credits": { crew: [{ id: 525, job: "Director" }, { id: 9, job: "Writer" }] },
	"/person/525/movie_credits": {
		crew: [
			{ id: 155, job: "Director", release_date: "2008-07-16", popularity: 90 },
			{ id: 27205, job: "Director", release_date: "2010-07-15", popularity: 80 },
			{ id: 157336, job: "Director", release_date: "2014-11-05", popularity: 95 },
			{ id: 999, job: "Producer", release_date: "2012-01-01", popularity: 99 },
			{ id: 1000, job: "Director", release_date: "2999-01-01", popularity: 99 },
		],
	},
	"/tv/95396": { created_by: [{ id: 77 }] },
	"/person/77/tv_credits": {
		crew: [
			{ id: 95396, job: "Creator", first_air_date: "2022-02-18", popularity: 50 },
			{ id: 1100, job: "Executive Producer", first_air_date: "2019-01-01", popularity: 10 },
			{ id: 1200, department: "Creator", job: "Creator", first_air_date: "2015-01-01", popularity: 20 },
			{ id: 1300, job: "Writer", first_air_date: "2015-01-01", popularity: 30 },
		],
	},
};
const seen = [];
require.cache[require.resolve("node-fetch")] = {
	exports: async (url) => {
		const u = new URL(url);
		seen.push(u.pathname);
		const body = replies[u.pathname.replace("/3", "")];
		return { json: async () => body || {} };
	},
};
const tmdb = require("../services/tmdb");

test("movie: other films by the same director, most popular first, released only", async () => {
	assert.deepStrictEqual(await tmdb.fetchSameMakerRecs(155, "movie", "k"), [{ id: 157336 }, { id: 27205 }]);
});

test("series: other shows by the creator", async () => {
	assert.deepStrictEqual(await tmdb.fetchSameMakerRecs(95396, "series", "k"), [{ id: 1200 }, { id: 1100 }]);
});

test("no key or no director gives null", async () => {
	assert.strictEqual(await tmdb.fetchSameMakerRecs(155, "movie", ""), null);
	assert.strictEqual(await tmdb.fetchSameMakerRecs(1, "movie", "k"), null);
});
