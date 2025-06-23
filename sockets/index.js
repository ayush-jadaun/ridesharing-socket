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
  MAX_RADIUS,
} = require("../utils/constants");

module.exports = (io) => {
  const driverSockets = new Map(); // driverId -> socket
  const rideToRider = new Map(); // rideId -> { socket, riderId, pickup, drop }
  const rideDriverBroadcastMap = new Map(); // rideId -> Set(driverIds)
  const driverActiveRide = new Map(); // driverId -> rideId
  const searchTimerByRide = new Map(); // rideId -> timer

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

      async function broadcastRide() {
        const nearbyDrivers = await getNearbyDrivers(pickup, radius);
        if (!nearbyDrivers.length) {
          console.log("No nearby drivers");
          return;
        }
        const eligibleDrivers = nearbyDrivers.filter(
          (driverId) => !driverActiveRide.has(driverId)
        );
        const newDrivers = eligibleDrivers.filter((d) => !foundDrivers.has(d));
        newDrivers.forEach((d) => foundDrivers.add(d));
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

      function startTimer() {
        const timer = setTimeout(async () => {
          const status = await getRideStatus(rideId);
          if (status === "pending" && !rideAccepted) {
            if (radius >= MAX_RADIUS) {
              // Timeout reached
              const rideReq = rideToRider.get(rideId);
              if (rideReq) {
                rideReq.socket.emit("rider:noDrivers", { rideId });
                rideToRider.delete(rideId);
              }
              rideDriverBroadcastMap.delete(rideId);
              searchTimerByRide.delete(rideId);
              return;
            }
            radius += SEARCH_RADIUS_INCREMENT;
            await broadcastRide();
            startTimer();
          }
        }, SEARCH_TIMEOUT || 20000);
        searchTimerByRide.set(rideId, timer);
      }
      startTimer();

      socket.emit("rider:rideCreated", { rideId });
    });

    // Rider cancels ride
    socket.on("rider:cancelRide", ({ rideId }) => {
      if (searchTimerByRide.has(rideId)) {
        clearTimeout(searchTimerByRide.get(rideId));
        searchTimerByRide.delete(rideId);
      }
      const notifiedDrivers = rideDriverBroadcastMap.get(rideId) || new Set();
      for (const dId of notifiedDrivers) {
        const drvSock = driverSockets.get(dId);
        if (drvSock) {
          drvSock.emit("ride:status", { rideId, status: "cancelled" });
        }
      }
      rideDriverBroadcastMap.delete(rideId);
      rideToRider.delete(rideId);
      socket.emit("rider:cancelConfirmed", { rideId });
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
      if (searchTimerByRide.has(rideId)) {
        clearTimeout(searchTimerByRide.get(rideId));
        searchTimerByRide.delete(rideId);
      }
      rideDriverBroadcastMap.delete(rideId);
    });

    socket.on("ride:finish", async ({ driverId, rideId }) => {
      driverActiveRide.delete(driverId);
    });

    // Clean up on disconnect for both drivers and riders
    socket.on("disconnect", () => {
      // Remove disconnected driver(s)
      for (const [driverId, sock] of driverSockets.entries()) {
        if (sock === socket) {
          driverSockets.delete(driverId);
          const rideId = driverActiveRide.get(driverId);
          if (rideId) {
            // Notify the rider driver became unavailable
            const rideReq = rideToRider.get(rideId);
            if (rideReq) {
              rideReq.socket.emit("rider:driverUnavailable", {
                rideId,
                driverId,
              });
            }
            driverActiveRide.delete(driverId);
            rideDriverBroadcastMap.delete(rideId);
            if (searchTimerByRide.has(rideId)) {
              clearTimeout(searchTimerByRide.get(rideId));
              searchTimerByRide.delete(rideId);
            }
            rideToRider.delete(rideId);
          }
        }
      }
      // Remove disconnected rider(s)
      for (const [rideId, rideReq] of rideToRider.entries()) {
        if (rideReq.socket === socket) {
          if (searchTimerByRide.has(rideId)) {
            clearTimeout(searchTimerByRide.get(rideId));
            searchTimerByRide.delete(rideId);
          }
          rideDriverBroadcastMap.delete(rideId);
          rideToRider.delete(rideId);
        }
      }
    });
  });
};
