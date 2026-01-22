import { getLatestTrackLatLng } from './spot.js';
import { searchPlacesNearby } from './google-places.js';

/**
 * Find nearby places around the latest tracked location.
 *
 * @param {number} radius_m - Search radius in meters (1..50000).
 * @param {object} [options] - Optional search settings.
 * @param {import('./google-places.js').IncludedPrimaryType[]=} options.included_primary_types - Places (New) primary types.
 * @param {number=} options.max_result_count - Max results (1..20).
 * @param {"POPULARITY"|"DISTANCE"=} options.rank_preference - Result ranking.
 * @param {string=} options.language_code - BCP-47 language code.
 * @param {string=} options.region_code - CLDR region code.
 * @param {string[]=} options.fieldMask - Places field mask.
 * @param {number=} options.ttlMs - Cache TTL in ms.
 * @returns {Promise<{places: import('./google-places.js').NearbyPlace[]}|null>} Nearby places or null.
 */
export async function findCurrentlyNearbyPlaces(radius_m, options = {}) {
    const latest = await getLatestTrackLatLng();
    if (!latest) return null;

    const args = {
        lat: latest.latitude,
        lng: latest.longitude,
        radius_m,
        included_primary_types: options.included_primary_types,
        max_result_count: options.max_result_count,
        rank_preference: options.rank_preference,
        language_code: options.language_code,
        region_code: options.region_code,
    };

    return searchPlacesNearby(args, {
        fieldMask: options.fieldMask,
        ttlMs: options.ttlMs,
    });
}
