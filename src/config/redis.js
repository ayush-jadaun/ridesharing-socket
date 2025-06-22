const redis = require("redis");

class RedisConfig {
  constructor() {
    this.client = null;
  }

  async connect() {
    try {
      const redisUrl =
        process.env.UPSTASH_REDIS_URL ||
        "rediss://default:********@mutual-cheetah-50921.upstash.io:6379";

      this.client = redis.createClient({
        url: redisUrl,
        socket: {
          tls: true,
          rejectUnauthorized: false,
        },
      });

      this.client.on("error", (err) => {
        console.error("Redis Client Error:", err);
      });

      this.client.on("connect", () => {
        console.log("Connected to Upstash Redis");
      });

      await this.client.connect();
      return this.client;
    } catch (error) {
      console.error("Failed to connect to Redis:", error);
      throw error;
    }
  }

  getClient() {
    return this.client;
  }

  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
    }
  }
}

module.exports = new RedisConfig();
