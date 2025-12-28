# CirclePot Notification Server

Push notification server for CirclePot PWA. Handles subscription management, event detection, and notification delivery.

## Features

- ✅ Web Push notifications (VAPID)
- ✅ Subgraph event polling
- ✅ Goal deadline scheduling
- ✅ Per-user notification preferences
- ✅ In-memory subscription storage (replace with DB for production)

## Quick Start

### 1. Install Dependencies

```bash
cd notification-server
npm install
```

### 2. Generate VAPID Keys

```bash
npm run generate-vapid
```

This creates `vapid-keys.json`. Copy the keys to your `.env` file.

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Server
PORT=3001

# VAPID Keys (from step 2)
VAPID_PUBLIC_KEY=your-public-key
VAPID_PRIVATE_KEY=your-private-key
VAPID_SUBJECT=mailto:your-email@example.com

# Subgraph
SUBGRAPH_URL=https://api.studio.thegraph.com/query/your-subgraph

# CORS
ALLOWED_ORIGINS=http://localhost:5173,https://your-app.com
```

### 4. Start Development Server

```bash
npm run dev
```

### 5. Build for Production

```bash
npm run build
npm start
```

## API Endpoints

| Method | Endpoint                              | Description                     |
| ------ | ------------------------------------- | ------------------------------- |
| GET    | `/health`                             | Health check                    |
| POST   | `/api/notifications/subscribe`        | Subscribe to push notifications |
| POST   | `/api/notifications/unsubscribe`      | Unsubscribe                     |
| PUT    | `/api/notifications/preferences`      | Update notification preferences |
| POST   | `/api/notifications/test`             | Send test notification          |
| POST   | `/api/notifications/send`             | Send notification to users      |
| GET    | `/api/notifications/vapid-public-key` | Get VAPID public key            |
| GET    | `/api/notifications/status`           | Get server status               |

## Frontend Configuration

Add to your frontend `.env`:

```bash
VITE_VAPID_PUBLIC_KEY=your-public-key-from-vapid-keys.json
VITE_NOTIFICATION_API_URL=http://localhost:3001/api/notifications
```

## Notification Types

The server supports these notification types:

### Circle Events

- `circle_member_joined` - New member joined
- `circle_member_payout` - Member received payout
- `circle_member_contributed` - Member made contribution
- `circle_member_withdrew` - Member withdrew collateral
- `circle_started` - Circle started after voting
- `circle_completed` - Circle cycle completed
- `circle_dead` - Circle failed/dead
- `contribution_due` - Contribution reminder
- `vote_required` - Vote needed
- `vote_executed` - Vote results
- `member_forfeited` - Member forfeited
- `late_payment_warning` - Late payment warning
- `position_assigned` - Payout position assigned

### Goal Events

- `goal_deadline_2days` - 2 days before deadline
- `goal_deadline_1day` - 1 day before deadline
- `goal_completed` - Goal achieved
- `goal_contribution_due` - Goal contribution reminder
- `goal_milestone` - 25%, 50%, 75% milestones

### Social Events

- `circle_invite` - Invited to private circle
- `invite_accepted` - Referral joined

### Financial Events

- `payment_received` - Payment confirmation
- `credit_score_changed` - Credit score update
- `withdrawal_fee_applied` - Withdrawal fee charged
- `collateral_returned` - Collateral returned

### System Events

- `system_maintenance` - Maintenance notice
- `security_alert` - Security notification

## Production Deployment

For production, consider:

1. **Database**: Replace in-memory store with PostgreSQL/MongoDB
2. **Rate Limiting**: Add rate limiting middleware
3. **Authentication**: Add API key or JWT authentication
4. **Logging**: Use proper logging (Winston, Pino)
5. **Monitoring**: Add health monitoring
6. **SSL**: Deploy behind HTTPS

### Example: Deploy to Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

## Testing

Send a test notification:

```bash
curl -X POST http://localhost:3001/api/notifications/test \
  -H "Content-Type: application/json" \
  -d '{"userAddress": "0x..."}'
```

Check server status:

```bash
curl http://localhost:3001/api/notifications/status
```

## Architecture

```
notification-server/
├── src/
│   ├── index.ts          # Main entry point
│   ├── routes/
│   │   └── notifications.ts  # API routes
│   ├── services/
│   │   ├── pushService.ts       # Web Push sending
│   │   ├── subscriptionStore.ts # Subscription storage
│   │   ├── subgraphService.ts   # Event polling
│   │   └── schedulerService.ts  # Goal deadline scheduler
│   └── types/
│       └── index.ts      # TypeScript types
├── package.json
├── tsconfig.json
└── .env.example
```

## License

MIT
