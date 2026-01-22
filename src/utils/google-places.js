import { getGoogleMapsApiKey } from '../env.js';

/**
 * @typedef {object} NearbyPlace
 * @property {string|null} id
 * @property {string|null} name
 * @property {string|null} address
 * @property {{lat:number,lng:number}|null} location
 * @property {string|null} primaryType
 * @property {string|null} mapsUrl
 */

/**
 * @typedef {object} GooglePlacesNearbyArgs
 * @property {number} lat Center latitude.
 * @property {number} lng Center longitude.
 * @property {number} radius_m Search radius in meters (1..50000). Results outside are not returned.
 * @property {IncludedPrimaryType[]=} included_primary_types Places (New) primary types, e.g. ["restaurant","cafe"].
 * @property {number=} max_result_count Max results (1..20). Default: 10.
 * @property {"POPULARITY"|"DISTANCE"=} rank_preference Default: "POPULARITY".
 * @property {string=} language_code BCP-47 language code, e.g. "en".
 * @property {string=} region_code CLDR region code, e.g. "US".
 */

/**
 * Supported Places (New) primary types.
 * @typedef {
 * | 'car_dealer'
 * | 'car_rental'
 * | 'car_repair'
 * | 'car_wash'
 * | 'electric_vehicle_charging_station'
 * | 'gas_station'
 * | 'parking'
 * | 'rest_stop'
 * | 'corporate_office'
 * | 'farm'
 * | 'ranch'
 * | 'art_gallery'
 * | 'art_studio'
 * | 'auditorium'
 * | 'cultural_landmark'
 * | 'historical_place'
 * | 'monument'
 * | 'museum'
 * | 'performing_arts_theater'
 * | 'sculpture'
 * | 'library'
 * | 'preschool'
 * | 'primary_school'
 * | 'school'
 * | 'secondary_school'
 * | 'university'
 * | 'adventure_sports_center'
 * | 'amphitheatre'
 * | 'amusement_center'
 * | 'amusement_park'
 * | 'aquarium'
 * | 'banquet_hall'
 * | 'barbecue_area'
 * | 'botanical_garden'
 * | 'bowling_alley'
 * | 'casino'
 * | 'childrens_camp'
 * | 'comedy_club'
 * | 'community_center'
 * | 'concert_hall'
 * | 'convention_center'
 * | 'cultural_center'
 * | 'cycling_park'
 * | 'dance_hall'
 * | 'dog_park'
 * | 'event_venue'
 * | 'ferris_wheel'
 * | 'garden'
 * | 'hiking_area'
 * | 'historical_landmark'
 * | 'internet_cafe'
 * | 'karaoke'
 * | 'marina'
 * | 'movie_rental'
 * | 'movie_theater'
 * | 'national_park'
 * | 'night_club'
 * | 'observation_deck'
 * | 'off_roading_area'
 * | 'opera_house'
 * | 'park'
 * | 'philharmonic_hall'
 * | 'picnic_ground'
 * | 'planetarium'
 * | 'plaza'
 * | 'roller_coaster'
 * | 'skateboard_park'
 * | 'state_park'
 * | 'tourist_attraction'
 * | 'video_arcade'
 * | 'visitor_center'
 * | 'water_park'
 * | 'wedding_venue'
 * | 'wildlife_park'
 * | 'wildlife_refuge'
 * | 'zoo'
 * | 'public_bath'
 * | 'public_bathroom'
 * | 'stable'
 * | 'accounting'
 * | 'atm'
 * | 'bank'
 * | 'acai_shop'
 * | 'afghani_restaurant'
 * | 'african_restaurant'
 * | 'american_restaurant'
 * | 'asian_restaurant'
 * | 'bagel_shop'
 * | 'bakery'
 * | 'bar'
 * | 'bar_and_grill'
 * | 'barbecue_restaurant'
 * | 'brazilian_restaurant'
 * | 'breakfast_restaurant'
 * | 'brunch_restaurant'
 * | 'buffet_restaurant'
 * | 'cafe'
 * | 'cafeteria'
 * | 'candy_store'
 * | 'cat_cafe'
 * | 'chinese_restaurant'
 * | 'chocolate_factory'
 * | 'chocolate_shop'
 * | 'coffee_shop'
 * | 'confectionery'
 * | 'deli'
 * | 'dessert_restaurant'
 * | 'dessert_shop'
 * | 'diner'
 * | 'dog_cafe'
 * | 'donut_shop'
 * | 'fast_food_restaurant'
 * | 'fine_dining_restaurant'
 * | 'food_court'
 * | 'french_restaurant'
 * | 'greek_restaurant'
 * | 'hamburger_restaurant'
 * | 'ice_cream_shop'
 * | 'indian_restaurant'
 * | 'indonesian_restaurant'
 * | 'italian_restaurant'
 * | 'japanese_restaurant'
 * | 'juice_shop'
 * | 'korean_restaurant'
 * | 'lebanese_restaurant'
 * | 'meal_delivery'
 * | 'meal_takeaway'
 * | 'mediterranean_restaurant'
 * | 'mexican_restaurant'
 * | 'middle_eastern_restaurant'
 * | 'pizza_restaurant'
 * | 'pub'
 * | 'ramen_restaurant'
 * | 'restaurant'
 * | 'sandwich_shop'
 * | 'seafood_restaurant'
 * | 'spanish_restaurant'
 * | 'steak_house'
 * | 'sushi_restaurant'
 * | 'tea_house'
 * | 'thai_restaurant'
 * | 'turkish_restaurant'
 * | 'vegan_restaurant'
 * | 'vegetarian_restaurant'
 * | 'vietnamese_restaurant'
 * | 'wine_bar'
 * | 'administrative_area_level_1'
 * | 'administrative_area_level_2'
 * | 'country'
 * | 'locality'
 * | 'postal_code'
 * | 'school_district'
 * | 'city_hall'
 * | 'courthouse'
 * | 'embassy'
 * | 'fire_station'
 * | 'government_office'
 * | 'local_government_office'
 * | 'neighborhood_police_station'
 * | 'police'
 * | 'post_office'
 * | 'chiropractor'
 * | 'dental_clinic'
 * | 'dentist'
 * | 'doctor'
 * | 'drugstore'
 * | 'hospital'
 * | 'massage'
 * | 'medical_lab'
 * | 'pharmacy'
 * | 'physiotherapist'
 * | 'sauna'
 * | 'skin_care_clinic'
 * | 'spa'
 * | 'tanning_studio'
 * | 'wellness_center'
 * | 'yoga_studio'
 * | 'apartment_building'
 * | 'apartment_complex'
 * | 'condominium_complex'
 * | 'housing_complex'
 * | 'bed_and_breakfast'
 * | 'budget_japanese_inn'
 * | 'campground'
 * | 'camping_cabin'
 * | 'cottage'
 * | 'extended_stay_hotel'
 * | 'farmstay'
 * | 'guest_house'
 * | 'hostel'
 * | 'hotel'
 * | 'inn'
 * | 'japanese_inn'
 * | 'lodging'
 * | 'mobile_home_park'
 * | 'motel'
 * | 'private_guest_room'
 * | 'resort_hotel'
 * | 'rv_park'
 * | 'beach'
 * | 'church'
 * | 'hindu_temple'
 * | 'mosque'
 * | 'synagogue'
 * | 'astrologer'
 * | 'barber_shop'
 * | 'beautician'
 * | 'beauty_salon'
 * | 'body_art_service'
 * | 'catering_service'
 * | 'cemetery'
 * | 'child_care_agency'
 * | 'consultant'
 * | 'courier_service'
 * | 'electrician'
 * | 'florist'
 * | 'food_delivery'
 * | 'foot_care'
 * | 'funeral_home'
 * | 'hair_care'
 * | 'hair_salon'
 * | 'insurance_agency'
 * | 'laundry'
 * | 'lawyer'
 * | 'locksmith'
 * | 'makeup_artist'
 * | 'moving_company'
 * | 'nail_salon'
 * | 'painter'
 * | 'plumber'
 * | 'psychic'
 * | 'real_estate_agency'
 * | 'roofing_contractor'
 * | 'storage'
 * | 'summer_camp_organizer'
 * | 'tailor'
 * | 'telecommunications_service_provider'
 * | 'tour_agency'
 * | 'tourist_information_center'
 * | 'travel_agency'
 * | 'veterinary_care'
 * | 'asian_grocery_store'
 * | 'auto_parts_store'
 * | 'bicycle_store'
 * | 'book_store'
 * | 'butcher_shop'
 * | 'cell_phone_store'
 * | 'clothing_store'
 * | 'convenience_store'
 * | 'department_store'
 * | 'discount_store'
 * | 'electronics_store'
 * | 'food_store'
 * | 'furniture_store'
 * | 'gift_shop'
 * | 'grocery_store'
 * | 'hardware_store'
 * | 'home_goods_store'
 * | 'home_improvement_store'
 * | 'jewelry_store'
 * | 'liquor_store'
 * | 'market'
 * | 'pet_store'
 * | 'shoe_store'
 * | 'shopping_mall'
 * | 'sporting_goods_store'
 * | 'store'
 * | 'supermarket'
 * | 'warehouse_store'
 * | 'wholesaler'
 * | 'arena'
 * | 'athletic_field'
 * | 'fishing_charter'
 * | 'fishing_pond'
 * | 'fitness_center'
 * | 'golf_course'
 * | 'gym'
 * | 'ice_skating_rink'
 * | 'playground'
 * | 'ski_resort'
 * | 'sports_activity_location'
 * | 'sports_club'
 * | 'sports_coaching'
 * | 'sports_complex'
 * | 'stadium'
 * | 'swimming_pool'
 * | 'airport'
 * | 'airstrip'
 * | 'bus_station'
 * | 'bus_stop'
 * | 'ferry_terminal'
 * | 'heliport'
 * | 'international_airport'
 * | 'light_rail_station'
 * | 'park_and_ride'
 * | 'subway_station'
 * | 'taxi_stand'
 * | 'train_station'
 * | 'transit_depot'
 * | 'transit_station'
 * | 'truck_stop'
 * } IncludedPrimaryType
 */

const INCLUDED_PRIMARY_TYPES = new Set([
    'car_dealer',
    'car_rental',
    'car_repair',
    'car_wash',
    'electric_vehicle_charging_station',
    'gas_station',
    'parking',
    'rest_stop',
    'corporate_office',
    'farm',
    'ranch',
    'art_gallery',
    'art_studio',
    'auditorium',
    'cultural_landmark',
    'historical_place',
    'monument',
    'museum',
    'performing_arts_theater',
    'sculpture',
    'library',
    'preschool',
    'primary_school',
    'school',
    'secondary_school',
    'university',
    'adventure_sports_center',
    'amphitheatre',
    'amusement_center',
    'amusement_park',
    'aquarium',
    'banquet_hall',
    'barbecue_area',
    'botanical_garden',
    'bowling_alley',
    'casino',
    'childrens_camp',
    'comedy_club',
    'community_center',
    'concert_hall',
    'convention_center',
    'cultural_center',
    'cycling_park',
    'dance_hall',
    'dog_park',
    'event_venue',
    'ferris_wheel',
    'garden',
    'hiking_area',
    'historical_landmark',
    'internet_cafe',
    'karaoke',
    'marina',
    'movie_rental',
    'movie_theater',
    'national_park',
    'night_club',
    'observation_deck',
    'off_roading_area',
    'opera_house',
    'park',
    'philharmonic_hall',
    'picnic_ground',
    'planetarium',
    'plaza',
    'roller_coaster',
    'skateboard_park',
    'state_park',
    'tourist_attraction',
    'video_arcade',
    'visitor_center',
    'water_park',
    'wedding_venue',
    'wildlife_park',
    'wildlife_refuge',
    'zoo',
    'public_bath',
    'public_bathroom',
    'stable',
    'accounting',
    'atm',
    'bank',
    'acai_shop',
    'afghani_restaurant',
    'african_restaurant',
    'american_restaurant',
    'asian_restaurant',
    'bagel_shop',
    'bakery',
    'bar',
    'bar_and_grill',
    'barbecue_restaurant',
    'brazilian_restaurant',
    'breakfast_restaurant',
    'brunch_restaurant',
    'buffet_restaurant',
    'cafe',
    'cafeteria',
    'candy_store',
    'cat_cafe',
    'chinese_restaurant',
    'chocolate_factory',
    'chocolate_shop',
    'coffee_shop',
    'confectionery',
    'deli',
    'dessert_restaurant',
    'dessert_shop',
    'diner',
    'dog_cafe',
    'donut_shop',
    'fast_food_restaurant',
    'fine_dining_restaurant',
    'food_court',
    'french_restaurant',
    'greek_restaurant',
    'hamburger_restaurant',
    'ice_cream_shop',
    'indian_restaurant',
    'indonesian_restaurant',
    'italian_restaurant',
    'japanese_restaurant',
    'juice_shop',
    'korean_restaurant',
    'lebanese_restaurant',
    'meal_delivery',
    'meal_takeaway',
    'mediterranean_restaurant',
    'mexican_restaurant',
    'middle_eastern_restaurant',
    'pizza_restaurant',
    'pub',
    'ramen_restaurant',
    'restaurant',
    'sandwich_shop',
    'seafood_restaurant',
    'spanish_restaurant',
    'steak_house',
    'sushi_restaurant',
    'tea_house',
    'thai_restaurant',
    'turkish_restaurant',
    'vegan_restaurant',
    'vegetarian_restaurant',
    'vietnamese_restaurant',
    'wine_bar',
    'administrative_area_level_1',
    'administrative_area_level_2',
    'country',
    'locality',
    'postal_code',
    'school_district',
    'city_hall',
    'courthouse',
    'embassy',
    'fire_station',
    'government_office',
    'local_government_office',
    'neighborhood_police_station',
    'police',
    'post_office',
    'chiropractor',
    'dental_clinic',
    'dentist',
    'doctor',
    'drugstore',
    'hospital',
    'massage',
    'medical_lab',
    'pharmacy',
    'physiotherapist',
    'sauna',
    'skin_care_clinic',
    'spa',
    'tanning_studio',
    'wellness_center',
    'yoga_studio',
    'apartment_building',
    'apartment_complex',
    'condominium_complex',
    'housing_complex',
    'bed_and_breakfast',
    'budget_japanese_inn',
    'campground',
    'camping_cabin',
    'cottage',
    'extended_stay_hotel',
    'farmstay',
    'guest_house',
    'hostel',
    'hotel',
    'inn',
    'japanese_inn',
    'lodging',
    'mobile_home_park',
    'motel',
    'private_guest_room',
    'resort_hotel',
    'rv_park',
    'beach',
    'church',
    'hindu_temple',
    'mosque',
    'synagogue',
    'astrologer',
    'barber_shop',
    'beautician',
    'beauty_salon',
    'body_art_service',
    'catering_service',
    'cemetery',
    'child_care_agency',
    'consultant',
    'courier_service',
    'electrician',
    'florist',
    'food_delivery',
    'foot_care',
    'funeral_home',
    'hair_care',
    'hair_salon',
    'insurance_agency',
    'laundry',
    'lawyer',
    'locksmith',
    'makeup_artist',
    'moving_company',
    'nail_salon',
    'painter',
    'plumber',
    'psychic',
    'real_estate_agency',
    'roofing_contractor',
    'storage',
    'summer_camp_organizer',
    'tailor',
    'telecommunications_service_provider',
    'tour_agency',
    'tourist_information_center',
    'travel_agency',
    'veterinary_care',
    'asian_grocery_store',
    'auto_parts_store',
    'bicycle_store',
    'book_store',
    'butcher_shop',
    'cell_phone_store',
    'clothing_store',
    'convenience_store',
    'department_store',
    'discount_store',
    'electronics_store',
    'food_store',
    'furniture_store',
    'gift_shop',
    'grocery_store',
    'hardware_store',
    'home_goods_store',
    'home_improvement_store',
    'jewelry_store',
    'liquor_store',
    'market',
    'pet_store',
    'shoe_store',
    'shopping_mall',
    'sporting_goods_store',
    'store',
    'supermarket',
    'warehouse_store',
    'wholesaler',
    'arena',
    'athletic_field',
    'fishing_charter',
    'fishing_pond',
    'fitness_center',
    'golf_course',
    'gym',
    'ice_skating_rink',
    'playground',
    'ski_resort',
    'sports_activity_location',
    'sports_club',
    'sports_coaching',
    'sports_complex',
    'stadium',
    'swimming_pool',
    'airport',
    'airstrip',
    'bus_station',
    'bus_stop',
    'ferry_terminal',
    'heliport',
    'international_airport',
    'light_rail_station',
    'park_and_ride',
    'subway_station',
    'taxi_stand',
    'train_station',
    'transit_depot',
    'transit_station',
    'truck_stop',
]);

const DEFAULT_FIELD_MASK = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.primaryType',
    'places.googleMapsUri',
];

const DEFAULT_TTL_MS = 150000;

/** @type {Map<string, {expiresAt:number, value:{places: NearbyPlace[]}}>} */
const cache = new Map();

/**
 * @param {GooglePlacesNearbyArgs} args - Tool input args.
 * @returns {string} Cache key for the input args.
 */
function cacheKey(args) {
    // Round lat/lng slightly so tiny float jitter doesn't defeat caching.
    const lat = Math.round(args.lat * 1e6) / 1e6;
    const lng = Math.round(args.lng * 1e6) / 1e6;

    return JSON.stringify({
        lat,
        lng,
        radius_m: args.radius_m,
        included_primary_types: args.included_primary_types || null,
        max_result_count: args.max_result_count ?? 10,
        rank_preference: args.rank_preference ?? 'POPULARITY',
        language_code: args.language_code || null,
        region_code: args.region_code || null,
    });
}

/**
 * @param {GooglePlacesNearbyArgs} args - Tool input args.
 * @param {string} apiKey - Google Maps API key.
 * @returns {string|null} Returns an error string if invalid, otherwise null.
 */
function validate(args, apiKey) {
    if (!apiKey) return 'Missing apiKey';
    if (!args || typeof args !== 'object') return 'Missing args';

    if (typeof args.lat !== 'number' || args.lat < -90 || args.lat > 90)
        return 'Invalid lat';
    if (typeof args.lng !== 'number' || args.lng < -180 || args.lng > 180)
        return 'Invalid lng';

    const r = args.radius_m;
    if (!Number.isFinite(r) || r < 1 || r > 50000)
        return 'Invalid radius_m (1..50000)';

    const m = args.max_result_count ?? 10;
    if (!Number.isFinite(m) || m < 1 || m > 20)
        return 'Invalid max_result_count (1..20)';

    if (
        args.rank_preference &&
        args.rank_preference !== 'POPULARITY' &&
        args.rank_preference !== 'DISTANCE'
    ) {
        return 'Invalid rank_preference';
    }

    if (
        args.included_primary_types &&
        !Array.isArray(args.included_primary_types)
    ) {
        return 'included_primary_types must be an array';
    }

    if (Array.isArray(args.included_primary_types)) {
        for (const type of args.included_primary_types) {
            if (!INCLUDED_PRIMARY_TYPES.has(type)) {
                return 'included_primary_types contains unsupported value';
            }
        }
    }

    return null;
}

/**
 * Nearby Search (New) via Places API (New) HTTP endpoint with in-memory caching.
 *
 * @param {GooglePlacesNearbyArgs} args - Tool input args.
 * @param {object} [options] - Optional request settings.
 * @param {number} [options.ttlMs=150000] - Cache TTL in ms.
 * @param {string[]} [options.fieldMask] - Places field mask.
 * @returns {Promise<{places: NearbyPlace[]}|null>} Returns null on any failure.
 */
export async function searchPlacesNearby(args, options = {}) {
    try {
        const apiKey = String(getGoogleMapsApiKey() || '');
        const err = validate(args, apiKey);
        if (err) return null;

        const ttlMs = Number.isFinite(options.ttlMs)
            ? options.ttlMs
            : DEFAULT_TTL_MS;
        const fieldMask =
            Array.isArray(options.fieldMask) && options.fieldMask.length
                ? options.fieldMask
                : DEFAULT_FIELD_MASK;

        const key = cacheKey(args);
        const now = Date.now();
        const hit = cache.get(key);
        if (hit && hit.expiresAt > now) return hit.value;

        const body = {
            locationRestriction: {
                circle: {
                    center: {
                        latitude: args.lat,
                        longitude: args.lng,
                    },
                    radius: args.radius_m,
                },
            },
            includedPrimaryTypes: args.included_primary_types,
            maxResultCount: args.max_result_count ?? 10,
            rankPreference: args.rank_preference ?? 'POPULARITY',
            languageCode: args.language_code,
            regionCode: args.region_code,
        };

        const resp = await fetch(
            'https://places.googleapis.com/v1/places:searchNearby',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': fieldMask.join(','),
                },
                body: JSON.stringify(body),
            }
        );

        if (!resp.ok) return null;

        /** @type {{ places?: Array<Record<string, any>> }} */
        const data = /** @type {any} */ (await resp.json());

        /** @type {NearbyPlace[]} */
        const places = (data?.places || []).map((p) => ({
            id: p?.id ?? null,
            name: p?.displayName?.text ?? null,
            address: p?.formattedAddress ?? null,
            location: p?.location
                ? {
                      lat: p.location.latitude,
                      lng: p.location.longitude,
                  }
                : null,
            primaryType: p?.primaryType ?? null,
            mapsUrl: p?.googleMapsUri ?? null,
        }));

        const value = { places };
        cache.set(key, { expiresAt: now + Number(ttlMs), value });
        return value;
    } catch {
        return null;
    }
}

/**
 * Find nearby places around the latest tracked location.
 *
 * @param {number} radius_m - Search radius in meters (1..50000).
 * @param {object} [options] - Optional search settings.
 * @param {IncludedPrimaryType[]=} options.included_primary_types - Places (New) primary types.
 * @param {number=} options.max_result_count - Max results (1..20).
 * @param {"POPULARITY"|"DISTANCE"=} options.rank_preference - Result ranking.
 * @param {string=} options.language_code - BCP-47 language code.
 * @param {string=} options.region_code - CLDR region code.
 * @param {string[]=} options.fieldMask - Places field mask.
 * @param {number=} options.ttlMs - Cache TTL in ms.
 * @returns {Promise<{places: NearbyPlace[]}|null>} Nearby places or null.
 */
