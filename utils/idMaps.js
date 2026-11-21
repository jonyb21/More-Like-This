// The Watchmode id map has about 970,000 rows and takes roughly 700 MB of
// memory once loaded. It is only a shortcut: every lookup falls back to the
// TMDB or Watchmode API when an id is missing. This fork leaves it off unless
// ID_MAP=on, so the addon runs in a small container.
const rawIdList = process.env.ID_MAP === "on" ? require("../data/watchmode_title_id_map.json") : [];

const idMapByWatchmode = {};
const idMapByImdb = {};
const idMapByTmdbMovie = {};
const idMapByTmdbSeries = {};

for (const row of rawIdList) {
	idMapByWatchmode[row.watchmodeID] = { imdbId: row.imdbID, tmdbId: row.tmdbID, type: row.type };
	idMapByImdb[row.imdbID] = { watchmodeId: row.watchmodeID, tmdbId: row.tmdbID, type: row.type };

	if (row.type === "movie") {
		idMapByTmdbMovie[row.tmdbID] = { watchmodeId: row.watchmodeID, imdbId: row.imdbID, type: row.type };
	} else if (row.type === "tv") {
		idMapByTmdbSeries[row.tmdbID] = { watchmodeId: row.watchmodeID, imdbId: row.imdbID, type: row.type };
	}
}

module.exports = {
	idMapByWatchmode,
	idMapByImdb,
	idMapByTmdbMovie,
	idMapByTmdbSeries,
};
