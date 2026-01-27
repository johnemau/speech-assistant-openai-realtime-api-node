import { googlePlacesTextSearch as realGooglePlacesTextSearch } from '../utils/google-places-text-search.js';

const DEFAULT_MAX_RESULT_COUNT = 10;
const PLACES_UNAVAILABLE_MESSAGE = 'Places search unavailable.';

/** @type {typeof realGooglePlacesTextSearch} */
let googlePlacesTextSearchImpl = realGooglePlacesTextSearch;

export const definition = {
    type: 'function',
    name: 'places_text_search',
    parameters: {
        type: 'object',
        properties: {
            text_query: {
                type: 'string',
                description:
                    'Search query for places, e.g., "shaved ice in Tucson" or a phone number.',
            },
            included_type: {
                type: 'string',
                description:
                    'Restrict results to a single includedType (Places API), e.g., "cafe".',
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
            use_strict_type_filtering: {
                type: 'boolean',
                description:
                    'Whether to strictly enforce includedType. Default false.',
            },
            is_open_now: {
                type: 'boolean',
                description: 'Only return places that are open now.',
            },
            min_rating: {
                type: 'number',
                description: 'Minimum rating (typically 1..5).',
            },
            max_result_count: {
                type: 'number',
                description: 'Max results (1..20). Default 10.',
            },
            language: {
                type: 'string',
                description: 'BCP-47 language tag (e.g., "en-US").',
            },
            region: {
                type: 'string',
                description: 'Region code (e.g., "us").',
            },
            location_bias: {
                type: 'object',
                description:
                    'Bias results toward a point (lat/lng). Use with current location for "near me" queries.',
                properties: {
                    lat: { type: 'number' },
                    lng: { type: 'number' },
                },
            },
            location_restriction: {
                type: 'object',
                description:
                    'Restrict results to a circle defined by center and radius_m (meters).',
                properties: {
                    center: {
                        type: 'object',
                        properties: {
                            lat: { type: 'number' },
                            lng: { type: 'number' },
                        },
                    },
                    radius_m: { type: 'number' },
                },
            },
        },
        required: ['text_query'],
    },
    description:
        'Text search for places using Google Places API (New). Use for queries like "coffee shops in Seattle" or "shaved ice in Tucson".',
};

/**
 * Execute places_text_search tool.
 *
 * @param {object} root0 - Tool inputs.
 * @param {{ text_query?: string, included_type?: string, use_strict_type_filtering?: boolean, is_open_now?: boolean, min_rating?: number, max_result_count?: number, language?: string, region?: string, location_bias?: { lat?: number, lng?: number }, location_restriction?: { center?: { lat?: number, lng?: number }, radius_m?: number } }} root0.args - Tool arguments.
 * @returns {Promise<{ status: 'ok', places: import('../utils/google-places-text-search.js').TextSearchPlace[] } | { status: 'unavailable', message: string }>} Tool result payload.
 */
export async function execute({ args }) {
    const textQuery = String(args?.text_query || '').trim();
    if (!textQuery) throw new Error('Missing text_query.');

    const locationBias = args?.location_bias;
    const locationRestriction = args?.location_restriction;
    const locationRestrictionCenter = locationRestriction?.center;

    const result = await googlePlacesTextSearchImpl({
        textQuery,
        includedType:
            typeof args?.included_type === 'string'
                ? args.included_type
                : undefined,
        useStrictTypeFiltering: Boolean(args?.use_strict_type_filtering),
        isOpenNow:
            typeof args?.is_open_now === 'boolean'
                ? args.is_open_now
                : undefined,
        minRating:
            Number.isFinite(args?.min_rating) && args?.min_rating != null
                ? Number(args.min_rating)
                : undefined,
        maxResultCount:
            Number.isFinite(args?.max_result_count) &&
            args?.max_result_count != null
                ? Number(args.max_result_count)
                : DEFAULT_MAX_RESULT_COUNT,
        language: args?.language || undefined,
        region: args?.region || undefined,
        locationBias:
            locationBias &&
            Number.isFinite(locationBias.lat) &&
            Number.isFinite(locationBias.lng)
                ? {
                      lat: Number(locationBias.lat),
                      lng: Number(locationBias.lng),
                  }
                : undefined,
        locationRestriction:
            locationRestriction &&
            locationRestrictionCenter &&
            Number.isFinite(locationRestrictionCenter.lat) &&
            Number.isFinite(locationRestrictionCenter.lng) &&
            Number.isFinite(locationRestriction.radius_m)
                ? {
                      center: {
                          lat: Number(locationRestrictionCenter.lat),
                          lng: Number(locationRestrictionCenter.lng),
                      },
                      radius_m: Number(locationRestriction.radius_m),
                  }
                : undefined,
    });

    if (!result) {
        return {
            status: 'unavailable',
            message: PLACES_UNAVAILABLE_MESSAGE,
        };
    }

    return {
        status: 'ok',
        places: result.places,
    };
}

/**
 * Test-only override for googlePlacesTextSearch.
 * @param {typeof realGooglePlacesTextSearch} override - Replacement implementation.
 */
export function setGooglePlacesTextSearchForTests(override) {
    googlePlacesTextSearchImpl = override || realGooglePlacesTextSearch;
}

/** Restore the default googlePlacesTextSearch implementation. */
export function resetGooglePlacesTextSearchForTests() {
    googlePlacesTextSearchImpl = realGooglePlacesTextSearch;
}
