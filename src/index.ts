import "dotenv/config";
import express from "express";
import cors from "cors";
import notificationRoutes from "./routes/notifications";
import { initializePushService } from "./services/pushService";
import { initializeSubgraphService, startPolling } from "./services/subgraphService";
import { initializeScheduler, startScheduler } from "./services/schedulerService";
import { connectDatabase, isDatabaseConnected } from "./utils/database";

const app = express();
const PORT = process.env.PORT || 3001;

// Parse allowed origins from environment
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
    "http://localhost:5173",
    "http://localhost:3000",
];

// Middleware
app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);

            if (allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(new Error("Not allowed by CORS"), false);
        },
        credentials: true,
    })
);

app.use(express.json());

app.use((req, res, next) => {
    next();
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        database: isDatabaseConnected() ? "connected" : "disconnected",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

// API routes
app.use("/api/notifications", notificationRoutes);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === "production" ? "Internal server error" : err.message,
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "Endpoint not found",
    });
});

// Initialize services and start server
async function main() {
    console.log("===========================================");
    console.log("   CirclePot Notification Server v1.0.0");
    console.log("===========================================");
    console.log();

    // Connect to MongoDB
    const dbConnected = await connectDatabase();
    if (!dbConnected) {
        console.error("❌ Failed to connect to MongoDB. Server cannot start.");
        console.log("   Make sure MongoDB is running and MONGODB_URI is set correctly.");
        process.exit(1);
    }
    console.log("✅ MongoDB connected");

    // Initialize push service
    const pushReady = initializePushService();

    // Initialize subgraph service
    const subgraphReady = initializeSubgraphService();

    // Initialize scheduler
    const schedulerReady = initializeScheduler();

    // Start server
    app.listen(PORT, () => {
        console.log();
        console.log(`🚀 Server running on port ${PORT}`);
        console.log();
        console.log("Available endpoints:");
        console.log(`   GET  /health                          - Health check`);
        console.log(`   POST /api/notifications/subscribe     - Subscribe to push`);
        console.log(`   POST /api/notifications/unsubscribe   - Unsubscribe`);
        console.log(`   PUT  /api/notifications/preferences   - Update preferences`);
        console.log(`   POST /api/notifications/test          - Send test notification`);
        console.log(`   POST /api/notifications/send          - Send notification`);
        console.log(`   GET  /api/notifications/vapid-public-key - Get VAPID key`);
        console.log(`   GET  /api/notifications/status        - Get server status`);
        console.log();

        // Start background services after server is up
        if (subgraphReady) {
            const pollInterval = parseInt(process.env.SUBGRAPH_POLL_INTERVAL_MS || "30000");
            startPolling(pollInterval);
            console.log(`📡 Subgraph polling started (every ${pollInterval / 1000}s)`);
        }

        if (schedulerReady) {
            startScheduler();
            console.log("⏰ Scheduler started for goal deadline notifications");
        }

        console.log();
        console.log("===========================================");
    });
}

main().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
