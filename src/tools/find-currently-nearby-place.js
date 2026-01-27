import { findCurrentlyNearbyPlaces as realFindCurrentlyNearbyPlaces } from '../utils/google-places-current.js';
import { isPrimaryCaller } from '../env.js';

const METERS_PER_MILE = 1609.344;
const DEFAULT_RADIUS_MILES = 5;
const DEFAULT_RADIUS_M = Math.round(METERS_PER_MILE * DEFAULT_RADIUS_MILES);
const LOCATION_UNAVAILABLE_MESSAGE = 'Current location not available.';

/** @type {typeof realFindCurrentlyNearbyPlaces} */
let findCurrentlyNearbyPlacesImpl = realFindCurrentlyNearbyPlaces;

export const definition = {
    type: 'function',
    name: 'find_currently_nearby_place',
    parameters: {
        type: 'object',
        properties: {
            radius_miles: {
                type: 'number',
                description:
                    'Search radius in miles. Defaults to 5 miles when omitted.',
            },
            radius_m: {
                type: 'number',
                description:
                    'Search radius in meters (1..50000). Overrides radius_miles when provided.',
            },
            included_primary_types: {
                type: 'array',
                description:
                    'Places (New) primary types the user is looking for (e.g., ["restaurant"]).',
                items: {
                    type: 'string',
                    enum: [
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
                    ],
                },
            },
            max_result_count: {
                type: 'number',
                description: 'Max results (1..20).',
            },
            rank_preference: {
                type: 'string',
                description:
                    'Result ranking preference: POPULARITY or DISTANCE.',
            },
            language_code: {
                type: 'string',
                description: 'BCP-47 language code, e.g., "en".',
            },
            region_code: {
                type: 'string',
                description: 'CLDR region code, e.g., "US".',
            },
        },
    },
    description:
        'Find places near the caller’s current tracked location. Defaults to a 5 mile radius when radius is not provided.',
};

/**
 * Execute find_currently_nearby_place tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ radius_miles?: number, radius_m?: number, included_primary_types?: string[], max_result_count?: number, rank_preference?: "POPULARITY"|"DISTANCE", language_code?: string, region_code?: string }} root0.args - Tool arguments.
 * @param {{ currentCallerE164?: string | null }} root0.context - Tool context.
 * @returns {Promise<{ status: 'ok', radius_m: number, places: import('../utils/google-places.js').NearbyPlace[] } | { status: 'unavailable', message: string }>} Tool result payload.
 */
export async function execute({ args, context }) {
    const currentCallerE164 = context?.currentCallerE164 || null;
    if (!currentCallerE164 || !isPrimaryCaller(currentCallerE164)) {
        return {
            status: 'unavailable',
            message: LOCATION_UNAVAILABLE_MESSAGE,
        };
    }
    const radiusMetersRaw = Number.isFinite(args?.radius_m)
        ? Number(args?.radius_m)
        : null;
    const radiusMilesRaw = Number.isFinite(args?.radius_miles)
        ? Number(args?.radius_miles)
        : null;

    let radius_m = DEFAULT_RADIUS_M;
    if (Number.isFinite(radiusMetersRaw)) {
        radius_m = Number(radiusMetersRaw);
    } else if (Number.isFinite(radiusMilesRaw)) {
        radius_m = Math.round(Number(radiusMilesRaw) * METERS_PER_MILE);
    }

    if (!Number.isFinite(radius_m) || radius_m <= 0 || radius_m > 50000) {
        throw new Error('Invalid radius; must be between 1 and 50000 meters.');
    }

    const result = await findCurrentlyNearbyPlacesImpl(radius_m, {
        included_primary_types: Array.isArray(args?.included_primary_types)
            ? args?.included_primary_types
            : undefined,
        max_result_count: Number.isFinite(args?.max_result_count)
            ? Number(args?.max_result_count)
            : undefined,
        rank_preference:
            args?.rank_preference === 'POPULARITY' ||
            args?.rank_preference === 'DISTANCE'
                ? args.rank_preference
                : undefined,
        language_code: args?.language_code || undefined,
        region_code: args?.region_code || undefined,
    });

    if (!result) {
        return {
            status: 'unavailable',
            message: LOCATION_UNAVAILABLE_MESSAGE,
        };
    }

    return {
        status: 'ok',
        radius_m,
        places: result.places,
    };
}

/**
 * Test-only override for findCurrentlyNearbyPlaces.
 * @param {typeof realFindCurrentlyNearbyPlaces} override - Replacement implementation.
 */
export function setFindCurrentlyNearbyPlacesForTests(override) {
    findCurrentlyNearbyPlacesImpl = override || realFindCurrentlyNearbyPlaces;
}

/** Restore the default findCurrentlyNearbyPlaces implementation. */
export function resetFindCurrentlyNearbyPlacesForTests() {
    findCurrentlyNearbyPlacesImpl = realFindCurrentlyNearbyPlaces;
}
