// The places in Stremio where this fork shows its picks. Each one is a switch
// on the settings page:
//   homeRows       - three rows on Home (Board) about the title opened last:
//                    "Same series", "More from the director", "Similar story"
//   discoverPicker - a "More Like This" catalog in Discover. Its drop-down
//                    picks one of the last five titles opened
//   gridButton     - an entry on each title page that opens that title's
//                    list in Discover (needs the Discover catalog)
//   trackSeries    - also notice series pages being opened (Stremio only asks
//                    for streams once an episode is picked)

const history = require("../utils/history");
const cache = require("../utils/cache");
const logger = require("../utils/logger");
const tmdb = require("../services/tmdb");
const idConverter = require("../utils/idConverter");
const catalog = require("./catalogHandler");

const DEFAULT_PLACES = {
	homeRows: true,
	discoverPicker: true,
	gridButton: true,
	trackSeries: true,
};

const PICKER_OPTIONS = ["Last opened", "2 titles ago", "3 titles ago", "4 titles ago", "5 titles ago"];

const REASONS = [
	{ key: "series", types: ["movie"], needsTmdb: true, name: () => "Same series" },
	{ key: "director", types: ["movie", "series"], needsTmdb: true, name: (type) => (type === "movie" ? "More from the director" : "More from the creator") },
	{ key: "similar", types: ["movie", "series"], needsTmdb: false, name: () => "Similar story" },
];

const ROW_LIMIT = 20;

function placesOf(userConfig) {
	return { ...DEFAULT_PLACES, ...(userConfig?.places || {}) };
}

function anyPlaceOn(userConfig) {
	const p = placesOf(userConfig);
	return p.homeRows || p.discoverPicker || p.gridButton;
}

function hasAnyRecSource(apiKeys) {
	return Object.keys(apiKeys || {}).some((k) => k !== "rpdb" && apiKeys[k]?.valid);
}

function pickerEnabled(userConfig) {
	const p = placesOf(userConfig);
	return p.discoverPicker || p.gridButton;
}

// Catalogs to add to the manifest for this install.
function placesCatalogs(userConfig) {
	const apiKeys = userConfig?.apiKeys || {};
	if (!hasAnyRecSource(apiKeys)) return [];

	const p = placesOf(userConfig);
	const catalogs = [];

	if (p.homeRows) {
		for (const type of ["movie", "series"]) {
			for (const reason of REASONS) {
				if (!reason.types.includes(type)) continue;
				if (reason.needsTmdb && !apiKeys.tmdb?.valid) continue;
				catalogs.push({ type, id: `mlt-reason-${reason.key}-${type}`, name: reason.name(type) });
			}
		}
	}

	if (pickerEnabled(userConfig)) {
		for (const type of ["movie", "series"]) {
			catalogs.push({
				type,
				id: `mlt-picker-${type}`,
				name: "More Like This",
				extra: [{ name: "genre", isRequired: true, options: PICKER_OPTIONS }],
			});
		}
	}

	return catalogs;
}

function isPlacesCatalog(id) {
	return id.startsWith("mlt-reason-") || id.startsWith("mlt-picker-");
}

function imdbOf(meta) {
	return String(meta?.id || "")
		.split("-")
		.at(-1);
}

function readExtra(extra, name) {
	if (!extra) return null;
	for (const part of String(extra).split("&")) {
		const [k, ...v] = part.split("=");
		if (k === name) return decodeURIComponent(v.join("="));
	}
	return null;
}

// TMDB ids -> catalog metas, in order.
async function tmdbListToMetas(tmdbList, type, apiKeys, metadataSource) {
	if (!tmdbList || tmdbList.length === 0) return [];
	const recs = await Promise.all(
		tmdbList.slice(0, ROW_LIMIT).map(async (r, i) => {
			const imdbId = await idConverter.tmdbToImdb(r.id, type, apiKeys.tmdb.key);
			return imdbId ? { imdbId, tmdbId: r.id, ranking: i + 1 } : null;
		}),
	);
	return (await catalog.createRecCatalog(recs.filter(Boolean), type, apiKeys, metadataSource)) || [];
}

// All three reasons for one title. Each title appears under one reason only,
// in the order Same series, director, Similar story.
async function reasonsFor(imdbId, type, userConfig, metadataSource) {
	const apiKeys = userConfig.apiKeys;
	const cacheKey = `places:${imdbId}:${type}:${metadataSource?.source}:${metadataSource?.language}:${Object.keys(apiKeys)
		.filter((k) => apiKeys[k]?.valid)
		.join("+")}`;
	const cached = await cache.getCache(cacheKey);
	if (cached) return cached;

	let tmdbId = null;
	if (apiKeys.tmdb?.valid) {
		tmdbId = await idConverter.imdbToTmdb(imdbId, type, apiKeys.tmdb.key);
	}

	const [seriesList, makerList, similar] = await Promise.all([
		type === "movie" && tmdbId ? tmdb.fetchCollectionRecs(tmdbId, type, apiKeys.tmdb.key) : null,
		tmdbId ? tmdb.fetchSameMakerRecs(tmdbId, type, apiKeys.tmdb.key) : null,
		catalog.catalogHandler(type, `mlt-combined-${type}-rec`, `search=${imdbId}`, { ...userConfig, includeTmdbCollection: false }, metadataSource),
	]);

	const out = { series: [], director: [], similar: [] };
	const seen = new Set([imdbId]);
	const take = (metas) =>
		(metas || []).filter((m) => {
			const id = imdbOf(m);
			if (!id || seen.has(id)) return false;
			seen.add(id);
			return true;
		});

	out.series = take(await tmdbListToMetas(seriesList, type, apiKeys, metadataSource));
	out.director = take(await tmdbListToMetas(makerList, type, apiKeys, metadataSource));
	out.similar = take(similar?.metas).slice(0, ROW_LIMIT);

	if (out.series.length + out.director.length + out.similar.length > 0) {
		await cache.setCache(cacheKey, out);
	}
	return out;
}

// Which title a picker value points at: a label ("2 titles ago") or an IMDb id.
function resolvePickerValue(value, key, type) {
	if (!value) return null;
	const asId = history.cleanId(value);
	if (asId) return asId;
	const index = PICKER_OPTIONS.indexOf(value);
	if (index < 0) return null;
	return history.list(key, type)[index]?.id || null;
}

// Returns null when the catalog is not one of ours.
async function placesCatalogHandler(type, id, extra, userConfig, metadataSource, key) {
	if (!isPlacesCatalog(id)) return null;
	const empty = { metas: [], cacheMaxAge: 0 };

	try {
		if (id.startsWith("mlt-reason-")) {
			if (!placesOf(userConfig).homeRows) return empty;
			const reason = id.split("-")[2];
			const last = history.latest(key);
			// The rows follow the one title opened last, so the other type's rows stay empty
			if (!last || last.type !== type) return empty;
			const reasons = await reasonsFor(last.id, type, userConfig, metadataSource);
			return { metas: reasons[reason] || [], cacheMaxAge: 0 };
		}

		if (!pickerEnabled(userConfig)) return empty;
		if (readExtra(extra, "skip")) return empty; // one page only
		const target = resolvePickerValue(readExtra(extra, "genre"), key, type);
		if (!target) return empty;
		const reasons = await reasonsFor(target, type, userConfig, metadataSource);
		return { metas: [...reasons.series, ...reasons.director, ...reasons.similar], cacheMaxAge: 0 };
	} catch (err) {
		logger.error("Places catalog failed", err);
		return empty;
	}
}

// Stream-list entry that opens this title's list in Discover.
function gridButton(origin, type, imdbId, transportUrl) {
	const path = `/discover/${encodeURIComponent(transportUrl)}/${type}/mlt-picker-${type}?genre=${imdbId}`;
	return {
		name: "More Like This",
		description: "Open the list in Discover",
		externalUrl: (origin?.includes("web.stremio.com") ? "https://web.stremio.com/#" : "stremio://") + path,
	};
}

module.exports = {
	DEFAULT_PLACES,
	PICKER_OPTIONS,
	placesOf,
	anyPlaceOn,
	pickerEnabled,
	placesCatalogs,
	isPlacesCatalog,
	placesCatalogHandler,
	gridButton,
	readExtra,
	resolvePickerValue,
};
