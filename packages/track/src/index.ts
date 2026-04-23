// Export modules for Next.js or other bundlers
export { StgyTrackRenderer } from './renderer';
export { isJapan, JAPAN_AREAS } from './geo';

// Import Leaflet CSS to ensure it's included in the bundle
import 'leaflet/dist/leaflet.css';
