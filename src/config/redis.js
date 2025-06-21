const Redis = require("ioredis");
const config = require("./index");
const logger = require("../utils/logger");

class RedisManager {
  constructor() {
    this.client = null;
    this.pubClient = null;
    this.subClient = null;
  }

  async connect() {
    try {
      // Simple Redis connection - replace ******** with your actual password
      const redisUrl =
        process.env.UPSTASH_REDIS_URL ||
        "rediss://default:********@mutual-cheetah-50921.upstash.io:6379";

      logger.info("Connecting to Upstash Redis...");

      // Create Redis clients
      this.client = new Redis(redisUrl);
      this.pubClient = new Redis(redisUrl);
      this.subClient = new Redis(redisUrl);

      // Test connections
      await this.client.ping();
      await this.pubClient.ping();
      await this.subClient.ping();

      logger.info("✅ Redis connections established successfully");

      // Basic error handling
      this.client.on("error", (err) =>
        logger.error("Redis Error:", err.message)
      );
      this.pubClient.on("error", (err) =>
        logger.error("Redis Pub Error:", err.message)
      );
      this.subClient.on("error", (err) =>
        logger.error("Redis Sub Error:", err.message)
      );
    } catch (error) {
      logger.error("❌ Failed to connect to Redis:", error.message);
      throw error;
    }
  }

  getClient() {
    return this.client;
  }

  getPubSubClients() {
    return { pubClient: this.pubClient, subClient: this.subClient };
  }

  async disconnect() {
    if (this.client) await this.client.quit();
    if (this.pubClient) await this.pubClient.quit();
    if (this.subClient) await this.subClient.quit();
    logger.info("Redis connections closed");
  }
}

module.exports = new RedisManager();
