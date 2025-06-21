const config = require("../config");
const logger = require("../utils/logger");
const geoService = require("./geoService");
const driverService = require("./driverService");
const redisManager = require("../config/redis");

class RideService {
  constructor() {
    this.activeRequests = new Map();
    this.processingLocks = new Map();
  }

  get redis() {
    return redisManager.getClient();
  }

  /**
   * Check if user already has an active ride request
   */
  async getUserActiveRequest(userId) {
    try {
      const activeRequestId = await this.redis.hget(
        config.REDIS_KEYS.USER_ACTIVE_REQUESTS,
        userId
      );
      
      if (activeRequestId) {
        // Verify the request still exists and is active
        const requestData = await this.redis.hget(
          config.REDIS_KEYS.RIDE_REQUESTS,
          activeRequestId
        );
        
        if (requestData) {
          const request = JSON.parse(requestData);
          if (['searching', 'accepted'].includes(request.status)) {
            return { requestId: activeRequestId, request };
          } else {
            // Clean up stale reference
            await this.redis.hdel(config.REDIS_KEYS.USER_ACTIVE_REQUESTS, userId);
          }
        } else {
          // Clean up stale reference
          await this.redis.hdel(config.REDIS_KEYS.USER_ACTIVE_REQUESTS, userId);
        }
      }
      
      return null;
    } catch (error) {
      logger.error(`Error checking user active request for ${userId}:`, error);
      return null;
    }
  }

  /**
   * Check if driver is currently busy/assigned
   */
  async getDriverActiveRide(driverId) {
    try {
      const activeRideId = await this.redis.hget(
        config.REDIS_KEYS.DRIVER_ACTIVE_RIDES,
        driverId
      );
      
      if (activeRideId) {
        // Verify the ride still exists and driver is assigned
        const rideData = await this.redis.hget(
          config.REDIS_KEYS.RIDE_REQUESTS,
          activeRideId
        );
        
        if (rideData) {
          const ride = JSON.parse(rideData);
          if (ride.status === 'accepted' && ride.acceptedBy === driverId) {
            return { rideId: activeRideId, ride };
          } else {
            // Clean up stale reference
            await this.redis.hdel(config.REDIS_KEYS.DRIVER_ACTIVE_RIDES, driverId);
          }
        } else {
          // Clean up stale reference
          await this.redis.hdel(config.REDIS_KEYS.DRIVER_ACTIVE_RIDES, driverId);
        }
      }
      
      return null;
    } catch (error) {
      logger.error(`Error checking driver active ride for ${driverId}:`, error);
      return null;
    }
  }

  async findAndBroadcastToDrivers(io, userRequest, additionalData = {}) {
    try {
      const { userId, latitude, longitude, vehicleType } = userRequest;
      
      // CRITICAL CHECK: Prevent multiple requests from same user
      const existingRequest = await this.getUserActiveRequest(userId);
      if (existingRequest) {
        logger.warn(`User ${userId} already has active request ${existingRequest.requestId}`);
        return {
          success: false,
          error: "ACTIVE_REQUEST_EXISTS",
          message: "You already have an active ride request",
          existingRequestId: existingRequest.requestId,
          existingRequest: existingRequest.request
        };
      }

      const requestId = `ride_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      let currentRadius = additionalData.radius || config.DEFAULT_RADIUS;

      logger.info(`Starting ride request ${requestId} for user ${userId}`);

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
        version: 1
      };

      // ATOMIC OPERATION: Store ride request and user mapping together
      const multi = this.redis.multi();
      
      // Store the ride request
      multi.hsetnx(
        config.REDIS_KEYS.RIDE_REQUESTS,
        requestId,
        JSON.stringify(rideRequest)
      );
      
      // Link user to this request
      multi.hset(
        config.REDIS_KEYS.USER_ACTIVE_REQUESTS,
        userId,
        requestId
      );
      
      // Set expiration for user request mapping
      multi.expire(
        config.REDIS_KEYS.USER_ACTIVE_REQUESTS,
        config.DRIVER_RESPONSE_TIMEOUT + 60 // Extra buffer
      );
      
      const results = await multi.exec();
      
      if (!results || !results[0] || !results[0][1]) {
        throw new Error("Failed to create ride request - ID collision");
      }

      try {
        const result = await this.findDriversWithExpansion(io, rideRequest);
        return result;
      } catch (error) {
        // If search fails, clean up user mapping
        await this.redis.hdel(config.REDIS_KEYS.USER_ACTIVE_REQUESTS, userId);
        throw error;
      }

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

      rideRequest.searchAttempts.push({
        attempt,
        radius: currentRadius,
        timestamp: new Date().toISOString(),
      });

      // Find nearby drivers and filter out busy ones
      const nearbyDrivers = await this.findAvailableDrivers(
        userLocation.latitude,
        userLocation.longitude,
        currentRadius,
        vehicleType
      );

      logger.debug(
        `Found ${nearbyDrivers.length} available drivers within ${currentRadius}km radius`
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
        message: `No available drivers found within ${currentRadius}km, expanding search...`,
      });

      if (attempt < maxAttempts && currentRadius < config.MAX_RADIUS) {
        currentRadius = Math.min(
          currentRadius + config.RADIUS_EXPANSION_STEP,
          config.MAX_RADIUS
        );
        rideRequest.radius = currentRadius;
        rideRequest.version++;

        await this.updateRideRequestAtomic(requestId, rideRequest);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      attempt++;
    }

    // No drivers found - clean up user mapping
    await this.cleanupFailedRequest(rideRequest.userId, requestId);

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
      `No drivers found for ${requestId} after ${attempt - 1} attempts (max radius: ${currentRadius}km)`
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

  /**
   * Find available drivers (not busy with other rides)
   */
  async findAvailableDrivers(latitude, longitude, radiusKm, vehicleType) {
    try {
      // Get all nearby drivers from geo service
      const nearbyDrivers = await geoService.findNearbyDrivers(
        latitude,
        longitude,
        radiusKm,
        vehicleType
      );

      // Filter out drivers who are currently assigned to rides
      const availableDrivers = [];
      
      for (const driver of nearbyDrivers) {
        const activeRide = await this.getDriverActiveRide(driver.driverId);
        if (!activeRide) {
          // Double-check driver status from driver service
          const driverProfile = await driverService.getDriverProfile(driver.driverId);
          if (driverProfile && driverProfile.status === 'available' && driverProfile.isOnline) {
            availableDrivers.push(driver);
          } else {
            logger.debug(`Driver ${driver.driverId} is not available: status=${driverProfile?.status}, online=${driverProfile?.isOnline}`);
          }
        } else {
          logger.debug(`Driver ${driver.driverId} is busy with ride ${activeRide.rideId}`);
        }
      }

      logger.debug(`Filtered ${nearbyDrivers.length} nearby drivers to ${availableDrivers.length} available drivers`);
      return availableDrivers;
      
    } catch (error) {
      logger.error("Error finding available drivers:", error);
      return [];
    }
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
      message: `Found ${driversToNotify.length} available drivers within ${finalRadius}km`,
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
   * ENHANCED: Handle driver response with busy driver prevention
   */
  async handleDriverResponse(io, responseData) {
    const { requestId, driverId, response, driverLocation } = responseData;
    
    const lockKey = `processing_${requestId}`;
    
    try {
      // CRITICAL CHECK: Ensure driver is not already busy
      if (response === "accept") {
        const driverActiveRide = await this.getDriverActiveRide(driverId);
        if (driverActiveRide) {
          logger.warn(`Driver ${driverId} tried to accept ride ${requestId} but is already assigned to ${driverActiveRide.rideId}`);
          
          // Send immediate rejection to driver
          const driverProfile = await driverService.getDriverProfile(driverId);
          if (driverProfile && driverProfile.socketId) {
            io.to(driverProfile.socketId).emit("ride_request_cancelled", {
              requestId,
              reason: "You are already assigned to another ride",
              timestamp: new Date().toISOString(),
            });
          }
          
          return {
            success: false,
            status: "driver_busy",
            message: "Driver is already assigned to another ride",
          };
        }
      }

      if (this.processingLocks.has(lockKey)) {
        logger.warn(`Already processing response for ${requestId}, ignoring duplicate`);
        return {
          success: false,
          status: "already_processing",
          message: "Request is being processed"
        };
      }
      
      this.processingLocks.set(lockKey, Date.now());
      
      const distributedLockKey = `lock:${requestId}`;
      const lockValue = `${Date.now()}_${Math.random()}`;
      const lockTimeout = 5;
      
      const lockAcquired = await this.redis.set(
        distributedLockKey,
        lockValue,
        'PX',
        lockTimeout * 1000,
        'NX'
      );
      
      if (!lockAcquired) {
        logger.warn(`Could not acquire distributed lock for ${requestId}`);
        return {
          success: false,
          status: "lock_failed",
          message: "Could not process request at this time"
        };
      }

      try {
        const rideRequest = await this.getRideRequest(requestId);
        if (!rideRequest) {
          return {
            success: false,
            status: "request_not_found",
            message: "Ride request not found",
          };
        }

        if (rideRequest.status === "accepted") {
          logger.info(
            `Driver ${driverId} tried to respond to already accepted ride ${requestId}`
          );
          
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

        rideRequest.responses[driverId] = {
          response,
          timestamp: new Date().toISOString(),
          driverLocation,
        };

        if (response === "accept") {
          // ATOMIC OPERATION: Update ride status and assign driver
          rideRequest.status = "accepted";
          rideRequest.acceptedBy = driverId;
          rideRequest.acceptedAt = new Date().toISOString();
          rideRequest.driverLocation = driverLocation;
          rideRequest.version++;

          const estimatedArrival = Math.floor(Math.random() * 10) + 5;
          rideRequest.estimatedArrival = estimatedArrival;

          // CRITICAL: Atomic operation to assign driver and update ride
          const multi = this.redis.multi();
          
          // Check current ride status
          multi.hget(config.REDIS_KEYS.RIDE_REQUESTS, requestId);
          
          // Update ride request
          multi.hset(
            config.REDIS_KEYS.RIDE_REQUESTS,
            requestId,
            JSON.stringify(rideRequest)
          );
          
          // Assign driver to this ride
          multi.hset(
            config.REDIS_KEYS.DRIVER_ACTIVE_RIDES,
            driverId,
            requestId
          );
          
          const results = await multi.exec();
          
          if (!results || !results[0] || !results[0][1]) {
            throw new Error("Ride request disappeared during processing");
          }
          
          const currentRequestData = JSON.parse(results[0][1]);
          if (currentRequestData.status === "accepted" && currentRequestData.acceptedBy !== driverId) {
            logger.warn(`Race condition detected: ${requestId} already accepted by ${currentRequestData.acceptedBy}`);
            
            // Clean up this driver's assignment
            await this.redis.hdel(config.REDIS_KEYS.DRIVER_ACTIVE_RIDES, driverId);
            
            const driverProfile = await driverService.getDriverProfile(driverId);
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

          // SUCCESS: Ride assigned to this driver
          io.emit("ride_accepted", {
            requestId,
            userId: rideRequest.userId,
            driverId,
            driverLocation,
            estimatedArrival,
            searchRadius: rideRequest.radius,
            searchAttempts: rideRequest.searchAttempts?.length || 1,
            message: "Your ride has been accepted!",
            timestamp: new Date().toISOString(),
          });

          // Immediate cleanup
          setImmediate(async () => {
            try {
              await this.cancelOtherDriverRequests(
                io,
                requestId,
                rideRequest.notifiedDrivers,
                driverId
              );
              
              await driverService.updateDriverStatus(driverId, "busy");
            } catch (error) {
              logger.error(`Error in post-acceptance cleanup for ${requestId}:`, error);
            }
          });

          logger.info(
            `Ride ${requestId} accepted by driver ${driverId} - ETA: ${estimatedArrival} minutes`
          );
          
          return { 
            success: true, 
            status: "accepted", 
            estimatedArrival,
            message: "Ride accepted successfully"
          };
          
        } else if (response === "reject") {
          rideRequest.version++;
          await this.updateRideRequestAtomic(requestId, rideRequest);

          const totalNotified = rideRequest.notifiedDrivers.length;
          const totalResponses = Object.keys(rideRequest.responses).length;

          if (totalResponses >= totalNotified) {
            const acceptedResponses = Object.values(rideRequest.responses).filter(
              (r) => r.response === "accept"
            );

            if (acceptedResponses.length === 0) {
              // All drivers rejected - clean up user mapping
              await this.cleanupFailedRequest(rideRequest.userId, requestId);
              
              rideRequest.status = "all_rejected";
              rideRequest.rejectedAt = new Date().toISOString();
              rideRequest.version++;

              await this.updateRideRequestAtomic(requestId, rideRequest);

              io.emit("ride_all_rejected", {
                requestId,
                userId: rideRequest.userId,
                searchRadius: rideRequest.radius,
                searchAttempts: rideRequest.searchAttempts?.length || 1,
                message: "All nearby drivers are currently busy. Please try again.",
                timestamp: new Date().toISOString(),
              });

              logger.info(`All drivers rejected ride ${requestId}`);
            }
          }

          logger.info(`Driver ${driverId} rejected ride ${requestId}`);
          return { success: true, status: "rejected" };
        }
        
      } finally {
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
      this.processingLocks.delete(lockKey);
    }
  }

  /**
   * Complete a ride and free up user and driver
   */
  async completeRide(requestId, driverId, userId) {
    try {
      const multi = this.redis.multi();
      
      // Update ride status
      const rideRequest = await this.getRideRequest(requestId);
      if (rideRequest) {
        rideRequest.status = "completed";
        rideRequest.completedAt = new Date().toISOString();
        
        multi.hset(
          config.REDIS_KEYS.RIDE_REQUESTS,
          requestId,
          JSON.stringify(rideRequest)
        );
      }
      
      // Free up user and driver
      multi.hdel(config.REDIS_KEYS.USER_ACTIVE_REQUESTS, userId);
      multi.hdel(config.REDIS_KEYS.DRIVER_ACTIVE_RIDES, driverId);
      
      await multi.exec();
      
      // Update driver status back to available
      await driverService.updateDriverStatus(driverId, "available");
      
      logger.info(`Ride ${requestId} completed - User ${userId} and Driver ${driverId} are now free`);
      
      return { success: true };
    } catch (error) {
      logger.error(`Error completing ride ${requestId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel a ride and free up resources
   */
  async cancelRide(requestId, reason = "User cancelled") {
    try {
      const rideRequest = await this.getRideRequest(requestId);
      if (!rideRequest) {
        return { success: false, message: "Ride not found" };
      }

      const multi = this.redis.multi();
      
      // Update ride status
      rideRequest.status = "cancelled";
      rideRequest.cancelledAt = new Date().toISOString();
      rideRequest.cancelReason = reason;
      
      multi.hset(
        config.REDIS_KEYS.RIDE_REQUESTS,
        requestId,
        JSON.stringify(rideRequest)
      );
      
      // Free up user
      multi.hdel(config.REDIS_KEYS.USER_ACTIVE_REQUESTS, rideRequest.userId);
      
      // If driver was assigned, free them up
      if (rideRequest.acceptedBy) {
        multi.hdel(config.REDIS_KEYS.DRIVER_ACTIVE_RIDES, rideRequest.acceptedBy);
      }
      
      await multi.exec();
      
      // Update driver status if assigned
      if (rideRequest.acceptedBy) {
        await driverService.updateDriverStatus(rideRequest.acceptedBy, "available");
      }
      
      logger.info(`Ride ${requestId} cancelled: ${reason}`);
      
      return { success: true };
    } catch (error) {
      logger.error(`Error cancelling ride ${requestId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up failed request mappings
   */
  async cleanupFailedRequest(userId, requestId) {
    try {
      await this.redis.hdel(config.REDIS_KEYS.USER_ACTIVE_REQUESTS, userId);
      logger.debug(`Cleaned up failed request mapping for user ${userId}, request ${requestId}`);
    } catch (error) {
      logger.error(`Error cleaning up failed request for user ${userId}:`, error);
    }
  }

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

      const cancellationPromises = driversToCancel.map(async (driverId) => {
        try {
          const driverProfile = await driverService.getDriverProfile(driverId);
          if (driverProfile && driverProfile.socketId) {
            io.to(driverProfile.socketId).emit("ride_request_cancelled", {
              requestId,
              reason: "Another driver accepted the ride",
              timestamp: new Date().toISOString(),
            });
            logger.debug(`Cancelled request ${requestId} for driver ${driverId}`);
            return { success: true, driverId };
          }
          return { success: false, driverId, reason: "Driver not found" };
        } catch (error) {
          logger.error(`Failed to cancel request for driver ${driverId}:`, error);
          return { success: false, driverId, error: error.message };
        }
      });

      const results = await Promise.allSettled(cancellationPromises);
      const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
      
      logger.info(`Successfully cancelled ${successful}/${driversToCancel.length} driver requests for ${requestId}`);
      
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

      // Clean up user mapping on timeout
      await this.cleanupFailedRequest(rideRequest.userId, requestId);

      rideRequest.status = "timeout";
      rideRequest.timeoutAt = new Date().toISOString();
      rideRequest.version++;

      await this.updateRideRequestAtomic(requestId, rideRequest);

      io.emit("ride_request_timeout", {
        requestId,
        userId: rideRequest.userId,
        searchRadius: rideRequest.radius,
        searchAttempts: rideRequest.searchAttempts?.length || 1,
        message: "No drivers responded within the time limit. Please try again.",
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
