const { findNearbyDrivers } = require("../services/geoService");
const { setRidePending } = require("../services/matchService");
const { v4: uuidv4 } = require("uuid");

async function createRideRequest(pickup, drop) {
  // Generate rideId
  const rideId = uuidv4();
  // Store ride status as pending (atomic control)
  await setRidePending(rideId);

  // You can persist pickup/drop/user info here for later DB (commented)
  // await redis.hSet('rides:data', rideId, JSON.stringify({ pickup, drop, ... }));

  return rideId;
}

async function getNearbyDrivers(pickup, radius) {
  return await findNearbyDrivers(pickup.lng, pickup.lat, radius);
}

module.exports = { createRideRequest, getNearbyDrivers };
