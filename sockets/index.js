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
  const driverSockets = new Map(); // driverId -> socket
  const rideToRider = new Map(); // rideId -> { socket, riderId, pickup, drop }
  const rideDriverBroadcastMap = new Map(); // rideId -> Set(driverIds)
  const driverActiveRide = new Map();

  io.on("connection", (socket) => {
    // DRIVER FLOW
    socket.on("driver:online", async ({ driverId, lng, lat }) => {
      driverSockets.set(driverId, socket);
      await driverOnline(driverId, lng, lat);
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

      let radius = SEARCH_INITIAL_RADIUS;
      let foundDrivers = new Set();
      let rideAccepted = false;
      let searchTimer;

      // Helper to broadcast ride request to new drivers only
      async function broadcastRide() {
        const nearbyDrivers = await getNearbyDrivers(pickup, radius);
        if (!nearbyDrivers.length) {
          console.log("No nearby drivers");
          return;
        }
        const eligibleDrivers = nearbyDrivers.filter(
          (driverId) => !driverActiveRide.has(driverId)
        );
        // Send to new drivers only
        const newDrivers = eligibleDrivers.filter((d) => !foundDrivers.has(d));
        newDrivers.forEach((d) => foundDrivers.add(d));
        // Save ALL drivers seen in this radius to broadcast map (for notifications)
        const currentSet = rideDriverBroadcastMap.get(rideId) || new Set();
        nearbyDrivers.forEach((d) => currentSet.add(d));
        rideDriverBroadcastMap.set(rideId, currentSet);

        for (const driverId of newDrivers) {
          const drvSock = driverSockets.get(driverId);
          if (drvSock) {
            drvSock.emit("ride:request", { rideId, pickup, drop, riderId });
          }
        }
      }

      await broadcastRide();

      // Timer: If no driver accepts in SEARCH_TIMEOUT, increase radius and retry
      async function startTimer() {
        searchTimer = setTimeout(async () => {
          const status = await getRideStatus(rideId);
          if (status === "pending" && !rideAccepted) {
            radius += SEARCH_RADIUS_INCREMENT;
            await broadcastRide();
            startTimer(); // recursively set timer
          }
        }, 20000); // 20 seconds (can use SEARCH_TIMEOUT if you want)
      }
      startTimer();

      socket.emit("rider:rideCreated", { rideId });

      // Clean up if ride is accepted or socket disconnects
      socket.on("disconnect", () => {
        clearTimeout(searchTimer);
        rideDriverBroadcastMap.delete(rideId);
        rideToRider.delete(rideId);
      });
    });

    // DRIVER ACCEPTS RIDE
    socket.on("driver:acceptRide", async ({ driverId, rideId }) => {
      const accepted = await tryAcceptRide(rideId, driverId);
      
      if (!accepted) {
        socket.emit("ride:acceptResult", { rideId, result: "failed" });
        return;
      }
      driverActiveRide.set(driverId, rideId); 


      // Notify all drivers who got the request for this ride
      const notifiedDrivers = rideDriverBroadcastMap.get(rideId) || new Set();
      for (const dId of notifiedDrivers) {
        const drvSock = driverSockets.get(dId);
        if (drvSock) {
          drvSock.emit("ride:status", { rideId, status: "accepted", driverId });
        }
      }

      // Notify rider of success
      const rideReq = rideToRider.get(rideId);
      if (rideReq) {
        rideReq.socket.emit("rider:rideAccepted", { rideId, driverId });
        rideToRider.delete(rideId);
      }

      // Clean up
      rideDriverBroadcastMap.delete(rideId);
    });

    socket.on("ride:finish", async ({ driverId, rideId }) => {
      driverActiveRide.delete(driverId); // <-- Mark driver as available
      // ...additional cleanup logic
    });

    // Clean up on disconnect for driver
    socket.on("disconnect", () => {
      // Remove disconnected driver from driverSockets
      driverSockets.forEach((sock, driverId) => {
        if (sock === socket) driverSockets.delete(driverId);
      });
      // Optionally clean up rides for which this driver was the only candidate, etc.
    });
  });
};
