/**
 * Geocoding adapter.
 *
 * Only a built-in DEMONSTRATION gazetteer is implemented: it resolves well-known U.S. cities and
 * ports to approximate city-center coordinates. Street-level geocoding requires connecting a provider
 * (e.g. Mapbox, Google, HERE) by implementing `GeocodeProvider` and setting GEOCODER_PROVIDER.
 */
export interface GeocodeResult {
  lat: number;
  lng: number;
  timezone: string;
  precision: "CITY_CENTER";
  provider: "demo-gazetteer";
}

export interface GeocodeProvider {
  readonly name: string;
  geocode(input: { city: string; state: string; postalCode?: string | null }): Promise<GeocodeResult | null>;
}

const E = "America/New_York";
const C = "America/Chicago";
const M = "America/Denver";
const P = "America/Los_Angeles";
const AZ = "America/Phoenix";

// city|state → [lat, lng, tz]
const GAZ: Record<string, [number, number, string]> = {
  "atlanta|GA": [33.749, -84.388, E],
  "savannah|GA": [32.0809, -81.0912, E],
  "charleston|SC": [32.7765, -79.9311, E],
  "greer|SC": [34.9387, -82.2271, E],
  "spartanburg|SC": [34.9496, -81.932, E],
  "charlotte|NC": [35.2271, -80.8431, E],
  "raleigh|NC": [35.7796, -78.6382, E],
  "norfolk|VA": [36.8508, -76.2859, E],
  "richmond|VA": [37.5407, -77.436, E],
  "baltimore|MD": [39.2904, -76.6122, E],
  "philadelphia|PA": [39.9526, -75.1652, E],
  "harrisburg|PA": [40.2732, -76.8867, E],
  "pittsburgh|PA": [40.4406, -79.9959, E],
  "newark|NJ": [40.7357, -74.1724, E],
  "elizabeth|NJ": [40.664, -74.2107, E],
  "edison|NJ": [40.5187, -74.4121, E],
  "new york|NY": [40.7128, -74.006, E],
  "buffalo|NY": [42.8864, -78.8784, E],
  "boston|MA": [42.3601, -71.0589, E],
  "hartford|CT": [41.7658, -72.6734, E],
  "jacksonville|FL": [30.3322, -81.6557, E],
  "miami|FL": [25.7617, -80.1918, E],
  "orlando|FL": [28.5383, -81.3792, E],
  "tampa|FL": [27.9506, -82.4572, E],
  "port everglades|FL": [26.0907, -80.1226, E],
  "detroit|MI": [42.3314, -83.0458, E],
  "columbus|OH": [39.9612, -82.9988, E],
  "cleveland|OH": [41.4993, -81.6944, E],
  "cincinnati|OH": [39.1031, -84.512, E],
  "indianapolis|IN": [39.7684, -86.1581, E],
  "louisville|KY": [38.2527, -85.7585, E],
  "knoxville|TN": [35.9606, -83.9207, E],
  "nashville|TN": [36.1627, -86.7816, C],
  "memphis|TN": [35.1495, -90.049, C],
  "birmingham|AL": [33.5186, -86.8104, C],
  "mobile|AL": [30.6954, -88.0399, C],
  "new orleans|LA": [29.9511, -90.0715, C],
  "baton rouge|LA": [30.4515, -91.1871, C],
  "jackson|MS": [32.2988, -90.1848, C],
  "little rock|AR": [34.7465, -92.2896, C],
  "chicago|IL": [41.8781, -87.6298, C],
  "joliet|IL": [41.525, -88.0817, C],
  "elwood|IL": [41.4039, -88.1117, C],
  "milwaukee|WI": [43.0389, -87.9065, C],
  "minneapolis|MN": [44.9778, -93.265, C],
  "st. louis|MO": [38.627, -90.1994, C],
  "kansas city|MO": [39.0997, -94.5786, C],
  "omaha|NE": [41.2565, -95.9345, C],
  "des moines|IA": [41.5868, -93.625, C],
  "wichita|KS": [37.6872, -97.3301, C],
  "oklahoma city|OK": [35.4676, -97.5164, C],
  "tulsa|OK": [36.154, -95.9928, C],
  "dallas|TX": [32.7767, -96.797, C],
  "fort worth|TX": [32.7555, -97.3308, C],
  "houston|TX": [29.7604, -95.3698, C],
  "san antonio|TX": [29.4241, -98.4936, C],
  "austin|TX": [30.2672, -97.7431, C],
  "laredo|TX": [27.5306, -99.4803, C],
  "el paso|TX": [31.7619, -106.485, M],
  "denver|CO": [39.7392, -104.9903, M],
  "albuquerque|NM": [35.0844, -106.6504, M],
  "salt lake city|UT": [40.7608, -111.891, M],
  "boise|ID": [43.615, -116.2023, M],
  "phoenix|AZ": [33.4484, -112.074, AZ],
  "tucson|AZ": [32.2226, -110.9747, AZ],
  "las vegas|NV": [36.1699, -115.1398, P],
  "reno|NV": [39.5296, -119.8138, P],
  "los angeles|CA": [34.0522, -118.2437, P],
  "long beach|CA": [33.7701, -118.1937, P],
  "ontario|CA": [34.0633, -117.6509, P],
  "san diego|CA": [32.7157, -117.1611, P],
  "oakland|CA": [37.8044, -122.2712, P],
  "san francisco|CA": [37.7749, -122.4194, P],
  "sacramento|CA": [38.5816, -121.4944, P],
  "fresno|CA": [36.7378, -119.7871, P],
  "portland|OR": [45.5152, -122.6784, P],
  "seattle|WA": [47.6062, -122.3321, P],
  "tacoma|WA": [47.2529, -122.4443, P],
  "spokane|WA": [47.6588, -117.426, P],
};

export const demoGeocoder: GeocodeProvider = {
  name: "demo-gazetteer",
  async geocode({ city, state }) {
    const hit = GAZ[`${city.trim().toLowerCase()}|${state.trim().toUpperCase()}`];
    if (!hit) return null;
    return { lat: hit[0], lng: hit[1], timezone: hit[2], precision: "CITY_CENTER", provider: "demo-gazetteer" };
  },
};

export function knownCities(): { city: string; state: string }[] {
  return Object.keys(GAZ).map((k) => {
    const [city, state] = k.split("|");
    return { city: city.replace(/\b\w/g, (c) => c.toUpperCase()), state };
  });
}

/** Great-circle distance in statute miles. */
export function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const geocoder = (): GeocodeProvider => demoGeocoder;
