require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const redis = require("./config/redis");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// Attach socket logic
require("./sockets")(io);

(async () => {
  await redis.connect();
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Ride-matching server running on port ${PORT}`);
  });
})();
