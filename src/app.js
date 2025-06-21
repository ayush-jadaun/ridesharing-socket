const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");

// Import configurations and services
const config = require("./config");
const redisManager = require("./config/redis");
const initializeSocket = require("./config/socket");
const SocketController = require("./controllers/socketController");
const logger = require("./utils/logger");

// Import services for health checks
const geoService = require("./services/geoService");
const driverService = require("./services/driverService");
const rideService = require("./services/rideService");

class RideMatchingApp {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = null;
    this.socketController = null;
  }

  async initialize() {
    try {
      // Connect to Redis first
      await redisManager.connect();
      logger.info("Redis connection established");

      // Initialize Socket.io
      this.io = initializeSocket(this.server);
      logger.info("Socket.io initialized");

      // Setup Socket Controller
      this.socketController = new SocketController(this.io);
      logger.info("Socket controller initialized");

      // Setup Express middleware
      this.setupMiddleware();

      // Setup Routes
      this.setupRoutes();

      // Setup Error Handling
      this.setupErrorHandling();

      // Setup Graceful Shutdown
      this.setupGracefulShutdown();

      logger.info("Application initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize application:", error);
      process.exit(1);
    }
  }

  setupMiddleware() {
    // CORS
    this.app.use(
      cors({
        origin: process.env.CORS_ORIGIN || "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true,
      })
    );

    // Body parsing
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path} - ${req.ip}`);
      next();
    });

    // Static files (for demo purposes)
    this.app.use(express.static(path.join(__dirname, "public")));
  }

  setupRoutes() {
    // Health Check Route
    this.app.get("/health", async (req, res) => {
      try {
        // Check Redis connection
        await redisManager.getClient().ping();

        // Check services
        const activeDrivers = await driverService.getActiveDriversCount();
        const connectedSockets = this.io.engine.clientsCount;

        res.json({
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          environment: config.NODE_ENV,
          services: {
            redis: "connected",
            socketio: "running",
          },
          stats: {
            activeDrivers,
            connectedSockets,
            memoryUsage: process.memoryUsage(),
          },
          config: {
            defaultRadius: config.DEFAULT_RADIUS,
            maxRadius: config.MAX_RADIUS,
            driverResponseTimeout: config.DRIVER_RESPONSE_TIMEOUT,
            locationUpdateInterval: config.LOCATION_UPDATE_INTERVAL,
          },
        });
      } catch (error) {
        logger.error("Health check failed:", error);
        res.status(500).json({
          status: "unhealthy",
          error: error.message,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // System Stats Route
    this.app.get("/stats", async (req, res) => {
      try {
        const activeDrivers = await driverService.getActiveDriversCount();
        const connectedSockets = this.io.engine.clientsCount;
        const redisInfo = await redisManager.getClient().info("memory");

        res.json({
          timestamp: new Date().toISOString(),
          drivers: {
            active: activeDrivers,
          },
          connections: {
            sockets: connectedSockets,
          },
          system: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
          },
          redis: {
            info: redisInfo,
          },
        });
      } catch (error) {
        logger.error("Error getting stats:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Configuration Route
    this.app.get("/config", (req, res) => {
      res.json({
        defaultRadius: config.DEFAULT_RADIUS,
        maxRadius: config.MAX_RADIUS,
        radiusExpansionStep: config.RADIUS_EXPANSION_STEP,
        driverResponseTimeout: config.DRIVER_RESPONSE_TIMEOUT,
        locationUpdateInterval: config.LOCATION_UPDATE_INTERVAL,
        geohashPrecision: config.GEOHASH_PRECISION,
        maxDriversToNotify: config.MAX_DRIVERS_TO_NOTIFY,
        speedThresholds: config.SPEED_THRESHOLDS,
        environment: config.NODE_ENV,
      });
    });

    // Driver Management Routes
    this.app.get("/drivers/active", async (req, res) => {
      try {
        const count = await driverService.getActiveDriversCount();
        res.json({ activeDrivers: count });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Nearby Drivers API (for testing)
    this.app.post("/drivers/nearby", async (req, res) => {
      try {
        const { latitude, longitude, radius, vehicleType } = req.body;

        if (!latitude || !longitude) {
          return res
            .status(400)
            .json({ error: "Latitude and longitude are required" });
        }

        const drivers = await geoService.findNearbyDrivers(
          latitude,
          longitude,
          radius || config.DEFAULT_RADIUS,
          vehicleType
        );

        res.json({
          drivers,
          count: drivers.length,
          searchRadius: radius || config.DEFAULT_RADIUS,
          searchLocation: { latitude, longitude },
        });
      } catch (error) {
        logger.error("Error finding nearby drivers:", error);
        res.status(500).json({ error: error.message });
      }
    });

    // Test Dashboard Route
    this.app.get("/test-dashboard", (req, res) => {
      res.sendFile(path.join(__dirname, "../public/test-dashboard.html"));
    });

    // Demo Route (Root)
    this.app.get("/", (req, res) => {
      res.json({
        message: "Ride Matching System API",
        version: "1.0.0",
        environment: config.NODE_ENV,
        timestamp: new Date().toISOString(),
        endpoints: {
          health: "/health",
          stats: "/stats",
          config: "/config",
          testDashboard: "/test-dashboard",
          nearbyDrivers: "POST /drivers/nearby",
        },
        websocket: {
          url: `ws://localhost:${config.PORT}`,
          events: {
            driver: [
              "driver_register",
              "driver_location_update",
              "driver_status_update",
              "ride_response",
            ],
            user: [
              "find_nearby_drivers",
              "cancel_ride_request",
              "expand_search_radius",
            ],
            common: ["get_active_drivers_count", "ping"],
          },
        },
      });
    });

    // 404 Handler (FIXED - removed the problematic '*' route)
    this.app.use((req, res) => {
      res.status(404).json({
        error: "Route not found",
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
          "GET /",
          "GET /health",
          "GET /stats",
          "GET /config",
          "GET /test-dashboard",
          "POST /drivers/nearby",
        ],
      });
    });
  }

  setupErrorHandling() {
    // Express error handler
    this.app.use((error, req, res, next) => {
      logger.error("Express error:", error);

      res.status(error.status || 500).json({
        error: error.message || "Internal server error",
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    });

    // Unhandled Promise Rejections
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    });

    // Uncaught Exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      this.gracefulShutdown();
    });
  }

  setupGracefulShutdown() {
    const signals = ["SIGTERM", "SIGINT", "SIGUSR2"];

    signals.forEach((signal) => {
      process.on(signal, () => {
        logger.info(`Received ${signal}, starting graceful shutdown...`);
        this.gracefulShutdown();
      });
    });
  }

  async gracefulShutdown() {
    try {
      logger.info("Starting graceful shutdown...");

      // Close HTTP server
      this.server.close(() => {
        logger.info("HTTP server closed");
      });

      // Close Socket.io connections
      if (this.io) {
        this.io.close(() => {
          logger.info("Socket.io closed");
        });
      }

      // Close Redis connections
      await redisManager.disconnect();

      logger.info("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown:", error);
      process.exit(1);
    }
  }

  start() {
    this.server.listen(config.PORT, () => {
      logger.info(`🚗 Ride Matching System started on port ${config.PORT}`);
      logger.info(`📍 Environment: ${config.NODE_ENV}`);
      logger.info(`🔧 Default Search Radius: ${config.DEFAULT_RADIUS}km`);
      logger.info(
        `⏱️  Driver Response Timeout: ${config.DRIVER_RESPONSE_TIMEOUT}s`
      );
      logger.info(
        `📡 Location Update Interval: ${config.LOCATION_UPDATE_INTERVAL}s`
      );
      logger.info(`🗺️  Geohash Precision: ${config.GEOHASH_PRECISION}`);

      console.log("\n🌐 Available Endpoints:");
      console.log(`   Health Check: http://localhost:${config.PORT}/health`);
      console.log(
        `   Test Dashboard: http://localhost:${config.PORT}/test-dashboard`
      );
      console.log(`   System Stats: http://localhost:${config.PORT}/stats`);
      console.log(`   Configuration: http://localhost:${config.PORT}/config`);
    });
  }
}

// Initialize and start the application
async function main() {
  const app = new RideMatchingApp();
  await app.initialize();
  app.start();
}

// Handle startup errors
main().catch((error) => {
  logger.error("Failed to start application:", error);
  process.exit(1);
});

module.exports = RideMatchingApp;
