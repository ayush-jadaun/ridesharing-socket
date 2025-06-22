class DriverService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.onlineDrivers = new Map(); // In-memory store for driver socket mappings
    this.DRIVER_GEO_KEY = "drivers:geo";
    this.DRIVER_STATUS_KEY = "drivers:status";
  }

  async addDriver(driverId, socketId, lat, lng, vehicleType = "car") {
    try {
      // Add driver to Redis geo index
      await this.redis.geoAdd(this.DRIVER_GEO_KEY, {
        longitude: lng,
        latitude: lat,
        member: driverId,
      });

      // Store driver status and details
      const driverData = {
        socketId,
        vehicleType,
        status: "available",
        lastUpdated: Date.now(),
      };

      await this.redis.hSet(
        `${this.DRIVER_STATUS_KEY}:${driverId}`,
        driverData
      );

      // Store in memory for socket management
      this.onlineDrivers.set(driverId, {
        socketId,
        vehicleType,
        lat,
        lng,
        status: "available",
      });

      console.log(`Driver ${driverId} added at location: ${lat}, ${lng}`);
      return true;
    } catch (error) {
      console.error("Error adding driver:", error);
      return false;
    }
  }

  async updateDriverLocation(driverId, lat, lng) {
    try {
      if (!this.onlineDrivers.has(driverId)) {
        return false;
      }

      // Update geo location
      await this.redis.geoAdd(this.DRIVER_GEO_KEY, {
        longitude: lng,
        latitude: lat,
        member: driverId,
      });

      // Update in-memory data
      const driver = this.onlineDrivers.get(driverId);
      driver.lat = lat;
      driver.lng = lng;
      this.onlineDrivers.set(driverId, driver);

      return true;
    } catch (error) {
      console.error("Error updating driver location:", error);
      return false;
    }
  }

  async findNearbyDrivers(lat, lng, radiusKm = 5) {
    try {
      console.log(
        `Searching for drivers near ${lat}, ${lng} within ${radiusKm}km`
      );

      const radiusMeters = radiusKm * 1000;

      // Check if the geo key exists and has any members
      const totalDrivers = await this.redis.zCard(this.DRIVER_GEO_KEY);
      console.log(`Total drivers in geo index: ${totalDrivers}`);

      if (totalDrivers === 0) {
        console.log("No drivers found in geo index");
        return [];
      }

      // Use GEORADIUS to find nearby drivers
      let nearbyDrivers;

      try {
        // Method 1: Try with options object (some Redis clients)
        nearbyDrivers = await this.redis.geoRadius(
          this.DRIVER_GEO_KEY,
          { longitude: lng, latitude: lat },
          radiusMeters,
          "m",
          {
            WITHDIST: true,
            WITHCOORD: true,
            COUNT: 10,
          }
        );

        // If we get simple strings, try the raw command
        if (
          nearbyDrivers &&
          nearbyDrivers.length > 0 &&
          typeof nearbyDrivers[0] === "string"
        ) {
          console.log("Got simple strings, trying raw command...");
          throw new Error("Need to use raw command");
        }
      } catch (methodError) {
        console.log(
          "Standard geoRadius failed, trying raw command:",
          methodError.message
        );

        // Method 2: Use raw Redis command
        nearbyDrivers = await this.redis.sendCommand([
          "GEORADIUS",
          this.DRIVER_GEO_KEY,
          lng.toString(),
          lat.toString(),
          radiusMeters.toString(),
          "m",
          "WITHDIST",
          "WITHCOORD",
          "COUNT",
          "10",
        ]);
      }

      console.log("Raw nearby drivers result:", nearbyDrivers);

      // Handle case where nearbyDrivers is undefined or null
      if (!nearbyDrivers || !Array.isArray(nearbyDrivers)) {
        console.log("No nearby drivers found or invalid response");
        return [];
      }

      const availableDrivers = [];

      for (const driver of nearbyDrivers) {
        // Handle different response formats
        let driverId,
          distance = 0,
          coordinates = [0, 0];

        if (Array.isArray(driver)) {
          // Response format from raw command: [member, distance, [lng, lat]]
          driverId = driver[0];
          distance = driver.length > 1 ? parseFloat(driver[1]) : 0;
          coordinates = driver.length > 2 ? driver[2] : [0, 0];
        } else if (driver.member) {
          // Response format: {member, distance, coordinates}
          driverId = driver.member;
          distance = parseFloat(driver.distance || 0);
          coordinates = driver.coordinates || [0, 0];
        } else if (typeof driver === "string") {
          // Just driver ID - need to get position and calculate distance manually
          driverId = driver;

          // Get driver position from Redis
          try {
            const position = await this.redis.geoPos(
              this.DRIVER_GEO_KEY,
              driverId
            );
            if (position && position[0] && position[0].length === 2) {
              coordinates = [
                parseFloat(position[0][0]),
                parseFloat(position[0][1]),
              ];
              // Calculate distance manually using Haversine formula
              distance =
                this.calculateDistance(
                  lat,
                  lng,
                  coordinates[1],
                  coordinates[0]
                ) * 1000; // Convert to meters
            }
          } catch (posError) {
            console.log(
              `Failed to get position for driver ${driverId}:`,
              posError.message
            );
            continue;
          }
        } else {
          console.log("Unknown driver response format:", driver);
          continue;
        }

        const [driverLng, driverLat] = coordinates;

        // Check if driver is available
        const driverInfo = this.onlineDrivers.get(driverId);
        if (driverInfo && driverInfo.status === "available") {
          availableDrivers.push({
            driverId,
            socketId: driverInfo.socketId,
            vehicleType: driverInfo.vehicleType,
            lat: parseFloat(driverLat),
            lng: parseFloat(driverLng),
            distance: Math.round(distance),
          });
        }
      }

      console.log(`Found ${availableDrivers.length} available drivers`);
      return availableDrivers.sort((a, b) => a.distance - b.distance);
    } catch (error) {
      console.error("Error finding nearby drivers:", error);
      return [];
    }
  }

  // Helper method to calculate distance (Haversine formula)
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  async setDriverStatus(driverId, status) {
    try {
      if (this.onlineDrivers.has(driverId)) {
        const driver = this.onlineDrivers.get(driverId);
        driver.status = status;
        this.onlineDrivers.set(driverId, driver);

        // Update in Redis
        await this.redis.hSet(
          `${this.DRIVER_STATUS_KEY}:${driverId}`,
          "status",
          status
        );
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error setting driver status:", error);
      return false;
    }
  }

  async removeDriver(driverId) {
    try {
      // Remove from geo index
      await this.redis.geoRem(this.DRIVER_GEO_KEY, driverId);

      // Remove driver status
      await this.redis.del(`${this.DRIVER_STATUS_KEY}:${driverId}`);

      // Remove from memory
      this.onlineDrivers.delete(driverId);

      console.log(`Driver ${driverId} removed`);
      return true;
    } catch (error) {
      console.error("Error removing driver:", error);
      return false;
    }
  }

  getDriverBySocketId(socketId) {
    for (const [driverId, driver] of this.onlineDrivers.entries()) {
      if (driver.socketId === socketId) {
        return { driverId, ...driver };
      }
    }
    return null;
  }

  getAllOnlineDrivers() {
    return Array.from(this.onlineDrivers.entries()).map(
      ([driverId, driver]) => ({
        driverId,
        ...driver,
      })
    );
  }
}

module.exports = DriverService;
