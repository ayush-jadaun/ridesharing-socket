const config = require("../config");
const logger = require("../utils/logger");
const GeohashUtil = require("../utils/geohash");
const geoService = require("./geoService");
const redisManager = require("../config/redis"); // Add this import

class DriverService {
  constructor() {
    // Remove constructor expecting redis parameter
    this.driverProfiles = new Map();
  }

  // Add getter for Redis client
  get redis() {
    return redisManager.getClient();
  }

  async registerDriver(socket, driverData) {
    try {
      const {
        driverId,
        latitude,
        longitude,
        vehicleType,
        rating,
        socketId,
        driverName,
        vehicleNumber,
      } = driverData;

      // Create driver profile
      const driverProfile = {
        driverId,
        driverName: driverName || `Driver ${driverId}`,
        vehicleType,
        vehicleNumber: vehicleNumber || "N/A",
        rating: rating || 5.0,
        status: "available",
        latitude,
        longitude,
        socketId: socket.id,
        connectedAt: new Date().toISOString(),
        lastLocationUpdate: new Date().toISOString(),
        totalRides: 0,
        isOnline: true,
      };

      // Store in memory for quick access
      this.driverProfiles.set(driverId, driverProfile);

      // Store in Redis for persistence
      await this.redis.hset(
        "drivers:profiles",
        driverId,
        JSON.stringify(driverProfile)
      );

      // Add to active drivers set
      await this.redis.sadd(config.REDIS_KEYS.ACTIVE_DRIVERS, driverId);

      // Create geohash-based room for efficient broadcasting
      const geohash = GeohashUtil.encode(
        latitude,
        longitude,
        config.GEOHASH_PRECISION
      );
      const roomName = `geo_${geohash}`;
      socket.join(roomName);

      // Update location in geo service
      await geoService.updateDriverLocation(
        driverId,
        latitude,
        longitude,
        "available",
        {
          vehicleType,
          rating,
          driverName,
          vehicleNumber,
          socketId: socket.id,
        }
      );

      logger.info(
        `Driver ${driverId} registered successfully in room ${roomName}`
      );

      return {
        success: true,
        driverId,
        roomName,
        profile: driverProfile,
      };
    } catch (error) {
      logger.error(`Error registering driver ${driverData.driverId}:`, error);
      throw error;
    }
  }

  async updateDriverRoom(socket, driverId, latitude, longitude) {
    try {
      const driverProfile = this.driverProfiles.get(driverId);
      if (!driverProfile) {
        logger.warn(`Driver profile not found for ${driverId}`);
        return;
      }

      const oldGeohash = GeohashUtil.encode(
        driverProfile.latitude,
        driverProfile.longitude,
        config.GEOHASH_PRECISION
      );
      const newGeohash = GeohashUtil.encode(
        latitude,
        longitude,
        config.GEOHASH_PRECISION
      );

      if (oldGeohash !== newGeohash) {
        // Driver moved to a different geohash region
        const oldRoomName = `geo_${oldGeohash}`;
        const newRoomName = `geo_${newGeohash}`;

        socket.leave(oldRoomName);
        socket.join(newRoomName);

        logger.debug(
          `Driver ${driverId} moved from ${oldRoomName} to ${newRoomName}`
        );
      }

      // Update profile location
      driverProfile.latitude = latitude;
      driverProfile.longitude = longitude;
      driverProfile.lastLocationUpdate = new Date().toISOString();

      // Update in Redis
      await this.redis.hset(
        "drivers:profiles",
        driverId,
        JSON.stringify(driverProfile)
      );
    } catch (error) {
      logger.error(`Error updating driver room for ${driverId}:`, error);
    }
  }

  async getDriverProfile(driverId) {
    try {
      // Try memory first
      let profile = this.driverProfiles.get(driverId);

      if (!profile) {
        // Try Redis
        const profileData = await this.redis.hget("drivers:profiles", driverId);
        if (profileData) {
          profile = JSON.parse(profileData);
          this.driverProfiles.set(driverId, profile);
        }
      }

      return profile;
    } catch (error) {
      logger.error(`Error getting driver profile for ${driverId}:`, error);
      return null;
    }
  }

  async updateDriverStatus(driverId, status) {
    try {
      const driverProfile = await this.getDriverProfile(driverId);
      if (!driverProfile) {
        throw new Error(`Driver ${driverId} not found`);
      }

      driverProfile.status = status;
      driverProfile.lastStatusUpdate = new Date().toISOString();

      // Update in memory
      this.driverProfiles.set(driverId, driverProfile);

      // Update in Redis
      await this.redis.hset(
        "drivers:profiles",
        driverId,
        JSON.stringify(driverProfile)
      );

      // Update geo service
      if (driverProfile.latitude && driverProfile.longitude) {
        await geoService.updateDriverLocation(
          driverId,
          driverProfile.latitude,
          driverProfile.longitude,
          status,
          {
            vehicleType: driverProfile.vehicleType,
            rating: driverProfile.rating,
            driverName: driverProfile.driverName,
            vehicleNumber: driverProfile.vehicleNumber,
            socketId: driverProfile.socketId,
          }
        );
      }

      logger.info(`Driver ${driverId} status updated to ${status}`);
      return true;
    } catch (error) {
      logger.error(`Error updating driver status for ${driverId}:`, error);
      throw error;
    }
  }

  async removeDriver(driverId, socketId) {
    try {
      // Remove from memory
      this.driverProfiles.delete(driverId);

      // Remove from Redis
      await this.redis.hdel("drivers:profiles", driverId);
      await this.redis.srem(config.REDIS_KEYS.ACTIVE_DRIVERS, driverId);

      // Remove from geo service
      await geoService.removeDriver(driverId);

      logger.info(`Driver ${driverId} removed from system`);
      return true;
    } catch (error) {
      logger.error(`Error removing driver ${driverId}:`, error);
      throw error;
    }
  }

  async getActiveDriversCount() {
    try {
      const count = await this.redis.scard(config.REDIS_KEYS.ACTIVE_DRIVERS);
      return count || 0;
    } catch (error) {
      logger.error("Error getting active drivers count:", error);
      return 0;
    }
  }

  async getDriverIdFromSocket(socketId) {
    try {
      // Search through profiles to find matching socket ID
      for (const [driverId, profile] of this.driverProfiles.entries()) {
        if (profile.socketId === socketId) {
          return driverId;
        }
      }

      // If not in memory, search Redis
      const allProfiles = await this.redis.hgetall("drivers:profiles");
      for (const [driverId, profileData] of Object.entries(allProfiles)) {
        try {
          const profile = JSON.parse(profileData);
          if (profile.socketId === socketId) {
            return driverId;
          }
        } catch (error) {
          continue;
        }
      }

      return null;
    } catch (error) {
      logger.error("Error finding driver by socket ID:", error);
      return null;
    }
  }

  async cleanupOfflineDrivers() {
    try {
      const allProfiles = await this.redis.hgetall("drivers:profiles");
      const now = Date.now();
      let cleanedCount = 0;

      for (const [driverId, profileData] of Object.entries(allProfiles)) {
        try {
          const profile = JSON.parse(profileData);
          const lastUpdate = new Date(profile.lastLocationUpdate).getTime();

          // Remove drivers offline for more than 5 minutes
          if (now - lastUpdate > config.DRIVER_OFFLINE_TIMEOUT * 1000) {
            await this.removeDriver(driverId);
            cleanedCount++;
          }
        } catch (error) {
          // Invalid profile data, remove it
          await this.removeDriver(driverId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} offline drivers`);
      }
    } catch (error) {
      logger.error("Error cleaning up offline drivers:", error);
    }
  }
}

module.exports = new DriverService();
