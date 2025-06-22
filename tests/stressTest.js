const io = require("socket.io-client");

const SERVER_URL = "http://localhost:3000";
const NUM_DRIVERS = 50;
const NUM_RIDERS = 50;
const DRIVERS = [];
const RIDERS = [];
const activeRides = new Map();

const CENTER_LNG = 77.6;
const CENTER_LAT = 12.94;
const DELTA_DEG = 0.005; // ~500 meters

function uniqueId(prefix) {
  return prefix + Math.random().toString(36).substring(2, 10);
}

function randomLocation() {
  return {
    lng: CENTER_LNG + (Math.random() * 2 - 1) * DELTA_DEG,
    lat: CENTER_LAT + (Math.random() * 2 - 1) * DELTA_DEG,
  };
}

// Simulate drivers
for (let i = 0; i < NUM_DRIVERS; i++) {
  const driverId = uniqueId("driver_");
  const socket = io(SERVER_URL, { reconnection: false });
  DRIVERS.push({ driverId, socket, busy: false });

  socket.on("connect", () => {
    const { lng, lat } = randomLocation();
    socket.emit("driver:online", { driverId, lng, lat });
  });

  socket.on("ride:request", (ride) => {
    if (!DRIVERS[i].busy) {
      // Simulate random acceptance (50% chance, or increase for more stress)
      if (Math.random() < 0.5) {
        DRIVERS[i].busy = true;
        setTimeout(() => {
          socket.emit("driver:acceptRide", { driverId, rideId: ride.rideId });
        }, Math.random() * 1000);
      }
    }
  });

  socket.on("ride:status", (r) => {
    if (r.status === "accepted" && r.driverId === driverId) {
      DRIVERS[i].busy = true;
      setTimeout(() => {
        socket.emit("ride:finish", { driverId, rideId: r.rideId });
        DRIVERS[i].busy = false;
      }, 1000 + Math.random() * 2000);
    }
    if (r.status === "cancelled") {
      DRIVERS[i].busy = false;
    }
  });

  socket.on("disconnect", () => {
    DRIVERS[i].busy = false;
  });
}

// Simulate riders
for (let i = 0; i < NUM_RIDERS; i++) {
  const riderId = uniqueId("rider_");
  const socket = io(SERVER_URL, { reconnection: false });
  RIDERS.push({ riderId, socket });

  socket.on("connect", () => {
    setTimeout(() => {
      const pickup = randomLocation();
      let drop;
      do {
        drop = randomLocation();
      } while (
        Math.abs(drop.lng - pickup.lng) < 0.001 &&
        Math.abs(drop.lat - pickup.lat) < 0.001
      );
      socket.emit("rider:requestRide", { pickup, drop, riderId });
    }, Math.random() * 1000);
  });

  socket.on("rider:rideCreated", (r) => {
    activeRides.set(r.rideId, { riderId, status: "created" });
  });

  socket.on("rider:rideAccepted", (r) => {
    activeRides.set(r.rideId, {
      ...activeRides.get(r.rideId),
      status: "accepted",
    });
  });

  socket.on("rider:noDrivers", (r) => {
    activeRides.set(r.rideId, {
      ...activeRides.get(r.rideId),
      status: "noDrivers",
    });
  });

  socket.on("rider:driverUnavailable", (r) => {
    activeRides.set(r.rideId, {
      ...activeRides.get(r.rideId),
      status: "driverUnavailable",
    });
  });

  socket.on("disconnect", () => {});
}

// Periodically print stats
setInterval(() => {
  let accepted = 0,
    noDrivers = 0,
    driverUnavailable = 0,
    created = 0;
  for (const v of activeRides.values()) {
    if (v.status === "accepted") accepted++;
    else if (v.status === "noDrivers") noDrivers++;
    else if (v.status === "driverUnavailable") driverUnavailable++;
    else if (v.status === "created") created++;
  }
  console.log(
    `Rides: accepted=${accepted}, noDrivers=${noDrivers}, driverUnavailable=${driverUnavailable}, waiting=${created}`
  );
}, 2000);
