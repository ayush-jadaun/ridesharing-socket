const { createClient } = require("redis");

const redis = createClient({
  url: process.env.REDIS_URL, // rediss://:password@host:port
  socket: { tls: true },
});

redis.on("error", (err) => console.error("Redis Client Error", err));

module.exports = redis;
