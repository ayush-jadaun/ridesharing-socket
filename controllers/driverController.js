const {
  addDriverLocation,
  removeDriverLocation,
} = require("../services/geoService");
const { DRIVER_STATUS_KEY } = require("../utils/constants");
const redis = require("../config/redis");

async function driverOnline(driverId, lng, lat) {
  await addDriverLocation(driverId, lng, lat);
  await redis.hSet(DRIVER_STATUS_KEY, driverId, "online");
}

async function driverOffline(driverId) {
  await removeDriverLocation(driverId);
  await redis.hDel(DRIVER_STATUS_KEY, driverId);
}

module.exports = { driverOnline, driverOffline };
