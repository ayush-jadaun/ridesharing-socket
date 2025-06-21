const DriverSimulator = require("../simulators/driverSimulator");
const UserSimulator = require("../simulators/userSimulator");

class BasicFlowTester {
  constructor() {
    this.driverSimulator = new DriverSimulator();
    this.userSimulator = new UserSimulator();
  }

  async runBasicFlow() {
    console.log("🧪 Starting Basic Flow Test...\n");

    try {
      // Step 1: Start driver simulation
      console.log("Step 1: Starting driver simulation...");
      await this.driverSimulator.startSimulation(8); // 8 drivers

      // Wait for drivers to be ready
      await this.sleep(3000);

      // Step 2: Check system health
      console.log("\nStep 2: Checking system health...");
      await this.checkSystemHealth();

      // Step 3: Simulate ride requests
      console.log("\nStep 3: Simulating ride requests...");
      const results = await this.userSimulator.simulateMultipleRequests(
        3,
        10000
      );

      // Step 4: Show results
      console.log("\nStep 4: Test Results Summary:");
      this.displayResults(results);

      // Step 5: Show driver status
      console.log("\nStep 5: Driver Status:");
      console.log(this.driverSimulator.getStatus());

      // Wait a bit more to see ongoing activity
      console.log("\nWaiting 30 seconds to observe system...");
      await this.sleep(30000);
    } catch (error) {
      console.error("❌ Test failed:", error);
    } finally {
      // Cleanup
      console.log("\nCleaning up...");
      await this.driverSimulator.stopSimulation();
      console.log("✅ Test completed");
    }
  }

  async checkSystemHealth() {
    try {
      const response = await fetch("http://localhost:5000/health");
      const health = await response.json();

      console.log("🏥 System Health:", {
        status: health.status,
        activeDrivers: health.stats.activeDrivers,
        connectedSockets: health.stats.connectedSockets,
        uptime: Math.round(health.uptime) + "s",
      });

      return health.status === "healthy";
    } catch (error) {
      console.error("❌ Health check failed:", error);
      return false;
    }
  }

  displayResults(results) {
    const summary = {
      total: results.length,
      accepted: results.filter((r) => r.status === "accepted").length,
      rejected: results.filter((r) => r.status === "all_rejected").length,
      timeout: results.filter((r) => r.status === "timeout").length,
      noDrivers: results.filter((r) => r.status === "no_drivers").length,
      errors: results.filter((r) => r.status === "error").length,
    };

    console.log("📊 Summary:", summary);

    // Show detailed results
    results.forEach((result, index) => {
      const responseTime = result.responseTime
        ? `${result.responseTime}ms`
        : "N/A";
      console.log(
        `   ${index + 1}. ${result.userId}: ${result.status} (${responseTime})`
      );

      if (result.status === "accepted") {
        console.log(`      🚗 Accepted by: ${result.acceptedBy}`);
        console.log(`      ⏱️  ETA: ${result.estimatedArrival} minutes`);
      }
    });

    // Calculate success rate
    const successRate = ((summary.accepted / summary.total) * 100).toFixed(1);
    console.log(
      `\n🎯 Success Rate: ${successRate}% (${summary.accepted}/${summary.total})`
    );
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Run the test
async function runTest() {
  const tester = new BasicFlowTester();
  await tester.runBasicFlow();
  process.exit(0);
}

// Handle Ctrl+C gracefully
process.on("SIGINT", async () => {
  console.log("\n🛑 Test interrupted by user");
  process.exit(0);
});

if (require.main === module) {
  runTest().catch(console.error);
}

module.exports = BasicFlowTester;
