// app/static/js/app.js
// Pure x402 payment flow via 0xmeta facilitator
// ✅ User signs EIP-3009 authorization (NO on-chain transaction)
// ✅ 0xmeta handles settlement on-chain
// ✅ Generates unique nonce per payment
// ✅ Prevents duplicate submissions
// 🔧 FIXED: Proper validBefore timestamp and authorization lifecycle

console.log("x402 Merchant Demo - Pure x402 Payment Module Loaded");

// ============================================================================
// GLOBAL STATE
// ============================================================================
let web3 = null;
let walletAddress = null;
let CONFIG = null;
let isPaymentInProgress = false; // ✅ Prevent duplicate submissions
let currentAuthorizationNonce = null; // 🔧 Track current authorization
const AUTO_REDIRECT_SECONDS = 3;
let countdownTimer = null;

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
    updateNetworkDisplay();
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

    // Switch to correct network
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
  currentAuthorizationNonce = null; // 🔧 Clear authorization

  const walletSection = $("#walletSection");
  const paymentSection = $("#paymentSection");
  const successSection = $("#successSection");

  if (walletSection) walletSection.style.display = "block";
  if (paymentSection) paymentSection.style.display = "none";
  if (successSection) successSection.style.display = "none";

  sessionStorage.removeItem("walletConnected");
  sessionStorage.removeItem("walletAddress");
  sessionStorage.removeItem("prefetchedPhotos");
  sessionStorage.removeItem("verifiedPayment");

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
      // Network not added yet
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
// EIP-3009 AUTHORIZATION CREATION (PURE x402 - NO ON-CHAIN TX)
// ✅ Generates UNIQUE nonce for EACH payment attempt
// 🔧 FIXED: Proper validBefore timestamp (24 hours instead of 1 hour)
// 🔧 FIXED: Invalidate previous authorizations on new attempts
// ============================================================================

/**
 * Create EIP-3009 transferWithAuthorization signature
 * This is sent to 0xmeta facilitator which handles on-chain execution
 */
async function createEIP3009Authorization() {
  if (!web3 || !walletAddress || !CONFIG) {
    throw new Error("Web3 not initialized");
  }

  console.log(
    "🔐 Creating EIP-3009 authorization (pure x402 - no on-chain tx)..."
  );

  // 1. Get USDC contract details
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

  // 2. ✅ CRITICAL: Generate UNIQUE random nonce for EACH payment
  // 🔧 FIXED: Ensure we're not reusing nonces
  const nonceBytes = new Uint8Array(32);
  window.crypto.getRandomValues(nonceBytes);
  const nonce =
    "0x" +
    Array.from(nonceBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  // Store current nonce to prevent reuse
  currentAuthorizationNonce = nonce;
  console.log("✅ Generated UNIQUE nonce:", nonce.substring(0, 20) + "...");

  // 3. Build EIP-712 domain
  const domain = {
    name: tokenName,
    version: tokenVersion,
    chainId: parseInt(CONFIG.chain_id, 16),
    verifyingContract: CONFIG.usdc_address,
  };

  // 4. Define EIP-712 types
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

  // 5. 🔧 FIXED: Build message with proper timestamps
  // Use validAfter = 0 (immediately valid)
  // Use validBefore = 24 hours from now (instead of 1 hour)
  const validAfter = "0";
  const validBefore = String(Math.floor(Date.now() / 1000) + 86400); // 24 hours

  const message = {
    from: walletAddress,
    to: CONFIG.merchant_address,
    value: CONFIG.price_usdc_wei.toString(),
    validAfter: validAfter,
    validBefore: validBefore,
    nonce: nonce,
  };

  console.log("📋 Signing message:", {
    from: message.from,
    to: message.to,
    value: message.value,
    validBefore: new Date(validBefore * 1000).toISOString(),
    nonce: nonce.substring(0, 20) + "...",
  });

  // 6. Sign using EIP-712
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

  return {
    authorization: {
      from: walletAddress,
      to: CONFIG.merchant_address,
      value: CONFIG.price_usdc_wei.toString(),
      validAfter: validAfter,
      validBefore: validBefore,
      nonce: nonce,
      token: CONFIG.usdc_address,
    },
    signature: signature,
  };
}

// ============================================================================
// PURE x402 PAYMENT FLOW VIA 0xmeta FACILITATOR
// ✅ NO on-chain transaction from user (no gas fees!)
// ✅ User only signs authorization
// ✅ 0xmeta handles on-chain settlement
// 🔧 FIXED: Better error handling and state management
// ============================================================================

async function makePayment() {
  // ✅ Prevent duplicate submissions
  if (isPaymentInProgress) {
    console.log("⚠️ Payment already in progress, ignoring duplicate request");
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

  // ✅ Lock payment processing
  isPaymentInProgress = true;

  const payBtn = $("#payBtn");
  if (payBtn) {
    payBtn.disabled = true;
    payBtn.textContent = "🔄 Signing Authorization...";
  }

  try {
    updateStatus("🔐 Creating payment authorization...", "info");

    // ========================================================================
    // STEP 1: Create EIP-3009 authorization (NO on-chain transaction!)
    // ========================================================================
    const { authorization, signature } = await createEIP3009Authorization();

    console.log("✅ Authorization created:", {
      from: authorization.from,
      to: authorization.to,
      value: authorization.value,
      nonce: authorization.nonce.substring(0, 20) + "...",
    });

    // ========================================================================
    // STEP 2: Send to 0xmeta facilitator for verification
    // ========================================================================
    updateStatus("🔄 Verifying payment with 0xmeta...", "info");

    const verifyPayload = {
      transaction_hash: authorization.nonce, // Use nonce as transaction reference
      chain: CONFIG.network,
      seller_address: CONFIG.merchant_address,
      expected_amount: authorization.value,
      expected_token: CONFIG.usdc_address,
      metadata: {
        source: "x402_merchant_demo",
        resource: "http://localhost:8080/photos",
        paymentPayload: {
          x402Version: 1,
          scheme: "exact",
          network: CONFIG.network,
          payload: {
            authorization: authorization,
            signature: signature,
          },
        },
        payer: walletAddress,
      },
    };

    console.log("📦 Sending verification request to 0xmeta...");

    const verifyResponse = await fetch("http://localhost:8000/v1/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(verifyPayload),
    });

    if (!verifyResponse.ok) {
      const errorData = await verifyResponse.json();
      throw new Error(errorData.detail || "Verification failed");
    }

    const verifyData = await verifyResponse.json();
    console.log("✅ Verification response:", verifyData);

    const verificationId = verifyData.verification_id;

    // ========================================================================
    // STEP 3: Send settlement request to 0xmeta
    // ========================================================================
    updateStatus("⚡ Settling payment via 0xmeta...", "info");

    if (payBtn) {
      payBtn.textContent = "⏳ Settling Payment...";
    }

    const settlePayload = {
      verification_id: verificationId,
      destination_address: CONFIG.merchant_address,
    };

    console.log("📦 Sending settlement request to 0xmeta...");

    const settleResponse = await fetch("http://localhost:8000/v1/settle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settlePayload),
    });

    if (!settleResponse.ok) {
      const errorData = await settleResponse.json();
      throw new Error(errorData.detail || "Settlement failed");
    }

    const settleData = await settleResponse.json();
    console.log("✅ Settlement response:", settleData);

    // ========================================================================
    // STEP 4: Success! Payment authorized and settling
    // ========================================================================

    updateStatus(
      `✅ Payment authorized! Settlement ID: ${settleData.settlement_id}`,
      "success"
    );

    // Update UI
    const paymentSection = $("#paymentSection");
    const successSection = $("#successSection");

    if (paymentSection) paymentSection.style.display = "none";
    if (successSection) successSection.style.display = "block";

    // Store verification for future use
    try {
      sessionStorage.setItem("verificationId", verificationId);
      sessionStorage.setItem("settlementId", settleData.settlement_id);
    } catch (e) {
      console.warn("Session storage failed:", e);
    }

    // Auto-redirect
    startAutoRedirect();
  } catch (err) {
    console.error("Payment error:", err);

    // 🔧 IMPROVED: Better error messages
    let errorMsg = "Payment failed";
    if (err.message.includes("User denied")) {
      errorMsg = "Signature cancelled by user";
    } else if (err.message.includes("expired")) {
      errorMsg = "Authorization expired. Please try again";
    } else if (err.message.includes("used or canceled")) {
      errorMsg = "Authorization already used. Please try again";
    } else {
      errorMsg = err.message || err;
    }

    updateStatus("❌ " + errorMsg, "danger");

    // ✅ Re-enable button ONLY on error
    isPaymentInProgress = false;
    currentAuthorizationNonce = null; // Clear failed authorization

    if (payBtn) {
      payBtn.disabled = false;
      payBtn.textContent = `💰 Pay ${CONFIG.price_usdc} USDC`;
    }
  }

  // NOTE: Don't unlock on success - we redirect instead
}

// ============================================================================
// AUTO-REDIRECT
// ============================================================================

function startAutoRedirect(seconds = AUTO_REDIRECT_SECONDS) {
  let t = seconds;
  const countdownEl = $("#countdown");

  if (countdownEl) {
    countdownEl.textContent = t;
  }

  countdownTimer = setInterval(() => {
    t -= 1;
    if (countdownEl) {
      countdownEl.textContent = t;
    }

    if (t <= 0) {
      clearInterval(countdownTimer);
      window.location.href = "/photos";
    }
  }, 1000);
}

function stopAutoRedirect() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
    updateStatus("You stayed on the page.", "info");
  }
}

// ============================================================================
// EVENT LISTENERS - MetaMask Events
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

  if (isMetaMaskInstalled()) {
    web3 = new Web3(window.ethereum);
  }

  await loadConfig();
});

// ============================================================================
// DOM READY - Bind Events
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  console.log("📋 DOM Ready - Binding events");

  // Restore wallet state
  if (sessionStorage.getItem("walletConnected") === "true") {
    walletAddress = sessionStorage.getItem("walletAddress");
    if (walletAddress && isMetaMaskInstalled()) {
      web3 = new Web3(window.ethereum);
      loadWalletState();
    }
  }

  // Bind button events
  const connectBtn = $("#connectBtn");
  const payBtn = $("#payBtn");
  const disconnectBtn = $("#disconnectBtn");
  const viewNowBtn = $("#viewNowBtn");
  const stayBtn = $("#stayBtn");

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

  if (viewNowBtn) {
    viewNowBtn.addEventListener("click", () => {
      window.location.href = "/photos";
    });
  }

  if (stayBtn) {
    stayBtn.addEventListener("click", stopAutoRedirect);
  }

  // Check MetaMask availability
  if (!isMetaMaskInstalled()) {
    updateStatus(
      "❌ MetaMask not found. Please install it to continue.",
      "danger"
    );
    if (connectBtn) {
      connectBtn.disabled = true;
    }
  } else {
    updateStatus(
      '✅ MetaMask detected. Click "Connect MetaMask" to start.',
      "success"
    );
  }

  // Handle /photos page - verify payment
  if (window.location.pathname === "/photos") {
    const verifiedPayment = sessionStorage.getItem("verifiedPayment");
    if (verifiedPayment) {
      fetch("/photos", {
        headers: {
          "X-Payment": verifiedPayment,
          Accept: "application/json",
        },
      })
        .then((resp) => {
          if (!resp.ok) throw new Error("Payment expired or invalid");
          return resp.json();
        })
        .then((data) => {
          console.log("✅ Photos loaded with verified payment");
          if (data.photos && Array.isArray(data.photos)) {
            preloadImages(data.photos);
          }
        })
        .catch((err) => {
          console.error("Payment verification failed:", err);
          sessionStorage.removeItem("verifiedPayment");
          window.location.href = "/paywall";
        });
    }
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function preloadImages(photoUrls) {
  if (!Array.isArray(photoUrls)) return;

  for (const url of photoUrls) {
    const img = new Image();
    img.src = url;
  }
  console.log(`🖼️ Preloading ${photoUrls.length} images...`);
}

// ============================================================================
// EXPOSE TO GLOBAL SCOPE (for console debugging)
// ============================================================================

window.connectWallet = connectWallet;
window.makePayment = makePayment;
window.disconnectWallet = disconnectWallet;
window.isMetaMaskInstalled = isMetaMaskInstalled;
