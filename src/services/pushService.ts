import webpush from "web-push";
import { subscriptionStore } from "./subscriptionStore";
import {
    NotificationType,
    NotificationPayload,
    UserSubscription,
    NOTIFICATION_PREFERENCE_KEYS,
} from "../types";

// Configure web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:adesholatajudeen1@gmail.com";

let isConfigured = false;

/**
 * Initialize web-push with VAPID keys
 */
export function initializePushService(): boolean {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        console.error("[PushService] FAILED to initialize: VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is missing in .env");
        return false;
    }

    try {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        isConfigured = true;
        //console.log("[PushService] Successfully initialized with VAPID details");
        return true;
    } catch (error: any) {
        console.error("[PushService] FAILED to set VAPID details:", error.message);
        return false;
    }
}

/**
 * Check if user has enabled this notification type
 */
function isNotificationEnabled(
    preferences: UserSubscription["preferences"],
    type: NotificationType
): boolean {
    // If pushEnabled is explicitly false, block all
    if (preferences.pushEnabled === false) {
        return false;
    }

    const key = NOTIFICATION_PREFERENCE_KEYS[type];
    // Default to true if preference key is not set (allow notification)
    const isEnabled = key ? (preferences as any)[key] !== false : true;
    return isEnabled;
}

/**
 * Send push notification to a single user
 */
async function sendToUser(
    subscription: UserSubscription,
    payload: NotificationPayload
): Promise<{ success: boolean; error?: string }> {
    if (!isConfigured) {
        return { success: false, error: "Push service not configured" };
    }

    // Check if user has this notification type enabled
    if (!isNotificationEnabled(subscription.preferences, payload.type)) {
        const reason = subscription.preferences.pushEnabled === false ? "Push notifications globally disabled" : `Type "${payload.type}" disabled`;
        //console.log(`[PushService] Skipping ${subscription.userAddress}: ${reason}`);
        return { success: false, error: "Notification type disabled by user" };
    }

    const pushSubscription = {
        endpoint: subscription.subscription.endpoint,
        keys: {
            p256dh: subscription.subscription.keys.p256dh,
            auth: subscription.subscription.keys.auth,
        },
    };


    const pushPayload = JSON.stringify({
        title: payload.title,
        message: payload.message,
        type: payload.type,
        priority: payload.priority,
        action: payload.action,
        data: payload.data,
        requiresAction: payload.priority === "high",
        timestamp: Date.now(),
    });

    try {
        await webpush.sendNotification(pushSubscription, pushPayload);
        return { success: true };
    } catch (error: any) {
        const status = error.statusCode || "unknown";
        const body = error.body || "no body";
        console.error(`[PushService] Error sending to ${subscription.userAddress}: Status ${status}, Message: ${error.message}, Body: ${body}`);

        // Remove invalid subscriptions (404 Not Found, 410 Gone)
        if (error.statusCode === 404 || error.statusCode === 410) {
            //console.log(`[PushService] Removing expired/invalid subscription for ${subscription.userAddress}`);
            subscriptionStore.remove(subscription.userAddress);
        }

        return { success: false, error: error.message };
    }
}

/**
 * Send notification to multiple users
 */
export async function sendNotification(
    userAddresses: string[],
    payload: NotificationPayload
): Promise<{ sent: number; failed: number; errors: string[] }> {
    const subscriptions = await subscriptionStore.getMany(userAddresses);
    const results = { sent: 0, failed: 0, errors: [] as string[] };

    for (const userAddress of userAddresses) {
        const normalizedAddr = userAddress.toLowerCase();
        const subscription = subscriptions.find(s => s.userAddress.toLowerCase() === normalizedAddr);

        if (!subscription) {
            console.warn(`[PushService] Skipping ${normalizedAddr}: No subscription found in database. User must "Allow Notifications" on frontend.`);
            results.failed++;
            continue;
        }

        const result = await sendToUser(subscription, payload);
        if (result.success) {
            results.sent++;
        } else {
            results.failed++;
            if (result.error) {
                results.errors.push(`${subscription.userAddress}: ${result.error}`);
            }
        }
    }

    if (results.failed > 0) {
        console.log(`[PushService] Batch Summary: ${results.sent} sent, ${results.failed} failed.`);
    }

    return results;
}

/**
 * Send notification to all subscribers (for system notifications)
 */
export async function broadcastNotification(
    payload: NotificationPayload
): Promise<{ sent: number; failed: number }> {
    const allSubscriptions = await subscriptionStore.getAll();
    const results = { sent: 0, failed: 0 };

    for (const subscription of allSubscriptions) {
        const result = await sendToUser(subscription, payload);
        if (result.success) {
            results.sent++;
        } else {
            results.failed++;
        }
    }

    return results;
}



/**
 * Get VAPID public key for frontend
 */
export function getVapidPublicKey(): string | null {
    return VAPID_PUBLIC_KEY || null;
}
