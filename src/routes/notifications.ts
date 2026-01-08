import { Router, Request, Response } from "express";
import { subscriptionStore } from "../services/subscriptionStore";
import {
    sendNotification,
    getVapidPublicKey,
} from "../services/pushService";
import { getPollingStatus } from "../services/subgraphService";
import { getSchedulerStatus } from "../services/schedulerService";
import { Subscription } from "../models/Subscription";
import type {
    PushSubscriptionData,
    NotificationPreferences,
    SendNotificationRequest,
} from "../types";

const router = Router();

/**
 * POST /subscribe
 * Subscribe a user to push notifications
 */
router.post("/subscribe", async (req: Request, res: Response) => {
    try {
        const { subscription, userAddress, preferences } = req.body as {
            subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
            userAddress: string;
            preferences: NotificationPreferences;
        };

        if (!subscription || !userAddress) {
            return res.status(400).json({
                success: false,
                error: "Missing required fields: subscription, userAddress",
            });
        }

        if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
            return res.status(400).json({
                success: false,
                error: "Invalid subscription format",
            });
        }

        const pushSubscription: PushSubscriptionData = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
            },
        };

        await subscriptionStore.upsert(userAddress, pushSubscription, preferences);

        res.json({
            success: true,
            message: "Successfully subscribed to push notifications",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: "Failed to subscribe",
        });
    }
});

/**
 * POST /unsubscribe
 * Unsubscribe a user from push notifications
 */
router.post("/unsubscribe", async (req: Request, res: Response) => {
    try {
        const { userAddress } = req.body as { userAddress: string };

        if (!userAddress) {
            return res.status(400).json({
                success: false,
                error: "Missing required field: userAddress",
            });
        }

        const removed = await subscriptionStore.remove(userAddress);

        res.json({
            success: true,
            message: removed ? "Successfully unsubscribed" : "Subscription not found",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: "Failed to unsubscribe",
        });
    }
});

/**
 * PUT /preferences
 * Update notification preferences for a user
 */
router.put("/preferences", async (req: Request, res: Response) => {
    try {
        const { userAddress, preferences } = req.body as {
            userAddress: string;
            preferences: Partial<NotificationPreferences>;
        };

        if (!userAddress) {
            return res.status(400).json({
                success: false,
                error: "Missing required field: userAddress",
            });
        }

        const updated = await subscriptionStore.updatePreferences(userAddress, preferences);

        if (!updated) {
            return res.status(404).json({
                success: false,
                error: "Subscription not found",
            });
        }

        res.json({
            success: true,
            message: "Preferences updated",
            preferences: updated.preferences,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: "Failed to update preferences",
        });
    }
});



/**
 * POST /send
 * Send a notification to specific users (internal/admin endpoint)
 */
router.post("/send", async (req: Request, res: Response) => {
    try {
        const {
            userAddresses,
            title,
            message,
            type,
            priority,
            action,
            data,
        } = req.body as SendNotificationRequest;

        if (!userAddresses || !Array.isArray(userAddresses) || userAddresses.length === 0) {
            return res.status(400).json({
                success: false,
                error: "Missing or invalid userAddresses array",
            });
        }

        if (!title || !message || !type) {
            return res.status(400).json({
                success: false,
                error: "Missing required fields: title, message, type",
            });
        }

        const result = await sendNotification(userAddresses, {
            title,
            message,
            type,
            priority: priority || "medium",
            action,
            data,
        });

        res.json({
            success: true,
            sent: result.sent,
            failed: result.failed,
            errors: result.errors.length > 0 ? result.errors : undefined,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: "Failed to send notifications",
        });
    }
});

/**
 * POST /test
 * Send a test notification to a specific user
 */
router.post("/test", async (req: Request, res: Response) => {
    try {
        const { userAddress } = req.body as { userAddress: string };

        if (!userAddress) {
            return res.status(400).json({
                success: false,
                error: "Missing required field: userAddress",
            });
        }

        const result = await sendNotification([userAddress], {
            title: "Test Notification",
            message: "This is a test notification from CirclePot!",
            type: "system_maintenance",
            priority: "high",
        });

        if (result.sent === 0) {
            return res.status(404).json({
                success: false,
                error: "User not subscribed or notification failed",
                details: result.errors,
            });
        }

        res.json({
            success: true,
            message: "Test notification sent successfully",
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: "Failed to send test notification",
        });
    }
});

/**
 * POST /simulate-event
 * Simulate a subgraph event for testing (development only)
 */
router.post("/simulate-event", async (req: Request, res: Response) => {
    try {
        const { eventType, data } = req.body;


        const subgraphService = require("../services/subgraphService");

        // Map eventType to the internal processing function name
        const functionMap: Record<string, string> = {
            "contribution": "processContributionEvents",
            "payout": "processPayoutEvents",
            "join": "processCircleJoinedEvents",
        };

        const procFileName = functionMap[eventType];
        if (!procFileName || typeof subgraphService[procFileName] !== 'function') {
            return res.status(400).json({
                success: false,
                error: `Unknown or non-exported event type: ${eventType}. Mode: ${procFileName}`
            });
        }

        // Execute the processing function with mock data
        await subgraphService[procFileName]([data]);

        res.json({
            success: true,
            message: `Simulation request processed for ${eventType}.`
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /vapid-public-key
 * Get the VAPID public key for frontend subscription
 */
router.get("/vapid-public-key", (req: Request, res: Response) => {
    const key = getVapidPublicKey();

    if (!key) {
        return res.status(500).json({
            success: false,
            error: "VAPID key not configured",
        });
    }

    res.json({
        success: true,
        vapidPublicKey: key,
    });
});

/**
 * GET /status
 * Get server status and statistics
 */
router.get("/status", async (req: Request, res: Response) => {
    const pollingStatus = getPollingStatus();
    const schedulerStatus = getSchedulerStatus();
    const subs = await Subscription.find({});

    res.json({
        success: true,
        status: "running",
        subscriptions: subs.length,
        polling: pollingStatus,
        scheduler: schedulerStatus,
        timestamp: new Date().toISOString(),
    });
});

/**
 * GET /check
 * Check for pending notifications (used by service worker periodic sync)
 */
router.get("/check", (req: Request, res: Response) => {
    // This endpoint returns pending notifications for the requesting user
    // In a real implementation, you would authenticate the user and return their pending notifications
    // For now, return empty array as notifications are pushed proactively
    res.json([]);
});

export default router;
