import cron from "node-cron";
import { GraphQLClient, gql } from "graphql-request";
import { sendNotification } from "./pushService";
import type { PersonalGoal, SubgraphCircle, ContributionEvent, CircleJoinedEvent } from "../types";

const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "";
let client: GraphQLClient | null = null;

// Track sent notifications to avoid duplicates
const sentNotifications = new Set<string>();

/**
 * Initialize the scheduler
 */
export function initializeScheduler(): boolean {
    if (!SUBGRAPH_URL) {
        return false;
    }

    const SUBGRAPH_API_KEY = process.env.SUBGRAPH_API_KEY || "";
    const headers: Record<string, string> = {
        'User-Agent': 'CirclePot-Notification-Server/1.0.0'
    };

    if (SUBGRAPH_API_KEY) {
        headers['Authorization'] = `Bearer ${SUBGRAPH_API_KEY}`;
    }

    client = new GraphQLClient(SUBGRAPH_URL, { headers });
    return true;
}

/**
 * Get active goals from Subgraph
 */
async function getActiveGoals(): Promise<PersonalGoal[]> {
    if (!client) return [];

    const query = gql`
    query GetActiveGoals {
      personalGoals(where: { isActive: true }) {
        id
        goalId
        goalName
        goalAmount
        currentAmount
        deadline
        isActive
        user {
          id
          username
          fullName
        }
      }
    }
  `;

    try {
        const data = await client.request<{ personalGoals: PersonalGoal[] }>(query);
        return data.personalGoals;
    } catch (error) {
        return [];
    }
}

/**
 * Format amount from wei to human-readable
 */
function formatAmount(amountWei: string, decimals = 18): string {
    const amount = BigInt(amountWei);
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    const fractionStr = fraction.toString().padStart(decimals, "0").slice(0, 2);
    return `$${whole}.${fractionStr}`;
}

/**
 * Calculate progress percentage
 */
function calculateProgress(current: string, target: string): number {
    const currentAmount = BigInt(current);
    const targetAmount = BigInt(target);

    if (targetAmount === BigInt(0)) return 0;
    return Number((currentAmount * BigInt(100)) / targetAmount);
}

/**
 * Check goals and send deadline notifications
 */
async function checkGoalDeadlines(): Promise<void> {

    const goals = await getActiveGoals();
    const now = Math.floor(Date.now() / 1000);

    for (const goal of goals) {
        const deadline = parseInt(goal.deadline);
        const timeUntilDeadline = deadline - now;
        const daysUntilDeadline = timeUntilDeadline / 86400;

        // 2 days before deadline
        if (daysUntilDeadline <= 2 && daysUntilDeadline > 1) {
            const notificationKey = `goal_2days_${goal.id}`;

            if (!sentNotifications.has(notificationKey)) {
                const progress = calculateProgress(goal.currentAmount, goal.goalAmount);
                const remaining = formatAmount(
                    (BigInt(goal.goalAmount) - BigInt(goal.currentAmount)).toString()
                );

                await sendNotification([goal.user.id], {
                    title: "Goal Deadline Approaching ⏰",
                    message: `Your "${goal.goalName}" goal deadline is in 2 days! ${progress}% complete, ${remaining} remaining.`,
                    type: "goal_deadline_2days",
                    priority: "medium",
                    action: { action: "/goals" },
                    data: { goalId: goal.goalId, deadline: goal.deadline },
                });

                sentNotifications.add(notificationKey);
            }
        }

        // 1 day before deadline
        if (daysUntilDeadline <= 1 && daysUntilDeadline > 0) {
            const notificationKey = `goal_1day_${goal.id}`;

            if (!sentNotifications.has(notificationKey)) {
                const progress = calculateProgress(goal.currentAmount, goal.goalAmount);
                const remaining = formatAmount(
                    (BigInt(goal.goalAmount) - BigInt(goal.currentAmount)).toString()
                );

                await sendNotification([goal.user.id], {
                    title: "Goal Deadline Tomorrow! ⚡",
                    message: `Your "${goal.goalName}" goal deadline is tomorrow! ${progress}% complete, ${remaining} remaining.`,
                    type: "goal_deadline_1day",
                    priority: "high",
                    action: { action: "/goals" },
                    data: { goalId: goal.goalId, deadline: goal.deadline },
                });

                sentNotifications.add(notificationKey);
            }
        }

        // Check for milestone notifications (25%, 50%, 75%)
        const progress = calculateProgress(goal.currentAmount, goal.goalAmount);
        const milestones = [25, 50, 75];

        for (const milestone of milestones) {
            const notificationKey = `goal_milestone_${goal.id}_${milestone}`;

            if (progress >= milestone && progress < milestone + 5 && !sentNotifications.has(notificationKey)) {
                await sendNotification([goal.user.id], {
                    title: `Goal Milestone Reached! 🎯`,
                    message: `You've reached ${milestone}% of your "${goal.goalName}" goal!`,
                    type: "goal_milestone",
                    priority: "low",
                    action: { action: "/goals" },
                    data: { goalId: goal.goalId, milestone, progress },
                });

                sentNotifications.add(notificationKey);
            }
        }

        // Goal completed notification
        if (progress >= 100) {
            const notificationKey = `goal_completed_${goal.id}`;

            if (!sentNotifications.has(notificationKey)) {
                await sendNotification([goal.user.id], {
                    title: "Goal Completed! 🎉",
                    message: `Congratulations! You've completed your "${goal.goalName}" goal!`,
                    type: "goal_completed",
                    priority: "medium",
                    action: { action: "/goals" },
                    data: { goalId: goal.goalId },
                });

                sentNotifications.add(notificationKey);
            }
        }
    }
}

/**
 * Check Circle deadlines and send contribution reminders
 */
async function checkCircleDeadlines(): Promise<void> {
    if (!client) return;

    // 1. Get all active circles
    const circlesQuery = gql`
    query GetActiveCircles {
      circles(where: { state: 3 }) {
        id
        circleId
        circleName
        currentRound
        nextDeadline
        contributionAmount
      }
    }
  `;

    try {
        const circlesData = await client.request<{ circles: SubgraphCircle[] }>(circlesQuery);
        const circles = circlesData.circles;
        const now = Math.floor(Date.now() / 1000);

        // Identify circles that need checking (deadline within 24 hours)
        const activeCirclesWithDeadlines = circles.filter(circle => {
            if (!circle.nextDeadline) return false;
            const hoursUntilDeadline = (parseInt(circle.nextDeadline) - now) / 3600;
            return hoursUntilDeadline <= 24 && hoursUntilDeadline > 0;
        });

        if (activeCirclesWithDeadlines.length === 0) return;

        const circleIds = activeCirclesWithDeadlines.map(c => c.circleId);

        // 2. Batch fetch ALL members and ALL contributions for these circles
        const batchQuery = gql`
            query GetBatchDetails($circleIds: [BigInt!]!) {
                members: circleJoineds(where: { circleId_in: $circleIds }) {
                    circleId
                    user { id }
                }
                contributions: contributionMades(where: { circleId_in: $circleIds }) {
                    circleId
                    round
                    user { id }
                }
            }
        `;

        const { members, contributions } = await client.request<{
            members: CircleJoinedEvent[];
            contributions: ContributionEvent[];
        }>(batchQuery, { circleIds });

        // Map data for easy lookup
        const membersByCircle = new Map<string, string[]>();
        members.forEach(m => {
            const list = membersByCircle.get(m.circleId) || [];
            list.push(m.user.id);
            membersByCircle.set(m.circleId, list);
        });

        const contributionsByCircleRound = new Map<string, Set<string>>();
        contributions.forEach(c => {
            const key = `${c.circleId}_${c.round}`;
            const set = contributionsByCircleRound.get(key) || new Set();
            set.add(c.user.id);
            contributionsByCircleRound.set(key, set);
        });

        // 3. Process each circle using the batched data
        for (const circle of activeCirclesWithDeadlines) {
            const deadline = parseInt(circle.nextDeadline!);
            const hoursUntilDeadline = (deadline - now) / 3600;

            const memberAddresses = membersByCircle.get(circle.circleId) || [];
            const contributedAddresses = contributionsByCircleRound.get(`${circle.circleId}_${circle.currentRound}`) || new Set();

            // Filter members who haven't contributed
            const pendingMembers = memberAddresses.filter(addr => !contributedAddresses.has(addr));

            if (pendingMembers.length === 0) continue;

            const isFinalWarning = hoursUntilDeadline <= 1;
            const notificationType = isFinalWarning ? "late_payment_warning" : "contribution_due";
            const priority = isFinalWarning ? "high" : "medium";
            const timeStr = isFinalWarning ? "less than 1 hour" : "24 hours";
            const notificationKey = `circle_${notificationType}_${circle.id}_${circle.currentRound}`;

            if (!sentNotifications.has(notificationKey)) {
                await sendNotification(pendingMembers, {
                    title: isFinalWarning ? "Urgent: Circle Payment Due! ⚡" : "Circle Contribution Reminder ⏰",
                    message: `Your payment for "${circle.circleName}" is due in ${timeStr}. Pay now to avoid credit score loss!`,
                    type: notificationType,
                    priority: priority,
                    action: { action: `/circles/${circle.circleId}` },
                    data: { circleId: circle.circleId, round: circle.currentRound, deadline: circle.nextDeadline || "" },
                });

                sentNotifications.add(notificationKey);
            }
        }
    } catch (error: any) {
        console.error("Error checking circle deadlines. This usually indicates a network issue or rate limiting by The Graph gateway.");
        if (error.message.includes('SSL') || error.message.includes('EPROTO')) {
            console.error("SSL/Protocol Error detected. Tip: If you are on MacOS, try disabling Apple Private Relay or use a stable network.");
        }
        console.error(`Details: ${error.message}`);
    }
}

/**
 * Clean up old notification keys (run weekly)
 */
function cleanupSentNotifications(): void {
    sentNotifications.clear();
}

/**
 * Start the cron scheduler
 */
export function startScheduler(): void {
    // Check goal deadlines every day at 9 AM
    const goalCheckCron = process.env.GOAL_CHECK_CRON || "0 9 * * *";

    cron.schedule(goalCheckCron, () => {
        checkGoalDeadlines();
        checkCircleDeadlines();
    });

    // Also check every 6 hours for more timely notifications
    cron.schedule("0 */6 * * *", () => {
        checkGoalDeadlines();
        checkCircleDeadlines();
    });

    // Clean up old notification keys every Sunday
    cron.schedule("0 0 * * 0", () => {
        cleanupSentNotifications();
    });


    // Run initial check
    setTimeout(() => {
        checkGoalDeadlines();
        checkCircleDeadlines();
    }, 5000);
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus(): {
    sentNotificationsCount: number;
    isRunning: boolean;
} {
    return {
        sentNotificationsCount: sentNotifications.size,
        isRunning: true,
    };
}
