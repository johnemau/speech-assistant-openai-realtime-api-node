import { googlePlacesTextSearch } from './google-places-text-search.js';

/**
 * @typedef {object} AddressLatLngOptions
 * @property {number=} maxResultCount Max results (1..20). Default: 1.
 * @property {string=} language BCP-47 language tag (e.g. "en-US").
 * @property {string=} region Region code (e.g. "us", "jp").
 * @property {{lat:number,lng:number}=} locationBias Bias results toward this point.
 * @property {{center:{lat:number,lng:number}, radius_m:number}=} locationRestriction Restrict results to a circle.
 */

/**
 * Resolve latitude/longitude from an address string.
 *
 * @param {string} address - Address text query.
 * @param {AddressLatLngOptions} [options] - Optional search settings.
 * @returns {Promise<{lat:number,lng:number}|null>} Lat/lng or null when unavailable.
 */
export async function getLatLngFromAddress(address, options = {}) {
    const textQuery = typeof address === 'string' ? address.trim() : '';
    if (!textQuery) return null;

    const result = await googlePlacesTextSearch({
        textQuery,
        maxResultCount: options.maxResultCount ?? 1,
        language: options.language,
        region: options.region,
        locationBias: options.locationBias,
        locationRestriction: options.locationRestriction,
    });

    const match = result?.places?.find(
        (place) =>
            place?.location &&
            Number.isFinite(place.location.lat) &&
            Number.isFinite(place.location.lng)
    );

    if (!match?.location) return null;

    return {
        lat: match.location.lat,
        lng: match.location.lng,
    };
}