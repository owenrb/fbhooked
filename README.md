# fbhooked - Exclusive Meta Messenger Webhook Server

`fbhooked` is a lightweight, secure, and production-ready NestJS server built exclusively for **Meta Messenger (Facebook Messenger Platform) Webhooks**.

It handles Meta Webhook verification (`GET /webhook`), payload authenticity signature validation (`x-hub-signature-256`), exclusive Meta Messenger event routing (`object: 'page'`), and sending messages via the **Meta Messenger Send API**.

---

## ⚡ Features

- **Exclusive Meta Messenger Scope**: Strictly filters and accepts Meta Messenger payloads (`object: 'page'`), rejecting irrelevant or unauthorized webhook traffic.
- **Google Gemini Multi-Turn AI Conversation**: Built-in stateful multi-turn conversational AI powered by Google's `@google/genai` SDK (`gemini-3.6-flash`). Remembers chat history per user and automatically generates contextual replies.
- **Webhook Verification Endpoint**: Implements standard Meta Webhook handshake (`GET /webhook`) with `hub.mode`, `hub.verify_token`, and `hub.challenge`.
- **HMAC Signature Validation**: `MetaSignatureGuard` validates `x-hub-signature-256` SHA-256 HMAC headers against `MESSENGER_APP_SECRET`.
- **Send API Integration**: Built-in support (`MessengerService`) for sending text messages, quick replies, templates, and attachments via Graph API (`https://graph.facebook.com/v21.0/me/messages`).
- **Comprehensive Testing**: Fully covered with unit tests and E2E integration tests.

---

## 🚀 Quick Start

### 1. Environment Configuration

Copy the example environment file and set your credentials:

```bash
cp .env.example .env
```

Set the following variables in `.env`:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | HTTP Server Port | `3000` |
| `MESSENGER_VERIFY_TOKEN` | Secret string configured in your Meta App Dashboard for verification | `your_verify_token_here` |
| `MESSENGER_APP_SECRET` | App Secret from Meta Developer Dashboard (for `x-hub-signature-256` validation) | `your_app_secret_here` |
| `MESSENGER_PAGE_ACCESS_TOKEN` | Page Access Token for replying via Messenger Send API | `your_page_access_token_here` |
| `GEMINI_API_KEY` | Google Gemini API Key for multi-turn AI chat | *(Required for AI)* |
| `GEMINI_MODEL` | Gemini model name | `gemini-3.6-flash` |
| `GEMINI_SYSTEM_INSTRUCTION` | Custom system prompt / persona for Gemini | *(Optional)* |
| `GEMINI_SESSION_TTL_MS` | Session inactivity expiration time in milliseconds | `1800000` (30 min) |


---

### 2. Installation & Run (Yarn)

```bash
# Install dependencies
yarn install

# Start in development mode with watch
yarn start:dev

# Start in production mode
yarn start:prod
```

### 3. Run with Docker

```bash
# Build the Docker image
docker build -t fbhooked .

# Run the container with environment variables
docker run -d -p 3000:3000 --env-file .env --name fbhooked fbhooked
```

---

### 4. Local Webhook Tunneling (Microsoft Dev Tunnels)

Meta Webhooks require a public HTTPS URL. You can configure a **permanent, static Tunnel ID** so your Meta Developer Callback URL never changes:

#### Step 1: Log in to Microsoft Dev Tunnels (one-time setup)
```bash
yarn tunnel:login
```

#### Step 2: Create a Permanent Tunnel ID
Create a persistent tunnel (e.g. named `fbhooked-dev` or any custom ID):
```bash
yarn tunnel:create micks-signal
```

#### Step 3: Host the Permanent Tunnel
Whenever you start your development server, run:
```bash
yarn tunnel micks-signal
```

Your persistent HTTPS URL will be `https://micks-signal-3000.asse.devtunnels.ms` (or `https://micks-signal.asse.devtunnels.ms`). Set `https://micks-signal-3000.asse.devtunnels.ms/webhook` as your static Callback URL in the **Meta Developer Dashboard**.

---

## 🛠 Webhook Endpoints

### 1. Verification (`GET /webhook`)

Meta calls this endpoint when configuring the webhook in the **Meta App Dashboard**.

**Request Query Parameters:**
- `hub.mode`: Must equal `subscribe`
- `hub.verify_token`: Must match `MESSENGER_VERIFY_TOKEN`
- `hub.challenge`: Random string echoed back by the server on success

**Example Test Command:**
```bash
curl -X GET "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=your_verify_token_here&hub.challenge=1234567890"
```

**Response:** `1234567890` (HTTP 200)

---

### 2. Event Delivery (`POST /webhook`)

Meta sends incoming Messenger messaging events (messages, postbacks, quick replies, read receipts, deliveries) to this endpoint.

**Exclusivity Enforcement:** Payloads must contain `"object": "page"`. Any other object type will be rejected with HTTP 400 Bad Request.

**Example Test Command:**
```bash
curl -X POST "http://localhost:3000/webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "object": "page",
    "entry": [
      {
        "id": "PAGE_ID",
        "time": 1700000000000,
        "messaging": [
          {
            "sender": { "id": "USER_PSID" },
            "recipient": { "id": "PAGE_ID" },
            "timestamp": 1700000000000,
            "message": {
              "mid": "mid.1234567890",
              "text": "Hello, Meta Messenger!"
            }
          }
        ]
      }
    ]
  }'
```

**Response:** `EVENT_RECEIVED` (HTTP 200)

---

### 3. Configure "Get Started" Button (`POST /webhook/get-started`)

Meta Messenger supports displaying a **"Get Started"** button in the chat thread when a user opens a conversation with your Facebook Page for the first time. Clicking this button sends a postback event with payload `"START_CONVERSATION"`.

- **Automatic Startup Configuration**: When `MESSENGER_PAGE_ACCESS_TOKEN` is configured in `.env`, `fbhooked` automatically sets the `"Get Started"` button with payload `"START_CONVERSATION"` on application startup (`OnModuleInit`).
- **Manual Setup Endpoint**: You can also trigger or re-configure the button anytime via API:

```bash
curl -X POST "http://localhost:3000/webhook/get-started"
```

- **Direct Meta Graph API Command**:

```bash
source .env && curl -X POST -H "Content-Type: application/json" -d '{
  "get_started": {
    "payload": "START_CONVERSATION"
  }
}' "https://graph.facebook.com/v21.0/me/messenger_profile?access_token=$MESSENGER_PAGE_ACCESS_TOKEN"
```

- **First Chat Session Handling**: When a user clicks **"Get Started"**, Meta sends a webhook postback with `payload: "START_CONVERSATION"`. The server processes this event in `MessengerService`, automatically resets any prior Gemini AI chat history for that user, and sends a welcome message.

---

## 🤖 Google Gemini AI Multi-Turn Conversation

`fbhooked` integrates Google's official `@google/genai` SDK for multi-turn conversational AI directly into the Meta Messenger webhook pipeline.

### How it works:
1. **Per-User Chat Session Management**: Each Messenger user (`senderId`) receives an isolated, stateful Gemini chat session (`GeminiService`).
2. **Contextual Memory**: When a user asks follow-up questions (e.g. "My flight is in May" followed by "What should I pack?"), Gemini retains the multi-turn context from earlier turns.
3. **Session Expiry & Cleanup**: Sessions expire after `GEMINI_SESSION_TTL_MS` (default 30 minutes of inactivity) to keep memory lightweight.
4. **Session Reset on "Get Started"**: When a user restarts via the Messenger "Get Started" button or postback, the conversation state is automatically cleared.
5. **Custom System Instruction**: You can configure a persona or system prompt via `GEMINI_SYSTEM_INSTRUCTION` to tailor responses to your brand.

---

## 🔒 Security Signature Verification (`x-hub-signature-256`)


Meta signs every webhook request body with `x-hub-signature-256`. When `MESSENGER_APP_SECRET` is set in your environment, `MetaSignatureGuard` automatically validates the payload signature using timing-safe SHA-256 HMAC verification.

---

## 🧪 Testing & Code Quality

```bash
# Run unit tests
yarn test

# Run e2e tests
yarn test:e2e

# Run linter
yarn lint

# Build project
yarn build
```

---

## 📄 License

[MIT](LICENSE)
