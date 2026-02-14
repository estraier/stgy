// Export modules for Next.js or other bundlers
export { StgyTrackRenderer } from './renderer';
export { isJapan } from './geo';
export { JAPAN_AREAS } from './areas';

// Import Leaflet CSS to ensure it's included in the bundle
import 'leaflet/dist/leaflet.css';
