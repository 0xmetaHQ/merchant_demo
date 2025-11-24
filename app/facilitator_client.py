# ============================================================================
# FILE: .env (Updated)
# ============================================================================
"""
# Facilitator API base URL
FACILITATOR_BASE_URL=http://localhost:8000

# Your merchant wallet address (where you receive payments)
MERCHANT_PAYOUT_WALLET=0xa821f428ef8cc9f54a9915336a82220853059090

# USDC contract address - Base Sepolia for testing
USDC_TOKEN_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e

# Blockchain network - use 'base-sepolia' for testing
CHAIN=base-sepolia

# Price for accessing /photos endpoint in USDC wei (0.01 USDC)
PRICE_IN_USDC=10000

# Auto-settle payments after verification
AUTO_SETTLE=true
"""


# ============================================================================
# FILE: app/config.py (Updated - Removed API Key requirement)
# ============================================================================
"""
Configuration for merchant demo app.
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings."""
    
    # Facilitator API base URL
    FACILITATOR_BASE_URL = os.getenv(
        "FACILITATOR_BASE_URL",
        "http://localhost:8000"
    )
    
    # Construct endpoint URLs
    FACILITATOR_VERIFY_URL = f"{FACILITATOR_BASE_URL}/v1/verify"
    FACILITATOR_SETTLE_URL = f"{FACILITATOR_BASE_URL}/v1/settle"
    
    # Your merchant wallet address
    MERCHANT_PAYOUT_WALLET = os.getenv("MERCHANT_PAYOUT_WALLET")
    
    # USDC contract address (Base Sepolia for testing)
    USDC_TOKEN_ADDRESS = os.getenv(
        "USDC_TOKEN_ADDRESS",
        "0x036CbD53842c5426634e7929541eC2318f3dCF7e"  # Base Sepolia USDC
    )
    
    # Blockchain network - IMPORTANT: Use 'base-sepolia' for testing!
    CHAIN = os.getenv("CHAIN", "base-sepolia")
    
    # Price for accessing /photos endpoint
    # 0.01 USDC = 10,000 (USDC has 6 decimals)
    PRICE_IN_USDC = int(os.getenv("PRICE_IN_USDC", "10000"))
    
    def validate(self):
        """Validate required configuration."""
        if not self.MERCHANT_PAYOUT_WALLET:
            raise ValueError(
                "Missing MERCHANT_PAYOUT_WALLET environment variable\n"
                "Please set it in your .env file"
            )
        
        # Validate wallet address format
        if not self.MERCHANT_PAYOUT_WALLET.startswith("0x"):
            raise ValueError(
                "MERCHANT_PAYOUT_WALLET must be a valid Ethereum address starting with 0x"
            )
        
        if len(self.MERCHANT_PAYOUT_WALLET) != 42:
            raise ValueError(
                "MERCHANT_PAYOUT_WALLET must be 42 characters long (0x + 40 hex chars)"
            )
    
    def __str__(self):
        """String representation for debugging."""
        return (
            f"Settings(\n"
            f"  Facilitator URL: {self.FACILITATOR_BASE_URL}\n"
            f"  Merchant Wallet: {self.MERCHANT_PAYOUT_WALLET}\n"
            f"  USDC Address: {self.USDC_TOKEN_ADDRESS}\n"
            f"  Chain: {self.CHAIN}\n"
            f"  Price: {self.PRICE_IN_USDC} USDC wei (0.01 USDC)\n"
            f")"
        )


# Global settings instance
settings = Settings()

# Validate on import
try:
    settings.validate()
    print("✅ Configuration validated successfully")
    print(settings)
except ValueError as e:
    print(f"❌ Configuration error: {e}")
    raise


# ============================================================================
# FILE: app/facilitator_client.py (Simplified - No API key)
# ============================================================================
import os
import logging
from typing import Dict, Any, Optional

import httpx

logger = logging.getLogger(__name__)
FACILITATOR_BASE = os.getenv("FACILITATOR_BASE_URL", "http://localhost:8000").rstrip("/")


class FacilitatorClient:
    """Async client for 0xmeta facilitator API."""

    def __init__(self, base_url: str = FACILITATOR_BASE):
        self.base_url = base_url

    async def verify_payment(
        self,
        transaction_hash: str,
        chain: str,
        seller_address: str,
        expected_amount: str,
        expected_token: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Verify a payment with the facilitator."""
        payload = {
            "transaction_hash": transaction_hash,
            "chain": chain,
            "seller_address": seller_address,
            "expected_amount": expected_amount,
            "expected_token": expected_token,
            "metadata": metadata or {},
        }

        logger.info("Calling facilitator /v1/verify")
        logger.debug("Verify payload: %s", payload)
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/v1/verify",
                    json=payload
                )
            except Exception as e:
                logger.exception("Network error calling facilitator verify")
                return {"success": False, "error": str(e)}

        logger.info("Facilitator verify response: %s", resp.status_code)
        
        if resp.status_code == 200:
            data = resp.json()
            return {"success": True, "data": data}
        else:
            error_text = resp.text
            logger.error("Verify failed: %s", error_text)
            return {
                "success": False,
                "error": f"HTTP {resp.status_code}: {error_text}",
                "status_code": resp.status_code
            }

    async def settle_payment(
        self,
        verification_id: str,
        destination_address: str,
        amount: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Settle a verified payment."""
        payload = {
            "verification_id": verification_id,
            "destination_address": destination_address,
        }
        
        if amount:
            payload["amount"] = amount
            
        if metadata:
            payload["metadata"] = metadata

        logger.info("Calling facilitator /v1/settle")
        logger.debug("Settle payload: %s", payload)
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.post(
                    f"{self.base_url}/v1/settle",
                    json=payload
                )
            except Exception as e:
                logger.exception("Network error calling facilitator settle")
                return {"success": False, "error": str(e)}

        logger.info("Facilitator settle response: %s", resp.status_code)
        
        if resp.status_code == 200:
            return {"success": True, "data": resp.json()}
        else:
            error_text = resp.text
            logger.error("Settle failed: %s", error_text)
            return {
                "success": False,
                "error": f"HTTP {resp.status_code}: {error_text}",
                "status_code": resp.status_code
            }


# Singleton instance
facilitator_client = FacilitatorClient()