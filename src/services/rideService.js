const config = require("../config");
const logger = require("../utils/logger");
const geoService = require("./geoService");
const driverService = require("./driverService");
const redisManager = require("../config/redis");

class RideService {
  constructor() {
    this.activeRequests = new Map();
    // Add local locks for additional protection
    this.processingLocks = new Map();
  }

  // Add getter for Redis client
  get redis() {
    return redisManager.getClient();
  }

  async findAndBroadcastToDrivers(io, userRequest, additionalData = {}) {
    try {
      const { userId, latitude, longitude, vehicleType } = userRequest;
      const requestId = `ride_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      let currentRadius = additionalData.radius || config.DEFAULT_RADIUS;

      logger.info(`Starting ride request ${requestId} for user ${userId}`);

      // Create ride request object
      const rideRequest = {
        requestId,
        userId,
        userLocation: { latitude, longitude },
        vehicleType: vehicleType || "any",
        pickupAddress: additionalData.pickupAddress || "Unknown location",
        dropoffAddress: additionalData.dropoffAddress || "Unknown destination",
        fareEstimate: additionalData.fareEstimate || null,
        radius: currentRadius,
        originalRadius: currentRadius,
        status: "searching",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + config.DRIVER_RESPONSE_TIMEOUT * 1000
        ).toISOString(),
        notifiedDrivers: [],
        responses: {},
        searchAttempts: [],
        // Add version for optimistic locking
        version: 1,
      };

      // Store ride request in Redis with atomic operation
      try {
        const success = await this.redis.hsetnx(
          config.REDIS_KEYS.RIDE_REQUESTS,
          requestId,
          JSON.stringify(rideRequest)
        );

        if (!success) {
          throw new Error("Ride request ID already exists");
        }
      } catch (redisError) {
        logger.error("Redis error storing ride request:", redisError);
        throw new Error("Failed to store ride request");
      }

      // Try to find drivers with radius expansion
      const result = await this.findDriversWithExpansion(io, rideRequest);

      return result;
    } catch (error) {
      logger.error("Error in findAndBroadcastToDrivers:", error);
      throw error;
    }
  }

  async findDriversWithExpansion(io, rideRequest) {
    const { requestId, userId, userLocation, vehicleType } = rideRequest;
    let currentRadius = rideRequest.radius;
    let attempt = 1;
    const maxAttempts = 4;

    while (attempt <= maxAttempts && currentRadius <= config.MAX_RADIUS) {
      logger.info(
        `Search attempt ${attempt} for ${requestId}: radius ${currentRadius}km`
      );

      // Record this search attempt
      rideRequest.searchAttempts.push({
        attempt,
        radius: currentRadius,
        timestamp: new Date().toISOString(),
      });

      // Find nearby drivers
      const nearbyDrivers = await geoService.findNearbyDrivers(
        userLocation.latitude,
        userLocation.longitude,
        currentRadius,
        vehicleType
      );

      logger.debug(
        `Found ${nearbyDrivers.length} drivers within ${currentRadius}km radius`
      );

      if (nearbyDrivers.length > 0) {
        return await this.broadcastToFoundDrivers(
          io,
          rideRequest,
          nearbyDrivers,
          currentRadius
        );
      }

      io.emit("search_expansion", {
        requestId,
        userId,
        currentRadius,
        driversFound: 0,
        searchAttempt: attempt,
        maxAttempts,
        nextRadius: Math.min(
          currentRadius + config.RADIUS_EXPANSION_STEP,
          config.MAX_RADIUS
        ),
        message: `No drivers found within ${currentRadius}km, expanding search...`,
      });

      if (attempt < maxAttempts && currentRadius < config.MAX_RADIUS) {
        currentRadius = Math.min(
          currentRadius + config.RADIUS_EXPANSION_STEP,
          config.MAX_RADIUS
        );
        rideRequest.radius = currentRadius;
        rideRequest.version++;

        // Update ride request atomically
        await this.updateRideRequestAtomic(requestId, rideRequest);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      attempt++;
    }

    // No drivers found after expansion
    rideRequest.status = "no_drivers_found";
    rideRequest.finalRadius = currentRadius;
    rideRequest.searchCompletedAt = new Date().toISOString();
    rideRequest.version++;

    await this.updateRideRequestAtomic(requestId, rideRequest);

    io.emit("no_drivers_found", {
      requestId,
      userId,
      searchRadius: currentRadius,
      maxRadius: config.MAX_RADIUS,
      totalAttempts: attempt - 1,
      message: `No drivers available within ${currentRadius}km radius. Please try again later.`,
    });

    logger.info(
      `No drivers found for ${requestId} after ${
        attempt - 1
      } attempts (max radius: ${currentRadius}km)`
    );

    return {
      success: false,
      requestId,
      message: `No drivers found within ${currentRadius}km radius`,
      driversNotified: 0,
      radius: currentRadius,
      searchAttempts: attempt - 1,
    };
  }

  async broadcastToFoundDrivers(io, rideRequest, nearbyDrivers, finalRadius) {
    const {
      requestId,
      userId,
      userLocation,
      vehicleType,
      pickupAddress,
      dropoffAddress,
      fareEstimate,
    } = rideRequest;

    rideRequest.radius = finalRadius;
    rideRequest.driversFoundAt = new Date().toISOString();

    const driversToNotify = nearbyDrivers.slice(
      0,
      config.MAX_DRIVERS_TO_NOTIFY
    );
    rideRequest.notifiedDrivers = driversToNotify.map((d) => d.driverId);
    rideRequest.version++;

    await this.updateRideRequestAtomic(requestId, rideRequest);

    io.emit("drivers_found", {
      requestId,
      userId,
      driversNotified: driversToNotify.length,
      driversFound: nearbyDrivers.length,
      radius: finalRadius,
      searchAttempts: rideRequest.searchAttempts.length,
      message: `Found ${driversToNotify.length} drivers within ${finalRadius}km`,
    });

    let notificationsSent = 0;
    for (const driver of driversToNotify) {
      try {
        const driverProfile = await driverService.getDriverProfile(
          driver.driverId
        );
        if (driverProfile && driverProfile.socketId) {
          io.to(driverProfile.socketId).emit("new_ride_request", {
            requestId,
            userId,
            userLocation: {
              latitude: userLocation.latitude,
              longitude: userLocation.longitude,
            },
            pickupAddress,
            dropoffAddress,
            fareEstimate,
            distance: driver.distance,
            vehicleType,
            timeout: config.DRIVER_RESPONSE_TIMEOUT,
            searchRadius: finalRadius,
            driverInfo: {
              driverId: driver.driverId,
              currentLocation: {
                latitude: driver.latitude,
                longitude: driver.longitude,
              },
            },
          });
          notificationsSent++;
          logger.info(
            `Notified driver ${driver.driverId} about ride ${requestId} (${driver.distance}km away)`
          );
        }
      } catch (error) {
        logger.error(`Failed to notify driver ${driver.driverId}:`, error);
      }
    }

    setTimeout(async () => {
      try {
        await this.handleRideTimeout(io, requestId);
      } catch (error) {
        logger.error(`Error handling timeout for ${requestId}:`, error);
      }
    }, config.DRIVER_RESPONSE_TIMEOUT * 1000);

    logger.info(
      `Ride request ${requestId} broadcasted to ${notificationsSent} drivers within ${finalRadius}km`
    );

    return {
      success: true,
      requestId,
      driversNotified: notificationsSent,
      radius: finalRadius,
      driversFound: nearbyDrivers.length,
      searchAttempts: rideRequest.searchAttempts.length,
    };
  }

  /**
   * CRITICAL: Handle driver response with atomic Redis operations to prevent race conditions
   */
  async handleDriverResponse(io, responseData) {
    const { requestId, driverId, response, driverLocation } = responseData;

    // Create a local lock key to prevent concurrent processing
    const lockKey = `processing_${requestId}`;

    try {
      // Check if we're already processing this request
      if (this.processingLocks.has(lockKey)) {
        logger.warn(
          `Already processing response for ${requestId}, ignoring duplicate`
        );
        return {
          success: false,
          status: "already_processing",
          message: "Request is being processed",
        };
      }

      // Set local lock
      this.processingLocks.set(lockKey, Date.now());

      // Use Redis distributed lock for additional safety
      const distributedLockKey = `lock:${requestId}`;
      const lockValue = `${Date.now()}_${Math.random()}`;
      const lockTimeout = 5; // 5 seconds

      const lockAcquired = await this.redis.set(
        distributedLockKey,
        lockValue,
        "PX",
        lockTimeout * 1000,
        "NX"
      );

      if (!lockAcquired) {
        logger.warn(`Could not acquire distributed lock for ${requestId}`);
        return {
          success: false,
          status: "lock_failed",
          message: "Could not process request at this time",
        };
      }

      try {
        // Get current ride request state
        const rideRequest = await this.getRideRequest(requestId);
        if (!rideRequest) {
          return {
            success: false,
            status: "request_not_found",
            message: "Ride request not found",
          };
        }

        // Critical check: If already accepted, reject immediately
        if (rideRequest.status === "accepted") {
          logger.info(
            `Driver ${driverId} tried to respond to already accepted ride ${requestId}`
          );

          // Send immediate cancellation to this driver
          const driverProfile = await driverService.getDriverProfile(driverId);
          if (driverProfile && driverProfile.socketId) {
            io.to(driverProfile.socketId).emit("ride_request_cancelled", {
              requestId,
              reason: "Ride already accepted by another driver",
              timestamp: new Date().toISOString(),
            });
          }

          return {
            success: false,
            status: "already_accepted",
            message: "Ride already accepted by another driver",
          };
        }

        if (rideRequest.status !== "searching") {
          return {
            success: false,
            status: "request_closed",
            message: "Ride request is no longer active",
          };
        }

        // Record the response
        rideRequest.responses[driverId] = {
          response,
          timestamp: new Date().toISOString(),
          driverLocation,
        };

        if (response === "accept") {
          // ATOMIC OPERATION: Try to change status to accepted
          rideRequest.status = "accepted";
          rideRequest.acceptedBy = driverId;
          rideRequest.acceptedAt = new Date().toISOString();
          rideRequest.driverLocation = driverLocation;
          rideRequest.version++;

          const estimatedArrival = Math.floor(Math.random() * 10) + 5;
          rideRequest.estimatedArrival = estimatedArrival;

          // Use Redis transaction to ensure atomicity
          const multi = this.redis.multi();

          // Check if status is still "searching" and update atomically
          multi.hget(config.REDIS_KEYS.RIDE_REQUESTS, requestId);
          multi.hset(
            config.REDIS_KEYS.RIDE_REQUESTS,
            requestId,
            JSON.stringify(rideRequest)
          );

          const results = await multi.exec();

          if (!results || !results[0] || !results[0][1]) {
            throw new Error("Ride request disappeared during processing");
          }

          // Double-check the status wasn't changed by another process
          const currentRequestData = JSON.parse(results[0][1]);
          if (
            currentRequestData.status === "accepted" &&
            currentRequestData.acceptedBy !== driverId
          ) {
            logger.warn(
              `Race condition detected: ${requestId} already accepted by ${currentRequestData.acceptedBy}`
            );

            // Send cancellation to this driver
            const driverProfile = await driverService.getDriverProfile(
              driverId
            );
            if (driverProfile && driverProfile.socketId) {
              io.to(driverProfile.socketId).emit("ride_request_cancelled", {
                requestId,
                reason: "Another driver accepted the ride first",
                timestamp: new Date().toISOString(),
              });
            }

            return {
              success: false,
              status: "already_accepted",
              message: "Another driver accepted the ride first",
            };
          }

          // SUCCESS: This driver got the ride
          // Immediately broadcast acceptance to user
          io.emit("ride_accepted", {
            requestId,
            driverId,
            driverLocation,
            estimatedArrival,
            searchRadius: rideRequest.radius,
            searchAttempts: rideRequest.searchAttempts?.length || 1,
            message: "Your ride has been accepted!",
            timestamp: new Date().toISOString(),
          });

          // Cancel other driver requests IMMEDIATELY and asynchronously
          setImmediate(async () => {
            try {
              await this.cancelOtherDriverRequests(
                io,
                requestId,
                rideRequest.notifiedDrivers,
                driverId
              );

              // Update driver status
              await driverService.updateDriverStatus(driverId, "busy");
            } catch (error) {
              logger.error(
                `Error in post-acceptance cleanup for ${requestId}:`,
                error
              );
            }
          });

          logger.info(
            `Ride ${requestId} accepted by driver ${driverId} - ETA: ${estimatedArrival} minutes`
          );

          return {
            success: true,
            status: "accepted",
            estimatedArrival,
            message: "Ride accepted successfully",
          };
        } else if (response === "reject") {
          // Handle rejection
          rideRequest.version++;
          await this.updateRideRequestAtomic(requestId, rideRequest);

          const totalNotified = rideRequest.notifiedDrivers.length;
          const totalResponses = Object.keys(rideRequest.responses).length;

          if (totalResponses >= totalNotified) {
            const acceptedResponses = Object.values(
              rideRequest.responses
            ).filter((r) => r.response === "accept");

            if (acceptedResponses.length === 0) {
              // All drivers rejected
              rideRequest.status = "all_rejected";
              rideRequest.rejectedAt = new Date().toISOString();
              rideRequest.version++;

              await this.updateRideRequestAtomic(requestId, rideRequest);

              io.emit("ride_all_rejected", {
                requestId,
                searchRadius: rideRequest.radius,
                searchAttempts: rideRequest.searchAttempts?.length || 1,
                message:
                  "All nearby drivers are currently busy. Please try again.",
                timestamp: new Date().toISOString(),
              });

              logger.info(`All drivers rejected ride ${requestId}`);
            }
          }

          logger.info(`Driver ${driverId} rejected ride ${requestId}`);
          return { success: true, status: "rejected" };
        }
      } finally {
        // Release distributed lock
        const script = `
          if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("del", KEYS[1])
          else
            return 0
          end
        `;

        await this.redis.eval(script, 1, distributedLockKey, lockValue);
      }
    } catch (error) {
      logger.error("Error handling driver response:", error);
      return { success: false, status: "error", message: error.message };
    } finally {
      // Always release local lock
      this.processingLocks.delete(lockKey);
    }
  }

  /**
   * Atomic update helper to prevent race conditions
   */
  async updateRideRequestAtomic(requestId, rideRequest) {
    try {
      await this.redis.hset(
        config.REDIS_KEYS.RIDE_REQUESTS,
        requestId,
        JSON.stringify(rideRequest)
      );
    } catch (error) {
      logger.error(`Error updating ride request ${requestId}:`, error);
      throw error;
    }
  }

  async getRideRequest(requestId) {
    try {
      const requestData = await this.redis.hget(
        config.REDIS_KEYS.RIDE_REQUESTS,
        requestId
      );
      return requestData ? JSON.parse(requestData) : null;
    } catch (error) {
      logger.error("Error getting ride request:", error);
      return null;
    }
  }

  /**
   * OPTIMIZED: Cancel other driver requests immediately with batch operations
   */
  async cancelOtherDriverRequests(
    io,
    requestId,
    notifiedDrivers,
    acceptingDriverId
  ) {
    try {
      const driversToCancel = notifiedDrivers.filter(
        (driverId) => driverId !== acceptingDriverId
      );

      logger.info(
        `Cancelling ride request ${requestId} for ${driversToCancel.length} other drivers`
      );

      // Use Promise.allSettled for concurrent cancellations
      const cancellationPromises = driversToCancel.map(async (driverId) => {
        try {
          const driverProfile = await driverService.getDriverProfile(driverId);
          if (driverProfile && driverProfile.socketId) {
            io.to(driverProfile.socketId).emit("ride_request_cancelled", {
              requestId,
              reason: "Another driver accepted the ride",
              timestamp: new Date().toISOString(),
            });
            logger.debug(
              `Cancelled request ${requestId} for driver ${driverId}`
            );
            return { success: true, driverId };
          }
          return { success: false, driverId, reason: "Driver not found" };
        } catch (error) {
          logger.error(
            `Failed to cancel request for driver ${driverId}:`,
            error
          );
          return { success: false, driverId, error: error.message };
        }
      });

      const results = await Promise.allSettled(cancellationPromises);
      const successful = results.filter(
        (r) => r.status === "fulfilled" && r.value.success
      ).length;

      logger.info(
        `Successfully cancelled ${successful}/${driversToCancel.length} driver requests for ${requestId}`
      );
    } catch (error) {
      logger.error("Error cancelling other driver requests:", error);
    }
  }

  async handleRideTimeout(io, requestId) {
    try {
      const rideRequest = await this.getRideRequest(requestId);
      if (!rideRequest || rideRequest.status !== "searching") {
        return;
      }

      rideRequest.status = "timeout";
      rideRequest.timeoutAt = new Date().toISOString();
      rideRequest.version++;

      await this.updateRideRequestAtomic(requestId, rideRequest);

      io.emit("ride_request_timeout", {
        requestId,
        searchRadius: rideRequest.radius,
        searchAttempts: rideRequest.searchAttempts?.length || 1,
        message:
          "No drivers responded within the time limit. Please try again.",
        timestamp: new Date().toISOString(),
      });

      await this.cancelOtherDriverRequests(
        io,
        requestId,
        rideRequest.notifiedDrivers,
        null
      );

      logger.info(
        `Ride request ${requestId} timed out after ${
          rideRequest.searchAttempts?.length || 1
        } search attempts`
      );
    } catch (error) {
      logger.error("Error handling ride timeout:", error);
    }
  }

  async cleanupOldRequests() {
    try {
      const allRequests = await this.redis.hgetall(
        config.REDIS_KEYS.RIDE_REQUESTS
      );
      const now = Date.now();
      let cleanedCount = 0;

      for (const [requestId, requestData] of Object.entries(allRequests)) {
        try {
          const request = JSON.parse(requestData);
          const expiryTime = new Date(request.expiresAt).getTime();

          if (now - expiryTime > 10 * 60 * 1000) {
            await this.redis.hdel(config.REDIS_KEYS.RIDE_REQUESTS, requestId);
            cleanedCount++;
          }
        } catch (error) {
          await this.redis.hdel(config.REDIS_KEYS.RIDE_REQUESTS, requestId);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} old ride requests`);
      }
    } catch (error) {
      logger.error("Error cleaning up old requests:", error);
    }
  }

  /**
   * Additional utility method to check request status
   */
  async isRequestStillAvailable(requestId) {
    try {
      const request = await this.getRideRequest(requestId);
      return request && request.status === "searching";
    } catch (error) {
      logger.error(
        `Error checking request availability for ${requestId}:`,
        error
      );
      return false;
    }
  }
}

module.exports = new RideService();
