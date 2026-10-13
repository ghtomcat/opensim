/* Hand-added windsock positions, keyed by ICAO, for mission airports where OSM has no
   aeroway=windsock node mapped. OSM windsocks are rendered directly when present (e.g.
   Hahnweide); these only fill the gaps. Each value is a list of { lat, lon }. */
export const WINDSOCKS = {
  LSZG: [{ lat: 47.1814, lon: 7.4112 }],   // Grenchen — by the airfield playground / apron
};
