const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");
const redisManager = require("./redis");
const config = require("./index");
const logger = require("../utils/logger");

function initializeSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
    pingTimeout: config.SOCKET_TIMEOUT,
    pingInterval: 25000,
  });

  // Setup Redis adapter for scaling
  const { pubClient, subClient } = redisManager.getPubSubClients();
  io.adapter(createAdapter(pubClient, subClient));

  logger.info("Socket.io initialized with Redis adapter");

  return io;
}

module.exports = initializeSocket;
