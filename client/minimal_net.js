import { Client } from "https://cdn.jsdelivr.net/npm/colyseus.js@0.15.16/dist/colyseus.mjs";
console.log("Colyseus Client imported:", Client);

// Try instantiating to see if it works
try {
    const testClient = new Client("ws://localhost"); // Dummy URL
    console.log("Test client instantiated:", testClient);
} catch (e) {
    console.error("Failed to instantiate test client:", e);
}