import webpush from "web-push";
import { subscriptionStore } from "./subscriptionStore";
import type {
    NotificationType,
    NotificationPriority,
    NotificationPayload,
    UserSubscription,
    NOTIFICATION_PREFERENCE_KEYS,
} from "../types";

// Configure web-push with VAPID keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:notifications@circlepot.com";

let isConfigured = false;

/**
 * Initialize web-push with VAPID keys
 */
export function initializePushService(): boolean {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
        return false;
    }

    try {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        isConfigured = true;
        return true;
    } catch (error) {
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

    const preferenceKeyMapping: Record<NotificationType, keyof typeof preferences> = {
        circle_member_joined: "circleMemberJoined",
        circle_member_payout: "circleMemberPayout",
        circle_member_contributed: "circleMemberContributed",
        circle_member_withdrew: "circleMemberWithdrew",
        circle_started: "circleStarted",
        circle_completed: "circleCompleted",
        circle_dead: "circleDead",
        contribution_due: "contributionDue",
        vote_required: "voteRequired",
        vote_executed: "voteExecuted",
        member_forfeited: "memberForfeited",
        late_payment_warning: "latePaymentWarning",
        position_assigned: "positionAssigned",
        goal_deadline_2days: "goalDeadline2Days",
        goal_deadline_1day: "goalDeadline1Day",
        goal_completed: "goalCompleted",
        goal_contribution_due: "goalContributionDue",
        goal_milestone: "goalMilestone",
        circle_invite: "circleInvite",
        invite_accepted: "inviteAccepted",
        payment_received: "paymentReceived",
        credit_score_changed: "creditScoreChanged",
        withdrawal_fee_applied: "withdrawalFeeApplied",
        collateral_returned: "collateralReturned",
        system_maintenance: "systemMaintenance",
        security_alert: "securityAlert",
    };

    const key = preferenceKeyMapping[type];
    // Default to true if preference key is not set (allow notification)
    const isEnabled = key ? preferences[key] !== false : true;
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
        console.error(`[PushService] Error sending to ${subscription.userAddress}:`, error.message);
        // Remove invalid subscriptions
        if (error.statusCode === 404 || error.statusCode === 410) {
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
        const subscription = subscriptions.find(s => s.userAddress.toLowerCase() === userAddress.toLowerCase());

        if (!subscription) {
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
