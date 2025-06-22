const redis = require("../config/redis");
const { DRIVER_GEO_KEY } = require("../utils/constants");

async function addDriverLocation(driverId, lng, lat) {
  await redis.geoAdd(DRIVER_GEO_KEY, {
    longitude: lng,
    latitude: lat,
    member: driverId,
  });
}

async function removeDriverLocation(driverId) {
  await redis.zRem(DRIVER_GEO_KEY, driverId);
}

async function findNearbyDrivers(lng, lat, radius) {
  return await redis.geoSearch(
    DRIVER_GEO_KEY,
    { longitude: lng, latitude: lat },
    { radius: radius, unit: "km" }
  );
}

module.exports = { addDriverLocation, removeDriverLocation, findNearbyDrivers };
