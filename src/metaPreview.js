const tmdb = require("../services/tmdb");
const rpdb = require("../services/rpdb");
const cinemeta = require("../services/cinemeta");
const idConverter = require("../utils/idConverter");

async function createMetaPreview(recs, type, apiKeys, metadataSource) {
	const imdbId = recs.imdbId;
	let tmdbId = recs.tmdbId;

	// Get RPDB poster if valid API key provided
	const rpdbApi = apiKeys.rpdb;
	let rpdbPoster = null;
	if (rpdbApi.valid) {
		rpdbPoster = await rpdb.getRPDBPoster(imdbId, rpdbApi.key);
	}

	// Stremio shows these next to the focused poster (background, plot,
	// rating, year, genres), so every poster carries them, not just a picture.
	const details = (meta, poster) =>
		Object.fromEntries(
			Object.entries({
				background: meta?.background || poster,
				logo: meta?.logo,
				name: meta?.name,
				description: meta?.description,
				releaseInfo: meta?.releaseInfo,
				imdbRating: meta?.imdbRating,
				genres: meta?.genres,
				runtime: meta?.runtime,
			}).filter(([, v]) => v != null && v !== ""),
		);

	if (metadataSource.source === "cinemeta") {
		const preview = await cinemeta.fetchPreview(imdbId, type);
		const poster = rpdbPoster || preview?.poster;

		return poster ? { id: imdbId, type: type, poster: poster, ...details(preview, poster) } : null;
	} else if (metadataSource.source === "tmdb") {
		const keepEnglishPoster = metadataSource.keepEnglishPosters;
		const language = keepEnglishPoster ? "en" : metadataSource.language;

		if (!tmdbId) {
			tmdbId = await idConverter.imdbToTmdb(imdbId, type, apiKeys.tmdb.key);
		}

		const [tmdbPoster, info] = await Promise.all([
			rpdbPoster ? null : tmdb.fetchPoster(tmdbId, type, apiKeys.tmdb.key, language),
			tmdb.fetchPreviewDetails(tmdbId, type, apiKeys.tmdb.key, metadataSource.language),
		]);

		// If poster not available in desired language, default to english posters
		let poster = rpdbPoster || tmdbPoster;
		if (!poster) {
			poster = await tmdb.fetchPoster(tmdbId, type, apiKeys.tmdb.key, "en");
		}

		return poster ? { id: "mlt-meta-" + imdbId, type: type, poster: poster, ...details(info, poster) } : null;
	}
}

module.exports = {
	createMetaPreview,
};
