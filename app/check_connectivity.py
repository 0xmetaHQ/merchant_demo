#!/usr/bin/env python3
"""
Connectivity Health Check Script

Tests connections to:
- Base Sepolia RPC endpoints
- 0xmeta facilitator API
- USDC contract
"""

import asyncio
from web3 import Web3
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

# RPC endpoints to test
RPC_ENDPOINTS = {
    "base-sepolia": [
        "https://sepolia.base.org",
        "https://base-sepolia.blockpi.network/v1/rpc/public",
        "https://base-sepolia-rpc.publicnode.com"
    ]
}

USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
FACILITATOR_URL = os.getenv("FACILITATOR_BASE_URL", "http://localhost:8000")


def test_rpc_connection(rpc_url: str, timeout: int = 10) -> tuple[bool, str]:
    """Test connection to RPC endpoint"""
    try:
        w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={'timeout': timeout}))
        
        if not w3.is_connected():
            return False, "Connection failed"
        
        # Try to get chain ID
        chain_id = w3.eth.chain_id
        
        # Try to get latest block
        block = w3.eth.block_number
        
        return True, f"✅ OK (Chain ID: {chain_id}, Block: {block})"
    except Exception as e:
        return False, f"❌ Error: {str(e)[:50]}"


async def test_facilitator_api() -> tuple[bool, str]:
    """Test connection to facilitator API"""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Try to hit health endpoint or any GET endpoint
            resp = await client.get(f"{FACILITATOR_URL}/docs")
            
            if resp.status_code in [200, 404]:  # 404 is OK, means server is up
                return True, f"✅ OK (Status: {resp.status_code})"
            else:
                return False, f"❌ Unexpected status: {resp.status_code}"
    except Exception as e:
        return False, f"❌ Error: {str(e)[:50]}"


async def test_usdc_contract(rpc_url: str) -> tuple[bool, str]:
    """Test USDC contract accessibility"""
    try:
        w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={'timeout': 10}))
        
        if not w3.is_connected():
            return False, "RPC not connected"
        
        # Simple contract call
        code = w3.eth.get_code(USDC_ADDRESS)
        
        if code and len(code) > 0:
            return True, f"✅ OK (Contract exists, {len(code)} bytes)"
        else:
            return False, "❌ Contract not found"
    except Exception as e:
        return False, f"❌ Error: {str(e)[:50]}"


async def main():
    """Run all health checks"""
    print("="*70)
    print("🏥 0xmeta Connectivity Health Check")
    print("="*70)
    
    # Test RPC endpoints
    print("\n📡 Testing Base Sepolia RPC Endpoints:")
    print("-"*70)
    
    working_rpc = None
    for rpc_url in RPC_ENDPOINTS["base-sepolia"]:
        success, message = test_rpc_connection(rpc_url)
        print(f"{rpc_url}")
        print(f"  {message}")
        
        if success and not working_rpc:
            working_rpc = rpc_url
    
    if not working_rpc:
        print("\n⚠️  WARNING: No working RPC endpoints found!")
        print("   This will prevent approval checks and on-chain operations.")
        print("\n   Possible solutions:")
        print("   1. Check your internet connection")
        print("   2. Try again later (might be temporary)")
        print("   3. Use a custom RPC endpoint (Alchemy, Infura, etc.)")
    
    # Test facilitator API
    print(f"\n🔧 Testing Facilitator API:")
    print("-"*70)
    print(f"{FACILITATOR_URL}")
    success, message = await test_facilitator_api()
    print(f"  {message}")
    
    if not success:
        print("\n⚠️  WARNING: Facilitator API not reachable!")
        print("   Make sure the facilitator is running:")
        print("   cd facilitator && python -m app.main")
    
    # Test USDC contract (only if we have working RPC)
    if working_rpc:
        print(f"\n💰 Testing USDC Contract:")
        print("-"*70)
        print(f"{USDC_ADDRESS}")
        success, message = await test_usdc_contract(working_rpc)
        print(f"  {message}")
    
    # Final summary
    print("\n" + "="*70)
    print("📋 Summary:")
    print("="*70)
    
    if working_rpc:
        print("✅ RPC Connection: OK")
        print(f"   Using: {working_rpc}")
    else:
        print("❌ RPC Connection: FAILED")
        print("   No working RPC endpoints found")
    
    print("\n💡 Next Steps:")
    if working_rpc:
        print("   1. Start facilitator: cd facilitator && python -m app.main")
        print("   2. Start merchant demo: cd merchant_demo && python -m app.main")
        print("   3. Visit: http://localhost:8080")
    else:
        print("   1. Check internet connection")
        print("   2. Try custom RPC endpoint (set in .env):")
        print("      RPC_URL=https://your-alchemy-or-infura-url")
        print("   3. Try again in a few minutes")
    
    print("="*70 + "\n")


if __name__ == "__main__":
    asyncio.run(main())