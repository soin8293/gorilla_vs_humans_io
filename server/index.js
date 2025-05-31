const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('colyseus');
const { WebSocketTransport } = require('@colyseus/ws-transport');

// Import your Room handlers
const { MatchRoom } = require('./rooms/MatchRoom'); // Ensure this path is correct

const port = Number(process.env.PORT) || 2567;
const app = express();

app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Create Colyseus Game Server
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: server, // Attach WebSocket transport to the HTTP server
    // pingInterval: 3000, // Optional: send pings every 3 seconds
    // pingMaxRetries: 3,   // Optional: disconnect client after 3 failed ping attempts
  }),
});

// Define "game_room"
// Clients will join this room by name: `client.joinOrCreate("game_room", { options })`
gameServer.define('game_room', MatchRoom)
  // .filterBy(['maxClients', 'mode']) // Example: if you wanted to filter rooms by options
  .on("create", (room) => console.log("Room created:", room.roomId))
  .on("dispose", (room) => console.log("Room disposed:", room.roomId))
  .on("join", (room, client) => console.log(client.sessionId, "joined", room.roomId))
  .on("leave", (room, client) => console.log(client.sessionId, "left", room.roomId));

// Example: Basic Express route for health check or info
app.get('/', (req, res) => {
  res.send('Gorilla vs Humans Colyseus Server is running!');
});

// Start listening
gameServer.listen(port)
  .then(() => {
    console.log(`Colyseus server listening on ws://localhost:${port}`);
  }).catch(err => {
    console.error("Failed to start Colyseus server:", err);
    process.exit(1);
  });

// Optional: Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  gameServer.gracefulShutdown().then(() => {
    console.log('Server shut down gracefully.');
    process.exit(0);
  }).catch(e => {
    console.error('Error during graceful shutdown:', e);
    process.exit(1);
  });
});