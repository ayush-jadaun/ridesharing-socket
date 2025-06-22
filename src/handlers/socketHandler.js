class SocketHandler {
  constructor(io, driverService, rideService) {
    this.io = io;
    this.driverService = driverService;
    this.rideService = rideService;
    this.riders = new Map(); // Store rider socket connections
  }

  handleConnection(socket) {
    console.log(`New client connected: ${socket.id}`);

    // Driver goes online
    socket.on("driver:online", async (data) => {
      try {
        const { driverId, lat, lng, vehicleType } = data;

        if (!driverId || !lat || !lng) {
          socket.emit("error", { message: "Missing required data" });
          return;
        }

        const success = await this.driverService.addDriver(
          driverId,
          socket.id,
          parseFloat(lat),
          parseFloat(lng),
          vehicleType || "car"
        );

        if (success) {
          socket.join("drivers");
          socket.emit("driver:status", {
            status: "online",
            message: "Successfully went online",
          });

          // Broadcast to admin/monitoring
          this.io.emit("driver:joined", {
            driverId,
            lat,
            lng,
            vehicleType,
          });
        } else {
          socket.emit("error", { message: "Failed to go online" });
        }
      } catch (error) {
        console.error("Error handling driver online:", error);
        socket.emit("error", { message: "Server error" });
      }
    });

    // Driver location update
    socket.on("driver:location", async (data) => {
      try {
        const { driverId, lat, lng } = data;

        if (!driverId || !lat || !lng) {
          socket.emit("error", { message: "Missing location data" });
          return;
        }

        const success = await this.driverService.updateDriverLocation(
          driverId,
          parseFloat(lat),
          parseFloat(lng)
        );

        if (success) {
          socket.emit("driver:location:updated", {
            message: "Location updated successfully",
          });
        } else {
          socket.emit("error", { message: "Failed to update location" });
        }
      } catch (error) {
        console.error("Error updating driver location:", error);
        socket.emit("error", { message: "Server error" });
      }
    });

    // Rider joins
    socket.on("rider:join", (data) => {
      const { riderId } = data;
      if (riderId) {
        this.riders.set(riderId, socket.id);
        socket.join("riders");
        socket.emit("rider:joined", {
          message: "Successfully joined as rider",
        });
      }
    });

    // Rider requests ride
    socket.on("rider:request", async (data) => {
      try {
        const { riderId, pickupLat, pickupLng, dropLat, dropLng } = data;

        if (!riderId || !pickupLat || !pickupLng || !dropLat || !dropLng) {
          socket.emit("error", { message: "Missing ride request data" });
          return;
        }

        // Create ride request
        const rideRequest = await this.rideService.createRideRequest(
          riderId,
          parseFloat(pickupLat),
          parseFloat(pickupLng),
          parseFloat(dropLat),
          parseFloat(dropLng),
          socket.id
        );

        // Calculate estimated fare
        const estimatedFare = this.rideService.calculateFare(
          parseFloat(pickupLat),
          parseFloat(pickupLng),
          parseFloat(dropLat),
          parseFloat(dropLng)
        );

        rideRequest.estimatedFare = estimatedFare;

        // Find nearby drivers
        const nearbyDrivers = await this.driverService.findNearbyDrivers(
          parseFloat(pickupLat),
          parseFloat(pickupLng),
          5 // 5km radius
        );

        if (nearbyDrivers.length === 0) {
          socket.emit("ride:no_drivers", {
            message: "No drivers available nearby",
          });
          return;
        }

        // Notify rider
        socket.emit("ride:searching", {
          rideId: rideRequest.rideId,
          message: "Searching for drivers...",
          driversFound: nearbyDrivers.length,
          estimatedFare,
        });

        // Send ride request to nearby drivers
        let notificationsSent = 0;
        for (const driver of nearbyDrivers.slice(0, 3)) {
          // Limit to 3 closest drivers
          const driverSocket = this.io.sockets.sockets.get(driver.socketId);
          if (driverSocket) {
            driverSocket.emit("ride:request", {
              rideId: rideRequest.rideId,
              riderId,
              pickup: rideRequest.pickup,
              drop: rideRequest.drop,
              estimatedFare,
              distance: driver.distance,
            });

            this.rideService.addAssignedDriver(
              rideRequest.rideId,
              driver.driverId
            );
            notificationsSent++;
          }
        }

        console.log(
          `Ride request ${rideRequest.rideId} sent to ${notificationsSent} drivers`
        );
      } catch (error) {
        console.error("Error handling ride request:", error);
        socket.emit("error", { message: "Failed to process ride request" });
      }
    });

    // Driver accepts ride
    socket.on("driver:accept", async (data) => {
      try {
        const { rideId } = data;
        const driver = this.driverService.getDriverBySocketId(socket.id);

        if (!driver) {
          socket.emit("error", { message: "Driver not found" });
          return;
        }

        const result = await this.rideService.acceptRide(
          rideId,
          driver.driverId,
          socket.id
        );

        if (result.success) {
          // Update driver status
          await this.driverService.setDriverStatus(driver.driverId, "busy");

          // Notify driver
          socket.emit("ride:accepted", {
            rideId,
            message: "Ride accepted successfully",
            ride: result.ride,
          });

          // Notify rider
          const riderSocket = this.io.sockets.sockets.get(
            result.ride.riderSocketId
          );
          if (riderSocket) {
            riderSocket.emit("ride:driver_assigned", {
              rideId,
              driverId: driver.driverId,
              vehicleType: driver.vehicleType,
              driverLocation: {
                lat: driver.lat,
                lng: driver.lng,
              },
              message: "Driver assigned to your ride",
            });
          }

          // Notify other drivers that ride is no longer available
          const allDrivers = this.driverService.getAllOnlineDrivers();
          allDrivers.forEach((d) => {
            if (
              d.driverId !== driver.driverId &&
              this.rideService.hasDriverBeenAssigned(rideId, d.driverId)
            ) {
              const otherDriverSocket = this.io.sockets.sockets.get(d.socketId);
              if (otherDriverSocket) {
                otherDriverSocket.emit("ride:unavailable", {
                  rideId,
                  message: "Ride has been accepted by another driver",
                });
              }
            }
          });
        } else {
          socket.emit("error", { message: result.message });
        }
      } catch (error) {
        console.error("Error accepting ride:", error);
        socket.emit("error", { message: "Failed to accept ride" });
      }
    });

    // Driver completes ride
    socket.on("driver:complete", async (data) => {
      try {
        const { rideId } = data;
        const driver = this.driverService.getDriverBySocketId(socket.id);

        if (!driver) {
          socket.emit("error", { message: "Driver not found" });
          return;
        }

        const result = await this.rideService.completeRide(rideId);

        if (result.success) {
          // Update driver status back to available
          await this.driverService.setDriverStatus(
            driver.driverId,
            "available"
          );

          // Notify driver
          socket.emit("ride:completed", {
            rideId,
            message: "Ride completed successfully",
          });

          // Notify rider
          const riderSocket = this.io.sockets.sockets.get(
            result.ride.riderSocketId
          );
          if (riderSocket) {
            riderSocket.emit("ride:completed", {
              rideId,
              message: "Your ride has been completed",
            });
          }
        } else {
          socket.emit("error", { message: result.message });
        }
      } catch (error) {
        console.error("Error completing ride:", error);
        socket.emit("error", { message: "Failed to complete ride" });
      }
    });

    // Cancel ride
    socket.on("ride:cancel", async (data) => {
      try {
        const { rideId } = data;
        const result = await this.rideService.cancelRideRequest(
          rideId,
          "user_cancelled"
        );

        if (result.success) {
          // Notify all relevant parties
          socket.emit("ride:cancelled", {
            rideId,
            message: "Ride cancelled successfully",
          });

          // Notify assigned drivers
          const allDrivers = this.driverService.getAllOnlineDrivers();
          allDrivers.forEach((driver) => {
            if (
              this.rideService.hasDriverBeenAssigned(rideId, driver.driverId)
            ) {
              const driverSocket = this.io.sockets.sockets.get(driver.socketId);
              if (driverSocket) {
                driverSocket.emit("ride:cancelled", {
                  rideId,
                  message: "Ride has been cancelled",
                });
              }
            }
          });

          // If driver was assigned, make them available again
          if (result.ride.acceptedBy) {
            await this.driverService.setDriverStatus(
              result.ride.acceptedBy,
              "available"
            );
          }
        } else {
          socket.emit("error", { message: result.message });
        }
      } catch (error) {
        console.error("Error cancelling ride:", error);
        socket.emit("error", { message: "Failed to cancel ride" });
      }
    });

    // Handle disconnection
    socket.on("disconnect", async () => {
      console.log(`Client disconnected: ${socket.id}`);

      // Remove driver if they were online
      const driver = this.driverService.getDriverBySocketId(socket.id);
      if (driver) {
        await this.driverService.removeDriver(driver.driverId);
        this.io.emit("driver:left", { driverId: driver.driverId });
      }

      // Remove rider
      for (const [riderId, socketId] of this.riders.entries()) {
        if (socketId === socket.id) {
          this.riders.delete(riderId);
          break;
        }
      }
    });

    // Debug endpoints
    socket.on("debug:drivers", () => {
      const drivers = this.driverService.getAllOnlineDrivers();
      socket.emit("debug:drivers", drivers);
    });

    socket.on("debug:rides", () => {
      const pendingRides = this.rideService.getAllPendingRequests();
      const activeRides = this.rideService.getAllActiveRides();
      socket.emit("debug:rides", { pendingRides, activeRides });
    });
  }
}

module.exports = SocketHandler;
