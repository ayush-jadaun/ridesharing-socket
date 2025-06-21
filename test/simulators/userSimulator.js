const { io } = require("socket.io-client");

class UserSimulator {
  constructor(serverUrl = "http://localhost:3000") {
    // CHANGED FROM 5000 to 3000
    this.serverUrl = serverUrl;
    this.activeRequests = new Set();
  }

  async simulateRideRequest(userData, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      // Prevent duplicate requests
      if (this.activeRequests.has(userData.userId)) {
        console.log(`⚠️  Request already active for ${userData.userName}`);
        resolve({ status: "duplicate_request", userId: userData.userId });
        return;
      }

      this.activeRequests.add(userData.userId);

      // Create socket connection
      const socket = io(this.serverUrl, {
        timeout: 10000,
        forceNew: true,
      });

      const startTime = Date.now();
      let resolved = false;

      const cleanup = () => {
        this.activeRequests.delete(userData.userId);
        if (socket && socket.connected) {
          socket.disconnect();
        }
      };

      const resolveOnce = (result) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(result);
        }
      };

      // Timeout handler
      const timeout = setTimeout(() => {
        console.log(`⏰ Request timeout for ${userData.userName}`);
        resolveOnce({
          status: "timeout",
          userId: userData.userId,
          responseTime: Date.now() - startTime,
        });
      }, timeoutMs);

      // Socket event handlers
      socket.on("connect", () => {
        console.log(`👤 User ${userData.userName} requesting ride...`);

        socket.emit("find_nearby_drivers", {
          userId: userData.userId,
          latitude: userData.location.latitude,
          longitude: userData.location.longitude,
          vehicleType: userData.vehicleType || "any",
          userName: userData.userName,
          pickupAddress: userData.pickupAddress || "Test Pickup Location",
          dropoffAddress: userData.dropoffAddress || "Test Destination",
        });
      });

      // FIXED: Handle duplicate request error
      socket.on("duplicate_request_error", (data) => {
        console.log(
          `⚠️ ${userData.userName} already has active request: ${data.existingRequestId}`
        );
        clearTimeout(timeout);
        resolveOnce({
          status: "duplicate_request",
          userId: userData.userId,
          existingRequestId: data.existingRequestId,
          responseTime: Date.now() - startTime,
        });
      });

      // FIXED: Handle search expansion with proper data
      socket.on("search_expansion", (data) => {
        const current =
          data.currentRadius !== undefined ? data.currentRadius : "?";
        const next = data.nextRadius !== undefined ? data.nextRadius : "?";
        const attempt =
          data.searchAttempt !== undefined ? data.searchAttempt : "?";
        const maxAttempts =
          data.maxAttempts !== undefined ? data.maxAttempts : "?";

        console.log(
          `🔍 Expanding search for ${userData.userName}: ${current}km → ${next}km (attempt ${attempt}/${maxAttempts})`
        );
      });

      // FIXED: Handle drivers found with proper data
      socket.on("drivers_found", (data) => {
        const radius = data.radius !== undefined ? data.radius : "unknown";
        const attempts =
          data.searchAttempts !== undefined ? data.searchAttempts : "unknown";
        const responseTime = Date.now() - startTime;

        console.log(
          `🎯 Found ${data.driversNotified} drivers for ${userData.userName} (${radius}km radius, ${attempts} attempts, ${responseTime}ms)`
        );
      });

      // FIXED: Handle no drivers found with proper data
      socket.on("no_drivers_found", (data) => {
        const radius =
          data.searchRadius !== undefined ? data.searchRadius : "0";
        const attempts =
          data.totalAttempts !== undefined ? data.totalAttempts : "unknown";
        const responseTime = Date.now() - startTime;

        console.log(
          `😞 No drivers found for ${userData.userName} within ${radius}km after ${attempts} attempts (${responseTime}ms)`
        );
        clearTimeout(timeout);
        resolveOnce({
          status: "no_drivers",
          userId: userData.userId,
          searchRadius: data.searchRadius,
          maxRadius: data.maxRadius,
          totalAttempts: data.totalAttempts,
          responseTime: responseTime,
        });
      });

      socket.on("ride_accepted", (data) => {
        const responseTime = Date.now() - startTime;
        console.log(
          `🎉 Ride accepted for ${userData.userName} by driver ${data.driverId} - ETA: ${data.estimatedArrival}min (${responseTime}ms total)`
        );

        clearTimeout(timeout);
        resolveOnce({
          status: "accepted",
          userId: userData.userId,
          acceptedBy: data.driverId,
          estimatedArrival: data.estimatedArrival,
          searchRadius: data.searchRadius,
          searchAttempts: data.searchAttempts,
          responseTime: responseTime,
          requestId: data.requestId,
        });
      });

      socket.on("ride_all_rejected", (data) => {
        const responseTime = Date.now() - startTime;
        console.log(`😔 All drivers rejected ride for ${userData.userName}`);
        clearTimeout(timeout);
        resolveOnce({
          status: "all_rejected",
          userId: userData.userId,
          searchRadius: data.searchRadius,
          searchAttempts: data.searchAttempts,
          responseTime: responseTime,
          requestId: data.requestId,
        });
      });

      socket.on("ride_request_timeout", (data) => {
        const responseTime = Date.now() - startTime;
        console.log(`⏰ Ride request timed out for ${userData.userName}`);
        clearTimeout(timeout);
        resolveOnce({
          status: "server_timeout",
          userId: userData.userId,
          searchRadius: data.searchRadius,
          searchAttempts: data.searchAttempts,
          responseTime: responseTime,
          requestId: data.requestId,
        });
      });

      socket.on("find_drivers_error", (data) => {
        console.log(
          `❌ Find drivers error for ${userData.userName}: ${data.message}`
        );
        clearTimeout(timeout);
        resolveOnce({
          status: "find_drivers_error",
          userId: userData.userId,
          error: data.message,
          responseTime: Date.now() - startTime,
        });
      });

      socket.on("connect_error", (error) => {
        console.log(
          `❌ Connection error for ${userData.userName}:`,
          error.message
        );
        clearTimeout(timeout);
        resolveOnce({
          status: "connection_error",
          userId: userData.userId,
          error: error.message,
        });
      });

      socket.on("disconnect", (reason) => {
        if (!resolved) {
          console.log(`🔌 ${userData.userName} disconnected: ${reason}`);
          clearTimeout(timeout);
          resolveOnce({
            status: "disconnected",
            userId: userData.userId,
            reason: reason,
            responseTime: Date.now() - startTime,
          });
        }
      });

      socket.on("error", (error) => {
        console.log(`❌ Socket error for ${userData.userName}:`, error.message);
        clearTimeout(timeout);
        resolveOnce({
          status: "socket_error",
          userId: userData.userId,
          error: error.message,
        });
      });
    });
  }

  async simulateMultipleRequests(
    numberOfUsers = 3,
    delayBetweenRequests = 5000
  ) {
    const users = [
      {
        id: "user_001",
        name: "Ayush Sharma",
        location: { latitude: 28.6139, longitude: 77.209 }, // Central Delhi
        vehicleType: "car",
        pickupAddress: "Central Delhi",
        dropoffAddress: "Connaught Place",
      },
      {
        id: "user_002",
        name: "Neha Gupta",
        location: { latitude: 28.5355, longitude: 77.391 }, // Noida
        vehicleType: "any",
        pickupAddress: "Noida Sector 18",
        dropoffAddress: "India Gate",
      },
      {
        id: "user_003",
        name: "Rohit Kumar",
        location: { latitude: 28.48, longitude: 77.08 }, // Closer to Gurgaon
        vehicleType: "car",
        pickupAddress: "Gurgaon",
        dropoffAddress: "Red Fort",
      },
    ];

    const results = [];

    console.log(
      `🚀 Starting ${numberOfUsers} ride requests with ${delayBetweenRequests}ms delay...`
    );

    // FIXED: Use different users for concurrent requests to prevent duplicate user IDs
    for (let i = 0; i < numberOfUsers && i < users.length; i++) {
      const user = users[i]; // Use different user for each request

      try {
        console.log(`\n--- Request ${i + 1}/${numberOfUsers} ---`);

        const result = await this.simulateRideRequest({
          userId: user.id,
          userName: user.name,
          location: user.location,
          vehicleType: user.vehicleType,
          pickupAddress: user.pickupAddress,
          dropoffAddress: user.dropoffAddress,
        });

        console.log(`✅ Request ${i + 1} completed: ${result.status}`);
        results.push(result);

        // Wait between requests (except for the last one)
        if (i < numberOfUsers - 1) {
          console.log(
            `⏳ Waiting ${delayBetweenRequests / 1000}s before next request...`
          );
          await this.sleep(delayBetweenRequests);
        }
      } catch (error) {
        console.error(`❌ Request ${i + 1} failed:`, error.message);
        results.push({
          status: "error",
          userId: user.id,
          error: error.message,
        });
      }
    }

    return results;
  }

  // ADDED: Method for concurrent requests with unique user IDs
  async simulateConcurrentRequests(numberOfUsers = 3) {
    const users = [
      {
        id: "user_concurrent_001", // Unique IDs for concurrent tests
        name: "Ayush Sharma",
        location: { latitude: 28.6139, longitude: 77.209 },
        vehicleType: "car",
        pickupAddress: "Central Delhi",
        dropoffAddress: "Connaught Place",
      },
      {
        id: "user_concurrent_002",
        name: "Neha Gupta",
        location: { latitude: 28.5355, longitude: 77.391 },
        vehicleType: "any",
        pickupAddress: "Noida Sector 18",
        dropoffAddress: "India Gate",
      },
      {
        id: "user_concurrent_003",
        name: "Rohit Kumar",
        location: { latitude: 28.48, longitude: 77.08 },
        vehicleType: "car",
        pickupAddress: "Gurgaon",
        dropoffAddress: "Red Fort",
      },
    ];

    console.log(`⚡ Starting ${numberOfUsers} concurrent ride requests...`);

    const promises = users.slice(0, numberOfUsers).map((user, index) => {
      console.log(`--- Concurrent Ride ${index + 1}/${numberOfUsers} ---`);

      return this.simulateRideRequest({
        userId: user.id,
        userName: user.name,
        location: user.location,
        vehicleType: user.vehicleType,
        pickupAddress: user.pickupAddress,
        dropoffAddress: user.dropoffAddress,
      });
    });

    try {
      const results = await Promise.all(promises);
      return results;
    } catch (error) {
      console.error("Error in concurrent requests:", error);
      return [];
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = UserSimulator;
