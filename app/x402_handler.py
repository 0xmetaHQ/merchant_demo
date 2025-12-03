import base64
import json
import logging
from typing import Tuple, Optional
import httpx

from fastapi import HTTPException, Request
from pydantic import BaseModel
from app.facilitator_client import facilitator_client

logger = logging.getLogger(__name__)


class PaymentRequirements(BaseModel):
    scheme: str
    network: str
    maxAmountRequired: str
    resource: str
    description: str
    payTo: str
    maxTimeoutSeconds: int = 60
    asset: str
    extra: Optional[dict] = None


class X402PaymentVerifier:
    """
    FastAPI dependency for X402 payment verification.
    
    ✅ UPDATED: No longer checks merchant approval (not needed for atomic settlement)
    """

    def __init__(
        self,
        network: str,
        pay_to_address: str,
        payment_asset: str,
        asset_name: str,
        max_amount_required: str,
        resource: str,
        resource_description: str,
        eip712_version: str = "2",
        facilitator_base_url: str = "http://localhost:8000",
    ):
        self.payment_requirements = PaymentRequirements(
            scheme="exact",
            network=network,
            maxAmountRequired=max_amount_required,
            resource=resource,
            description=resource_description,
            payTo=pay_to_address,
            asset=payment_asset,
            extra={"name": asset_name, "version": eip712_version},
        )
        self.facilitator_base_url = facilitator_base_url
        self.logger = logger

    async def __call__(self, request: Request) -> Tuple[bool, PaymentRequirements]:
        """
        Check for payment headers and verify/settle if present.
        
        ✅ UPDATED: Removed approval checking logic (not needed for atomic settlement)
        
        Returns:
            (False, requirements) - No payment, show paywall
            (True, requirements) - Payment verified and settled
        """
        headers = {k.lower(): v for k, v in request.headers.items()}
        x_payment = headers.get("x-payment")
        x_payment_hash = headers.get("x-payment-hash") or headers.get("x-paymenthash")
        accept = headers.get("accept", "")

        self.logger.info(
            "X402 check: has_x_payment=%s, has_x_payment_hash=%s",
            bool(x_payment),
            bool(x_payment_hash)
        )

        # No payment headers -> show paywall or return 402
        if not x_payment and not x_payment_hash:
            if "text/html" in accept:
                return False, self.payment_requirements
            raise HTTPException(
                status_code=402,
                detail={
                    "x402Version": 1,
                    "error": "X-Payment header is required.",
                    "accepts": self.payment_requirements.dict(),
                },
            )

        # Decode payment payload
        payment_payload_obj = None
        tx_hash = None

        if x_payment:
            try:
                decoded = base64.b64decode(x_payment)
                payment_payload_obj = json.loads(decoded.decode("utf-8"))
                self.logger.info(
                    "Decoded payment payload: network=%s, scheme=%s",
                    payment_payload_obj.get("network"),
                    payment_payload_obj.get("scheme")
                )
            except Exception as e:
                self.logger.exception("Failed to decode X-Payment payload")
                raise HTTPException(
                    status_code=402,
                    detail={
                        "x402Version": 1,
                        "error": f"Invalid X-Payment payload: {str(e)}",
                        "accepts": self.payment_requirements.dict()
                    }
                )

            # Extract transaction hash from nonce (EIP-3009)
            try:
                tx_hash = payment_payload_obj["payload"]["authorization"]["nonce"]
            except Exception:
                tx_hash = None

        # Fallback to X-Payment-Hash header
        if not tx_hash and x_payment_hash:
            if ":" in x_payment_hash:
                _, tx_hash = x_payment_hash.split(":", 1)
            else:
                tx_hash = x_payment_hash

        if not tx_hash:
            raise HTTPException(
                status_code=402,
                detail={
                    "x402Version": 1,
                    "error": "Transaction hash not found in payment headers",
                    "accepts": self.payment_requirements.dict()
                }
            )

        # Normalize transaction hash
        tx_hash = tx_hash.strip()
        if not tx_hash.startswith("0x"):
            tx_hash = "0x" + tx_hash

        # Build verification request
        verify_payload = {
            "transaction_hash": tx_hash.lower(),
            "chain": self.payment_requirements.network,
            "seller_address": self.payment_requirements.payTo.lower(),
            "expected_amount": self.payment_requirements.maxAmountRequired,
            "expected_token": self.payment_requirements.asset.lower(),
            "metadata": {
                "source": "x402_merchant_demo",
                "resource": self.payment_requirements.resource
            },
        }

        # Add payment payload to metadata (CRITICAL for EIP-3009)
        if payment_payload_obj:
            verify_payload["metadata"]["paymentPayload"] = payment_payload_obj
            
            # Extract payer address
            try:
                payer = payment_payload_obj["payload"]["authorization"]["from"]
                verify_payload["metadata"]["payer"] = payer
            except Exception as e:
                self.logger.warning("Could not extract payer: %s", e)

        self.logger.info(
            "Calling facilitator verify: chain=%s",
            verify_payload["chain"]
        )

        # Call facilitator verify
        result = await facilitator_client.verify_payment(
            transaction_hash=verify_payload["transaction_hash"],
            chain=verify_payload["chain"],
            seller_address=verify_payload["seller_address"],
            expected_amount=verify_payload["expected_amount"],
            expected_token=verify_payload["expected_token"],
            metadata=verify_payload["metadata"],
        )

        if not result.get("success"):
            err = result.get("error", "verification failed")
            self.logger.error("Facilitator verify failed: %s", err)
            raise HTTPException(
                status_code=402,
                detail={
                    "x402Version": 1,
                    "error": f"Payment verification failed: {err}",
                    "accepts": self.payment_requirements.dict(),
                },
            )

        # Extract verification ID
        verification_data = result["data"]
        verification_id = (
            verification_data.get("verification_id") or
            verification_data.get("id") or
            verification_data.get("verificationId")
        )

        if not verification_id:
            self.logger.warning("No verification_id from facilitator")
            return True, self.payment_requirements

        # Attempt settlement
        self.logger.info("Attempting settlement: verification_id=%s", verification_id)

        settle_result = await facilitator_client.settle_payment(
            verification_id=verification_id,
            destination_address=self.payment_requirements.payTo.lower(),
            metadata={"source": "x402_merchant_demo"},
        )

        if not settle_result.get("success"):
            self.logger.error("Facilitator settle failed: %s", settle_result.get("error"))
            raise HTTPException(
                status_code=402,
                detail={
                    "x402Version": 1,
                    "error": f"Payment settlement failed: {settle_result.get('error')}",
                    "accepts": self.payment_requirements.dict(),
                },
            )

        self.logger.info("✅ Payment successfully verified and settled via atomic split")
        return True, self.payment_requirements