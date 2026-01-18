import { GraphQLClient, gql } from "graphql-request";
import { sendNotification } from "./pushService";
import { SystemState } from "../models/SystemState";

const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "";
const SUBGRAPH_API_KEY = process.env.SUBGRAPH_API_KEY || "";

let client: GraphQLClient | null = null;
let lastProcessedTimestamp = 0;
let isPolling = false;

// Event interfaces matching the schema
interface TransactionData {
    blockNumber: string;
    blockTimestamp: string;
    transactionHash: string;
}

interface UserData {
    id: string;
    username?: string;
    fullName?: string;
}

interface CircleJoinedEvent {
    id: string;
    circleId: string;
    user: UserData;
    currentMembers: string;
    circleState: number;
    transaction: TransactionData;
}

interface PayoutDistributedEvent {
    id: string;
    user: UserData;
    circleId: string;
    round: string;
    payoutAmount: string;
    nextRoundDeadline?: string;
    transaction: TransactionData;
}

interface ContributionMadeEvent {
    id: string;
    user: UserData;
    circleId: string;
    round: string;
    amount: string;
    transaction: TransactionData;
}

interface CollateralWithdrawnEvent {
    id: string;
    user: UserData;
    circleId: string;
    amount: string;
    transaction: TransactionData;
}

interface MemberInvitedEvent {
    id: string;
    inviter: UserData;
    invitee: UserData;
    circleId: string;
    invitedAt: string;
    transaction: TransactionData;
}

interface VotingInitiatedEvent {
    id: string;
    circleId: string;
    votingStartAt: string;
    votingEndAt: string;
    transaction: TransactionData;
}

interface VoteExecutedEvent {
    id: string;
    circleId: string;
    circleStarted: boolean;
    startVoteTotal: string;
    withdrawVoteTotal: string;
    withdrawWon: boolean;
    transaction: TransactionData;
}

interface MemberForfeitedEvent {
    id: string;
    forfeiter: UserData;
    forfeitedUser: UserData;
    circleId: string;
    round: string;
    deductionAmount: string;
    transaction: TransactionData;
}

interface ReputationEvent {
    id: string;
    user: UserData;
    points: string;
    reason: string;
    transaction: TransactionData;
}

interface CategoryEvent {
    id: string;
    user: UserData;
    oldCategory: number;
    newCategory: number;
    transaction: TransactionData;
}

interface ReferralRewardEvent {
    id: string;
    referrer: UserData;
    referee: UserData;
    rewardAmount: string;
    transaction: TransactionData;
}

interface CircleData {
    circleId: string;
    circleName: string;
}

/**
 * Initialize the Subgraph client
 */
export function initializeSubgraphService(): boolean {
    if (!SUBGRAPH_URL) {
        return false;
    }

    const headers: Record<string, string> = {
        'User-Agent': 'CirclePot-Notification-Server/1.0.0'
    };

    if (SUBGRAPH_API_KEY) {
        headers['Authorization'] = `Bearer ${SUBGRAPH_API_KEY}`;
    }

    client = new GraphQLClient(SUBGRAPH_URL, { headers });
    if (SUBGRAPH_API_KEY) {
    }
    return true;
}

/**
 * Get members of a circle from Subgraph
 */
async function getCircleMembers(circleId: string): Promise<string[]> {
    if (!client) return [];


    const query = gql`
    query GetCircleMembers($circleId: BigInt!) {
      circleJoineds(where: { circleId: $circleId }) {
        user {
          id
        }
      }
      circles(where: { circleId: $circleId }) {
        creator {
          id
        }
      }
    }
  `;

    try {
        const data = await client.request<{
            circleJoineds: Array<{ user: { id: string } }>;
            circles: Array<{ creator: { id: string } }>;
        }>(query, { circleId: circleId.toString() });


        const members = new Set<string>();

        if (data.circleJoineds) {
            data.circleJoineds.forEach((cj) => {
                if (cj.user?.id) members.add(cj.user.id.toLowerCase());
            });
        }

        if (data.circles?.[0]?.creator?.id) {
            members.add(data.circles[0].creator.id.toLowerCase());
        }

        const memberList = Array.from(members);
        return memberList;
    } catch (error: any) {
        return [];
    }
}


/**
 * Get circle name by ID
 */
async function getCircleName(circleId: string): Promise<string> {
    if (!client) return "your circle";

    const query = gql`
    query GetCircle($circleId: BigInt!) {
      circles(where: { circleId: $circleId }) {
        circleName
      }
    }
  `;

    try {
        const data = await client.request<{ circles: Array<{ circleName: string }> }>(
            query,
            { circleId }
        );
        return data.circles[0]?.circleName || "your circle";
    } catch (error) {
        return "your circle";
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
 * Process circle joined events
 */
export async function processCircleJoinedEvents(events: CircleJoinedEvent[]): Promise<void> {
    if (events.length > 0) {
    }
    for (const event of events) {
        if (!event.user?.id) continue;
        const members = await getCircleMembers(event.circleId);
        const membersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());


        if (membersToNotify.length > 0) {
            const userName = event.user.username || "Someone";
            const circleName = await getCircleName(event.circleId);

            const results = await sendNotification(membersToNotify, {
                title: "New Member Joined 👋",
                message: `${userName} joined "${circleName}"`,
                type: "circle_member_joined",
                priority: "high",
                action: { action: "/circles" },
                data: { circleId: event.circleId, newMember: event.user.id },
            });
        }
    }
}

/**
 * Process payout events
 */
export async function processPayoutEvents(events: PayoutDistributedEvent[]): Promise<void> {
    if (events.length > 0) {
    }
    for (const event of events) {
        if (!event.user?.id) continue;
        const amount = formatAmount(event.payoutAmount);

        const members = await getCircleMembers(event.circleId);
        const recipientAddress = event.user.id.toLowerCase();
        const circleName = await getCircleName(event.circleId);

        // 1. Notify the recipient specifically
        await sendNotification([recipientAddress], {
            title: "Payment Received! 💰",
            message: `You received ${amount} from "${circleName}" payout (Round ${event.round})`,
            type: "circle_payout",
            priority: "high",
            action: { action: "/transactions-history" },
            data: { circleId: event.circleId, amount: event.payoutAmount, round: event.round },
        });

        // 2. Notify other members about the payout
        const othersToNotify = members.filter((m) => m.toLowerCase() !== recipientAddress);

        if (othersToNotify.length > 0) {
            const recipientName = event.user.username || "A member";

            const results = await sendNotification(othersToNotify, {
                title: "Circle Payout Completed",
                message: `${recipientName} received their payout of ${amount} for "${circleName}" circle (Round ${event.round})`,
                type: "circle_member_payout",
                priority: "medium",
                action: { action: "/circles" },
                data: { circleId: event.circleId, round: event.round },
            });
        }
    }
}

/**
 * Process contribution events
 */
export async function processContributionEvents(events: ContributionMadeEvent[]): Promise<void> {
    if (events.length > 0) {
    }
    for (const event of events) {
        try {
            if (!event.user?.id) continue;
            const members = await getCircleMembers(event.circleId);
            const othersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());


            const contributorName = event.user.username || "A member";
            const amount = formatAmount(event.amount);
            const circleName = await getCircleName(event.circleId);

            // 1. Notify the contributor themselves (Confirmation)
            await sendNotification([event.user.id.toLowerCase()], {
                title: "Contribution Successful! ✅",
                message: `Your contribution of ${amount} to "${circleName}" was successful (Round ${event.round})`,
                type: "payment_received",
                priority: "high",
                action: { action: "/transactions-history" },
                data: { circleId: event.circleId, round: event.round },
            });

            // 2. Notify other members
            if (othersToNotify.length > 0) {
                const results = await sendNotification(othersToNotify, {
                    title: "Circle Contribution Made ✅",
                    message: `${contributorName} contributed ${amount} to "${circleName}" (Round ${event.round})`,
                    type: "circle_member_contributed",
                    priority: "medium",
                    action: { action: "/circles" },
                    data: { circleId: event.circleId, round: event.round },
                });
            }
        } catch (error) {
        }
    }
}

/**
 * Process collateral withdrawn events
 */
export async function processCollateralWithdrawnEvents(events: CollateralWithdrawnEvent[]): Promise<void> {
    if (events.length > 0) {
    }
    for (const event of events) {
        try {
            if (!event.user?.id) continue;
            const amount = formatAmount(event.amount);
            const circleName = await getCircleName(event.circleId);


            // 1. Notify the user who withdrew
            await sendNotification([event.user.id], {
                title: "Collateral Returned 💵",
                message: `Your collateral of ${amount} has been returned`,
                type: "collateral_returned",
                priority: "high",
                action: { action: "/transactions-history" },
                data: { circleId: event.circleId, amount: event.amount },
            });

            // 2. Notify other members
            const members = await getCircleMembers(event.circleId);
            const othersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());

            if (othersToNotify.length > 0) {
                const userName = event.user.username || "A member";

                const results = await sendNotification(othersToNotify, {
                    title: "Member Withdrew",
                    message: `${userName} withdrew their collateral from "${circleName}"`,
                    type: "circle_member_withdrew",
                    priority: "medium",
                    action: { action: "/circles" },
                    data: { circleId: event.circleId },
                });
                //console.log(`[SubgraphService] Withdrawal notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
            }
        } catch (error) {
            console.error(`[SubgraphService] Error processing collateral withdrawal event:`, error);
        }
    }
}

/**
 * Process member invited events
 */
export async function processMemberInvitedEvents(events: MemberInvitedEvent[]): Promise<void> {
    if (events.length > 0) {
        //console.log(`[SubgraphService] Processing ${events.length} member invitation events`);
    }
    for (const event of events) {
        if (!event.invitee?.id) continue;
        const inviterName = event.inviter?.username || "Someone";
        const circleName = await getCircleName(event.circleId);

        //console.log(`[SubgraphService] Invitation from ${event.inviter?.id} to ${event.invitee.id} for circle ${event.circleId}`);

        const results = await sendNotification([event.invitee.id], {
            title: "Circle Invitation 📩",
            message: `${inviterName} invited you to join "${circleName}"`,
            type: "circle_invite",
            priority: "high",
            action: { action: "/browse" },
            data: { circleId: event.circleId, inviter: event.inviter?.id },
        });
        //console.log(`[SubgraphService] Invitation notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
    }
}

/**
 * Process voting initiated events
 */
export async function processVotingInitiatedEvents(events: VotingInitiatedEvent[]): Promise<void> {
    if (events.length > 0) {
        //console.log(`[SubgraphService] Processing ${events.length} voting initiated events`);
    }
    for (const event of events) {
        const members = await getCircleMembers(event.circleId);
        const votingEnd = new Date(parseInt(event.votingEndAt) * 1000);

        //console.log(`[SubgraphService] Voting initiated for circle ${event.circleId}. Notifying ${members.length} members.`);

        const results = await sendNotification(members, {
            title: "Vote Required! 🗳️",
            message: `Voting has started for your circle. Cast your vote before ${votingEnd.toLocaleDateString()}`,
            type: "vote_required",
            priority: "high",
            action: { action: "/circles" },
            data: { circleId: event.circleId, votingEndAt: event.votingEndAt },
        });
        //console.log(`[SubgraphService] Voting notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
    }
}

/**
 * Process vote executed events
 */
export async function processVoteExecutedEvents(events: VoteExecutedEvent[]): Promise<void> {
    if (events.length > 0) {
        //console.log(`[SubgraphService] Processing ${events.length} vote executed events`);
    }
    for (const event of events) {
        const members = await getCircleMembers(event.circleId);
        const result = event.circleStarted ? "Circle Started! 🚀" : "Circle did not start";

        //console.log(`[SubgraphService] Vote executed for circle ${event.circleId}. Circle started: ${event.circleStarted}. Notifying ${members.length} members.`);

        const results = await sendNotification(members, {
            title: "Voting Results",
            message: result,
            type: event.circleStarted ? "circle_started" : "vote_executed",
            priority: "high",
            action: { action: "/" },
            data: {
                circleId: event.circleId,
                started: event.circleStarted,
                startVotes: event.startVoteTotal,
                withdrawVotes: event.withdrawVoteTotal,
            },
        });
        //console.log(`[SubgraphService] Vote result notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
    }
}

/**
 * Process member forfeited events
 */
export async function processMemberForfeitedEvents(events: MemberForfeitedEvent[]): Promise<void> {
    if (events.length > 0) {
        //console.log(`[SubgraphService] Processing ${events.length} member forfeited events`);
    }
    for (const event of events) {
        if (!event.forfeitedUser?.id) continue;
        const forfeitedName = event.forfeitedUser.username || "A member";
        const amount = formatAmount(event.deductionAmount);
        const circleName = await getCircleName(event.circleId);


        // 1. Notify the forfeited user
        await sendNotification([event.forfeitedUser.id], {
            title: "You have been forfeited ⚠️",
            message: `You were forfeited from "${circleName}". Deduction: ${amount} (Round ${event.round})`,
            type: "member_forfeited",
            priority: "high",
            action: { action: "/circles" },
            data: { circleId: event.circleId, round: event.round, amount: event.deductionAmount },
        });

        // 2. Notify other members
        const members = await getCircleMembers(event.circleId);
        const othersToNotify = members.filter((m) => m.toLowerCase() !== event.forfeitedUser.id.toLowerCase());

        if (othersToNotify.length > 0) {
            const results = await sendNotification(othersToNotify, {
                title: "Member Forfeited",
                message: `${forfeitedName} has been forfeited from "${circleName}" (Round ${event.round})`,
                type: "member_forfeited",
                priority: "medium",
                action: { action: "/circles" },
                data: { circleId: event.circleId, round: event.round },
            });
            //console.log(`[SubgraphService] Forfeiture notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
        }
    }
}

/**
 * Process reputation events
 */
export async function processReputationEvents(events: ReputationEvent[], isIncrease: boolean): Promise<void> {
    for (const event of events) {
        if (!event.user?.id) continue;
        const emoji = isIncrease ? "⭐️" : "⚠️";
        const title = isIncrease ? "Reputation Boost!" : "Reputation Decreased";

        await sendNotification([event.user.id], {
            title: `${title} ${emoji}`,
            message: `Your reputation ${isIncrease ? "increased" : "decreased"} by ${event.points} points. Reason: ${event.reason}`,
            type: "credit_score_changed",
            priority: isIncrease ? "medium" : "high",
            action: { action: "/profile" },
            data: { points: event.points, reason: event.reason },
        });
    }
}

/**
 * Process category change events
 */
export async function processCategoryEvents(events: CategoryEvent[]): Promise<void> {
    const categories = ["Newbie", "Basic", "Bronze", "Silver", "Gold", "Platinum"];
    for (const event of events) {
        if (!event.user?.id) continue;
        const newCat = categories[event.newCategory] || "Elite";
        const improved = event.newCategory > event.oldCategory;

        await sendNotification([event.user.id], {
            title: improved ? "Category Level Up! 📈" : "Category Changed",
            message: improved
                ? `Congratulations! You've been promoted to the ${newCat} category.`
                : `Your credit category has changed to ${newCat}.`,
            type: "credit_score_changed",
            priority: "high",
            action: { action: "/profile" },
            data: { newCategory: event.newCategory },
        });
    }
}

/**
 * Process referral reward events
 */
export async function processReferralEvents(events: ReferralRewardEvent[]): Promise<void> {
    for (const event of events) {
        if (!event.referrer?.id) continue;
        const amount = formatAmount(event.rewardAmount);
        const friend = event.referee?.username || "A friend";
        const message = event.referee
            ? `You just earned ${amount} because ${friend} joined Circlepot!`
            : `You just earned a referral bonus of ${amount}!`;

        await sendNotification([event.referrer.id], {
            title: "Referral Bonus! 🎁",
            message: message,
            type: "payment_received",
            priority: "high",
            action: { action: "/profile" },
            data: { amount: event.rewardAmount },
        });
    }
}


/**
 * Query for new events since last timestamp
 */
async function queryNewEvents(): Promise<{
    circleJoineds: CircleJoinedEvent[];
    payoutDistributeds: PayoutDistributedEvent[];
    contributionMades: ContributionMadeEvent[];
    collateralWithdrawns: CollateralWithdrawnEvent[];
    memberInviteds: MemberInvitedEvent[];
    votingInitiateds: VotingInitiatedEvent[];
    voteExecuteds: VoteExecutedEvent[];
    memberForfeiteds: MemberForfeitedEvent[];
    reputationIncreases: ReputationEvent[];
    reputationDecreases: ReputationEvent[];
    categoryChanges: CategoryEvent[];
    referralRewards: ReferralRewardEvent[];
    latestTimestamp: number;
}> {
    if (!client) {
        return {
            circleJoineds: [],
            payoutDistributeds: [],
            contributionMades: [],
            collateralWithdrawns: [],
            memberInviteds: [],
            votingInitiateds: [],
            voteExecuteds: [],
            memberForfeiteds: [],
            reputationIncreases: [],
            reputationDecreases: [],
            categoryChanges: [],
            referralRewards: [],
            latestTimestamp: lastProcessedTimestamp,
        };
    }

    const query = gql`
    query GetNewEvents($lastTimestamp: BigInt!) {
      circleJoineds(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
        orderBy: transaction__blockTimestamp
        orderDirection: asc
      ) {
        id
        circleId
        user { id username fullName }
        currentMembers
        circleState
        transaction { blockNumber blockTimestamp transactionHash }
      }
      payoutDistributeds(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
        orderBy: transaction__blockTimestamp
        orderDirection: asc
      ) {
        id
        user { id username fullName }
        circleId
        round
        payoutAmount
        transaction { blockNumber blockTimestamp transactionHash }
      }
      contributionMades(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
        orderBy: transaction__blockTimestamp
        orderDirection: asc
      ) {
        id
        user { id username fullName }
        circleId
        round
        amount
        transaction { blockNumber blockTimestamp transactionHash }
      }
      collateralWithdrawns(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
        orderBy: transaction__blockTimestamp
        orderDirection: asc
      ) {
        id
        user { id username fullName }
        circleId
        amount
        transaction { blockNumber blockTimestamp transactionHash }
      }
      memberInviteds(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
        orderBy: transaction__blockTimestamp
        orderDirection: asc
      ) {
        id
        inviter { id username fullName }
        invitee { id username fullName }
        circleId
        invitedAt
        transaction { blockNumber blockTimestamp transactionHash }
      }
      votingInitiateds(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
        orderBy: transaction__blockTimestamp
        orderDirection: asc
      ) {
        id
        circleId
        votingStartAt
        votingEndAt
        transaction { blockNumber blockTimestamp transactionHash }
      }
      voteExecuteds(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
        orderBy: transaction__blockTimestamp
        orderDirection: asc
      ) {
        id
        circleId
        circleStarted
        startVoteTotal
        withdrawVoteTotal
        withdrawWon
        transaction { blockNumber blockTimestamp transactionHash }
      }
      memberForfeiteds(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
        orderBy: transaction__blockTimestamp
        orderDirection: asc
      ) {
        id
        forfeiter { id username fullName }
        forfeitedUser { id username fullName }
        circleId
        round
        deductionAmount
        transaction { blockNumber blockTimestamp transactionHash }
      }
      reputationIncreaseds(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
      ) {
        id
        user { id username fullName }
        points
        reason
        transaction { blockTimestamp }
      }
      reputationDecreaseds(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
      ) {
        id
        user { id username fullName }
        points
        reason
        transaction { blockTimestamp }
      }
      scoreCategoryChangeds(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
      ) {
        id
        user { id username fullName }
        oldCategory
        newCategory
        transaction { blockTimestamp }
      }
      referralRewardPaids(
        where: { transaction_: { blockTimestamp_gt: $lastTimestamp } }
      ) {
        id
        referrer { id username fullName }
        referee { id username fullName }
        rewardAmount
        transaction { blockTimestamp }
      }
      _meta {
        block {
          number
          timestamp
        }
      }
    }
  `;

    try {
        if (!client) throw new Error("GraphQL client not initialized");

        const data = await client.request<{
            circleJoineds: CircleJoinedEvent[];
            payoutDistributeds: PayoutDistributedEvent[];
            contributionMades: ContributionMadeEvent[];
            collateralWithdrawns: CollateralWithdrawnEvent[];
            memberInviteds: MemberInvitedEvent[];
            votingInitiateds: VotingInitiatedEvent[];
            voteExecuteds: VoteExecutedEvent[];
            memberForfeiteds: MemberForfeitedEvent[];
            reputationIncreaseds: ReputationEvent[];
            reputationDecreaseds: ReputationEvent[];
            scoreCategoryChangeds: CategoryEvent[];
            referralRewardPaids: ReferralRewardEvent[];
            _meta: { block: { number: number; timestamp: number } };
        }>(query, { lastTimestamp: lastProcessedTimestamp.toString() });

        const totalEvents =
            data.circleJoineds.length +
            data.payoutDistributeds.length +
            data.contributionMades.length +
            data.collateralWithdrawns.length +
            data.memberInviteds.length +
            data.votingInitiateds.length +
            data.voteExecuteds.length +
            data.memberForfeiteds.length +
            (data.reputationIncreaseds?.length || 0) +
            (data.reputationDecreaseds?.length || 0) +
            (data.scoreCategoryChangeds?.length || 0) +
            (data.referralRewardPaids?.length || 0);


        if (totalEvents > 0) {
            //console.log(`[SubgraphService] Found ${totalEvents} new events since timestamp ${lastProcessedTimestamp}`);
        }

        return {
            circleJoineds: data.circleJoineds,
            payoutDistributeds: data.payoutDistributeds,
            contributionMades: data.contributionMades,
            collateralWithdrawns: data.collateralWithdrawns,
            memberInviteds: data.memberInviteds,
            votingInitiateds: data.votingInitiateds,
            voteExecuteds: data.voteExecuteds,
            memberForfeiteds: data.memberForfeiteds,
            reputationIncreases: data.reputationIncreaseds || [],
            reputationDecreases: data.reputationDecreaseds || [],
            categoryChanges: data.scoreCategoryChangeds || [],
            referralRewards: data.referralRewardPaids || [],
            latestTimestamp: data._meta?.block?.timestamp || lastProcessedTimestamp,
        };
    } catch (error: any) {
        console.error("[SubgraphService] Error querying new events. This usually indicates a network issue or rate limiting by The Graph gateway.");
        if (error.message.includes('SSL') || error.message.includes('EPROTO')) {
            console.error("[SubgraphService] SSL/Protocol Error detected. Tip: If you are on MacOS, try disabling Apple Private Relay or use a stable network.");
        }
        console.error(`[SubgraphService] Details: ${error.message}`);
        return {
            circleJoineds: [],
            payoutDistributeds: [],
            contributionMades: [],
            collateralWithdrawns: [],
            memberInviteds: [],
            votingInitiateds: [],
            voteExecuteds: [],
            memberForfeiteds: [],
            reputationIncreases: [],
            reputationDecreases: [],
            categoryChanges: [],
            referralRewards: [],
            latestTimestamp: lastProcessedTimestamp,
        };
    }
}

/**
 * Poll for new events and process them with retry logic
 */
export async function pollAndProcess(retryCount = 0): Promise<void> {
    if (!client || isPolling) return;
    isPolling = true;

    try {
        if (!lastProcessedTimestamp) {
            // Try to load from database first
            const state = await SystemState.findOne({ key: "lastProcessedTimestamp" });
            if (state && typeof state.value === "number" && state.value > 0) {
                lastProcessedTimestamp = state.value;
                //console.log(`[SubgraphService] Resuming from persisted timestamp: ${lastProcessedTimestamp}`);
            } else {
                // Initial poll - just get current timestamp to start from now
                lastProcessedTimestamp = Math.floor(Date.now() / 1000);
                //console.log(`[SubgraphService] Starting fresh from current timestamp: ${lastProcessedTimestamp}`);
                await SystemState.updateOne(
                    { key: "lastProcessedTimestamp" },
                    { value: lastProcessedTimestamp },
                    { upsert: true }
                );
            }
            isPolling = false;
            return;
        }

        const events = await queryNewEvents();

        // Heartbeat log to show polling is active
        if (Math.random() < 0.1) { // Log approx every 10 polls (~5 mins at 30s)
            //console.log(`[SubgraphService] Heartbeat: Polling Subgraph... (Last: ${lastProcessedTimestamp})`);
        }

        // Process each event type
        if (events.circleJoineds.length > 0) {
            await processCircleJoinedEvents(events.circleJoineds);
        }

        if (events.payoutDistributeds.length > 0) {
            await processPayoutEvents(events.payoutDistributeds);
        }

        if (events.contributionMades.length > 0) {
            await processContributionEvents(events.contributionMades);
        }

        if (events.collateralWithdrawns.length > 0) {
            await processCollateralWithdrawnEvents(events.collateralWithdrawns);
        }

        if (events.memberInviteds.length > 0) {
            await processMemberInvitedEvents(events.memberInviteds);
        }

        if (events.votingInitiateds.length > 0) {
            await processVotingInitiatedEvents(events.votingInitiateds);
        }

        if (events.voteExecuteds.length > 0) {
            await processVoteExecutedEvents(events.voteExecuteds);
        }

        if (events.memberForfeiteds.length > 0) {
            await processMemberForfeitedEvents(events.memberForfeiteds);
        }

        if (events.reputationIncreases.length > 0) {
            await processReputationEvents(events.reputationIncreases, true);
        }

        if (events.reputationDecreases.length > 0) {
            await processReputationEvents(events.reputationDecreases, false);
        }

        if (events.categoryChanges.length > 0) {
            await processCategoryEvents(events.categoryChanges);
        }

        if (events.referralRewards.length > 0) {
            await processReferralEvents(events.referralRewards);
        }

        // Update last processed timestamp
        if (events.latestTimestamp > lastProcessedTimestamp) {
            lastProcessedTimestamp = events.latestTimestamp;
            await SystemState.updateOne(
                { key: "lastProcessedTimestamp" },
                { value: lastProcessedTimestamp },
                { upsert: true }
            );
        }
    } catch (error: any) {
        console.error("[SubgraphService] Error polling and processing events:", error);
        // Retry logic for transient errors (like SSL bad record mac)
        if (retryCount < 3) {
            const delay = Math.pow(2, retryCount) * 1000;
            setTimeout(() => {
                isPolling = false;
                pollAndProcess(retryCount + 1);
            }, delay);
            return; // Don't reset isPolling here, let the timeout do it
        }
    } finally {
        isPolling = false;
    }
}

/**
 * Start polling interval
 */
export function startPolling(intervalMs: number = 30000): void {
    if (!client) {
        return;
    }

    setInterval(pollAndProcess, intervalMs);

    // Run immediately
    pollAndProcess();
}

/**
 * Get current polling status
 */
export function getPollingStatus(): { lastTimestamp: number; isPolling: boolean } {
    return {
        lastTimestamp: lastProcessedTimestamp,
        isPolling,
    };
}
