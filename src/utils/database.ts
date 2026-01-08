import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/circlepot-notifications";

let isConnected = false;

/**
 * Connect to MongoDB
 */
export async function connectDatabase(): Promise<boolean> {
    if (isConnected) {
        return true;
    }

    try {
        mongoose.set("strictQuery", true);

        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });

        isConnected = true;

        // Handle connection events
        mongoose.connection.on("error", (err: Error) => {
            isConnected = false;
        });

        mongoose.connection.on("disconnected", () => {
            isConnected = false;
        });

        mongoose.connection.on("reconnected", () => {
            isConnected = true;
        });

        return true;
    } catch (error) {
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
    } catch (error) {
    }
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
    return isConnected && mongoose.connection.readyState === 1;
}

export default mongoose;
