const config = require("../config");
const logger = require("../utils/logger");
const GeohashUtil = require("../utils/geohash");
const redisManager = require("../config/redis"); // Add this import

class GeoService {
  constructor() {
    // Remove constructor expecting redis parameter
  }

  // Add getter for Redis client
  get redis() {
    return redisManager.getClient();
  }

  async updateDriverLocation(
    driverId,
    latitude,
    longitude,
    status = "available",
    metadata = {}
  ) {
    try {
      // Add driver to geo index
      await this.redis.geoadd(
        config.REDIS_KEYS.GEO,
        longitude,
        latitude,
        driverId
      );

      // Store additional driver metadata
      const driverData = {
        driverId,
        latitude,
        longitude,
        status,
        lastUpdate: new Date().toISOString(),
        ...metadata,
      };

      await this.redis.hset(
        config.REDIS_KEYS.DRIVER_DATA,
        driverId,
        JSON.stringify(driverData)
      );

      logger.debug(
        `Updated location for driver ${driverId}: ${latitude}, ${longitude}`
      );
      return true;
    } catch (error) {
      logger.error(`Error updating driver location for ${driverId}:`, error);
      throw error;
    }
  }

  async findNearbyDrivers(
    latitude,
    longitude,
    radiusKm = 5,
    vehicleType = null
  ) {
    try {
      // Find drivers within radius using Redis GEORADIUS
      const results = await this.redis.georadius(
        config.REDIS_KEYS.GEO,
        longitude,
        latitude,
        radiusKm,
        "km",
        "WITHDIST",
        "WITHCOORD",
        "ASC",
        "COUNT",
        config.MAX_SEARCH_RESULTS || 50
      );

      const nearbyDrivers = [];

      for (const result of results) {
        try {
          const [driverId, distance, [driverLng, driverLat]] = result;

          // Get driver data
          const driverDataStr = await this.redis.hget(
            config.REDIS_KEYS.DRIVER_DATA,
            driverId
          );
          if (!driverDataStr) continue;

          const driverData = JSON.parse(driverDataStr);

          // Filter by vehicle type if specified
          if (
            vehicleType &&
            vehicleType !== "any" &&
            driverData.vehicleType !== vehicleType
          ) {
            continue;
          }

          // Only include available drivers
          if (driverData.status !== "available") {
            continue;
          }

          nearbyDrivers.push({
            driverId,
            distance: parseFloat(distance),
            latitude: parseFloat(driverLat),
            longitude: parseFloat(driverLng),
            vehicleType: driverData.vehicleType,
            rating: driverData.rating || 5.0,
            driverName: driverData.driverName,
            vehicleNumber: driverData.vehicleNumber,
            lastUpdate: driverData.lastUpdate,
          });
        } catch (error) {
          logger.error(`Error processing driver data for ${result[0]}:`, error);
          continue;
        }
      }

      // Sort by distance and rating
      nearbyDrivers.sort((a, b) => {
        if (Math.abs(a.distance - b.distance) < 0.5) {
          // If distances are similar, prefer higher rating
          return b.rating - a.rating;
        }
        return a.distance - b.distance;
      });

      logger.debug(
        `Found ${nearbyDrivers.length} nearby drivers within ${radiusKm}km`
      );
      return nearbyDrivers;
    } catch (error) {
      logger.error("Error finding nearby drivers:", error);
      throw error;
    }
  }

  async removeDriver(driverId) {
    try {
      // Remove from geo index
      await this.redis.zrem(config.REDIS_KEYS.GEO, driverId);

      // Remove driver data
      await this.redis.hdel(config.REDIS_KEYS.DRIVER_DATA, driverId);

      logger.debug(`Removed driver ${driverId} from geo index`);
      return true;
    } catch (error) {
      logger.error(`Error removing driver ${driverId}:`, error);
      throw error;
    }
  }

  async getDriverLocation(driverId) {
    try {
      const position = await this.redis.geopos(config.REDIS_KEYS.GEO, driverId);
      if (position && position[0]) {
        const [longitude, latitude] = position[0];
        return {
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
        };
      }
      return null;
    } catch (error) {
      logger.error(`Error getting driver location for ${driverId}:`, error);
      return null;
    }
  }

  async calculateDistance(lat1, lon1, lat2, lon2) {
    return GeohashUtil.calculateDistance(lat1, lon1, lat2, lon2);
  }
}

module.exports = new GeoService();
