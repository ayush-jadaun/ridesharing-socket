const { io } = require("socket.io-client");
const { mockDrivers, generateRandomMovement } = require("../mock-data/drivers");

class DriverSimulator {
  constructor(serverUrl = "http://localhost:5000") {
    this.serverUrl = serverUrl;
    this.drivers = [];
    this.isRunning = false;
  }

  async startSimulation(numberOfDrivers = 5) {
    console.log(`🚗 Starting simulation with ${numberOfDrivers} drivers...`);

    // Take first N drivers from mock data
    const driversToSimulate = mockDrivers.slice(0, numberOfDrivers);

    for (const driverData of driversToSimulate) {
      const driver = await this.createDriver(driverData);
      this.drivers.push(driver);
    }

    this.isRunning = true;
    this.startLocationUpdates();

    console.log(`✅ ${this.drivers.length} drivers connected and active`);
  }

  async createDriver(driverData) {
    return new Promise((resolve, reject) => {
      const socket = io(this.serverUrl);
      const driver = {
        ...driverData,
        socket,
        currentLocation: { ...driverData.location },
        baseLocation: { ...driverData.location },
        status: "available",
        isConnected: false,
      };

      socket.on("connect", () => {
        console.log(`🔌 Driver ${driverData.driverId} connected`);

        // Register driver
        socket.emit("driver_register", {
          driverId: driverData.driverId,
          latitude: driverData.location.latitude,
          longitude: driverData.location.longitude,
          vehicleType: driverData.vehicleType,
          rating: driverData.rating,
          driverName: driverData.driverName,
          vehicleNumber: driverData.vehicleNumber,
        });
      });

      socket.on("driver_registered", (data) => {
        console.log(`✅ Driver ${driverData.driverId} registered successfully`);
        driver.isConnected = true;
        driver.roomName = data.roomName;
        resolve(driver);
      });

      socket.on("driver_register_error", (error) => {
        console.error(
          `❌ Driver ${driverData.driverId} registration failed:`,
          error
        );
        reject(error);
      });

      // Handle ride requests
      socket.on("new_ride_request", (rideData) => {
        console.log(`🚨 Driver ${driverData.driverId} received ride request:`, {
          requestId: rideData.requestId,
          distance: rideData.distance,
          userLocation: rideData.userLocation,
        });

        // Simulate driver decision (80% accept rate)
        setTimeout(() => {
          const shouldAccept = Math.random() > 0.2;

          socket.emit("ride_response", {
            requestId: rideData.requestId,
            driverId: driverData.driverId,
            response: shouldAccept ? "accept" : "reject",
            driverLocation: driver.currentLocation,
          });

          if (shouldAccept) {
            driver.status = "busy";
            console.log(
              `✅ Driver ${driverData.driverId} ACCEPTED ride ${rideData.requestId}`
            );
          } else {
            console.log(
              `❌ Driver ${driverData.driverId} REJECTED ride ${rideData.requestId}`
            );
          }
        }, Math.random() * 10000 + 2000); // 2-12 seconds response time
      });

      socket.on("ride_request_cancelled", (data) => {
        console.log(
          `📵 Ride request ${data.requestId} cancelled for driver ${driverData.driverId}`
        );
      });

      socket.on("location_updated", (data) => {
        console.log(
          `📍 Driver ${driverData.driverId} location updated (moved: ${data.distanceMoved}m)`
        );
      });

      socket.on("disconnect", () => {
        console.log(`🔌 Driver ${driverData.driverId} disconnected`);
        driver.isConnected = false;
      });
    });
  }

  startLocationUpdates() {
    setInterval(() => {
      if (!this.isRunning) return;

      this.drivers.forEach((driver) => {
        if (!driver.isConnected) return;

        // Generate realistic movement
        const newLocation = generateRandomMovement(driver.baseLocation, 0.3);
        driver.currentLocation = newLocation;

        // Simulate realistic speed (0-60 km/h)
        const speed = Math.random() * 60;
        const heading = Math.random() * 360;

        driver.socket.emit("driver_location_update", {
          driverId: driver.driverId,
          latitude: newLocation.latitude,
          longitude: newLocation.longitude,
          speed,
          heading,
        });
      });
    }, 15000); // Update every 15 seconds
  }

  async stopSimulation() {
    console.log("🛑 Stopping driver simulation...");
    this.isRunning = false;

    this.drivers.forEach((driver) => {
      if (driver.socket) {
        driver.socket.disconnect();
      }
    });

    this.drivers = [];
    console.log("✅ Driver simulation stopped");
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      totalDrivers: this.drivers.length,
      connectedDrivers: this.drivers.filter((d) => d.isConnected).length,
      availableDrivers: this.drivers.filter((d) => d.status === "available")
        .length,
      busyDrivers: this.drivers.filter((d) => d.status === "busy").length,
    };
  }
}

module.exports = DriverSimulator;
