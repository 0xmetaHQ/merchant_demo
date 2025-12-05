// ============================================================================
// GLOBAL STATE
// ============================================================================
let web3 = null;
let walletAddress = null;
let CONFIG = null;
let isPaymentInProgress = false;
let currentAuthorizationNonce = null;

// 0xmeta fee configuration
const OXMETA_FEE_USDC_WEI = 10000; // $0.01 USDC in wei (6 decimals)
const OXMETA_FEE_USDC = 0.01; // For display
let OXMETA_TREASURY_WALLET = null;

// Treasury will keep the fee and forward merchant_amount to merchant

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function $(selector) {
  return document.querySelector(selector);
}

function isMetaMaskInstalled() {
  return typeof window.ethereum !== "undefined" && window.ethereum.isMetaMask;
}

function shorten(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function updateStatus(msg, type = "info") {
  const el = $("#status");
  if (!el) return;

  const alertClass =
    {
      info: "alert-info",
      success: "alert-success",
      danger: "alert-danger",
      warning: "alert-warning",
    }[type] || "alert-info";

  el.innerHTML = `<div class="alert ${alertClass}">${msg}</div>`;
}

function saveWalletState() {
  if (walletAddress) {
    sessionStorage.setItem("walletConnected", "true");
    sessionStorage.setItem("walletAddress", walletAddress);
  } else {
    sessionStorage.removeItem("walletConnected");
    sessionStorage.removeItem("walletAddress");
  }
}

function loadWalletState() {
  if (sessionStorage.getItem("walletConnected") === "true") {
    walletAddress = sessionStorage.getItem("walletAddress");
    if (walletAddress) {
      showPaymentSection();
    }
  }
}

function showPaymentSection() {
  const walletSection = $("#walletSection");
  const paymentSection = $("#paymentSection");
  const walletAddressEl = $("#walletAddress");

  if (walletSection) walletSection.style.display = "none";
  if (paymentSection) paymentSection.style.display = "block";
  if (walletAddressEl) walletAddressEl.textContent = shorten(walletAddress);

  updatePayButtonText();
}

function updatePayButtonText() {
  const payBtn = $("#payBtn");
  if (payBtn && CONFIG) {
    const totalAmount = (
      parseFloat(CONFIG.price_usdc) + OXMETA_FEE_USDC
    ).toFixed(2);
    payBtn.innerHTML = `💰 Pay ${totalAmount} USDC`;
  }
}

// ============================================================================
// CONFIG LOADING
// ============================================================================

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error("Failed to fetch config");
    }
    CONFIG = await response.json();
    console.log("✅ Config loaded:", CONFIG);

    // Ensure all values are STRINGS
    CONFIG.price_usdc_wei = String(CONFIG.price_usdc_wei);
    CONFIG.total_price_usdc_wei = String(
      parseInt(CONFIG.price_usdc_wei) + OXMETA_FEE_USDC_WEI
    );
    CONFIG.total_price_usdc = (
      parseFloat(CONFIG.price_usdc) + OXMETA_FEE_USDC
    ).toFixed(2);
    OXMETA_TREASURY_WALLET = CONFIG.treasury_wallet;
    BASE_URL = CONFIG.FACILITATOR_BASE_URL;

    if (!OXMETA_TREASURY_WALLET) {
      throw new Error("Treasury address not configured in backend");
    }

    console.log("🏦 Treasury address loaded:", OXMETA_TREASURY_WALLET);

    console.log("💰 Payment breakdown:", {
      merchant_amount: CONFIG.price_usdc,
      fee_amount: OXMETA_FEE_USDC,
      total_amount: CONFIG.total_price_usdc,
      merchant_wei: CONFIG.price_usdc_wei,
      fee_wei: String(OXMETA_FEE_USDC_WEI),
      total_wei: CONFIG.total_price_usdc_wei,
    });

    console.log("🏦 Payment routing:", {
      client_authorizes_to: CONFIG.treasury_wallet,
      treasury_forwards_to: CONFIG.merchant_address,
      note: "Treasury-first flow ensures 0xmeta fee collection",
    });

    updateNetworkDisplay();
    updatePayButtonText();
    return CONFIG;
  } catch (error) {
    console.error("❌ Failed to load config:", error);
    updateStatus("❌ Failed to load network configuration", "danger");
    return null;
  }
}

function updateNetworkDisplay() {
  if (!CONFIG) return;
  const networkDisplay = $("#networkDisplay");
  if (networkDisplay) {
    const networkName =
      CONFIG.network === "base" ? "Base Mainnet" : "Base Sepolia";
    networkDisplay.textContent = networkName;
  }
}

// ============================================================================
// WALLET CONNECTION
// ============================================================================

async function connectWallet() {
  if (!isMetaMaskInstalled()) {
    updateStatus(
      "❌ MetaMask not found. Please install it to continue.",
      "danger"
    );
    return;
  }

  if (!CONFIG) {
    CONFIG = await loadConfig();
    if (!CONFIG) {
      updateStatus("❌ Failed to load configuration", "danger");
      return;
    }
  }

  try {
    updateStatus("🔄 Connecting to MetaMask...", "info");

    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    if (!accounts || accounts.length === 0) {
      updateStatus("❌ No accounts found", "danger");
      return;
    }

    walletAddress = accounts[0];
    web3 = new Web3(window.ethereum);
    saveWalletState();

    showPaymentSection();
    updateStatus("✅ Wallet connected: " + shorten(walletAddress), "success");

    await switchToNetwork();
  } catch (err) {
    console.error("Wallet connection error:", err);
    updateStatus(
      "❌ Failed to connect wallet: " + (err.message || err),
      "danger"
    );
  }
}

function disconnectWallet() {
  walletAddress = null;
  web3 = null;
  isPaymentInProgress = false;
  currentAuthorizationNonce = null;

  const walletSection = $("#walletSection");
  const paymentSection = $("#paymentSection");
  const successSection = $("#successSection");

  if (walletSection) walletSection.style.display = "block";
  if (paymentSection) paymentSection.style.display = "none";
  if (successSection) successSection.style.display = "none";

  sessionStorage.removeItem("walletConnected");
  sessionStorage.removeItem("walletAddress");

  updateStatus("🔒 Wallet disconnected", "info");
}

async function switchToNetwork() {
  if (!window.ethereum || !CONFIG) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CONFIG.chain_id }],
    });
    console.log(`✅ Switched to ${CONFIG.network}`);
  } catch (switchError) {
    if (switchError.code === 4902) {
      const networkParams = {
        chainId: CONFIG.chain_id,
        chainName: CONFIG.network === "base" ? "Base" : "Base Sepolia",
        nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: [CONFIG.rpc_url],
        blockExplorerUrls: [CONFIG.block_explorer],
      };

      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [networkParams],
      });

      console.log(`✅ Added and switched to ${CONFIG.network}`);
    } else {
      console.warn("Network switch error:", switchError);
      throw switchError;
    }
  }
}

// ============================================================================
// EIP-3009 AUTHORIZATION
// ============================================================================

async function createEIP3009Authorization() {
  if (!web3 || !walletAddress || !CONFIG) {
    throw new Error("Web3 not initialized");
  }

  console.log("🔐 Creating EIP-3009 authorization with fee included...");

  const usdcContract = new web3.eth.Contract(
    [
      {
        constant: true,
        inputs: [],
        name: "name",
        outputs: [{ name: "", type: "string" }],
        type: "function",
      },
      {
        constant: true,
        inputs: [],
        name: "version",
        outputs: [{ name: "", type: "string" }],
        type: "function",
      },
    ],
    CONFIG.usdc_address
  );

  const [tokenName, tokenVersion] = await Promise.all([
    usdcContract.methods.name().call(),
    usdcContract.methods.version().call(),
  ]);

  console.log(`📝 Token: ${tokenName} v${tokenVersion}`);

  // Generate UNIQUE random nonce
  const nonceBytes = new Uint8Array(32);
  window.crypto.getRandomValues(nonceBytes);
  const nonce =
    "0x" +
    Array.from(nonceBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  currentAuthorizationNonce = nonce;

  const domain = {
    name: tokenName,
    version: tokenVersion,
    chainId: parseInt(CONFIG.chain_id, 16),
    verifyingContract: CONFIG.usdc_address,
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  const validAfter = "0";
  const validBefore = String(Math.floor(Date.now() / 1000) + 86400);

  // Treasury will receive full amount and forward merchant_amount to merchant
  const message = {
    from: walletAddress,
    to: OXMETA_TREASURY_WALLET,
    value: CONFIG.total_price_usdc_wei,
    validAfter: validAfter,
    validBefore: validBefore,
    nonce: nonce,
  };

  console.log("📋 Authorization details:", {
    from: message.from,
    to: message.to,
    value: message.value,
    breakdown: {
      merchant_amount: CONFIG.price_usdc_wei,
      fee_amount: String(OXMETA_FEE_USDC_WEI),
      total: CONFIG.total_price_usdc_wei,
    },
    flow: "client → treasury (keeps fee) → merchant (forwards payment)",
  });

  updateStatus(
    `🔐 Authorizing ${CONFIG.total_price_usdc} USDC to 0xmeta<br/>` +
      `<small>→ ${CONFIG.price_usdc} to merchant + $${OXMETA_FEE_USDC} facilitator fee</small>`,
    "info"
  );

  const signature = await window.ethereum.request({
    method: "eth_signTypedData_v4",
    params: [
      walletAddress,
      JSON.stringify({
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          TransferWithAuthorization: types.TransferWithAuthorization,
        },
        primaryType: "TransferWithAuthorization",
        domain: domain,
        message: message,
      }),
    ],
  });

  console.log("✅ EIP-3009 signature created");
  console.log("✅ Payment will route: Client → Treasury → Merchant");

  return {
    authorization: {
      from: walletAddress,
      to: OXMETA_TREASURY_WALLET,
      value: CONFIG.total_price_usdc_wei,
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce: nonce,
      token: CONFIG.usdc_address,
    },
    signature: signature,
    // Include merchant info for facilitator to forward payment
    merchant_info: {
      merchant_address: CONFIG.merchant_address,
      merchant_amount: CONFIG.price_usdc_wei,
      fee_amount: String(OXMETA_FEE_USDC_WEI),
    },
  };
}

// ============================================================================
// PAYMENT FLOW
// ============================================================================

async function makePayment() {
  if (isPaymentInProgress) {
    console.log("⚠️ Payment already in progress");
    return;
  }

  if (!walletAddress || !web3) {
    updateStatus("❌ Connect wallet first", "danger");
    return;
  }

  if (!CONFIG) {
    CONFIG = await loadConfig();
    if (!CONFIG) {
      updateStatus("❌ Failed to load configuration", "danger");
      return;
    }
  }

  isPaymentInProgress = true;

  const payBtn = $("#payBtn");
  if (payBtn) {
    payBtn.disabled = true;
    payBtn.textContent = "🔄 Signing Authorization...";
  }

  try {
    updateStatus("🔐 Creating payment authorization...", "info");

    // STEP 1: Create EIP-3009 authorization (now to TREASURY)
    const { authorization, signature, merchant_info } =
      await createEIP3009Authorization();

    console.log("✅ Authorization created (to treasury)");

    // STEP 2: Verify payment with 0xmeta
    updateStatus("🔄 Verifying payment with 0xmeta...", "info");

    const verifyPayload = {
      transaction_hash: authorization.nonce,
      chain: CONFIG.network,
      seller_address: CONFIG.merchant_address, // Still merchant (for verification)
      expected_amount: String(CONFIG.price_usdc_wei), // Merchant amount (not total)
      expected_token: CONFIG.usdc_address,
      metadata: {
        source: "x402_merchant_demo",
        resource: "https://merchant-demo-six.vercel.app/photos",
        paymentPayload: {
          x402Version: 1,
          scheme: "exact",
          network: CONFIG.network,
          payload: {
            authorization: authorization, // Contains treasury as 'to'
            signature: signature,
          },
        },
        payer: walletAddress,
        payment_breakdown: {
          merchant_amount: String(CONFIG.price_usdc_wei),
          fee_amount: String(OXMETA_FEE_USDC_WEI),
          total_authorized: String(CONFIG.total_price_usdc_wei),
        },
        // ✅ NEW: Include merchant forwarding info
        merchant_forward: {
          merchant_address: CONFIG.merchant_address,
          merchant_amount: CONFIG.price_usdc_wei,
        },
      },
    };

    console.log("📤 Sending verify request to facilitator...");

    const verifyResponse = await fetch(`${BASE_URL}/v1/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(verifyPayload),
    });

    if (!verifyResponse.ok) {
      const errorData = await verifyResponse.json();
      console.error("❌ Verification failed:", errorData);
      throw new Error(
        errorData.error?.message || errorData.detail || "Verification failed"
      );
    }

    const verifyData = await verifyResponse.json();
    console.log("✅ Verification response:", verifyData);

    const verificationId = verifyData.verification_id;

    // STEP 3: Settle payment
    updateStatus("⚡ Settling payment via 0xmeta...", "info");

    if (payBtn) {
      payBtn.textContent = "⏳ Settling Payment...";
    }

    const settlePayload = {
      verification_id: verificationId,
      destination_address: CONFIG.merchant_address, // Merchant will receive forwarded amount
      metadata: {
        source: "x402_merchant_demo",
        treasury_forward_required: true, // Signal that treasury must forward to merchant
      },
    };

    console.log("📤 Sending settle request to facilitator...");

    const settleResponse = await fetch(`${BASE_URL}/v1/settle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settlePayload),
    });

    if (!settleResponse.ok) {
      const errorData = await settleResponse.json();
      console.error("❌ Settlement failed:", errorData);
      throw new Error(
        errorData.error?.message || errorData.detail || "Settlement failed"
      );
    }

    const settleData = await settleResponse.json();
    console.log("✅ Settlement response:", settleData);

    // STEP 4: Success! Show photos
    console.log("✅ Payment complete! Fetching photos...");
    console.log("💰 Payment routing:", {
      treasury_received: CONFIG.total_price_usdc_wei,
      fee_kept_by_treasury: OXMETA_FEE_USDC_WEI,
      forwarded_to_merchant: CONFIG.price_usdc_wei,
    });

    updateStatus(
      "✅ Payment successful! Loading your premium content...",
      "success"
    );

    // Call the success function to fetch and display photos
    if (typeof window.showPaymentSuccess === "function") {
      window.showPaymentSuccess();
    }

    // Store payment info
    try {
      sessionStorage.setItem("verificationId", verificationId);
      sessionStorage.setItem("settlementId", settleData.settlement_id);
      sessionStorage.setItem("verifiedPayment", "true");
    } catch (e) {
      console.warn("Session storage failed:", e);
    }
  } catch (error) {
    console.error("❌ Payment error:", error);
    updateStatus("❌ Payment failed: " + (error.message || error), "danger");

    if (payBtn) {
      payBtn.disabled = false;
      payBtn.textContent = `💰 Pay ${CONFIG.total_price_usdc} USDC`;
    }

    isPaymentInProgress = false;
  }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

if (isMetaMaskInstalled()) {
  window.ethereum.on("accountsChanged", (accounts) => {
    console.log("Accounts changed:", accounts);
    if (!accounts || accounts.length === 0) {
      disconnectWallet();
    } else {
      walletAddress = accounts[0];
      sessionStorage.setItem("walletAddress", walletAddress);
      showPaymentSection();
      updateStatus("🔄 Account changed to " + shorten(walletAddress), "info");
    }
  });

  window.ethereum.on("chainChanged", (chainId) => {
    console.log("Chain changed:", chainId);
    updateStatus("🔄 Network changed. Please ensure correct network.", "info");
  });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

window.addEventListener("load", async () => {
  console.log("🚀 App initialized");
  console.log("🏦 Treasury-first payment flow enabled");
  console.log(`   Treasury Address: ${OXMETA_TREASURY_WALLET}`);

  if (isMetaMaskInstalled()) {
    web3 = new Web3(window.ethereum);
  }

  await loadConfig();
});

// ============================================================================
// DOM READY
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  console.log("📋 DOM Ready - Binding events");

  if (sessionStorage.getItem("walletConnected") === "true") {
    walletAddress = sessionStorage.getItem("walletAddress");
    if (walletAddress && isMetaMaskInstalled()) {
      web3 = new Web3(window.ethereum);
      loadWalletState();
    }
  }

  const connectBtn = $("#connectBtn");
  const payBtn = $("#payBtn");
  const disconnectBtn = $("#disconnectBtn");

  if (connectBtn) {
    connectBtn.addEventListener("click", connectWallet);
    console.log("✅ Connect button bound");
  }

  if (payBtn) {
    payBtn.addEventListener("click", makePayment);
    console.log("✅ Pay button bound");
  }

  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", disconnectWallet);
    console.log("✅ Disconnect button bound");
  }

  if (!isMetaMaskInstalled()) {
    updateStatus(
      "❌ MetaMask not found. Please install it to continue.",
      "danger"
    );
    if (connectBtn) {
      connectBtn.disabled = true;
    }
  }
});

// ============================================================================
// EXPOSE TO GLOBAL SCOPE
// ============================================================================

window.connectWallet = connectWallet;
window.makePayment = makePayment;
window.disconnectWallet = disconnectWallet;
window.isMetaMaskInstalled = isMetaMaskInstalled;
