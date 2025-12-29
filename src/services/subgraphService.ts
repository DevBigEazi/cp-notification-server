import { GraphQLClient, gql } from "graphql-request";
import { subscriptionStore } from "./subscriptionStore";
import { sendNotification } from "./pushService";

const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "";

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
        console.warn("[SubgraphService] SUBGRAPH_URL not configured. Polling disabled.");
        return false;
    }

    client = new GraphQLClient(SUBGRAPH_URL);
    console.log("[SubgraphService] Initialized with URL:", SUBGRAPH_URL);
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
    }
  `;

    try {
        const data = await client.request<{ circleJoineds: Array<{ user: { id: string } }> }>(
            query,
            { circleId }
        );
        return data.circleJoineds.map((cj) => cj.user.id);
    } catch (error) {
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
async function processCircleJoinedEvents(events: CircleJoinedEvent[]): Promise<void> {
    for (const event of events) {
        const members = await getCircleMembers(event.circleId);
        const membersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());

        if (membersToNotify.length > 0) {
            const userName = event.user.username || "Someone";
            const circleName = await getCircleName(event.circleId);

            await sendNotification(membersToNotify, {
                title: "New Member Joined 👋",
                message: `${userName} joined "${circleName}"`,
                type: "circle_member_joined",
                priority: "medium",
                action: { action: "/" },
                data: { circleId: event.circleId, newMember: event.user.id },
            });
        }
    }
}

/**
 * Process payout events
 */
async function processPayoutEvents(events: PayoutDistributedEvent[]): Promise<void> {
    for (const event of events) {
        const amount = formatAmount(event.payoutAmount);

        await sendNotification([event.user.id], {
            title: "Payment Received! 💰",
            message: `You received ${amount} from your circle payout (Round ${event.round})`,
            type: "payment_received",
            priority: "high",
            action: { action: "/transactions-history" },
            data: { circleId: event.circleId, amount: event.payoutAmount, round: event.round },
        });

        // Notify other members about the payout
        const members = await getCircleMembers(event.circleId);
        const othersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());

        if (othersToNotify.length > 0) {
            const recipientName = event.user.username || "A member";

            await sendNotification(othersToNotify, {
                title: "Circle Payout Completed",
                message: `${recipientName} received their payout of ${amount}`,
                type: "circle_member_payout",
                priority: "low",
                action: { action: "/" },
                data: { circleId: event.circleId, round: event.round },
            });
        }
    }
}

/**
 * Process contribution events
 */
async function processContributionEvents(events: ContributionMadeEvent[]): Promise<void> {
    for (const event of events) {
        const members = await getCircleMembers(event.circleId);
        const othersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());

        if (othersToNotify.length > 0) {
            const contributorName = event.user.username || "A member";
            const amount = formatAmount(event.amount);

            await sendNotification(othersToNotify, {
                title: "Contribution Made ✅",
                message: `${contributorName} contributed ${amount} (Round ${event.round})`,
                type: "circle_member_contributed",
                priority: "low",
                action: { action: "/" },
                data: { circleId: event.circleId, round: event.round },
            });
        }
    }
}

/**
 * Process collateral withdrawn events
 */
async function processCollateralWithdrawnEvents(events: CollateralWithdrawnEvent[]): Promise<void> {
    for (const event of events) {
        const amount = formatAmount(event.amount);

        // Notify the user who withdrew
        await sendNotification([event.user.id], {
            title: "Collateral Returned 💵",
            message: `Your collateral of ${amount} has been returned`,
            type: "collateral_returned",
            priority: "medium",
            action: { action: "/transactions-history" },
            data: { circleId: event.circleId, amount: event.amount },
        });

        // Notify other members
        const members = await getCircleMembers(event.circleId);
        const othersToNotify = members.filter((m) => m.toLowerCase() !== event.user.id.toLowerCase());

        if (othersToNotify.length > 0) {
            const userName = event.user.username || "A member";

            await sendNotification(othersToNotify, {
                title: "Member Withdrew",
                message: `${userName} withdrew their collateral`,
                type: "circle_member_withdrew",
                priority: "medium",
                action: { action: "/" },
                data: { circleId: event.circleId },
            });
        }
    }
}

/**
 * Process member invited events
 */
async function processMemberInvitedEvents(events: MemberInvitedEvent[]): Promise<void> {
    for (const event of events) {
        const inviterName = event.inviter.username || "Someone";
        const circleName = await getCircleName(event.circleId);

        await sendNotification([event.invitee.id], {
            title: "Circle Invitation 📩",
            message: `${inviterName} invited you to join "${circleName}"`,
            type: "circle_invite",
            priority: "high",
            action: { action: "/browse" },
            data: { circleId: event.circleId, inviter: event.inviter.id },
        });
    }
}

/**
 * Process voting initiated events
 */
async function processVotingInitiatedEvents(events: VotingInitiatedEvent[]): Promise<void> {
    for (const event of events) {
        const members = await getCircleMembers(event.circleId);
        const votingEnd = new Date(parseInt(event.votingEndAt) * 1000);

        await sendNotification(members, {
            title: "Vote Required! 🗳️",
            message: `Voting has started for your circle. Cast your vote before ${votingEnd.toLocaleDateString()}`,
            type: "vote_required",
            priority: "high",
            action: { action: "/" },
            data: { circleId: event.circleId, votingEndAt: event.votingEndAt },
        });
    }
}

/**
 * Process vote executed events
 */
async function processVoteExecutedEvents(events: VoteExecutedEvent[]): Promise<void> {
    for (const event of events) {
        const members = await getCircleMembers(event.circleId);
        const result = event.circleStarted ? "Circle Started! 🚀" : "Circle did not start";

        await sendNotification(members, {
            title: "Voting Results",
            message: result,
            type: event.circleStarted ? "circle_started" : "vote_executed",
            priority: event.circleStarted ? "high" : "medium",
            action: { action: "/" },
            data: {
                circleId: event.circleId,
                started: event.circleStarted,
                startVotes: event.startVoteTotal,
                withdrawVotes: event.withdrawVoteTotal,
            },
        });
    }
}

/**
 * Process member forfeited events
 */
async function processMemberForfeitedEvents(events: MemberForfeitedEvent[]): Promise<void> {
    for (const event of events) {
        const forfeitedName = event.forfeitedUser.username || "A member";
        const amount = formatAmount(event.deductionAmount);

        // Notify the forfeited user
        await sendNotification([event.forfeitedUser.id], {
            title: "You have been forfeited ⚠️",
            message: `You were forfeited from your circle. Deduction: ${amount}`,
            type: "member_forfeited",
            priority: "high",
            action: { action: "/" },
            data: { circleId: event.circleId, round: event.round, amount: event.deductionAmount },
        });

        // Notify other members
        const members = await getCircleMembers(event.circleId);
        const othersToNotify = members.filter((m) => m.toLowerCase() !== event.forfeitedUser.id.toLowerCase());

        if (othersToNotify.length > 0) {
            await sendNotification(othersToNotify, {
                title: "Member Forfeited",
                message: `${forfeitedName} has been forfeited from the circle`,
                type: "member_forfeited",
                priority: "medium",
                action: { action: "/" },
                data: { circleId: event.circleId, round: event.round },
            });
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
            // Initial poll - just get current timestamp to start from now
            lastProcessedTimestamp = Math.floor(Date.now() / 1000);
            isPolling = false;
            return;
        }

        const events = await queryNewEvents();

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
        }
    } catch (error: any) {
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
        console.warn("[SubgraphService] Cannot start polling - client not initialized");
        return;
    }

    console.log(`[SubgraphService] Starting polling every ${intervalMs / 1000}s`);
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
