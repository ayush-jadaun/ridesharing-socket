require("dotenv").config();
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

// Import services
const redisConfig = require("./config/redis");
const DriverService = require("./services/driverService");
const RideService = require("./services/rideService");
const SocketHandler = require("./handlers/socketHandler");

class RideMatchingServer {
  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.port = process.env.PORT || 3000;
    this.setupMiddleware();
    this.setupRoutes();

    // Services will be initialized after Redis connection
    this.driverService = null;
    this.rideService = null;
    this.socketHandler = null;
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, "../public")));
  }

  setupRoutes() {
    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    });

    // API Routes
    this.app.get("/api/drivers", (req, res) => {
      if (!this.driverService) {
        return res.status(503).json({ error: "Service not ready" });
      }
      const drivers = this.driverService.getAllOnlineDrivers();
      res.json({ drivers, count: drivers.length });
    });

    this.app.get("/api/rides", (req, res) => {
      if (!this.rideService) {
        return res.status(503).json({ error: "Service not ready" });
      }
      const pendingRides = this.rideService.getAllPendingRequests();
      const activeRides = this.rideService.getAllActiveRides();
      res.json({
        pending: pendingRides,
        active: activeRides,
        counts: {
          pending: pendingRides.length,
          active: activeRides.length,
        },
      });
    });

    // Test endpoint to find nearby drivers
    this.app.post("/api/drivers/nearby", async (req, res) => {
      try {
        if (!this.driverService) {
          return res.status(503).json({ error: "Service not ready" });
        }

        const { lat, lng, radius = 5 } = req.body;

        if (!lat || !lng) {
          return res
            .status(400)
            .json({ error: "Latitude and longitude are required" });
        }

        const nearbyDrivers = await this.driverService.findNearbyDrivers(
          parseFloat(lat),
          parseFloat(lng),
          parseFloat(radius)
        );

        res.json({
          drivers: nearbyDrivers,
          count: nearbyDrivers.length,
          searchRadius: radius,
        });
      } catch (error) {
        console.error("Error finding nearby drivers:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Serve the test HTML file
    this.app.get("/", (req, res) => {
      res.sendFile(path.join(__dirname, "../public/index.html"));
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ error: "Route not found" });
    });
  }

  async initializeServices() {
    try {
      console.log("Connecting to Redis...");
      const redisClient = await redisConfig.connect();

      console.log("Initializing services...");
      this.driverService = new DriverService(redisClient);
      this.rideService = new RideService(redisClient);
      this.socketHandler = new SocketHandler(
        this.io,
        this.driverService,
        this.rideService
      );

      console.log("Services initialized successfully");
    } catch (error) {
      console.error("Failed to initialize services:", error);
      process.exit(1);
    }
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket) => {
      this.socketHandler.handleConnection(socket);
    });
  }

  async start() {
    try {
      await this.initializeServices();
      this.setupSocketHandlers();

      this.server.listen(this.port, () => {
        console.log(`🚗 Ride Matching Server running on port ${this.port}`);
        console.log(`📱 Open http://localhost:${this.port} to test the system`);
        console.log(`🔧 API Health: http://localhost:${this.port}/health`);
        console.log(
          `📊 Drivers API: http://localhost:${this.port}/api/drivers`
        );
        console.log(`🚖 Rides API: http://localhost:${this.port}/api/rides`);
      });

      // Graceful shutdown
      process.on("SIGTERM", () => this.shutdown());
      process.on("SIGINT", () => this.shutdown());
    } catch (error) {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
  }

  async shutdown() {
    console.log("Shutting down server...");

    if (this.server) {
      this.server.close();
    }

    if (redisConfig) {
      await redisConfig.disconnect();
    }

    console.log("Server shutdown complete");
    process.exit(0);
  }
}

// Start the server
const server = new RideMatchingServer();
server.start().catch(console.error);
