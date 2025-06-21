const DriverSimulator = require("../simulators/driverSimulator");
const UserSimulator = require("../simulators/userSimulator");

class EnhancedTester {
  constructor() {
    this.driverSimulator = new DriverSimulator();
    this.userSimulator = new UserSimulator();
    this.stats = {
      totalRequests: 0,
      successfulMatches: 0,
      failedMatches: 0,
      averageResponseTime: 0,
    };
  }

  async runEnhancedTest() {
    console.log("🧪 Enhanced Ride Matching Test\n");

    try {
      // Step 1: Check server health
      console.log("Step 1: System Health Check");
      await this.checkSystemHealth();

      // Step 2: Start optimized driver distribution
      console.log("\nStep 2: Starting optimized driver distribution");
      await this.driverSimulator.startSimulation(8);
      await this.sleep(3000);

      // Step 3: Test different scenarios
      console.log("\nStep 3: Testing various scenarios");

      // Scenario 1: Central Delhi (should work)
      await this.testScenario("Central Delhi", {
        userId: "test_user_1",
        userName: "Test User Central",
        location: { latitude: 28.6139, longitude: 77.209 },
        vehicleType: "car",
      });

      await this.sleep(5000);

      // Scenario 2: Noida (might need radius expansion)
      await this.testScenario("Noida", {
        userId: "test_user_2",
        userName: "Test User Noida",
        location: { latitude: 28.5355, longitude: 77.391 },
        vehicleType: "any",
      });

      await this.sleep(5000);

      // Scenario 3: Gurgaon (challenging)
      await this.testScenario("Gurgaon", {
        userId: "test_user_3",
        userName: "Test User Gurgaon",
        location: { latitude: 28.4595, longitude: 77.0266 },
        vehicleType: "car",
      });

      // Step 4: Show comprehensive results
      console.log("\nStep 4: Test Results Summary");
      this.showDetailedResults();

      // Step 5: System monitoring
      console.log("\nStep 5: System monitoring (30 seconds)");
      await this.monitorSystem(30000);
    } catch (error) {
      console.error("❌ Enhanced test failed:", error);
    } finally {
      await this.driverSimulator.stopSimulation();
      console.log("✅ Enhanced test completed");
    }
  }

  async testScenario(scenarioName, userData) {
    console.log(`\n🎯 Testing: ${scenarioName}`);
    const startTime = Date.now();

    try {
      const result = await this.userSimulator.simulateRideRequest(userData);
      const responseTime = Date.now() - startTime;

      this.stats.totalRequests++;

      if (result.status === "accepted") {
        this.stats.successfulMatches++;
        console.log(
          `✅ ${scenarioName}: SUCCESS in ${Math.round(responseTime / 1000)}s`
        );
        console.log(`   Driver: ${result.acceptedBy}`);
        console.log(`   ETA: ${result.estimatedArrival} minutes`);
      } else {
        this.stats.failedMatches++;
        console.log(`❌ ${scenarioName}: FAILED - ${result.status}`);
      }

      this.stats.averageResponseTime =
        (this.stats.averageResponseTime * (this.stats.totalRequests - 1) +
          responseTime) /
        this.stats.totalRequests;
    } catch (error) {
      console.log(`❌ ${scenarioName}: ERROR - ${error.message}`);
      this.stats.failedMatches++;
    }
  }

  async checkSystemHealth() {
    try {
      const response = await fetch("http://localhost:3000/health");
      const health = await response.json();

      console.log("🏥 System Status:", health.status);
      console.log(`📊 Active Drivers: ${health.stats.activeDrivers}`);
      console.log(`🔌 Connected Sockets: ${health.stats.connectedSockets}`);
      console.log(`⚙️  Default Radius: ${health.config.defaultRadius}km`);
      console.log(
        `🔄 Response Timeout: ${health.config.driverResponseTimeout}s`
      );
    } catch (error) {
      console.log("❌ Health check failed:", error.message);
    }
  }

  showDetailedResults() {
    const successRate =
      this.stats.totalRequests > 0
        ? (
            (this.stats.successfulMatches / this.stats.totalRequests) *
            100
          ).toFixed(1)
        : 0;

    console.log("📈 Detailed Results:");
    console.log(`   Total Requests: ${this.stats.totalRequests}`);
    console.log(`   Successful Matches: ${this.stats.successfulMatches}`);
    console.log(`   Failed Matches: ${this.stats.failedMatches}`);
    console.log(`   Success Rate: ${successRate}%`);
    console.log(
      `   Average Response Time: ${Math.round(
        this.stats.averageResponseTime / 1000
      )}s`
    );

    if (successRate < 70) {
      console.log("\n💡 Recommendations:");
      console.log("   - Increase DEFAULT_RADIUS in config");
      console.log("   - Add more drivers in suburban areas");
      console.log("   - Implement radius expansion feature");
    }
  }

  async monitorSystem(duration) {
    const interval = 5000; // 5 seconds
    const iterations = duration / interval;

    for (let i = 0; i < iterations; i++) {
      try {
        const stats = await fetch("http://localhost:3000/stats");
        const data = await stats.json();

        console.log(
          `[${new Date().toLocaleTimeString()}] Active: ${
            data.drivers.active
          } drivers, Sockets: ${data.connections.sockets}`
        );
      } catch (error) {
        console.log(
          `[${new Date().toLocaleTimeString()}] Monitoring error: ${
            error.message
          }`
        );
      }

      await this.sleep(interval);
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Polyfill fetch
async function setupFetch() {
  if (typeof fetch === "undefined") {
    const { default: fetch } = await import("node-fetch");
    global.fetch = fetch;
  }
}

async function runEnhancedTest() {
  await setupFetch();
  const tester = new EnhancedTester();
  await tester.runEnhancedTest();
}

if (require.main === module) {
  runEnhancedTest().catch(console.error);
}

module.exports = EnhancedTester;
