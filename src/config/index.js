const dotenv = require("dotenv");
dotenv.config();

const baseConfig = {
  // Server Settings
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || "development",

  // Location & Radius Settings
  DEFAULT_RADIUS: parseInt(process.env.DEFAULT_RADIUS) || 3,
  MAX_RADIUS: parseInt(process.env.MAX_RADIUS) || 15,
  RADIUS_EXPANSION_STEP: parseInt(process.env.RADIUS_EXPANSION_STEP) || 2,
  RADIUS_EXPANSION_INTERVAL: 60,

  // Driver Location Updates
  LOCATION_UPDATE_INTERVAL:
    parseInt(process.env.LOCATION_UPDATE_INTERVAL) || 10,
  MOVEMENT_THRESHOLD: 50,
  STATIONARY_UPDATE_INTERVAL: 60,
  SLOW_MOVING_UPDATE_INTERVAL: 30,
  FAST_MOVING_UPDATE_INTERVAL: 5,
  SPEED_THRESHOLDS: {
    SLOW: 5,
    NORMAL: 30,
  },

  // Geohash & Broadcasting
  GEOHASH_PRECISION: parseInt(process.env.GEOHASH_PRECISION) || 7,
  MAX_DRIVERS_TO_NOTIFY: parseInt(process.env.MAX_DRIVERS_TO_NOTIFY) || 15,
  DRIVER_RESPONSE_TIMEOUT: parseInt(process.env.DRIVER_RESPONSE_TIMEOUT) || 60,

  // Filtering & Matching
  MIN_DRIVER_RATING: 3.5,
  MAX_CONCURRENT_REQUESTS: 3,
  DRIVER_OFFLINE_TIMEOUT: 300,

  // Upstash Redis Settings
  REDIS: {
    // Upstash specific
    URL: process.env.UPSTASH_REDIS_URL,
    REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,

    // Fallback settings
    HOST: process.env.REDIS_HOST || "localhost",
    PORT: process.env.REDIS_PORT || 6379,
    PASSWORD: process.env.REDIS_PASSWORD || null,
  },

  // Redis Keys
  REDIS_KEYS: {
    GEO: "drivers:all_locations",
    DRIVER_DATA: "drivers:data",
    ACTIVE_DRIVERS: "drivers:active",
    RIDE_REQUESTS: "ride:requests",
    USER_ACTIVE_REQUESTS: "users:active_requests", // ADD THIS
    DRIVER_ACTIVE_RIDES: "drivers:active_rides", // ADD THIS
  },

  // Performance & Limits (Optimized for Upstash free tier)
  MAX_SEARCH_RESULTS: 50, // Reduced for free tier
  REQUEST_RATE_LIMIT: 5, // Reduced for free tier
  SOCKET_TIMEOUT: 30000,

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
};

// Environment-specific overrides
const environmentConfigs = {
  development: {
    ...baseConfig,
    DEFAULT_RADIUS: 5,
    MAX_RADIUS: 50,
    LOCATION_UPDATE_INTERVAL: 10,
    DRIVER_RESPONSE_TIMEOUT: 45,
    LOG_LEVEL: "debug",
    MAX_DRIVERS_TO_NOTIFY: 8, // Reduced for testing
  },

  production: {
    ...baseConfig,
    DEFAULT_RADIUS: 5,
    MAX_RADIUS: 20,
    LOCATION_UPDATE_INTERVAL: 15,
    DRIVER_RESPONSE_TIMEOUT: 90,
    MIN_DRIVER_RATING: 4.0,
    LOG_LEVEL: "warn",
  },
};

const config = environmentConfigs[baseConfig.NODE_ENV] || baseConfig;

module.exports = config;
