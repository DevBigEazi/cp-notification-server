import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/circlepot-notifications";

let isConnected = false;

/**
 * Connect to MongoDB
 */
export async function connectDatabase(): Promise<boolean> {
    if (isConnected) {
        console.log("[MongoDB] Already connected");
        return true;
    }

    try {
        mongoose.set("strictQuery", true);

        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        isConnected = true;
        console.log("[MongoDB] Connected successfully to:", MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, "//***:***@")); // Hide credentials in logs

        // Handle connection events
        mongoose.connection.on("error", (err: Error) => {
            console.error("[MongoDB] Connection error:", err);
            isConnected = false;
        });

        mongoose.connection.on("disconnected", () => {
            console.warn("[MongoDB] Disconnected");
            isConnected = false;
        });

        mongoose.connection.on("reconnected", () => {
            console.log("[MongoDB] Reconnected");
            isConnected = true;
        });

        return true;
    } catch (error) {
        console.error("[MongoDB] Failed to connect:", error);
        return false;
    }
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectDatabase(): Promise<void> {
    if (!isConnected) return;

    try {
        await mongoose.disconnect();
        isConnected = false;
        console.log("[MongoDB] Disconnected successfully");
    } catch (error) {
        console.error("[MongoDB] Error disconnecting:", error);
    }
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
    return isConnected && mongoose.connection.readyState === 1;
}

export default mongoose;
