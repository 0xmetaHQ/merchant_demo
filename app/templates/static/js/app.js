// Pure x402 payment flow via 0xmeta facilitator
// ✅ UPDATED: Authorization includes merchant payment + 0xmeta fee ($0.01)
// ✅ User signs EIP-3009 authorization (NO on-chain transaction)
// ✅ 0xmeta handles atomic settlement (split payment)

console.log("x402 Merchant Demo - Pure x402 Payment Module Loaded");

// ============================================================================
// GLOBAL STATE
// ============================================================================
let web3 = null;
let walletAddress = null;
let CONFIG = null;
let isPaymentInProgress = false;
let currentAuthorizationNonce = null;
const AUTO_REDIRECT_SECONDS = 3;
let countdownTimer = null;

// ✅ CRITICAL: 0xmeta fee configuration
const OXMETA_FEE_USDC_WEI = 10000; // $0.01 USDC in wei (6 decimals)
const OXMETA_FEE_USDC = 0.01; // For display

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

  // ✅ Update pay button to show total amount (merchant + fee)
  updatePayButtonText();
}

// ✅ NEW: Update pay button to show total cost
function updatePayButtonText() {
  const payBtn = $("#payBtn");
  if (payBtn && CONFIG) {
    const totalAmount = (
      parseFloat(CONFIG.price_usdc) + OXMETA_FEE_USDC
    ).toFixed(2);
    payBtn.innerHTML = `💰 Pay ${totalAmount} USDC <small class="d-block" style="font-size: 0.7em;">Includes $${OXMETA_FEE_USDC} facilitator fee</small>`;
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

    // ✅ CRITICAL FIX: Ensure all values are STRINGS
    CONFIG.price_usdc_wei = String(CONFIG.price_usdc_wei);
    CONFIG.total_price_usdc_wei = String(
      parseInt(CONFIG.price_usdc_wei) + OXMETA_FEE_USDC_WEI
    );
    CONFIG.total_price_usdc = (
      parseFloat(CONFIG.price_usdc) + OXMETA_FEE_USDC
    ).toFixed(2);

    console.log("💰 Payment breakdown:", {
      merchant_amount: CONFIG.price_usdc,
      fee_amount: OXMETA_FEE_USDC,
      total_amount: CONFIG.total_price_usdc,
      merchant_wei: CONFIG.price_usdc_wei, // ✅ Now string
      fee_wei: String(OXMETA_FEE_USDC_WEI), // ✅ String
      total_wei: CONFIG.total_price_usdc_wei, // ✅ Now string
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

/**
 * Create EIP-3009 transferWithAuthorization signature
 *
 * ✅ CRITICAL: Authorization amount = merchant_amount + fee_amount
 * This allows 0xmeta to execute atomic split payment:
 * - merchant receives merchant_amount
 * - treasury receives fee_amount
 * - both in SINGLE transaction
 */
async function createEIP3009Authorization() {
  if (!web3 || !walletAddress || !CONFIG) {
    throw new Error("Web3 not initialized");
  }

  console.log("🔐 Creating EIP-3009 authorization with fee included...");

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

  // 2. Generate UNIQUE random nonce
  const nonceBytes = new Uint8Array(32);
  window.crypto.getRandomValues(nonceBytes);
  const nonce =
    "0x" +
    Array.from(nonceBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

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

  // 5. ✅ CRITICAL: Build message with TOTAL amount (merchant + fee)
  const validAfter = "0";
  const validBefore = String(Math.floor(Date.now() / 1000) + 86400); // 24 hours

  const message = {
    from: walletAddress,
    to: CONFIG.merchant_address,
    value: CONFIG.total_price_usdc_wei, // This is already a string from config
    validAfter: validAfter, // Already a string
    validBefore: validBefore, // Already a string
    nonce: nonce, // Already a string
  };

  console.log("📋 Signing authorization:", {
    from: message.from,
    to: message.to,
    merchant_amount: CONFIG.price_usdc_wei,
    fee_amount: OXMETA_FEE_USDC_WEI,
    total_value: message.value,
    validBefore: new Date(validBefore * 1000).toISOString(),
    nonce: nonce.substring(0, 20) + "...",
  });

  // Show user what they're authorizing
  updateStatus(
    `🔐 Authorizing ${CONFIG.total_price_usdc} USDC total<br/>` +
      `<small>→ ${CONFIG.price_usdc} to merchant + $${OXMETA_FEE_USDC} facilitator fee</small>`,
    "info"
  );

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

  console.log("✅ EIP-3009 signature created with fee included");

  return {
    authorization: {
      from: walletAddress,
      to: CONFIG.merchant_address,
      value: CONFIG.total_price_usdc_wei, // ✅ String, not number
      validAfter: String(validAfter), // ✅ Ensure string
      validBefore: String(validBefore), // ✅ Ensure string
      nonce: nonce,
      token: CONFIG.usdc_address,
    },
    signature: signature,
  };
}

// ============================================================================
// PURE x402 PAYMENT FLOW VIA 0xmeta FACILITATOR
// ✅ UPDATED: Sends merchant_amount to facilitator (not total)
// ✅ Facilitator validates that authorization = merchant_amount + fee
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

    // ========================================================================
    // STEP 1: Create EIP-3009 authorization (includes fee!)
    // ========================================================================
    const { authorization, signature } = await createEIP3009Authorization();

    console.log("✅ Authorization created:", {
      from: authorization.from,
      to: authorization.to,
      total_authorized: authorization.value,
      merchant_amount: CONFIG.price_usdc_wei,
      fee_amount: OXMETA_FEE_USDC_WEI,
    });

    // ========================================================================
    // STEP 2: Send to 0xmeta facilitator for verification
    // ✅ CRITICAL FIX: Convert ALL numbers to strings
    // ========================================================================
    updateStatus("🔄 Verifying payment with 0xmeta...", "info");

    const verifyPayload = {
      transaction_hash: authorization.nonce,
      chain: CONFIG.network,
      seller_address: CONFIG.merchant_address,
      expected_amount: String(CONFIG.price_usdc_wei), // ✅ FIXED: Convert to string
      expected_token: CONFIG.usdc_address,
      metadata: {
        source: "x402_merchant_demo",
        resource: "https://merchant-demo-six.vercel.app/photos",
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
        payment_breakdown: {
          merchant_amount: String(CONFIG.price_usdc_wei), // ✅ FIXED: Convert to string
          fee_amount: String(OXMETA_FEE_USDC_WEI), // ✅ FIXED: Already string, but ensure
          total_authorized: String(CONFIG.total_price_usdc_wei), // ✅ FIXED: Convert to string
        },
      },
    };

    console.log("📦 Sending verification request to 0xmeta...");
    console.log(
      "💰 Payment breakdown:",
      verifyPayload.metadata.payment_breakdown
    );

    const verifyResponse = await fetch(
      "https://facilitator.0xmeta.ai/v1/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(verifyPayload),
      }
    );

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

    // ========================================================================
    // STEP 3: Send settlement request to 0xmeta
    // 0xmeta will execute atomic split payment
    // ========================================================================
    updateStatus("⚡ Settling payment via 0xmeta (atomic split)...", "info");

    if (payBtn) {
      payBtn.textContent = "⏳ Settling Payment...";
    }

    const settlePayload = {
      verification_id: verificationId,
      destination_address: CONFIG.merchant_address,
    };

    console.log("📦 Sending settlement request to 0xmeta...");

    const settleResponse = await fetch(
      "https://facilitator.0xmeta.ai/v1/settle",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(settlePayload),
      }
    );

    if (!settleResponse.ok) {
      const errorData = await settleResponse.json();
      console.error("❌ Settlement failed:", errorData);
      throw new Error(
        errorData.error?.message || errorData.detail || "Settlement failed"
      );
    }

    const settleData = await settleResponse.json();
    console.log("✅ Settlement response:", settleData);
    console.log("💰 Fee collection:", settleData.details);

    // ========================================================================
    // STEP 4: Success! Display JSON responses
    // ========================================================================

    // Find the success handling section in makePayment() function
    // Replace the success section (around line 550-580) with this:

    // ========================================================================
    // STEP 4: Success! Display JSON responses
    // ========================================================================

    console.log("✅ Payment flow complete!");
    console.log("Verification:", verifyData);
    console.log("Settlement:", settleData);

    // Call the new display function from paywall.html
    if (typeof window.showPaymentSuccess === "function") {
      window.showPaymentSuccess(verifyData, settleData);

      // ✅ NEW: Start polling settlement status
      if (settleData.settlement_id && settleData.status === "pending") {
        console.log("⏳ Settlement is pending, starting status polling...");

        // Show status indicator
        updateStatus(
          "⏳ Waiting for on-chain confirmation...<br/>" +
            "<small>This usually takes 10-30 seconds</small>",
          "info"
        );

        // Poll for status updates
        if (typeof window.pollSettlementStatus === "function") {
          window
            .pollSettlementStatus(settleData.settlement_id, 20, 3000)
            .then((result) => {
              if (result.success) {
                console.log(
                  `✅ Settlement confirmed after ${result.attempts} attempts`
                );
                updateStatus(
                  "✅ Settlement confirmed on-chain!<br/>" +
                    `<small>Transaction: ${result.status.transaction_hash}</small>`,
                  "success"
                );
              } else if (result.timeout) {
                console.warn("⚠️  Status polling timed out");
                updateStatus(
                  "⚠️  Settlement is taking longer than expected<br/>" +
                    "<small>You can check status later or refresh the page</small>",
                  "warning"
                );
              } else {
                console.error("❌ Settlement failed");
                updateStatus(
                  "❌ Settlement failed<br/>" +
                    "<small>Please contact support</small>",
                  "danger"
                );
              }
            })
            .catch((err) => {
              console.error("Status polling error:", err);
            });
        }
      } else if (settleData.settlement_tx_hash) {
        // Already confirmed
        updateStatus(
          "✅ Settlement confirmed on-chain!<br/>" +
            `<small>Transaction: ${settleData.settlement_tx_hash}</small>`,
          "success"
        );
      }
    } else {
      // Fallback to old success display
      updateStatus(
        `✅ Payment complete!<br/>` +
          `<small>Settlement ID: ${settleData.settlement_id}</small><br/>` +
          `<small>Merchant received: ${CONFIG.price_usdc} USDC</small><br/>` +
          `<small>Fee collected: ${OXMETA_FEE_USDC} (atomic)</small>`,
        "success"
      );

      const paymentSection = $("#paymentSection");
      const successSection = $("#successSection");

      if (paymentSection) paymentSection.style.display = "none";
      if (successSection) successSection.style.display = "block";
    }

    try {
      sessionStorage.setItem("verificationId", verificationId);
      sessionStorage.setItem("settlementId", settleData.settlement_id);
      sessionStorage.setItem("verifyResponse", JSON.stringify(verifyData));
      sessionStorage.setItem("settleResponse", JSON.stringify(settleData));
    } catch (e) {
      console.warn("Session storage failed:", e);
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
          updateStatus(
            "🔄 Account changed to " + shorten(walletAddress),
            "info"
          );
        }
      });

      window.ethereum.on("chainChanged", (chainId) => {
        console.log("Chain changed:", chainId);
        updateStatus(
          "🔄 Network changed. Please ensure correct network.",
          "info"
        );
      });
    }
  } catch (e) {
    console.error("Error in makePayment:", e);
    updateStatus("❌ Payment failed: " + (e.message || e), "danger");
  }
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

// Add this to your app.js after the settlement response

/**
 * Poll settlement status until it's confirmed on-chain
 * This is needed because 1Shot processes transactions asynchronously
 */
async function pollSettlementStatus(
  settlementId,
  maxAttempts = 20,
  interval = 3000
) {
  console.log(`🔍 Starting settlement status polling for ${settlementId}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(
        `https://facilitator.0xmeta.ai/v1/settlements/${settlementId}/status`,
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        console.warn(
          `Attempt ${attempt}/${maxAttempts}: Failed to fetch status`
        );
        await sleep(interval);
        continue;
      }

      const status = await response.json();
      console.log(`Attempt ${attempt}/${maxAttempts}: Status =`, status.status);

      // Check if settled
      if (status.status === "settled" && status.transaction_hash) {
        console.log("✅ Settlement confirmed on-chain!");
        console.log("Transaction hash:", status.transaction_hash);

        // Update UI with transaction hash
        updateSettlementStatus(status);

        return {
          success: true,
          status: status,
          attempts: attempt,
        };
      }

      // Check if failed
      if (status.status === "failed") {
        console.error("❌ Settlement failed");
        return {
          success: false,
          status: status,
          attempts: attempt,
        };
      }

      // Still pending, wait and try again
      await sleep(interval);
    } catch (error) {
      console.error(`Attempt ${attempt}/${maxAttempts}: Error`, error);
      await sleep(interval);
    }
  }

  console.warn("⚠️  Polling timeout - settlement still pending");
  return {
    success: false,
    timeout: true,
    attempts: maxAttempts,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateSettlementStatus(status) {
  // Update the settlement response JSON viewer
  if (typeof window.showPaymentSuccess === "function") {
    const settlementViewer = document.getElementById("settleJsonViewer");
    if (settlementViewer && status) {
      // Get current verification data
      const verifyResponse = sessionStorage.getItem("verifyResponse");
      const verifyData = verifyResponse ? JSON.parse(verifyResponse) : null;

      // Update settlement data with new status
      const updatedSettleData = {
        ...status,
        status: status.status || "settled",
        settlement_tx_hash:
          status.transaction_hash || status.settlement_tx_hash,
        details: {
          ...(status.details || {}),
          confirmed_on_chain: true,
          block_number: status.details?.blockNumber,
          gas_used: status.details?.gasUsed,
        },
      };

      // Re-display with updated data
      const highlighted = syntaxHighlight(updatedSettleData);
      settlementViewer.innerHTML = `<pre>${highlighted}</pre>`;

      // Show success message
      const badge = document.querySelector(".status-settled");
      if (badge) {
        badge.style.background = "#d4edda";
        badge.style.color = "#155724";
        badge.innerHTML =
          "<span>✓</span><span>Settlement Confirmed On-Chain</span>";
      }

      // Store updated data
      sessionStorage.setItem(
        "settleResponse",
        JSON.stringify(updatedSettleData)
      );
    }
  }
}

// Syntax highlighting helper (needed for updateSettlementStatus)
function syntaxHighlight(json) {
  if (typeof json !== "string") {
    json = JSON.stringify(json, null, 2);
  }
  json = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    function (match) {
      let cls = "json-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "json-key";
        } else {
          cls = "json-string";
        }
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      } else if (/null/.test(match)) {
        cls = "json-null";
      }
      return '<span class="' + cls + '">' + match + "</span>";
    }
  );
}

// Export for use in app.js
window.pollSettlementStatus = pollSettlementStatus;

// ============================================================================
// EXPOSE TO GLOBAL SCOPE
// ============================================================================

window.connectWallet = connectWallet;
window.makePayment = makePayment;
window.disconnectWallet = disconnectWallet;
window.isMetaMaskInstalled = isMetaMaskInstalled;
