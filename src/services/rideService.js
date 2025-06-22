const { v4: uuidv4 } = require("uuid");

class RideService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.activeRides = new Map(); // In-memory store for active rides
    this.rideRequests = new Map(); // Pending ride requests
    this.RIDE_KEY_PREFIX = "ride:";
    this.RIDE_REQUEST_TIMEOUT = 60000; // 60 seconds
  }

  async createRideRequest(
    riderId,
    pickupLat,
    pickupLng,
    dropLat,
    dropLng,
    riderSocketId
  ) {
    const rideId = uuidv4();
    const rideRequest = {
      rideId,
      riderId,
      riderSocketId,
      pickup: { lat: pickupLat, lng: pickupLng },
      drop: { lat: dropLat, lng: dropLng },
      status: "pending",
      createdAt: Date.now(),
      assignedDrivers: new Set(), // Track which drivers have been notified
      acceptedBy: null,
    };

    // Store in memory
    this.rideRequests.set(rideId, rideRequest);

    // Store in Redis with expiration
    await this.redis.setEx(
      `${this.RIDE_KEY_PREFIX}${rideId}`,
      300, // 5 minutes expiration
      JSON.stringify({
        ...rideRequest,
        assignedDrivers: Array.from(rideRequest.assignedDrivers),
      })
    );

    // Set timeout to auto-cancel ride if not accepted
    setTimeout(() => {
      this.cancelRideRequest(rideId, "timeout");
    }, this.RIDE_REQUEST_TIMEOUT);

    console.log(`Ride request created: ${rideId}`);
    return rideRequest;
  }

  async acceptRide(rideId, driverId, driverSocketId) {
    try {
      const rideRequest = this.rideRequests.get(rideId);

      if (!rideRequest) {
        return {
          success: false,
          message: "Ride not found or already accepted",
        };
      }

      if (rideRequest.status !== "pending") {
        return { success: false, message: "Ride is no longer available" };
      }

      // Lock the ride
      rideRequest.status = "accepted";
      rideRequest.acceptedBy = driverId;
      rideRequest.driverSocketId = driverSocketId;
      rideRequest.acceptedAt = Date.now();

      // Move from requests to active rides
      this.activeRides.set(rideId, rideRequest);
      this.rideRequests.delete(rideId);

      // Update in Redis
      await this.redis.setEx(
        `${this.RIDE_KEY_PREFIX}${rideId}`,
        3600, // 1 hour expiration for active rides
        JSON.stringify({
          ...rideRequest,
          assignedDrivers: Array.from(rideRequest.assignedDrivers),
        })
      );

      console.log(`Ride ${rideId} accepted by driver ${driverId}`);
      return {
        success: true,
        message: "Ride accepted successfully",
        ride: rideRequest,
      };
    } catch (error) {
      console.error("Error accepting ride:", error);
      return { success: false, message: "Failed to accept ride" };
    }
  }

  async cancelRideRequest(rideId, reason = "user_cancelled") {
    try {
      const rideRequest =
        this.rideRequests.get(rideId) || this.activeRides.get(rideId);

      if (!rideRequest) {
        return { success: false, message: "Ride not found" };
      }

      // Update status
      rideRequest.status = "cancelled";
      rideRequest.cancelledAt = Date.now();
      rideRequest.cancelReason = reason;

      // Remove from active collections
      this.rideRequests.delete(rideId);
      this.activeRides.delete(rideId);

      // Update in Redis
      await this.redis.setEx(
        `${this.RIDE_KEY_PREFIX}${rideId}`,
        86400, // Keep cancelled rides for 24 hours
        JSON.stringify({
          ...rideRequest,
          assignedDrivers: Array.from(rideRequest.assignedDrivers),
        })
      );

      console.log(`Ride ${rideId} cancelled: ${reason}`);
      return {
        success: true,
        message: "Ride cancelled successfully",
        ride: rideRequest,
      };
    } catch (error) {
      console.error("Error cancelling ride:", error);
      return { success: false, message: "Failed to cancel ride" };
    }
  }

  async completeRide(rideId) {
    try {
      const ride = this.activeRides.get(rideId);

      if (!ride) {
        return { success: false, message: "Active ride not found" };
      }

      ride.status = "completed";
      ride.completedAt = Date.now();

      // Remove from active rides
      this.activeRides.delete(rideId);

      // Update in Redis
      await this.redis.setEx(
        `${this.RIDE_KEY_PREFIX}${rideId}`,
        86400, // Keep completed rides for 24 hours
        JSON.stringify({
          ...ride,
          assignedDrivers: Array.from(ride.assignedDrivers),
        })
      );

      console.log(`Ride ${rideId} completed`);
      return {
        success: true,
        message: "Ride completed successfully",
        ride,
      };
    } catch (error) {
      console.error("Error completing ride:", error);
      return { success: false, message: "Failed to complete ride" };
    }
  }

  getRideRequest(rideId) {
    return this.rideRequests.get(rideId);
  }

  getActiveRide(rideId) {
    return this.activeRides.get(rideId);
  }

  getAllPendingRequests() {
    return Array.from(this.rideRequests.values());
  }

  getAllActiveRides() {
    return Array.from(this.activeRides.values());
  }

  addAssignedDriver(rideId, driverId) {
    const rideRequest = this.rideRequests.get(rideId);
    if (rideRequest) {
      rideRequest.assignedDrivers.add(driverId);
      return true;
    }
    return false;
  }

  hasDriverBeenAssigned(rideId, driverId) {
    const rideRequest = this.rideRequests.get(rideId);
    return rideRequest ? rideRequest.assignedDrivers.has(driverId) : false;
  }

  // Calculate estimated fare (basic calculation)
  calculateFare(pickupLat, pickupLng, dropLat, dropLng) {
    const distance = this.calculateDistance(
      pickupLat,
      pickupLng,
      dropLat,
      dropLng
    );
    const baseFare = 50; // Base fare in currency units
    const perKmRate = 15; // Rate per km
    return Math.round(baseFare + distance * perKmRate);
  }

  // Calculate distance using Haversine formula
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
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
}

module.exports = RideService;
