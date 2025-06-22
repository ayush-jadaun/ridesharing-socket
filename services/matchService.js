const redis = require("../config/redis");
const { RIDE_STATUS_KEY } = require("../utils/constants");

// Atomic check-and-set using Lua to avoid race conditions on ride acceptance
async function tryAcceptRide(rideId, driverId) {
  const lua = `
    local status = redis.call('GET', KEYS[1])
    if (not status) or status == 'pending' then
      redis.call('SET', KEYS[1], ARGV[1])
      return 1
    else
      return 0
    end
  `;
  const key = `${RIDE_STATUS_KEY}:${rideId}`;
  const result = await redis.eval(lua, { keys: [key], arguments: [driverId] });
  return result === 1;
}

async function setRidePending(rideId) {
  const key = `${RIDE_STATUS_KEY}:${rideId}`;
  await redis.set(key, "pending", { EX: 300 }); // expired in 5 min
}

async function getRideStatus(rideId) {
  const key = `${RIDE_STATUS_KEY}:${rideId}`;
  return await redis.get(key);
}

module.exports = { tryAcceptRide, setRidePending, getRideStatus };
