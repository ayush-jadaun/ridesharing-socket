const {
  driverOnline,
  driverOffline,
} = require("../controllers/driverController");
const {
  createRideRequest,
  getNearbyDrivers,
} = require("../controllers/riderController");
const { tryAcceptRide, getRideStatus } = require("../services/matchService");
const {
  SEARCH_INITIAL_RADIUS,
  SEARCH_RADIUS_INCREMENT,
  SEARCH_TIMEOUT,
} = require("../utils/constants");

module.exports = (io) => {
  // Maps for in-memory session tracking
  const driverSockets = new Map();
  const rideToRider = new Map();

  io.on("connection", (socket) => {
    // DRIVER FLOW
    socket.on("driver:online", async ({ driverId, lng, lat }) => {
      driverSockets.set(driverId, socket);
      await driverOnline(driverId, lng, lat);
      // Optionally send current ride requests here
      socket.emit("driver:status", { status: "online" });
    });

    socket.on("driver:offline", async ({ driverId }) => {
      driverSockets.delete(driverId);
      await driverOffline(driverId);
      socket.emit("driver:status", { status: "offline" });
    });

    socket.on("driver:updateLocation", async ({ driverId, lng, lat }) => {
      await driverOnline(driverId, lng, lat);
    });

    // RIDER FLOW
    socket.on("rider:requestRide", async ({ pickup, drop, riderId }) => {
      const rideId = await createRideRequest(pickup, drop);
      rideToRider.set(rideId, { socket, riderId, pickup, drop });

      // Start matching process
      let radius = SEARCH_INITIAL_RADIUS;
      let found = false;
      let timerStart = Date.now();

      async function broadcastRide() {
        const nearbyDrivers = await getNearbyDrivers(pickup, radius);
        if (!nearbyDrivers.length){
          console.log("No nearby drivers")
          return;
        }  // No drivers to broadcast

        // Broadcast to all nearby drivers
        for (const driverId of nearbyDrivers) {
          const drvSock = driverSockets.get(driverId);
          if (drvSock) {
            drvSock.emit("ride:request", { rideId, pickup, drop, riderId });
          }
        }
      }

      await broadcastRide();

      // Timer: If no driver accepted in 1 minute, extend by 3km and repeat
      const interval = setInterval(async () => {
        const status = await getRideStatus(rideId);
        if (status !== "pending") {
          clearInterval(interval);
          return;
        }
        if (Date.now() - timerStart >= SEARCH_TIMEOUT) {
          radius += SEARCH_RADIUS_INCREMENT;
          timerStart = Date.now();
          await broadcastRide();
        }
      }, 5000); // Check every 5s

      socket.emit("rider:rideCreated", { rideId });
    });

    // DRIVER ACCEPTS RIDE
    socket.on("driver:acceptRide", async ({ driverId, rideId }) => {
      const accepted = await tryAcceptRide(rideId, driverId);
      if (!accepted) {
        socket.emit("ride:acceptResult", { rideId, result: "failed" });
        return;
      }

      // Notify all drivers (ride taken)
      for (const drvSock of driverSockets.values()) {
        drvSock.emit("ride:status", { rideId, status: "accepted", driverId });
      }

      // Notify rider of success
      const rideReq = rideToRider.get(rideId);
      if (rideReq) {
        rideReq.socket.emit("rider:rideAccepted", { rideId, driverId });
        rideToRider.delete(rideId);
      }

      // COMMENT: Save ride to DB here for history/auditing
    });

    // Clean up on disconnect
    socket.on("disconnect", () => {
      driverSockets.forEach((sock, driverId) => {
        if (sock === socket) driverSockets.delete(driverId);
      });
      // Could also clean up rideToRider if needed
    });
  });
};
