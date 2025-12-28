import mongoose, { Schema, Document } from "mongoose";
import type { NotificationPreferences, PushSubscriptionData } from "../types";

// Interface for the Subscription document
export interface ISubscription extends Document {
    userAddress: string;
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
    preferences: NotificationPreferences;
    createdAt: Date;
    updatedAt: Date;
}

// Preferences schema (embedded)
const NotificationPreferencesSchema = new Schema({
    pushEnabled: { type: Boolean, default: true },
    inAppEnabled: { type: Boolean, default: true },

    // Circle notifications
    circleMemberJoined: { type: Boolean, default: true },
    circleMemberPayout: { type: Boolean, default: true },
    circleMemberContributed: { type: Boolean, default: false },
    circleMemberWithdrew: { type: Boolean, default: true },
    circleStarted: { type: Boolean, default: true },
    circleCompleted: { type: Boolean, default: true },
    circleDead: { type: Boolean, default: true },
    contributionDue: { type: Boolean, default: true },
    voteRequired: { type: Boolean, default: true },
    voteExecuted: { type: Boolean, default: true },
    memberForfeited: { type: Boolean, default: true },
    latePaymentWarning: { type: Boolean, default: true },
    positionAssigned: { type: Boolean, default: true },

    // Goal notifications
    goalDeadline2Days: { type: Boolean, default: true },
    goalDeadline1Day: { type: Boolean, default: true },
    goalCompleted: { type: Boolean, default: true },
    goalContributionDue: { type: Boolean, default: true },
    goalMilestone: { type: Boolean, default: false },

    // Social notifications
    circleInvite: { type: Boolean, default: true },
    inviteAccepted: { type: Boolean, default: false },

    // Financial notifications
    paymentReceived: { type: Boolean, default: true },
    creditScoreChanged: { type: Boolean, default: true },
    withdrawalFeeApplied: { type: Boolean, default: false },
    collateralReturned: { type: Boolean, default: true },

    // System notifications
    systemMaintenance: { type: Boolean, default: true },
    securityAlert: { type: Boolean, default: true },
}, { _id: false });

// Main subscription schema
const SubscriptionSchema = new Schema<ISubscription>({
    userAddress: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        index: true,
    },
    endpoint: {
        type: String,
        required: true,
    },
    keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true },
    },
    preferences: {
        type: NotificationPreferencesSchema,
        default: () => ({}),
    },
}, {
    timestamps: true,
    versionKey: false,
});

// Create indexes
SubscriptionSchema.index({ endpoint: 1 });
SubscriptionSchema.index({ "preferences.pushEnabled": 1 });

// Virtual for subscription in the format expected by web-push
SubscriptionSchema.virtual("subscription").get(function (this: ISubscription) {
    return {
        endpoint: this.endpoint,
        keys: {
            p256dh: this.keys.p256dh,
            auth: this.keys.auth,
        },
    };
});

// Enable virtuals in JSON
SubscriptionSchema.set("toJSON", { virtuals: true });
SubscriptionSchema.set("toObject", { virtuals: true });

export const Subscription = mongoose.model<ISubscription>("Subscription", SubscriptionSchema);

export default Subscription;
