# 🤖 Becas AI - Next-Gen Community Intelligence Platform

**Revolutionary AI-powered moderation with blockchain-backed reputation and autonomous action execution**

[![Base Sepolia](https://img.shields.io/badge/Base-Sepolia-blue)](https://sepolia.basescan.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Discord](https://img.shields.io/badge/Discord-Join-green)](https://discord.gg/becas)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

## 🌟 What is Becas?

Becas is not just another Discord bot - it's a **sentient AI security platform** that thinks, learns, and acts autonomously to protect your community. Built with cutting-edge AI architecture and blockchain transparency, Becas represents the future of online community management.

### Why Becas?

- **🧠 Truly Intelligent**: Multi-layer cognitive system with reasoning, memory, and self-learning
- **⚡ BecasFlow Framework**: Revolutionary natural language → action execution engine
- **⛓️ Blockchain-Native**: Decentralized trust scores on Base L2
- **🛡️ Proactive Security**: Prevents threats before they escalate
- **🎯 Zero Configuration**: Just talk to it naturally - no complex commands

## 🎯 The Problem

Online communities face an existential crisis:
- **78% of Discord servers** experience scams, raids, or harassment monthly
- **Traditional bots** require complex commands, constant config, and manual intervention
- **Reputation is local**: Bad actors hop servers without consequences
- **Moderation is reactive**: By the time you act, damage is done
- **No intelligence**: Bots follow rules, they don't understand context

## 💡 The Becas Solution

### 🧠 Sentient AI Architecture

Becas uses a **multi-model cognitive system** inspired by human cognition:

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERACTION                      │
│   "ban toxic users from last hour" → Natural Language   │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              🧠 BECASFLOW FRAMEWORK                      │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Intent Classifier → Planner → Executor          │  │
│  │  • Multi-intent parsing                          │  │
│  │  • Dependency resolution                         │  │
│  │  • Conditional logic (if/else/loops)             │  │
│  │  • Context awareness                             │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│            ⚡ COGNITIVE PROCESSING LAYER                │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │   Reflex    │  │   Semantic   │  │   Reasoning   │  │
│  │  (TinyLlama)│  │  (Embeddings)│  │   (Qwen3 8B)  │  │
│  │   10-50ms   │  │   Multi-lang │  │  Chain-of-    │  │
│  │   Filter    │  │    Intent    │  │    Thought    │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              📊 DATA & MEMORY LAYER                     │
│  ┌────────────────┐  ┌────────────────────────────┐    │
│  │   Supabase     │  │   Base Sepolia Testnet     │    │
│  │   PostgreSQL   │  │   Trust Score Registry     │    │
│  │   Redis Cache  │  │   Immutable Audit Trail    │    │
│  └────────────────┘  └────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### ⚡ BecasFlow: The Game Changer

**BecasFlow** is our proprietary framework that converts natural language into executable action plans:

#### How It Works

1. **Intent Classification**: AI detects what you want (moderation, query, analytics)
2. **Planning Phase**: Breaks complex requests into atomic steps with dependencies
3. **Execution**: Runs actions in correct order, handles failures, retries
4. **Learning**: Remembers outcomes, adapts to your server's culture

#### Example

**You say:**
```
"ban users who sent scam links in #general during last 2 hours,
then purge their messages, and send a report to #mod-log"
```

**BecasFlow does:**
```typescript
Step 1: [QUERY] Find users with scam_score > 0.8 in #general (last 2h)
  ↓ dependency
Step 2: [ACTION] Ban identified users (bulk action)
  ↓ dependency
Step 3: [ACTION] Bulk delete messages from banned users
  ↓ dependency
Step 4: [REPORT] Generate summary → post to #mod-log
```

**All with zero configuration, zero commands to remember.**

## 🚀 Key Features

### 🧠 AI Capabilities

#### Multi-Model Architecture
- **Reflex Layer** (TinyLlama 1B): Ultra-fast toxicity/scam detection (10-50ms)
- **Semantic Layer** (E5 embeddings): Language-agnostic intent understanding
- **Reasoning Layer** (Qwen3 8B): Chain-of-thought, multi-step planning
- **Strategic Layer** (Qwen3 14B): Long-term goals, server optimization

#### Context Awareness
- **Conversation Memory**: Remembers last 20 messages, resolves "him", "that user"
- **Action History**: Tracks last 10 actions, enables "undo that", "modify it"
- **User Profiling**: Deep behavioral analysis, relationship graphs
- **Server Knowledge**: Learns your server's culture, adapts policies

#### Self-Learning
- **Feedback Loop**: Learns from corrections ("no, I meant ban for 1 day")
- **Authority Hierarchy**: Weighs feedback by role (Owner > Admin > Mod)
- **Pattern Recognition**: Discovers recurring threats, suggests policies
- **Confidence Thresholds**: Only applies learned rules when 75%+ confident

### ⛓️ Blockchain Integration (Base Sepolia)

#### Smart Contract Features
- **Trust Score Registry**: Immutable reputation system
- **Cross-Server Reputation**: Bad actors can't escape their history
- **Basename Integration**: Link Base identities to Discord profiles
- **Audit Trail**: Every moderation action logged on-chain
- **Leaderboard**: Top trusted contributors ranked transparently

#### Base Account Support
- Connect MetaMask wallet to Discord identity
- Earn reputation points for positive contributions
- Lose trust for violations (transparently logged)
- Export trust score as Verifiable Credential

**Contract Address**: `0x79B2967738854B37E1F5043a27985b23241686c3`
**Network**: Base Sepolia (Chain ID: 84532)
[**View on BaseScan →**](https://sepolia.basescan.org/address/0x79B2967738854B37E1F5043a27985b23241686c3)

### 🛡️ Security Features

#### Advanced Scam Detection
- **Phishing URL Analysis**: Real-time link verification
- **Fake Giveaway Detection**: Pattern matching + AI reasoning
- **Impersonation Detection**: Profile similarity scoring
- **Social Engineering**: Manipulation tactic recognition

#### Toxicity Monitoring
- **Real-time Sentiment**: Multi-language emotion analysis
- **Escalation Prediction**: Flags conflicts before they explode
- **Contextual Understanding**: Distinguishes banter from harassment
- **Cultural Awareness**: Adapts to server-specific norms

#### Investigation Mode
- **Deep User Profiling**: Activity patterns, relationships, risk scores
- **Relationship Graphs**: Who interacts with whom, conflict mapping
- **Behavioral Anomaly Detection**: Flags sudden changes (account compromise?)
- **Cross-Server Intelligence**: Checks user's history in other servers

### 📊 BecasFlow Tools (17+ Actions)

#### Moderation Tools
- `ban` - Permanent removal with reason logging
- `timeout` - Temporary mute (duration: smart suggestions)
- `kick` - Remove without ban (warning)
- `warn` - Formal warning with escalation tracking
- `delete_messages` - Bulk message purge (filters: user, time, content)
- `lock_channel` - Emergency lockdown
- `slowmode` - Cooldown enforcement
- `add_role` / `remove_role` - Dynamic permission management

#### Trust & Analytics
- `check_trust` - View user's reputation + history
- `update_trust` - Manual adjustment (with reason)
- `trust_report` - Server trust distribution analysis
- `server_stats` - Activity metrics, trends
- `user_activity` - Individual behavior profiling
- `moderation_history` - Audit log with filters

#### Automation
- **Workflows**: Schedule actions (e.g., "purge #spam daily at 3am")
- **Policies**: Define rules (e.g., "3 toxicity warnings → timeout")
- **Watch System**: Monitor specific users (e.g., "alert if X posts scam link")

## 📦 Installation

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **PostgreSQL** 13+ (or Supabase account - recommended)
- **Ollama** for local AI (or OpenAI API key)
- **Discord Bot Token** ([Create here](https://discord.com/developers/applications))
- **MetaMask Wallet** with Base Sepolia ETH ([Get from faucet](https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet))

### Quick Start

1. **Clone the repository**
```bash
git clone https://github.com/BecasLan/BecasScore.git
cd BecasScore
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment**
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
# Discord
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id

# Database (Supabase recommended)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_anon_key

# AI (Ollama local or OpenAI)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b

# Blockchain (Base Sepolia)
BASE_RPC_URL=https://sepolia.base.org
CONTRACT_ADDRESS=0x79B2967738854B37E1F5043a27985b23241686c3
PRIVATE_KEY=your_wallet_private_key
```

4. **Setup Ollama** (if using local AI)
```bash
# Install Ollama: https://ollama.ai
# Pull models:
ollama pull qwen3:8b
ollama pull tinyllama
```

5. **Initialize database**
```bash
npm run migrate
```

6. **Compile TypeScript**
```bash
npm run build
```

7. **Start Becas**
```bash
node dist/index.js
```

**⚠️ IMPORTANT**: Always run `node dist/index.js`, **not** `npm start` or `npx ts-node`. The compiled JavaScript in `dist/` is the production-ready version.

### Docker Deployment (Alternative)

```bash
docker-compose up -d
```

See `docker-compose.yml` for configuration.

## 🔗 Smart Contract Deployment

### Deploy Your Own Contract

1. **Install Hardhat**
```bash
npm install --save-dev hardhat
```

2. **Configure network**
Edit `hardhat.config.js`:
```javascript
networks: {
  baseSepolia: {
    url: "https://sepolia.base.org",
    accounts: [process.env.PRIVATE_KEY],
    chainId: 84532
  }
}
```

3. **Deploy**
```bash
npx hardhat run scripts/deploy.js --network baseSepolia
```

4. **Verify**
```bash
npx hardhat verify --network baseSepolia <CONTRACT_ADDRESS>
```

### Contract Methods

```solidity
// Update user trust (only bot can call)
function updateTrustScore(address user, uint256 newScore) external onlyBot;

// Link wallet to Discord ID
function linkWallet(string memory discordId) external;

// Link Basename
function linkBasename(string memory basename) external;

// Query trust
function getTrustScore(address user) external view returns (uint256);

// Get leaderboard
function getLeaderboard(uint256 limit) external view returns (TrustEntry[]);
```

## 🌐 Live Demos

- **Web Dashboard**: [becascore.xyz](https://becascore.xyz)
- **Check Scores**: [becascore.xyz/checkscore.html](https://becascore.xyz/checkscore.html)



## 📊 Tech Stack

### Backend
- **Runtime**: Node.js 18+, TypeScript 5.0
- **Framework**: Discord.js 14
- **Database**: PostgreSQL 15 (Supabase hosted)
- **Cache**: Redis 7
- **Queue**: BullMQ (background jobs)

### AI
- **Local LLM**: Ollama (Qwen3 8B, TinyLlama 1B)
- **Embeddings**: Hugging Face Transformers (E5, MiniLM)
- **Vision**: LLaVA (image analysis for scams)
- **Fallback**: OpenAI GPT-4o (optional)

### Blockchain
- **Smart Contracts**: Solidity 0.8.20
- **Framework**: Hardhat
- **Network**: Base Sepolia (L2 Ethereum)
- **Web3**: ethers.js 6

### Frontend
- **Dashboard**: React 18 + Vite
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Auth**: Discord OAuth2

### DevOps
- **Hosting**: Railway (bot), Vercel (frontend)
- **CI/CD**: GitHub Actions
- **Monitoring**: Prometheus + Grafana
- **Logging**: Winston + Loki

## 🎥 Video Demo

📹 **[Watch Full Demo on YouTube →](#)**

*4-minute walkthrough covering:*
- Natural language command examples
- BecasFlow in action
- Trust score system
- Blockchain integration
- Self-learning capabilities

## 🛠️ Development Roadmap

### ✅ Phase 1 (COMPLETED - Q4 2024)
- [x] Core AI architecture (multi-model system)
- [x] BecasFlow framework (natural language → actions)
- [x] Smart contract deployment (Base Sepolia)
- [x] Trust score system with on-chain registry
- [x] Advanced scam detection (phishing, giveaways)
- [x] Self-learning system (feedback loops)
- [x] Web dashboard (real-time analytics)

### 🚧 Phase 2 (IN PROGRESS - Q1 2025)
- [ ] Multi-platform expansion (Telegram, Twitter/X, Farcaster)
- [ ] Voice channel monitoring (audio scam detection)
- [ ] AI-powered server setup wizard ("generate my entire server with prompts")
- [ ] Custom policy templates (community-driven)
- [ ] Mobile app (iOS/Android) for admins

### 📋 Phase 3 (Q2-Q3 2025)
- [ ] **Universal Dashboard**: Control ALL your Discord servers from one place
  - Real-time server health monitoring
  - Bulk operations across servers
  - Custom AI panels per community
  - Advanced analytics (user flows, churn prediction)
- [ ] **Decentralized AI Federation**: Cross-platform threat intelligence network
- [ ] **Enterprise API**: White-label Becas for large communities
- [ ] **Token Economy**: $BECAS token for governance + incentives

### 🌟 Phase 4 (Q4 2025 - Q1 2026)
- [ ] **Autonomous Security Network**: Self-coordinating bots across 10K+ servers
- [ ] **AI Marketplace**: Buy/sell custom models, policies, integrations
- [ ] **Global Threat Intelligence Hub**: Real-time scam/raid alerts
- [ ] **Verifiable Credentials**: Export trust as portable Web3 reputation

## 💎 Support the Project ## 

### 💰 Donation Addresses

**Crypto (Ethereum, Base, Arbitrum, Optimism):**
```
0x71EfE338ca8A0BB6294Da8898B35bB0E9aeFA3B1
```

**Fiat (Bank Transfer / PayPal):**
Contact `lordgrim9591` on Discord

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

**TL;DR**: Free for personal/commercial use. Attribute Becas. No warranty.

## 🤝 Contributing

We welcome contributions! Whether you're fixing bugs, adding features, or improving docs.

### How to Contribute

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

### Bug Reports

Found a bug? [Open an issue](https://github.com/BecasLan/BecasScore/issues/new) with:
- Clear title + description
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Node version, etc.)

## 📞 Contact & Community

- **Discord**: `lordgrim9591` (Founder)
- **Website**: [becascore.xyz](https://becascore.xyz)
- **Twitter/X**: [@becascore](https://x.com/becascore)
- **Founder Twitter**: [@dutchonederlin](https://x.com/dutchonederlin)
- **Email**: support@becascore.xyz
- **Documentation**: [docs.becascore.xyz](https://docs.becascore.xyz)

### Join Our Community

- 💬 [Discord Server](https://discord.gg/becas) - Get support, share ideas
- 🐦 [Twitter](https://x.com/becascore) - Updates, announcements
- 📚 [GitHub Discussions](https://github.com/BecasLan/BecasScore/discussions) - Feature requests, Q&A

---

<div align="center">

**Built with ❤️ for the Base Buildathon & Beyond**

*Protecting communities, one intelligent action at a time.*

[⭐ Star us on GitHub](https://github.com/BecasLan/BecasScore) • [🐦 Follow on Twitter](https://x.com/becascore) • [💬 Join Discord](https://discord.gg/becas)

</div>
