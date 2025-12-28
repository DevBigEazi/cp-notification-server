// Notification event types - keep in sync with frontend
export type NotificationType =
    // Circle notifications
    | "circle_member_joined"
    | "circle_member_payout"
    | "circle_member_contributed"
    | "circle_member_withdrew"
    | "circle_started"
    | "circle_completed"
    | "circle_dead"
    | "contribution_due"
    | "vote_required"
    | "vote_executed"
    | "member_forfeited"
    | "late_payment_warning"
    | "position_assigned"
    // Goal notifications
    | "goal_deadline_2days"
    | "goal_deadline_1day"
    | "goal_completed"
    | "goal_contribution_due"
    | "goal_milestone"
    // Social notifications
    | "circle_invite"
    | "invite_accepted"
    // Financial notifications
    | "payment_received"
    | "credit_score_changed"
    | "withdrawal_fee_applied"
    | "collateral_returned"
    // System notifications
    | "system_maintenance"
    | "security_alert";

export type NotificationPriority = "high" | "medium" | "low";

export interface NotificationPreferences {
    pushEnabled: boolean;
    inAppEnabled: boolean;
    circleMemberJoined: boolean;
    circleMemberPayout: boolean;
    circleMemberContributed: boolean;
    circleMemberWithdrew: boolean;
    circleStarted: boolean;
    circleCompleted: boolean;
    circleDead: boolean;
    contributionDue: boolean;
    voteRequired: boolean;
    voteExecuted: boolean;
    memberForfeited: boolean;
    latePaymentWarning: boolean;
    positionAssigned: boolean;
    goalDeadline2Days: boolean;
    goalDeadline1Day: boolean;
    goalCompleted: boolean;
    goalContributionDue: boolean;
    goalMilestone: boolean;
    circleInvite: boolean;
    inviteAccepted: boolean;
    paymentReceived: boolean;
    creditScoreChanged: boolean;
    withdrawalFeeApplied: boolean;
    collateralReturned: boolean;
    systemMaintenance: boolean;
    securityAlert: boolean;
}

export interface PushSubscriptionKeys {
    p256dh: string;
    auth: string;
}

export interface PushSubscriptionData {
    endpoint: string;
    keys: PushSubscriptionKeys;
}

export interface UserSubscription {
    userAddress: string;
    subscription: PushSubscriptionData;
    preferences: NotificationPreferences;
    createdAt: Date;
    updatedAt: Date;
}

export interface NotificationPayload {
    title: string;
    message: string;
    type: NotificationType;
    priority: NotificationPriority;
    action?: {
        label?: string;
        action: string;
    };
    data?: Record<string, unknown>;
}

export interface SendNotificationRequest {
    userAddresses: string[];
    title: string;
    message: string;
    type: NotificationType;
    priority: NotificationPriority;
    action?: {
        label?: string;
        action: string;
    };
    data?: Record<string, unknown>;
}

// Subgraph event types
export interface SubgraphUser {
    id: string;
    username?: string;
    fullName?: string;
}

export interface SubgraphCircle {
    id: string;
    circleId: string;
    circleName: string;
    creator: SubgraphUser;
    state: number;
    currentMembers: string;
    maxMembers: string;
}

export interface CircleJoinedEvent {
    id: string;
    circleId: string;
    user: SubgraphUser;
    circle: SubgraphCircle;
    timestamp: string;
    blockNumber: string;
}

export interface PayoutEvent {
    id: string;
    circleId: string;
    recipient: SubgraphUser;
    payoutAmount: string;
    round: string;
    timestamp: string;
    blockNumber: string;
}

export interface ContributionEvent {
    id: string;
    circleId: string;
    contributor: SubgraphUser;
    amount: string;
    round: string;
    circleName?: string;
    timestamp: string;
    blockNumber: string;
}

export interface CollateralWithdrawnEvent {
    id: string;
    circleId: string;
    user: SubgraphUser;
    amount: string;
    timestamp: string;
    blockNumber: string;
}

export interface MemberInvitedEvent {
    id: string;
    circleId: string;
    inviter: SubgraphUser;
    invitee: SubgraphUser;
    circle: SubgraphCircle;
    timestamp: string;
    blockNumber: string;
}

export interface VotingInitiatedEvent {
    id: string;
    circleId: string;
    votingStartAt: string;
    votingEndAt: string;
    timestamp: string;
    blockNumber: string;
}

export interface VoteExecutedEvent {
    id: string;
    circleId: string;
    circleStarted: boolean;
    startVoteTotal: string;
    withdrawVoteTotal: string;
    timestamp: string;
    blockNumber: string;
}

export interface MemberForfeitedEvent {
    id: string;
    circleId: string;
    forfeiter: SubgraphUser;
    forfeitedUser: SubgraphUser;
    round: string;
    deductionAmount: string;
    timestamp: string;
    blockNumber: string;
}

export interface PersonalGoal {
    id: string;
    goalId: string;
    goalName: string;
    goalAmount: string;
    currentAmount: string;
    deadline: string;
    isActive: boolean;
    user: SubgraphUser;
}

export interface CircleMember {
    id: string;
    circleId: string;
    user: SubgraphUser;
}

// Preference key mapping
export const NOTIFICATION_PREFERENCE_KEYS: Record<NotificationType, keyof NotificationPreferences> = {
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
