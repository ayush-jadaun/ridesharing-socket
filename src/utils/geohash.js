const geohash = require("ngeohash");
const config = require("../config");

class GeohashUtil {
  // Encode coordinates to geohash
  static encode(latitude, longitude, precision = config.GEOHASH_PRECISION) {
    return geohash.encode(latitude, longitude, precision);
  }

  // Decode geohash to coordinates
  static decode(hash) {
    return geohash.decode(hash);
  }

  // Get neighboring geohashes for broader search
  static getNeighbors(hash) {
    return geohash.neighbors(hash);
  }

  // Get geohash-based room name for Socket.io
  static getRoomName(latitude, longitude) {
    const hash = this.encode(latitude, longitude, config.GEOHASH_PRECISION - 1);
    return `zone_${hash}`;
  }

  // Calculate distance between two points (Haversine formula)
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  static toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }
}

module.exports = GeohashUtil;
