const fetch = require("node-fetch");
const { withTimeout } = require("../utils/timeout");
const logger = require("../utils/logger");

// The details Stremio shows next to a focused poster (background, plot,
// rating, year, genres) all come from the same Cinemeta request as the
// poster. Answers are kept in memory for a day; the same titles come back
// across searches and Home rows.
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const PREVIEW_MAX = 5000;
const previewCache = new Map();

function previewFrom(meta) {
	if (!meta) return null;
	return {
		poster: meta.poster || null,
		background: meta.background || null,
		logo: meta.logo || null,
		name: meta.name || null,
		description: meta.description || null,
		releaseInfo: meta.releaseInfo || meta.year || null,
		imdbRating: meta.imdbRating || null,
		genres: Array.isArray(meta.genres) && meta.genres.length ? meta.genres : Array.isArray(meta.genre) && meta.genre.length ? meta.genre : null,
		runtime: meta.runtime || null,
	};
}

async function fetchPreview(imdbId, type) {
	if (!imdbId) {
		return null;
	}
	const mediaType = type === "movie" ? "movie" : "series";
	const key = `${mediaType}:${imdbId}`;
	const hit = previewCache.get(key);
	if (hit && Date.now() - hit.at < PREVIEW_TTL_MS) {
		return hit.preview;
	}

	try {
		const url = `https://v3-cinemeta.strem.io/meta/${mediaType}/${imdbId}.json`;
		const response = await withTimeout(fetch(url), 5000, `Cinemeta poster fetch timed out: ${imdbId}`);
		const json = await response.json();
		const preview = previewFrom(json?.meta);
		if (preview?.poster) {
			if (previewCache.size >= PREVIEW_MAX) previewCache.delete(previewCache.keys().next().value);
			previewCache.set(key, { at: Date.now(), preview });
		}
		return preview;
	} catch (error) {
		logger.error(error.message, null);
		return null;
	}
}

async function fetchPoster(imdbId, type) {
	return (await module.exports.fetchPreview(imdbId, type))?.poster || null;
}

async function fetchBaseMetadata(imdbId, type) {
	if (!imdbId) {
		return null;
	}

	try {
		const mediaType = type === "movie" ? "movie" : "series";
		const url = `https://v3-cinemeta.strem.io/meta/${mediaType}/${imdbId}.json`;

		const response = await withTimeout(fetch(url), 5000, `Cinemeta fetch timed out: ${imdbId}`);
		const json = await response.json();

		if (json?.meta) {
			// Manually add year field if possible
			if (!json?.meta?.year) {
				if (json?.meta?.releaseInfo) {
					json.meta.year = json.meta.releaseInfo.split(/[–-]/)[0];
				}
			}

			return json.meta;
		}

		return null;
	} catch (error) {
		logger.error(error.message, null);
		return null;
	}
}

async function adjustMetadata(rawMeta) {
	let meta = rawMeta;

	// Remove media that are not released yet
	if (meta?.imdb_id == null || meta?.status === "Upcoming" || meta?.releaseInfo == null) {
		return null;
	}

	const year = Number(meta.releaseInfo);
	const currentYear = new Date().getFullYear();
	if (currentYear < year || year === 0) {
		return null;
	}

	meta.year = meta.releaseInfo;
	meta.backdrop = meta.background;
	meta.title = meta.title ? meta.title : meta.name;

	return meta;
}

async function fetchFullMetadata(imdbId, type) {
	let meta = await fetchBaseMetadata(imdbId, type);

	// Adjust metadata for addon usage
	if (meta) {
		meta = await adjustMetadata(meta);
		return meta;
	}

	return null;
}

module.exports = {
	fetchPoster,
	fetchPreview,
	previewFrom,
	fetchFullMetadata,
};
