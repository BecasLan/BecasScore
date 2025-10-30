# 🤖 Becas AI - Decentralized Trust & Security Platform

**Revolutionizing community safety with AI-powered moderation and blockchain-backed reputation**

[![Base Sepolia](https://img.shields.io/badge/Base-Sepolia-blue)](https://sepolia.basescan.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Discord](https://img.shields.io/badge/Discord-Online-green)](https://discord.com/invite/becas)

## 🌟 What is Becas?

Becas is an advanced AI-powered security platform that protects online communities through:

- **Sentient AI Architecture**: Self-learning, context-aware threat detection
- **Decentralized Trust Network**: Blockchain-backed reputation system on Base
- **Cross-Platform Intelligence**: Unified security across Discord, Telegram, and more
- **Real-time Threat Prevention**: Scam detection, toxicity monitoring, behavior analysis

## 🎯 Problem Statement

Online communities face critical challenges:
- **60%+ of Discord servers** experience scam/phishing attacks
- **Traditional moderation** is reactive, slow, and inconsistent
- **Reputation systems** are centralized and can be manipulated
- **Cross-server threats** go undetected without shared intelligence

## 💡 Solution

Becas combines AI intelligence with blockchain transparency:

1. **AI-Powered Detection**: Multi-layer cognitive system analyzes threats in real-time
2. **Decentralized Trust Scores**: Immutable reputation stored on Base blockchain
3. **Federated Intelligence**: Cross-server threat sharing network
4. **Autonomous Governance**: Self-learning AI that improves with community feedback

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│              User Interaction Layer              │
│  (Discord Bot, Web Dashboard, API Endpoints)     │
└───────────────────┬─────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────┐
│          AI Processing Layer                     │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │ Qwen3 8B LLM │  │ Cognitive Orchestrator │   │
│  └──────────────┘  └────────────────────────┘   │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │ Scam Detector│  │ Sentiment Analysis     │   │
│  └──────────────┘  └────────────────────────┘   │
└───────────────────┬─────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────┐
│              Data & Blockchain Layer             │
│  ┌─────────────┐  ┌──────────────────────────┐  │
│  │  Supabase   │  │  Base Sepolia Testnet    │  │
│  │  PostgreSQL │  │  Smart Contracts         │  │
│  └─────────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## 🚀 Key Features

### 🧠 AI Capabilities
- **Multi-model Architecture**: TinyLlama (reflex), Qwen3 (reasoning)
- **Context Awareness**: Remembers conversations, understands references
- **Predictive Security**: Anticipates conflicts before escalation
- **Self-Learning**: Improves from corrections and feedback

### ⛓️ Blockchain Integration (Base)
- **Trust Score Registry**: On-chain reputation system
- **Basename Support**: Link Discord users to Base identities
- **Base Account Integration**: Wallet-based authentication
- **Immutable Audit Trail**: Transparent moderation history

### 🛡️ Security Features
- **Scam Detection**: Phishing URL analysis, fake giveaway detection
- **Toxicity Monitoring**: Real-time sentiment analysis
- **Investigation Mode**: Deep user behavior profiling
- **Cross-Server Federation**: Shared threat intelligence

## 📦 Installation

### Prerequisites
- Node.js 18+
- PostgreSQL (or Supabase account)
- Ollama (for local AI)
- MetaMask wallet with Base Sepolia ETH

### Setup

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/becas-ai.git
cd becas-ai
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. **Deploy smart contract to Base Sepolia**
```bash
npx hardhat run scripts/deploy.js --network baseSepolia
```

5. **Start the bot**
```bash
npm run build
npm start
```

## 🔗 Smart Contract Deployment

The Becas Trust Score contract is deployed on **Base Sepolia Testnet**:

- **Contract Address**: `0x79B2967738854B37E1F5043a27985b23241686c3`
- **Network**: Base Sepolia (Chain ID: 84532)
- **Explorer**: [View on BaseScan](https://sepolia.basescan.org/address/0x79B2967738854B37E1F5043a27985b23241686c3)

### Features
- `updateTrustScore()`: Update user reputation
- `linkWallet()`: Connect Base Account to Discord identity
- `linkBasename()`: Associate Basename with user
- `getTrustScore()`: Query user reputation
- `getLeaderboard()`: View top trusted users

## 🌐 Live Demo

- **Web Dashboard**: https://becascore.xyz
- **Check Scores**: https://becascore.xyz/checkscore.html
- **API Endpoints**: https://becascore.xyz/api/*

## 📊 Tech Stack

- **Backend**: Node.js, TypeScript, Discord.js
- **AI**: Ollama (Qwen3 8B), HuggingFace Transformers
- **Database**: PostgreSQL (Supabase)
- **Blockchain**: Solidity, Hardhat, Base (L2 Ethereum)
- **Frontend**: HTML/CSS/JS (Dashboard)
- **Deployment**: Vercel (API), Railway (Bot)

## 🎯 Buildathon Checklist

- ✅ **Onchain App**: Smart contract deployed to Base Sepolia
- ✅ **Public URL**: https://becascore.xyz
- ✅ **Open Source**: GitHub repository (you're here!)
- ✅ **Base Integration**: Basenames + Base Account support
- ✅ **Testnet Deployment**: Multiple transactions on Base Sepolia
- 🎥 **Video**: [Link to demo video]

## 🛠️ Development Roadmap

### Phase 1 (Current) ✅
- Advanced scam detection
- Cross-chain reputation
- Self-learning AI

### Phase 2 (Q2 2025) 🚧
- Multi-platform expansion (Telegram, Twitter)
- DAO governance launch
- Token economy

### Phase 3 (Q3 2025) 📋
- Decentralized AI federation
- Staking & rewards
- Enterprise API

### Phase 4 (Q4 2025) 🌟
- Autonomous security network
- AI marketplace
- Global threat intelligence hub

## 💎 Support Becas

Becas is seeking $500K funding to scale to 100M+ users and launch the token economy.

**Founding Supporter Benefits:**
- DAO governance rights
- Token pre-sale (20% discount)
- Revenue sharing
- Exclusive NFT + on-chain recognition
- Lifetime premium features

**Contribute:**
- ETH/USDT/USDC: `0x71EfE338ca8A0BB6294Da8898B35bB0E9aeFA3B1`
- Contact: `lordgrim9591` on Discord

## 📄 License

MIT License - see [LICENSE](LICENSE) for details

## 🤝 Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📞 Contact

- Discord: `lordgrim9591`
- Website: https://becascore.xyz
- Twitter: [@becasai](https://twitter.com/becasai)

---

**Built with ❤️ for the Base Buildathon**

*Protecting communities, one interaction at a time.*
