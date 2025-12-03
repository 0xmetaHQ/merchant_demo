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


async def check_approval_status(network: str, merchant_address: str, treasury_address: str):
    """Check current approval status"""
    config = NETWORKS[network]
    w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
    
    if not w3.is_connected():
        print(f"❌ Failed to connect to {network} RPC")
        return None
    
    usdc = w3.eth.contract(
        address=Web3.to_checksum_address(config["usdc_address"]),
        abi=USDC_ABI
    )
    
    merchant_checksum = Web3.to_checksum_address(merchant_address)
    treasury_checksum = Web3.to_checksum_address(treasury_address)
    
    # Get allowance
    allowance_wei = usdc.functions.allowance(merchant_checksum, treasury_checksum).call()
    allowance_usdc = allowance_wei / 1e6
    
    # Get balance
    balance_wei = usdc.functions.balanceOf(merchant_checksum).call()
    balance_usdc = balance_wei / 1e6
    
    settlements_possible = int(allowance_wei / 10000) if allowance_wei > 0 else 0
    
    return {
        "allowance_wei": allowance_wei,
        "allowance_usdc": allowance_usdc,
        "balance_usdc": balance_usdc,
        "settlements_possible": settlements_possible,
        "is_approved": allowance_usdc >= 0.01
    }


async def setup_approval(network: str, amount_usdc: float = 100.0):
    """Setup USDC approval for 0xmeta treasury"""
    
    # Load environment variables
    merchant_private_key = os.getenv("MERCHANT_PRIVATE_KEY")
    merchant_address = os.getenv("MERCHANT_PAYOUT_WALLET")
    treasury_address = os.getenv("TREASURY_ADDRESS")
    
    if not merchant_private_key:
        print("❌ MERCHANT_PRIVATE_KEY not found in .env")
        print("   Add it to your .env file:")
        print("   MERCHANT_PRIVATE_KEY=0xyour_private_key_here")
        sys.exit(1)
    
    if not merchant_address:
        print("❌ MERCHANT_PAYOUT_WALLET not found in .env")
        sys.exit(1)
    
    if not treasury_address:
        print("❌ TREASURY_ADDRESS not found in .env")
        print("   This should be 0xmeta's treasury wallet address")
        sys.exit(1)
    
    print("=" * 70)
    print("0xmeta Merchant Approval Setup")
    print("=" * 70)
    print(f"\nNetwork: {network}")
    print(f"Merchant: {merchant_address}")
    print(f"Treasury (0xmeta): {treasury_address}")
    print(f"Approval Amount: {amount_usdc} USDC ({int(amount_usdc / 0.01):,} settlements)")
    print("=" * 70)
    
    # Check current status
    print("\n🔍 Checking current approval status...")
    status = await check_approval_status(network, merchant_address, treasury_address)
    
    if status:
        print(f"\n📊 Current Status:")
        print(f"   Allowance: {status['allowance_usdc']:.2f} USDC")
        print(f"   Balance: {status['balance_usdc']:.2f} USDC")
        print(f"   Settlements Possible: ~{status['settlements_possible']:,}")
        print(f"   Status: {'✅ APPROVED' if status['is_approved'] else '❌ NOT APPROVED'}")
        
        if status['is_approved'] and status['allowance_usdc'] >= amount_usdc:
            print(f"\n✅ Sufficient allowance already set!")
            return
    
    # Confirm with user
    print(f"\n⚠️  This will:")
    print(f"   1. Approve 0xmeta treasury to spend {amount_usdc} USDC from your wallet")
    print(f"   2. This allows 0xmeta to collect $0.01 fee per settlement")
    print(f"   3. You will pay gas fees for the approval transaction (~$0.10-$0.50)")
    
    confirm = input("\nProceed with approval? (yes/no): ").strip().lower()
    if confirm not in ['yes', 'y']:
        print("❌ Approval cancelled")
        return
    
    # Connect to network
    config = NETWORKS[network]
    w3 = Web3(Web3.HTTPProvider(config["rpc_url"]))
    
    if not w3.is_connected():
        print(f"❌ Failed to connect to {network}")
        sys.exit(1)
    
    print(f"✅ Connected to {network}")
    
    # Load merchant account
    account = Account.from_key(merchant_private_key)
    
    # Load USDC contract
    usdc = w3.eth.contract(
        address=Web3.to_checksum_address(config["usdc_address"]),
        abi=USDC_ABI
    )
    
    # Check ETH balance for gas
    eth_balance = w3.eth.get_balance(account.address)
    eth_balance_eth = w3.from_wei(eth_balance, 'ether')
    
    if eth_balance_eth < 0.001:
        print(f"❌ Insufficient ETH for gas. Balance: {eth_balance_eth:.6f} ETH")
        print(f"   You need at least 0.001 ETH on {network}")
        sys.exit(1)
    
    print(f"✅ ETH balance: {eth_balance_eth:.6f} ETH")
    
    # Build approval transaction
    approval_amount_wei = int(amount_usdc * 1e6)
    treasury_checksum = Web3.to_checksum_address(treasury_address)
    
    print(f"\n🔐 Building approval transaction...")
    
    nonce = w3.eth.get_transaction_count(account.address)
    gas_price = w3.eth.gas_price
    
    tx = usdc.functions.approve(
        treasury_checksum,
        approval_amount_wei
    ).build_transaction({
        'from': account.address,
        'gas': 100000,
        'gasPrice': gas_price,
        'nonce': nonce,
        'chainId': config['chain_id']
    })
    
    # Estimate gas
    try:
        estimated_gas = w3.eth.estimate_gas(tx)
        tx['gas'] = int(estimated_gas * 1.2)
        print(f"✅ Estimated gas: {estimated_gas}")
    except Exception as e:
        print(f"⚠️  Gas estimation failed: {e}, using default")
    
    # Sign and send
    print(f"🔐 Signing transaction...")
    signed_tx = account.sign_transaction(tx)
    
    print(f"📡 Sending transaction...")
    tx_hash = w3.eth.send_raw_transaction(signed_tx.rawTransaction)
    tx_hash_hex = tx_hash.hex()
    
    print(f"\n✅ Transaction sent!")
    print(f"   TX Hash: {tx_hash_hex}")
    print(f"   Explorer: {config['explorer']}/tx/{tx_hash_hex}")
    
    # Wait for confirmation
    print(f"\n⏳ Waiting for confirmation...")
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
    
    if receipt['status'] == 1:
        print(f"\n✅ Approval confirmed!")
        print(f"   Block: {receipt['blockNumber']}")
        print(f"   Gas Used: {receipt['gasUsed']}")
        
        # Verify new allowance
        new_status = await check_approval_status(network, merchant_address, treasury_address)
        if new_status:
            print(f"\n📊 New Status:")
            print(f"   Allowance: {new_status['allowance_usdc']:.2f} USDC")
            print(f"   Settlements Possible: ~{new_status['settlements_possible']:,}")
            print(f"\n🎉 Setup complete! You can now accept payments via 0xmeta")
    else:
        print(f"\n❌ Transaction failed")
        sys.exit(1)

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