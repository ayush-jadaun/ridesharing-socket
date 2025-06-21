const driverService = require("../services/driverService");
const geoService = require("../services/geoService");
const rideService = require("../services/rideService");
const config = require("../config");
const logger = require("../utils/logger");
const GeohashUtil = require("../utils/geohash");

class SocketController {
  constructor(io) {
    this.io = io;
    this.setupSocketHandlers();
    this.startCleanupTasks();
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      logger.info(`New connection established: ${socket.id}`);

      // Driver Events
      socket.on("driver_register", (data) =>
        this.handleDriverRegister(socket, data)
      );
      socket.on("driver_location_update", (data) =>
        this.handleDriverLocationUpdate(socket, data)
      );
      socket.on("driver_status_update", (data) =>
        this.handleDriverStatusUpdate(socket, data)
      );
      socket.on("ride_response", (data) =>
        this.handleRideResponse(socket, data)
      );

      // User Events
      socket.on("find_nearby_drivers", (data) =>
        this.handleFindNearbyDrivers(socket, data)
      );
      socket.on("cancel_ride_request", (data) =>
        this.handleCancelRideRequest(socket, data)
      );
      socket.on("expand_search_radius", (data) =>
        this.handleExpandSearchRadius(socket, data)
      );

      // Common Events
      socket.on("get_active_drivers_count", () =>
        this.handleGetActiveDriversCount(socket)
      );
      socket.on("ping", () => this.handlePing(socket));

      // Disconnect Event
      socket.on("disconnect", () => this.handleDisconnect(socket));

      // Error Handling
      socket.on("error", (error) => {
        logger.error(`Socket error for ${socket.id}:`, error);
      });
    });
  }

  // === DRIVER EVENT HANDLERS ===

  async handleDriverRegister(socket, data) {
    try {
      const {
        driverId,
        latitude,
        longitude,
        vehicleType,
        rating,
        driverName,
        vehicleNumber,
      } = data;

      // Validation
      if (!driverId || !latitude || !longitude || !vehicleType) {
        socket.emit("driver_register_error", {
          message:
            "Missing required fields: driverId, latitude, longitude, vehicleType",
        });
        return;
      }

      if (
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        socket.emit("driver_register_error", {
          message: "Invalid coordinates",
        });
        return;
      }

      // Register driver
      const registrationData = {
        driverId,
        latitude,
        longitude,
        vehicleType,
        rating: rating || 5.0,
        socketId: socket.id,
        driverName,
        vehicleNumber,
      };

      const result = await driverService.registerDriver(
        socket,
        registrationData
      );

      // Update location in geo service
      await geoService.updateDriverLocation(
        driverId,
        latitude,
        longitude,
        "available",
        {
          vehicleType,
          rating: rating || 5.0,
          driverName,
          vehicleNumber,
          socketId: socket.id,
        }
      );

      socket.emit("driver_registered", {
        success: true,
        driverId,
        roomName: result.roomName,
        message: "Driver registered successfully",
        config: {
          updateInterval: config.LOCATION_UPDATE_INTERVAL,
          movementThreshold: config.MOVEMENT_THRESHOLD,
        },
      });

      logger.info(`Driver ${driverId} registered successfully`);
    } catch (error) {
      logger.error("Error in driver registration:", error);
      socket.emit("driver_register_error", {
        message: "Registration failed",
        error: error.message,
      });
    }
  }

  async handleDriverLocationUpdate(socket, data) {
    try {
      const { driverId, latitude, longitude, speed, heading } = data;

      // Validation
      if (!driverId || !latitude || !longitude) {
        socket.emit("location_update_error", {
          message: "Missing required fields: driverId, latitude, longitude",
        });
        return;
      }

      // Get current driver profile
      const driverProfile = await driverService.getDriverProfile(driverId);
      if (!driverProfile) {
        socket.emit("location_update_error", {
          message: "Driver not found. Please register first.",
        });
        return;
      }

      // Calculate distance moved (if previous location exists)
      let distanceMoved = 0;
      if (driverProfile.latitude && driverProfile.longitude) {
        distanceMoved =
          GeohashUtil.calculateDistance(
            driverProfile.latitude,
            driverProfile.longitude,
            latitude,
            longitude
          ) * 1000; // Convert to meters
      }

      // Check movement threshold
      if (distanceMoved < config.MOVEMENT_THRESHOLD && driverProfile.latitude) {
        // Driver hasn't moved significantly, skip update
        return;
      }

      // Update driver room if location changed significantly
      await driverService.updateDriverRoom(
        socket,
        driverId,
        latitude,
        longitude
      );

      // Update location in geo service
      await geoService.updateDriverLocation(
        driverId,
        latitude,
        longitude,
        driverProfile.status,
        {
          vehicleType: driverProfile.vehicleType,
          rating: driverProfile.rating,
          speed: speed || 0,
          heading: heading || 0,
          socketId: socket.id,
          lastMovement: distanceMoved,
        }
      );

      // Update driver profile with new location
      driverProfile.latitude = latitude;
      driverProfile.longitude = longitude;
      driverProfile.lastLocationUpdate = new Date().toISOString();

      // Determine next update interval based on speed
      let nextUpdateInterval = config.LOCATION_UPDATE_INTERVAL;
      if (speed) {
        if (speed < config.SPEED_THRESHOLDS.SLOW) {
          nextUpdateInterval = config.STATIONARY_UPDATE_INTERVAL;
        } else if (speed > config.SPEED_THRESHOLDS.NORMAL) {
          nextUpdateInterval = config.FAST_MOVING_UPDATE_INTERVAL;
        } else {
          nextUpdateInterval = config.SLOW_MOVING_UPDATE_INTERVAL;
        }
      }

      socket.emit("location_updated", {
        success: true,
        driverId,
        distanceMoved: Math.round(distanceMoved),
        nextUpdateInterval,
        timestamp: new Date().toISOString(),
      });

      logger.debug(
        `Driver ${driverId} location updated: ${latitude}, ${longitude} (moved: ${Math.round(
          distanceMoved
        )}m)`
      );
    } catch (error) {
      logger.error("Error updating driver location:", error);
      socket.emit("location_update_error", {
        message: "Location update failed",
        error: error.message,
      });
    }
  }

  async handleDriverStatusUpdate(socket, data) {
    try {
      const { driverId, status } = data;

      // Validation
      const validStatuses = ["available", "busy", "offline"];
      if (!driverId || !status || !validStatuses.includes(status)) {
        socket.emit("status_update_error", {
          message: `Invalid status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        });
        return;
      }

      await driverService.updateDriverStatus(driverId, status);

      socket.emit("status_updated", {
        success: true,
        driverId,
        status,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Driver ${driverId} status updated to ${status}`);
    } catch (error) {
      logger.error("Error updating driver status:", error);
      socket.emit("status_update_error", {
        message: "Status update failed",
        error: error.message,
      });
    }
  }

  async handleRideResponse(socket, data) {
    try {
      const { requestId, driverId, response, driverLocation } = data;

      // Validation
      if (
        !requestId ||
        !driverId ||
        !response ||
        !["accept", "reject"].includes(response)
      ) {
        socket.emit("ride_response_error", {
          message: "Invalid ride response data",
        });
        return;
      }

      if (response === "accept" && !driverLocation) {
        socket.emit("ride_response_error", {
          message: "Driver location required for acceptance",
        });
        return;
      }

      const result = await rideService.handleDriverResponse(this.io, {
        requestId,
        driverId,
        response,
        driverLocation,
      });

      socket.emit("ride_response_processed", {
        success: result.success,
        requestId,
        response,
        status: result.status,
        message: result.message || `Ride ${response}ed successfully`,
      });

      logger.info(`Driver ${driverId} ${response}ed ride request ${requestId}`);
    } catch (error) {
      logger.error("Error processing ride response:", error);
      socket.emit("ride_response_error", {
        message: "Failed to process ride response",
        error: error.message,
      });
    }
  }

  // === USER EVENT HANDLERS ===

  async handleFindNearbyDrivers(socket, data) {
    try {
      const {
        userId,
        latitude,
        longitude,
        vehicleType,
        pickupAddress,
        dropoffAddress,
        fareEstimate,
      } = data;

      // Validation
      if (!userId || !latitude || !longitude) {
        socket.emit("find_drivers_error", {
          message: "Missing required fields: userId, latitude, longitude",
        });
        return;
      }

      if (
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        socket.emit("find_drivers_error", {
          message: "Invalid coordinates",
        });
        return;
      }

      // Start the ride matching process
      socket.emit("ride_search_started", {
        userId,
        userLocation: { latitude, longitude },
        vehicleType,
        message: "Searching for nearby drivers...",
      });

      const result = await rideService.findAndBroadcastToDrivers(
        this.io,
        { userId, latitude, longitude, vehicleType },
        { pickupAddress, dropoffAddress, fareEstimate }
      );

      if (result.success) {
        socket.emit("drivers_found", {
          success: true,
          requestId: result.requestId,
          driversNotified: result.driversNotified,
          searchRadius: result.radius,
          estimatedWaitTime: config.DRIVER_RESPONSE_TIMEOUT,
          message: `Found ${result.driversNotified} drivers nearby`,
        });
      } else {
        socket.emit("no_drivers_found", {
          success: false,
          requestId: result.requestId,
          message: result.message,
        });
      }

      logger.info(`User ${userId} requested ride at ${latitude}, ${longitude}`);
    } catch (error) {
      logger.error("Error finding nearby drivers:", error);
      socket.emit("find_drivers_error", {
        message: "Failed to find nearby drivers",
        error: error.message,
      });
    }
  }

  async handleCancelRideRequest(socket, data) {
    try {
      const { requestId, userId, reason } = data;

      if (!requestId || !userId) {
        socket.emit("cancel_ride_error", {
          message: "Missing required fields: requestId, userId",
        });
        return;
      }

      // Get ride request
      const rideRequest = await rideService.getRideRequest(requestId);
      if (!rideRequest) {
        socket.emit("cancel_ride_error", {
          message: "Ride request not found",
        });
        return;
      }

      if (rideRequest.userId !== userId) {
        socket.emit("cancel_ride_error", {
          message: "Unauthorized to cancel this ride request",
        });
        return;
      }

      // Cancel the ride request
      rideRequest.status = "cancelled_by_user";
      rideRequest.cancelledAt = new Date().toISOString();
      rideRequest.cancellationReason = reason || "User cancelled";

      // Update in Redis
      await rideService.redis.hset(
        config.REDIS_KEYS.RIDE_REQUESTS,
        requestId,
        JSON.stringify(rideRequest)
      );

      // Notify all drivers that request was cancelled
      if (rideRequest.notifiedDrivers) {
        await rideService.cancelOtherDriverRequests(
          this.io,
          requestId,
          rideRequest.notifiedDrivers,
          null
        );
      }

      socket.emit("ride_cancelled", {
        success: true,
        requestId,
        message: "Ride request cancelled successfully",
      });

      logger.info(`User ${userId} cancelled ride request ${requestId}`);
    } catch (error) {
      logger.error("Error cancelling ride request:", error);
      socket.emit("cancel_ride_error", {
        message: "Failed to cancel ride request",
        error: error.message,
      });
    }
  }

  async handleExpandSearchRadius(socket, data) {
    try {
      const { requestId, userId } = data;

      // Get current ride request
      const rideRequest = await rideService.getRideRequest(requestId);
      if (!rideRequest || rideRequest.userId !== userId) {
        socket.emit("expand_search_error", {
          message: "Invalid ride request",
        });
        return;
      }

      // Expand search
      const newRadius = Math.min(
        (rideRequest.radius || config.DEFAULT_RADIUS) +
          config.RADIUS_EXPANSION_STEP,
        config.MAX_RADIUS
      );

      const result = await rideService.findAndBroadcastToDrivers(
        this.io,
        {
          userId,
          latitude: rideRequest.userLocation.latitude,
          longitude: rideRequest.userLocation.longitude,
          vehicleType: rideRequest.vehicleType,
        },
        { ...rideRequest, radius: newRadius }
      );

      socket.emit("search_expanded", {
        success: result.success,
        requestId,
        newRadius,
        driversFound: result.driversNotified || 0,
      });
    } catch (error) {
      logger.error("Error expanding search radius:", error);
      socket.emit("expand_search_error", {
        message: "Failed to expand search",
        error: error.message,
      });
    }
  }

  // === COMMON EVENT HANDLERS ===

  async handleGetActiveDriversCount(socket) {
    try {
      const count = await driverService.getActiveDriversCount();
      socket.emit("active_drivers_count", { count });
    } catch (error) {
      logger.error("Error getting active drivers count:", error);
      socket.emit("active_drivers_count", { count: 0, error: error.message });
    }
  }

  handlePing(socket) {
    socket.emit("pong", { timestamp: new Date().toISOString() });
  }

  async handleDisconnect(socket) {
    try {
      logger.info(`Socket disconnected: ${socket.id}`);

      // Check if this was a driver
      const driverId = await driverService.getDriverIdFromSocket(socket.id);
      if (driverId) {
        // Remove driver from system
        await driverService.removeDriver(driverId, socket.id);
        logger.info(`Driver ${driverId} disconnected and removed from system`);
      }
    } catch (error) {
      logger.error("Error handling disconnect:", error);
    }
  }

  // === CLEANUP TASKS ===

  startCleanupTasks() {
    // Cleanup offline drivers every 5 minutes
    setInterval(async () => {
      try {
        await driverService.cleanupOfflineDrivers();
      } catch (error) {
        logger.error("Error in driver cleanup task:", error);
      }
    }, 5 * 60 * 1000);

    // Cleanup old ride requests every 10 minutes
    setInterval(async () => {
      try {
        await rideService.cleanupOldRequests();
      } catch (error) {
        logger.error("Error in ride requests cleanup task:", error);
      }
    }, 10 * 60 * 1000);

    // Log system stats every hour
    setInterval(async () => {
      try {
        const activeDrivers = await driverService.getActiveDriversCount();
        const connectedSockets = this.io.engine.clientsCount;

        logger.info(
          `System Stats - Active Drivers: ${activeDrivers}, Connected Sockets: ${connectedSockets}`
        );
      } catch (error) {
        logger.error("Error logging system stats:", error);
      }
    }, 60 * 60 * 1000);

    logger.info("Cleanup tasks started");
  }
}

module.exports = SocketController;
