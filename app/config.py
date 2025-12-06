"""
Configuration for merchant demo app.
FIXED: Network properly set to base-sepolia for testing
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    """Application settings."""
    
    # =========================================================================
    # 0xmeta Facilitator Configuration
    # =========================================================================
    
    # Facilitator API base URL
    FACILITATOR_BASE_URL = os.getenv(
        "FACILITATOR_BASE_URL"
    )
    OXMETA_TREASURY_WALLET = os.getenv("OXMETA_TREASURY_WALLET")
    
    # Construct endpoint URLs
    FACILITATOR_VERIFY_URL = f"{FACILITATOR_BASE_URL}/v1/verify"
    FACILITATOR_SETTLE_URL = f"{FACILITATOR_BASE_URL}/v1/settle"
    
    # =========================================================================
    # Merchant Configuration
    # =========================================================================
    
    # Your merchant wallet address (where you receive payments)
    MERCHANT_PAYOUT_WALLET = os.getenv("MERCHANT_PAYOUT_WALLET")
    
    # =========================================================================
    # Payment Configuration
    # =========================================================================
    
    # ✅ FIXED: Network configuration with proper defaults
    # Use 'base-sepolia' for testing, 'base' for production
    CHAIN = os.getenv("CHAIN", "base-sepolia")  # ✅ Changed default to base-sepolia
    
    # USDC contract addresses - auto-select based on CHAIN
    USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    
    @property
    def USDC_TOKEN_ADDRESS(self) -> str:
        """Get USDC address for current chain."""
        if self.CHAIN == "base":
            return self.USDC_BASE_MAINNET
        elif self.CHAIN == "base-sepolia":
            return self.USDC_BASE_SEPOLIA
        else:
            raise ValueError(f"Unsupported chain: {self.CHAIN}")
    
    # Chain IDs
    @property
    def CHAIN_ID(self) -> str:
        """Get chain ID for current chain."""
        if self.CHAIN == "base":
            return "0x2105"  # Base Mainnet
        elif self.CHAIN == "base-sepolia":
            return "0x14a34"  # Base Sepolia
        else:
            raise ValueError(f"Unsupported chain: {self.CHAIN}")
    
    # RPC URLs
    @property
    def RPC_URL(self) -> str:
        """Get RPC URL for current chain."""
        if self.CHAIN == "base":
            return "https://mainnet.base.org"
        elif self.CHAIN == "base-sepolia":
            return "https://sepolia.base.org"
        else:
            raise ValueError(f"Unsupported chain: {self.CHAIN}")
    
    # Block explorer URLs
    @property
    def BLOCK_EXPLORER_URL(self) -> str:
        """Get block explorer URL for current chain."""
        if self.CHAIN == "base":
            return "https://basescan.org"
        elif self.CHAIN == "base-sepolia":
            return "https://sepolia.basescan.org"
        else:
            raise ValueError(f"Unsupported chain: {self.CHAIN}")
    
    # =========================================================================
    # API Pricing
    # =========================================================================
    
    # Price for accessing /photos endpoint
    # 0.01 USDC = 10,000 (USDC has 6 decimals)
    PRICE_IN_USDC = int(os.getenv("PRICE_IN_USDC", "10000"))
    
    # =========================================================================
    # Validation
    # =========================================================================
    
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
        
        if not self.OXMETA_TREASURY_WALLET:  
            raise ValueError("Missing OXMETA_TREASURY_WALLET environment variable")
        
        if not self.FACILITATOR_BASE_URL:  
            raise ValueError("Missing FACILITATOR_BASE_URL environment variable")
        
        # Validate chain
        if self.CHAIN not in ["base", "base-sepolia"]:
            raise ValueError(
                f"Invalid CHAIN: {self.CHAIN}. Must be 'base' or 'base-sepolia'"
            )
    
    def get_network_info(self) -> dict:
        """Get complete network information."""
        return {
            "chain": self.CHAIN,
            "chain_id": self.CHAIN_ID,
            "usdc_address": self.USDC_TOKEN_ADDRESS,
            "rpc_url": self.RPC_URL,
            "block_explorer": self.BLOCK_EXPLORER_URL,
            "is_testnet": self.CHAIN == "base-sepolia",
        }
    
    def __str__(self):
        """String representation for debugging."""
        return (
            f"Settings(\n"
            f"  Facilitator URL: {self.FACILITATOR_BASE_URL}\n"
            f"  Merchant Wallet: {self.MERCHANT_PAYOUT_WALLET}\n"
            f"  Chain: {self.CHAIN}\n"
            f"  Chain ID: {self.CHAIN_ID}\n"
            f"  USDC Address: {self.USDC_TOKEN_ADDRESS}\n"
            f"  RPC URL: {self.RPC_URL}\n"
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
    print("\nNetwork Info:")
    print(settings.get_network_info())
except ValueError as e:
    print(f"❌ Configuration error: {e}")
    raise
