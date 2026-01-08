import { Subscription, ISubscription } from "../models/Subscription";
import type { UserSubscription, NotificationPreferences, PushSubscriptionData } from "../types";

/**
 * MongoDB-backed subscription storage
 */
class SubscriptionStore {
    /**
     * Add or update a subscription
     */
    async upsert(
        userAddress: string,
        subscription: PushSubscriptionData,
        preferences: NotificationPreferences
    ): Promise<UserSubscription | null> {
        const normalizedAddress = userAddress.toLowerCase();

        try {
            const result = await Subscription.findOneAndUpdate(
                { userAddress: normalizedAddress },
                {
                    $set: {
                        endpoint: subscription.endpoint,
                        keys: subscription.keys,
                        preferences: preferences,
                    },
                },
                {
                    new: true,
                    upsert: true,
                    runValidators: true,
                }
            );


            return this.toUserSubscription(result);
        } catch (error) {
            return null;
        }
    }

    /**
     * Get subscription by user address
     */
    async get(userAddress: string): Promise<UserSubscription | null> {
        try {
            const subscription = await Subscription.findOne({
                userAddress: userAddress.toLowerCase(),
            });

            return subscription ? this.toUserSubscription(subscription) : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get all subscriptions
     */
    async getAll(): Promise<UserSubscription[]> {
        try {
            const subscriptions = await Subscription.find({
                "preferences.pushEnabled": { $ne: false },
            });

            return subscriptions.map((s: ISubscription) => this.toUserSubscription(s));
        } catch (error) {
            return [];
        }
    }

    /**
     * Get subscriptions for multiple user addresses
     */
    async getMany(userAddresses: string[]): Promise<UserSubscription[]> {
        if (userAddresses.length === 0) return [];

        const normalizedAddresses = userAddresses.map((addr) => addr.toLowerCase());

        try {
            const subscriptions = await Subscription.find({
                userAddress: { $in: normalizedAddresses },
                "preferences.pushEnabled": { $ne: false },
            });

            return subscriptions.map((s: ISubscription) => this.toUserSubscription(s));
        } catch (error) {
            return [];
        }
    }

    /**
     * Update preferences for a user
     */
    async updatePreferences(
        userAddress: string,
        preferences: Partial<NotificationPreferences>
    ): Promise<UserSubscription | null> {
        const normalizedAddress = userAddress.toLowerCase();

        try {
            // Build update object with only provided preferences
            const updateFields: Record<string, boolean> = {};
            for (const [key, value] of Object.entries(preferences)) {
                updateFields[`preferences.${key}`] = value;
            }

            const result = await Subscription.findOneAndUpdate(
                { userAddress: normalizedAddress },
                { $set: updateFields },
                { new: true }
            );

            if (!result) {
                return null;
            }

            return this.toUserSubscription(result);
        } catch (error) {
            return null;
        }
    }

    /**
     * Remove a subscription
     */
    async remove(userAddress: string): Promise<boolean> {
        const normalizedAddress = userAddress.toLowerCase();

        try {
            const result = await Subscription.deleteOne({
                userAddress: normalizedAddress,
            });

            if (result.deletedCount > 0) {
                return true;
            }

            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if a user is subscribed
     */
    async has(userAddress: string): Promise<boolean> {
        try {
            const count = await Subscription.countDocuments({
                userAddress: userAddress.toLowerCase(),
            });
            return count > 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get count of subscriptions
     */
    async count(): Promise<number> {
        try {
            return await Subscription.countDocuments({});
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get all circle members who are subscribed
     */
    async getSubscribedMembers(
        memberAddresses: string[],
        excludeAddress?: string
    ): Promise<UserSubscription[]> {
        const filteredAddresses = memberAddresses.filter(
            (addr) => !excludeAddress || addr.toLowerCase() !== excludeAddress.toLowerCase()
        );

        return this.getMany(filteredAddresses);
    }

    /**
     * Convert MongoDB document to UserSubscription type
     */
    private toUserSubscription(doc: ISubscription): UserSubscription {
        return {
            userAddress: doc.userAddress,
            subscription: {
                endpoint: doc.endpoint,
                keys: {
                    p256dh: doc.keys.p256dh,
                    auth: doc.keys.auth,
                },
            },
            preferences: doc.preferences as NotificationPreferences,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        };
    }
}

// Export singleton instance
export const subscriptionStore = new SubscriptionStore();
