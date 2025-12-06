from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
import httpx
import uvicorn
from typing import Tuple
import os

from app.x402_handler import X402PaymentVerifier, PaymentRequirements
from app.config import settings

# ✅ Import merchant approval module
try:
    from app.merchant_approval import setup_approval, check_approval_status
except ImportError:
    print("⚠️  Warning: merchant_approval module not found")
    setup_approval = None
    check_approval_status = None

# ✅ Step 1: Create app
app = FastAPI(
    title="x402 Merchant Demo",
    version="1.0",
    description=f"Demo merchant app using 0xmeta on {settings.CHAIN}"
)

# ✅ Step 2: Mount static files IMMEDIATELY (before anything else)
app.mount("/static", StaticFiles(directory="app/templates/static"), name="static")

# ✅ Step 3: Setup templates
templates = Jinja2Templates(directory="app/templates")


# ============================================================================
# STARTUP EVENT - Auto-Confirm Approval Setup
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """
    Run on application startup to verify merchant has approved facilitator
    for USDC fee collection. AUTO-CONFIRMS approval setup if needed.
    """
    print("\n" + "="*80)
    print("🚀 Starting x402 Merchant Demo")
    print("="*80)
    print(f"Network: {settings.CHAIN}")
    print(f"Merchant Address: {settings.MERCHANT_PAYOUT_WALLET}")
    print(f"USDC Token: {settings.USDC_TOKEN_ADDRESS}")
    print(f"Price: {settings.PRICE_IN_USDC / 1000000} USDC")
    print(f"Treasury: {os.getenv('OXMETA_TREASURY_WALLET', 'Not set')}")
    print("="*80)
    
    # Check if approval functions are available
    if not check_approval_status or not setup_approval:
        print("\n⚠️  Skipping approval check (merchant_approval module not available)")
        print("="*80 + "\n")
        return
    
    # Check if private key is available
    if not os.getenv("MERCHANT_PRIVATE_KEY"):
        print("\n⚠️  MERCHANT_PRIVATE_KEY not set - skipping approval setup")
        print("   Set MERCHANT_PRIVATE_KEY in .env to enable auto-approval")
        print("="*80 + "\n")
        return
    
    print("\n🔍 Checking merchant USDC approval status...")
    
    try:
        # Check current approval status
        approval_status = await check_approval_status(
            network=settings.CHAIN,
            merchant_address=settings.MERCHANT_PAYOUT_WALLET
        )
        
        if approval_status["approved"]:
            print(f"✅ Merchant approval: OK")
            print(f"   Current allowance: {approval_status['allowance_usdc']:.2f} USDC")
            print(f"   Facilitator: {approval_status['facilitator_address']}")
            print(f"   Estimated transactions: ~{int(approval_status['allowance_usdc'] / 0.01):,}")
            
            # Warn if allowance is low
            if approval_status['allowance_usdc'] < 10:
                print(f"\n⚠️  WARNING: Low allowance ({approval_status['allowance_usdc']:.2f} USDC)")
                print(f"   Auto-increasing approval to 1000 USDC...")
                
                try:
                    result = await setup_approval(
                        network=settings.CHAIN,
                        amount_usdc=1000.0,
                        auto_confirm=True  # ✅ AUTO-CONFIRM
                    )
                    
                    if result["success"]:
                        print(f"✅ Approval increased successfully!")
                        print(f"   Transaction: {result['tx_hash']}")
                        print(f"   New allowance: {result['new_allowance_usdc']:.2f} USDC")
                    else:
                        print(f"❌ Failed to increase approval: {result['error']}")
                except Exception as e:
                    print(f"❌ Error increasing approval: {e}")
        else:
            print(f"❌ Merchant approval: NOT SET")
            print(f"   Current allowance: {approval_status['allowance_usdc']:.2f} USDC")
            print(f"   Facilitator: {approval_status['facilitator_address']}")
            print(f"\n🔐 Auto-setting up approval for 1000 USDC...")
            
            try:
                result = await setup_approval(
                    network=settings.CHAIN,
                    amount_usdc=1000.0,
                    auto_confirm=True  # ✅ AUTO-CONFIRM
                )
                
                if result["success"]:
                    print(f"✅ Approval successful!")
                    if result.get('tx_hash'):
                        print(f"   Transaction: {result['tx_hash']}")
                        print(f"   Explorer: {result.get('explorer_url', 'N/A')}")
                    print(f"   New allowance: {result['new_allowance_usdc']:.2f} USDC")
                    print(f"   Estimated transactions: ~{int(result['new_allowance_usdc'] / 0.01):,}")
                    print(f"\n🎉 Setup complete! 0xmeta can now collect settlement fees.")
                else:
                    print(f"❌ Approval failed: {result['error']}")
                    
                    # Check for specific error types
                    if result.get('insufficient_gas'):
                        print(f"\n💡 Your merchant wallet needs ETH for gas fees:")
                        print(f"   Current balance: {result.get('eth_balance', 0):.6f} ETH")
                        print(f"   Required: ~0.001 ETH")
                        print(f"\n   Get testnet ETH from:")
                        print(f"   🚰 https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet")
                        print(f"   🚰 https://basescan.org/faucet (requires mainnet ETH)")
                        print(f"\n   Then restart the app or visit https://merchant-demo-six.vercel.app/admin")
                    
                    print(f"\n⚠️  WARNING: Settlement fee collection will FAIL!")
                    print(f"\n📋 After getting ETH, run:")
                    print(f"   python -m app.merchant_approval --network {settings.CHAIN} --amount 1000 --auto-confirm")
            except Exception as e:
                print(f"❌ Error during approval setup: {e}")
                print(f"\n⚠️  WARNING: Settlement fee collection will FAIL!")
                print(f"\n📋 To manually fix, run:")
                print(f"   python -m app.merchant_approval --network {settings.CHAIN} --amount 1000 --auto-confirm")
        
        print("="*80 + "\n")
        
    except Exception as e:
        print(f"❌ Error checking approval status: {e}")
        print(f"\n💡 Troubleshooting tips:")
        print(f"   1. Check your internet connection")
        print(f"   2. Verify RPC endpoint is accessible: https://sepolia.base.org")
        print(f"   3. Try again in a few moments (RPC might be rate limiting)")
        print(f"   4. Manually check approval: python -m app.merchant_approval --network {settings.CHAIN} --check-only")
        print(f"\n   App will continue to run, but approval status is unknown.")
        print(f"   You can setup approval manually via: https://merchant-demo-six.vercel.app/admin")
        print("="*80 + "\n")


# ============================================================================
# API ENDPOINTS
# ============================================================================

@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    """Main landing page"""
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "network_info": settings.get_network_info()
        }
    )


@app.get("/admin", response_class=HTMLResponse)
async def admin_dashboard(request: Request):
    """Admin dashboard for checking approval status"""
    return templates.TemplateResponse(
        "admin.html",
        {
            "request": request,
            "network_info": settings.get_network_info()
        }
    )

@app.get("/api/config")
async def get_config():
    """
    API endpoint to get current network configuration.
    """

    treasury_wallet = os.getenv("OXMETA_TREASURY_WALLET")
    
    if not treasury_wallet:
        raise ValueError("OXMETA_TREASURY_WALLET not configured in .env")
    

    return {
        "network": settings.CHAIN,
        "chain_id": settings.CHAIN_ID,
        "usdc_address": settings.USDC_TOKEN_ADDRESS,
        "rpc_url": settings.RPC_URL,
        "block_explorer": settings.BLOCK_EXPLORER_URL,
        "price_usdc": settings.PRICE_IN_USDC / 1_000_000,  
        "price_usdc_wei": settings.PRICE_IN_USDC,
        "merchant_address": settings.MERCHANT_PAYOUT_WALLET,
        "treasury_wallet": treasury_wallet,  
        "facilitator_base_url": settings.FACILITATOR_BASE_URL,  
    }

@app.get("/api/approval-status")
async def get_approval_status():
    """Check current merchant approval status."""
    if not check_approval_status:
        raise HTTPException(
            status_code=503,
            detail="Approval check not available"
        )
    
    try:
        status = await check_approval_status(
            network=settings.CHAIN,
            merchant_address=settings.MERCHANT_PAYOUT_WALLET
        )
        return status
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to check approval status: {str(e)}"
        )


@app.post("/api/setup-approval")
async def setup_merchant_approval(amount_usdc: float = 1000.0):
    """
    Setup merchant USDC approval for facilitator.
    Requires MERCHANT_PRIVATE_KEY in environment.
    """
    if not setup_approval:
        raise HTTPException(
            status_code=503,
            detail="Approval setup not available"
        )
    
    try:
        result = await setup_approval(
            network=settings.CHAIN,
            amount_usdc=amount_usdc,
            auto_confirm=True  # Always auto-confirm for API calls
        )
        
        if result["success"]:
            return {
                "success": True,
                "message": "Approval successful",
                "tx_hash": result.get("tx_hash"),
                "new_allowance_usdc": result.get("new_allowance_usdc", 0),
                "explorer_url": result.get("explorer_url", f"{settings.BLOCK_EXPLORER_URL}/tx/{result.get('tx_hash', '')}")
            }
        else:
            raise HTTPException(
                status_code=400,
                detail=result.get("error", "Unknown error")
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to setup approval: {str(e)}"
        )


@app.get("/photos")
async def get_photos(
    request: Request,
    settled: Tuple[bool, PaymentRequirements] = Depends(
        X402PaymentVerifier(
            network=settings.CHAIN,
            pay_to_address=settings.MERCHANT_PAYOUT_WALLET,
            payment_asset=settings.USDC_TOKEN_ADDRESS,
            asset_name="USDC",
            max_amount_required=str(settings.PRICE_IN_USDC),
            resource="https://merchant-demo-six.vercel.app/photos",
            resource_description="Pay in crypto for premium access to photos"
        )
    )
):
    """Protected resource - requires payment."""
    
    if not settled[0]:
        accept_header = request.headers.get("accept", "")
        if "application/json" in accept_header:
            raise HTTPException(
                status_code=402,
                detail={
                    "x402Version": 1,
                    "error": "X-PAYMENT header is required.",
                    "accepts": settled[1].dict()
                }
            )
        else:
            return templates.TemplateResponse(
                "paywall.html",
                {
                    "request": request,
                    "payment_requirements": settled[1].dict(),
                    "amount": settings.PRICE_IN_USDC / 1000000,
                    "network_info": settings.get_network_info(),
                }
            )

    # Payment verified/settled -> fetch resource and return
    async with httpx.AsyncClient() as client:
        resp = await client.get("https://jsonplaceholder.typicode.com/photos")
        photos = resp.json()

    if "application/json" in request.headers.get("accept", ""):
        return photos
    else:
        return templates.TemplateResponse(
            "gallery.html",
            {
                "request": request,
                "photos": photos[:12],
                "network_info": settings.get_network_info(),
            }
        )


# ============================================================================
# MAIN ENTRYPOINT
# ============================================================================

if __name__ == "__main__":
    print("\n" + "="*80)
    print(f"Starting Merchant Demo on {settings.CHAIN}")
    print("="*80)
    print(settings)
    print("="*80 + "\n")
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
        log_level="info"
    )