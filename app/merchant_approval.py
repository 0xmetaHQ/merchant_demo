"""
Merchant Approval Module for 0xmeta Facilitator

Handles USDC approval setup for fee collection.
"""

import os
import sys
from web3 import Web3
from eth_account import Account
from dotenv import load_dotenv
import asyncio
from typing import Dict, Optional
import requests
from web3 import HTTPProvider

# Load environment variables
load_dotenv()

# Network configurations
# Note: TREASURY_ADDRESS is used as the facilitator address for fee collection
TREASURY_ADDRESS = os.getenv("TREASURY_ADDRESS")

NETWORKS = {
    "base": {
        "rpc_urls": [
            "https://mainnet.base.org",
            "https://base.llamarpc.com",
            "https://base.blockpi.network/v1/rpc/public"
        ],
        "chain_id": 8453,
        "usdc_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "facilitator_address": TREASURY_ADDRESS,
        "explorer": "https://basescan.org"
    },
    "base-sepolia": {
        "rpc_urls": [
            "https://sepolia.base.org",
            "https://base-sepolia.blockpi.network/v1/rpc/public",
            "https://base-sepolia-rpc.publicnode.com"
        ],
        "chain_id": 84532,
        "usdc_address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "facilitator_address": TREASURY_ADDRESS,
        "explorer": "https://sepolia.basescan.org"
    }
}

# USDC ERC-20 ABI (minimal - only needed functions)
USDC_ABI = [
    {
        "constant": False,
        "inputs": [
            {"name": "_spender", "type": "address"},
            {"name": "_value", "type": "uint256"}
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [
            {"name": "_owner", "type": "address"},
            {"name": "_spender", "type": "address"}
        ],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function"
    },
    {
        "constant": True,
        "inputs": [
            {"name": "_owner", "type": "address"}
        ],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function"
    }
]


def _get_web3_connection(rpc_urls: list, timeout: int = 10) -> Web3:
    """
    Try to connect to Web3 using multiple RPC endpoints with retry logic.
    
    Args:
        rpc_urls: List of RPC URLs to try
        timeout: Connection timeout in seconds
    
    Returns:
        Connected Web3 instance
    
    Raises:
        ConnectionError: If all RPC endpoints fail
    """
    
    for rpc_url in rpc_urls:
        try:
            # Create session with timeout
            session = requests.Session()
            session.request = lambda *args, **kwargs: requests.Session.request(
                session, *args, **{**kwargs, 'timeout': timeout}
            )
            
            provider = HTTPProvider(rpc_url, session=session)
            w3 = Web3(provider)
            
            # Test connection
            if w3.is_connected():
                print(f"✅ Connected to RPC: {rpc_url}")
                return w3
            else:
                print(f"⚠️  Failed to connect to {rpc_url}")
        except Exception as e:
            print(f"⚠️  Error connecting to {rpc_url}: {e}")
            continue
    
    raise ConnectionError(f"Failed to connect to any RPC endpoint. Tried: {', '.join(rpc_urls)}")


async def check_approval_status(
    network: str,
    merchant_address: Optional[str] = None
) -> Dict:
    """
    Check current approval status for merchant.
    
    Args:
        network: "base" or "base-sepolia"
        merchant_address: Merchant wallet address (optional, reads from env if not provided)
    
    Returns:
        Dict with approval status information
    """
    # Validate network
    if network not in NETWORKS:
        raise ValueError(f"Invalid network: {network}. Must be one of: {list(NETWORKS.keys())}")
    
    config = NETWORKS[network]
    
    # Get merchant address
    if not merchant_address:
        merchant_address = os.getenv("MERCHANT_PAYOUT_WALLET")
    
    if not merchant_address:
        raise ValueError("Merchant address not provided and MERCHANT_PAYOUT_WALLET not set in environment")
    
    # Get facilitator address
    facilitator_address = config["facilitator_address"]
    if not facilitator_address:
        raise ValueError(f"Facilitator address not configured for {network}")
    
    # Initialize Web3 with retry logic
    w3 = _get_web3_connection(config["rpc_urls"])
    
    # Load USDC contract
    usdc_address = Web3.to_checksum_address(config["usdc_address"])
    usdc_contract = w3.eth.contract(address=usdc_address, abi=USDC_ABI)
    
    # Get decimals
    decimals = usdc_contract.functions.decimals().call()
    
    # Check current allowance
    allowance = usdc_contract.functions.allowance(
        Web3.to_checksum_address(merchant_address),
        Web3.to_checksum_address(facilitator_address)
    ).call()
    
    allowance_usdc = allowance / (10 ** decimals)
    
    # Check merchant balance
    balance = usdc_contract.functions.balanceOf(
        Web3.to_checksum_address(merchant_address)
    ).call()
    
    balance_usdc = balance / (10 ** decimals)
    
    return {
        "network": network,
        "merchant_address": merchant_address,
        "facilitator_address": facilitator_address,
        "usdc_address": usdc_address,
        "allowance_wei": allowance,
        "allowance_usdc": allowance_usdc,
        "balance_usdc": balance_usdc,
        "approved": allowance_usdc >= 0.01,  # At least 1 transaction worth
        "estimated_transactions": int(allowance_usdc / 0.01) if allowance_usdc > 0 else 0
    }


async def setup_approval(
    network: str,
    amount_usdc: float = 1000.0,
    auto_confirm: bool = False,
    merchant_private_key: Optional[str] = None
) -> Dict:
    """
    Setup USDC approval for the facilitator.
    
    Args:
        network: "base" or "base-sepolia"
        amount_usdc: Amount of USDC to approve (default: 1000)
        auto_confirm: Skip confirmation prompt (default: False)
        merchant_private_key: Private key (optional, reads from env if not provided)
    
    Returns:
        Dict with approval result
    """
    # Validate network
    if network not in NETWORKS:
        raise ValueError(f"Invalid network: {network}. Must be one of: {list(NETWORKS.keys())}")
    
    config = NETWORKS[network]
    
    # Get merchant private key
    if not merchant_private_key:
        merchant_private_key = os.getenv("MERCHANT_PRIVATE_KEY")
    
    if not merchant_private_key:
        raise ValueError("MERCHANT_PRIVATE_KEY not found in environment")
    
    # Get facilitator address
    facilitator_address = config["facilitator_address"]
    if not facilitator_address:
        raise ValueError(f"Facilitator address not configured for {network}")
    
    # Initialize Web3 with retry logic
    w3 = _get_web3_connection(config["rpc_urls"])
    
    # Load merchant account
    account = Account.from_key(merchant_private_key)
    merchant_address = account.address
    
    # Load USDC contract
    usdc_address = Web3.to_checksum_address(config["usdc_address"])
    usdc_contract = w3.eth.contract(address=usdc_address, abi=USDC_ABI)
    
    # Get decimals
    decimals = usdc_contract.functions.decimals().call()
    
    # Check current allowance
    current_allowance = usdc_contract.functions.allowance(
        merchant_address,
        Web3.to_checksum_address(facilitator_address)
    ).call()
    
    current_allowance_usdc = current_allowance / (10 ** decimals)
    
    # Check if already sufficient
    if current_allowance_usdc >= amount_usdc:
        return {
            "success": True,
            "message": f"Sufficient allowance already set ({current_allowance_usdc} USDC)",
            "already_approved": True,
            "current_allowance_usdc": current_allowance_usdc,
            "tx_hash": None
        }
    
    # Check merchant ETH balance for gas fees
    eth_balance = w3.eth.get_balance(merchant_address)
    eth_balance_eth = w3.from_wei(eth_balance, 'ether')
    
    if eth_balance_eth < 0.001:  # Need at least 0.001 ETH for gas
        return {
            "success": False,
            "error": f"Insufficient ETH for gas fees. Balance: {eth_balance_eth:.6f} ETH. Need at least 0.001 ETH.",
            "insufficient_gas": True,
            "eth_balance": float(eth_balance_eth)
        }
    
    # Calculate approval amount
    approval_amount = int(amount_usdc * (10 ** decimals))
    
    # Confirmation check
    if not auto_confirm:
        print(f"\n⚠️  Please confirm:")
        print(f"   Network: {network}")
        print(f"   Merchant: {merchant_address}")
        print(f"   Approve: {amount_usdc} USDC")
        print(f"   Spender: {facilitator_address}")
        print(f"   Current allowance: {current_allowance_usdc} USDC")
        
        if sys.stdin.isatty():
            confirm = input("\nProceed with approval? (yes/no): ").strip().lower()
            if confirm not in ['yes', 'y']:
                return {
                    "success": False,
                    "error": "Approval cancelled by user"
                }
    
    try:
        # Get gas price
        gas_price = w3.eth.gas_price
        
        # Build transaction
        nonce = w3.eth.get_transaction_count(merchant_address)
        
        tx = usdc_contract.functions.approve(
            Web3.to_checksum_address(facilitator_address),
            approval_amount
        ).build_transaction({
            'from': merchant_address,
            'gas': 100000,
            'gasPrice': gas_price,
            'nonce': nonce,
            'chainId': config['chain_id']
        })
        
        # Estimate gas
        try:
            estimated_gas = w3.eth.estimate_gas(tx)
            tx['gas'] = int(estimated_gas * 1.2)
        except Exception as e:
            print(f"⚠️  Gas estimation failed: {e}, using default")
        
        # Sign and send
        signed_tx = account.sign_transaction(tx)
        
        # Handle different web3.py versions
        raw_tx = signed_tx.rawTransaction if hasattr(signed_tx, 'rawTransaction') else signed_tx.raw_transaction
        tx_hash = w3.eth.send_raw_transaction(raw_tx)
        
        print(f"✅ Transaction sent: {tx_hash.hex()}")
        print(f"🔍 Explorer: {config['explorer']}/tx/{tx_hash.hex()}")
        
        # Wait for confirmation
        print("⏳ Waiting for confirmation...")
        receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
        
        if receipt['status'] == 1:
            # Verify new allowance
            new_allowance = usdc_contract.functions.allowance(
                merchant_address,
                Web3.to_checksum_address(facilitator_address)
            ).call()
            new_allowance_usdc = new_allowance / (10 ** decimals)
            
            return {
                "success": True,
                "message": "Approval successful",
                "tx_hash": tx_hash.hex(),
                "new_allowance_usdc": new_allowance_usdc,
                "estimated_transactions": int(new_allowance_usdc / 0.01),
                "explorer_url": f"{config['explorer']}/tx/{tx_hash.hex()}"
            }
        else:
            return {
                "success": False,
                "error": "Transaction failed",
                "tx_hash": tx_hash.hex()
            }
            
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


# ============================================================================
# CLI Interface
# ============================================================================

async def main():
    """Main CLI entrypoint"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Setup merchant USDC approval for 0xmeta facilitator"
    )
    parser.add_argument(
        "--network",
        required=True,
        choices=["base", "base-sepolia"],
        help="Network to use"
    )
    parser.add_argument(
        "--amount",
        type=float,
        default=1000.0,
        help="Amount of USDC to approve (default: 1000)"
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only check current approval status"
    )
    parser.add_argument(
        "--auto-confirm",
        action="store_true",
        help="Skip confirmation prompt"
    )
    
    args = parser.parse_args()
    
    print("=" * 70)
    print("0xmeta Merchant Approval Setup")
    print("=" * 70)
    
    # Check status
    print(f"\n🔍 Checking approval status on {args.network}...")
    
    try:
        status = await check_approval_status(args.network)
        
        print(f"\n📊 Current Status:")
        print(f"   Merchant: {status['merchant_address']}")
        print(f"   Facilitator: {status['facilitator_address']}")
        print(f"   USDC Address: {status['usdc_address']}")
        print(f"   Allowance: {status['allowance_usdc']:.2f} USDC")
        print(f"   Balance: {status['balance_usdc']:.2f} USDC")
        print(f"   Estimated Transactions: ~{status['estimated_transactions']:,}")
        print(f"   Status: {'✅ APPROVED' if status['approved'] else '❌ NOT APPROVED'}")
        
        if args.check_only:
            return
        
        if status['approved'] and status['allowance_usdc'] >= args.amount:
            print(f"\n✅ Sufficient allowance already set!")
            return
        
        # Setup approval
        print(f"\n🔐 Setting up approval for {args.amount} USDC...")
        
        result = await setup_approval(
            network=args.network,
            amount_usdc=args.amount,
            auto_confirm=args.auto_confirm
        )
        
        if result['success']:
            print(f"\n✅ Approval successful!")
            if result.get('tx_hash'):
                print(f"   Transaction: {result['tx_hash']}")
                print(f"   Explorer: {result['explorer_url']}")
            print(f"   New Allowance: {result['new_allowance_usdc']:.2f} USDC")
            print(f"   Estimated Transactions: ~{result['estimated_transactions']:,}")
            print(f"\n🎉 Setup complete! 0xmeta can now collect settlement fees.")
        else:
            print(f"\n❌ Approval failed: {result['error']}")
            sys.exit(1)
            
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
    
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())