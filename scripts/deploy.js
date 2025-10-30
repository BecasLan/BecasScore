const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying BecasTrustScore to Base Sepolia Testnet...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH\n");

  // Deploy contract
  console.log("⏳ Deploying contract...");
  const BecasTrustScore = await hre.ethers.getContractFactory("BecasTrustScore");
  const contract = await BecasTrustScore.deploy();

  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  console.log("\n✅ Contract deployed successfully!");
  console.log("📍 Contract Address:", contractAddress);
  console.log("🔗 View on BaseScan:", `https://sepolia.basescan.org/address/${contractAddress}`);

  // Wait for a few block confirmations
  console.log("\n⏳ Waiting for block confirmations...");
  await contract.deploymentTransaction().wait(5);

  // Perform test transactions
  console.log("\n🧪 Running test transactions...");

  // Test 1: Update trust score for a test user
  const testUserId = hre.ethers.id("test_user_123");
  console.log("1️⃣ Updating trust score for test user...");
  const tx1 = await contract.updateTrustScore(testUserId, 85, 15, 2);
  await tx1.wait();
  console.log("   ✅ Trust score updated! TX:", tx1.hash);

  // Test 2: Link a wallet
  const testWallet = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb";
  console.log("2️⃣ Linking wallet address...");
  const tx2 = await contract.linkWallet(testUserId, testWallet);
  await tx2.wait();
  console.log("   ✅ Wallet linked! TX:", tx2.hash);

  // Test 3: Link a Basename
  console.log("3️⃣ Linking Basename...");
  const tx3 = await contract.linkBasename("becas.base.eth", testUserId);
  await tx3.wait();
  console.log("   ✅ Basename linked! TX:", tx3.hash);

  // Read back the data
  console.log("\n📊 Verifying stored data...");
  const trustData = await contract.getTrustScore(testUserId);
  console.log("   Score:", trustData[0].toString());
  console.log("   Risk Score:", trustData[1].toString());
  console.log("   Violations:", trustData[2].toString());

  const totalUsers = await contract.getTotalUsers();
  console.log("   Total Users:", totalUsers.toString());

  console.log("\n🎉 Deployment and testing complete!");
  console.log("\n📋 DEPLOYMENT SUMMARY:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Contract Address:", contractAddress);
  console.log("Network: Base Sepolia Testnet");
  console.log("Chain ID: 84532");
  console.log("Deployer:", deployer.address);
  console.log("Total Transactions:", 4); // 1 deploy + 3 test txs
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n🔗 View Contract:", `https://sepolia.basescan.org/address/${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
