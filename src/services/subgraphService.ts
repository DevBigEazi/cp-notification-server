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

interface CircleData {
    circleId: string;
    circleName: string;
}

/**
 * Initialize the Subgraph client
 */
export function initializeSubgraphService(): boolean {
    if (!SUBGRAPH_URL) {
        console.error("[SubgraphService] FAILED to initialize: SUBGRAPH_URL is missing in .env");
        return false;
    }

    const headers: Record<string, string> = {};
    if (SUBGRAPH_API_KEY) {
        headers['Authorization'] = `Bearer ${SUBGRAPH_API_KEY}`;
    }

    client = new GraphQLClient(SUBGRAPH_URL, { headers });
    console.log("[SubgraphService] Successfully initialized with URL:", SUBGRAPH_URL);
    if (SUBGRAPH_API_KEY) {
        console.log("[SubgraphService] Using API Key for Authorization");
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
        console.log(`[SubgraphService] Querying members for circle ${circleId}`);
        const data = await client.request<{
            circleJoineds: Array<{ user: { id: string } }>;
            circles: Array<{ creator: { id: string } }>;
        }>(query, { circleId: circleId.toString() });

        console.log(`[SubgraphService] Subgraph response for circle ${circleId}: OK`);

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
        console.log(`[SubgraphService] Total members found for circle ${circleId}: ${memberList.length}`);
        return memberList;
    } catch (error: any) {
        console.error(`[SubgraphService] Error fetching members for ${circleId}:`, error.message);
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
        console.log(`[SubgraphService] Processing ${events.length} circle joined events`);
    }
    for (const event of events) {
        if (!event.user?.id) continue;
        const members = await getCircleMembers(event.circleId);
        const membersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());

        console.log(`[SubgraphService] Member ${event.user.id} joined circle ${event.circleId}. Notifying ${membersToNotify.length} existing members.`);

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
            console.log(`[SubgraphService] Join notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
        }
    }
}

/**
 * Process payout events
 */
export async function processPayoutEvents(events: PayoutDistributedEvent[]): Promise<void> {
    if (events.length > 0) {
        console.log(`[SubgraphService] Processing ${events.length} payout events`);
    }
    for (const event of events) {
        if (!event.user?.id) continue;
        const amount = formatAmount(event.payoutAmount);

        console.log(`[SubgraphService] Payout of ${amount} to ${event.user.id} in circle ${event.circleId}`);

        // 1. Notify the recipient
        await sendNotification([event.user.id], {
            title: "Payment Received! 💰",
            message: `You received ${amount} from your circle payout (Round ${event.round})`,
            type: "payment_received",
            priority: "high",
            action: { action: "/transactions-history" },
            data: { circleId: event.circleId, amount: event.payoutAmount, round: event.round },
        });

        // 2. Notify other members about the payout
        const members = await getCircleMembers(event.circleId);
        const othersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());

        if (othersToNotify.length > 0) {
            const recipientName = event.user.username || "A member";

            const results = await sendNotification(othersToNotify, {
                title: "Circle Payout Completed",
                message: `${recipientName} received their payout of ${amount}`,
                type: "circle_member_payout",
                priority: "high",
                action: { action: "/circles" },
                data: { circleId: event.circleId, round: event.round },
            });
            console.log(`[SubgraphService] Payout notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
        }
    }
}

/**
 * Process contribution events
 */
export async function processContributionEvents(events: ContributionMadeEvent[]): Promise<void> {
    if (events.length > 0) {
        console.log(`[SubgraphService] Processing ${events.length} contribution events`);
    }
    for (const event of events) {
        try {
            if (!event.user?.id) continue;
            const members = await getCircleMembers(event.circleId);
            const othersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());

            console.log(`[SubgraphService] Contribution by ${event.user.id} in circle ${event.circleId}. Notifying ${othersToNotify.length} others.`);

            const contributorName = event.user.username || "A member";
            const amount = formatAmount(event.amount);

            // 1. Notify the contributor themselves (Confirmation)
            await sendNotification([event.user.id], {
                title: "Contribution Successful! ✅",
                message: `You contributed ${amount} to your circle (Round ${event.round})`,
                type: "payment_received",
                priority: "high",
                action: { action: "/" },
                data: { circleId: event.circleId, round: event.round },
            });

            // 2. Notify other members
            if (othersToNotify.length > 0) {
                const results = await sendNotification(othersToNotify, {
                    title: "Contribution Made ✅",
                    message: `${contributorName} contributed ${amount} (Round ${event.round})`,
                    type: "circle_member_contributed",
                    priority: "high",
                    action: { action: "/" },
                    data: { circleId: event.circleId, round: event.round },
                });
                console.log(`[SubgraphService] Contribution notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
            }
        } catch (error) {
            console.error(`[SubgraphService] Error processing contribution event:`, error);
        }
    }
}

/**
 * Process collateral withdrawn events
 */
export async function processCollateralWithdrawnEvents(events: CollateralWithdrawnEvent[]): Promise<void> {
    if (events.length > 0) {
        console.log(`[SubgraphService] Processing ${events.length} collateral withdrawal events`);
    }
    for (const event of events) {
        if (!event.user?.id) continue;
        const amount = formatAmount(event.amount);

        console.log(`[SubgraphService] Collateral withdrawal of ${amount} by ${event.user.id}`);

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
                message: `${userName} withdrew their collateral`,
                type: "circle_member_withdrew",
                priority: "high",
                action: { action: "/transactions-history" },
                data: { circleId: event.circleId },
            });
            console.log(`[SubgraphService] Withdrawal notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
        }
    }
}

/**
 * Process member invited events
 */
export async function processMemberInvitedEvents(events: MemberInvitedEvent[]): Promise<void> {
    if (events.length > 0) {
        console.log(`[SubgraphService] Processing ${events.length} member invitation events`);
    }
    for (const event of events) {
        if (!event.invitee?.id) continue;
        const inviterName = event.inviter?.username || "Someone";
        const circleName = await getCircleName(event.circleId);

        console.log(`[SubgraphService] Invitation from ${event.inviter?.id} to ${event.invitee.id} for circle ${event.circleId}`);

        const results = await sendNotification([event.invitee.id], {
            title: "Circle Invitation 📩",
            message: `${inviterName} invited you to join "${circleName}"`,
            type: "circle_invite",
            priority: "high",
            action: { action: "/browse" },
            data: { circleId: event.circleId, inviter: event.inviter?.id },
        });
        console.log(`[SubgraphService] Invitation notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
    }
}

/**
 * Process voting initiated events
 */
export async function processVotingInitiatedEvents(events: VotingInitiatedEvent[]): Promise<void> {
    if (events.length > 0) {
        console.log(`[SubgraphService] Processing ${events.length} voting initiated events`);
    }
    for (const event of events) {
        const members = await getCircleMembers(event.circleId);
        const votingEnd = new Date(parseInt(event.votingEndAt) * 1000);

        console.log(`[SubgraphService] Voting initiated for circle ${event.circleId}. Notifying ${members.length} members.`);

        const results = await sendNotification(members, {
            title: "Vote Required! 🗳️",
            message: `Voting has started for your circle. Cast your vote before ${votingEnd.toLocaleDateString()}`,
            type: "vote_required",
            priority: "high",
            action: { action: "/circles" },
            data: { circleId: event.circleId, votingEndAt: event.votingEndAt },
        });
        console.log(`[SubgraphService] Voting notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
    }
}

/**
 * Process vote executed events
 */
export async function processVoteExecutedEvents(events: VoteExecutedEvent[]): Promise<void> {
    if (events.length > 0) {
        console.log(`[SubgraphService] Processing ${events.length} vote executed events`);
    }
    for (const event of events) {
        const members = await getCircleMembers(event.circleId);
        const result = event.circleStarted ? "Circle Started! 🚀" : "Circle did not start";

        console.log(`[SubgraphService] Vote executed for circle ${event.circleId}. Circle started: ${event.circleStarted}. Notifying ${members.length} members.`);

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
        console.log(`[SubgraphService] Vote result notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
    }
}

/**
 * Process member forfeited events
 */
export async function processMemberForfeitedEvents(events: MemberForfeitedEvent[]): Promise<void> {
    if (events.length > 0) {
        console.log(`[SubgraphService] Processing ${events.length} member forfeited events`);
    }
    for (const event of events) {
        if (!event.forfeitedUser?.id) continue;
        const forfeitedName = event.forfeitedUser.username || "A member";
        const amount = formatAmount(event.deductionAmount);

        console.log(`[SubgraphService] Member ${event.forfeitedUser.id} forfeited from circle ${event.circleId}`);

        // 1. Notify the forfeited user
        await sendNotification([event.forfeitedUser.id], {
            title: "You have been forfeited ⚠️",
            message: `You were forfeited from your circle. Deduction: ${amount}`,
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
                message: `${forfeitedName} has been forfeited from the circle`,
                type: "member_forfeited",
                priority: "high",
                action: { action: "/Circles" },
                data: { circleId: event.circleId, round: event.round },
            });
            console.log(`[SubgraphService] Forfeiture notification results: Sent: ${results.sent}, Failed: ${results.failed}`);
        }
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
      _meta {
        block {
          number
          timestamp
        }
      }
    }
  `;

    try {
        const data = await client.request<{
            circleJoineds: CircleJoinedEvent[];
            payoutDistributeds: PayoutDistributedEvent[];
            contributionMades: ContributionMadeEvent[];
            collateralWithdrawns: CollateralWithdrawnEvent[];
            memberInviteds: MemberInvitedEvent[];
            votingInitiateds: VotingInitiatedEvent[];
            voteExecuteds: VoteExecutedEvent[];
            memberForfeiteds: MemberForfeitedEvent[];
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
            data.memberForfeiteds.length;


        if (totalEvents > 0) {
            console.log(`[SubgraphService] Found ${totalEvents} new events since timestamp ${lastProcessedTimestamp}`);
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
            latestTimestamp: data._meta?.block?.timestamp || lastProcessedTimestamp,
        };
    } catch (error) {
        console.error("[SubgraphService] Error querying new events:", error);
        return {
            circleJoineds: [],
            payoutDistributeds: [],
            contributionMades: [],
            collateralWithdrawns: [],
            memberInviteds: [],
            votingInitiateds: [],
            voteExecuteds: [],
            memberForfeiteds: [],
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
                console.log(`[SubgraphService] Resuming from persisted timestamp: ${lastProcessedTimestamp}`);
            } else {
                // Initial poll - just get current timestamp to start from now
                lastProcessedTimestamp = Math.floor(Date.now() / 1000);
                console.log(`[SubgraphService] Starting fresh from current timestamp: ${lastProcessedTimestamp}`);
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
            console.log(`[SubgraphService] Heartbeat: Polling Subgraph... (Last: ${lastProcessedTimestamp})`);
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
