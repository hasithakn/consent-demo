#!/usr/bin/env python3
"""
===================================================================================
  CONSENT-BASED KYC API ACCESS DEMO
  ==================================
  This script demonstrates a complete consent management flow using:
  - WSO2 API Manager 4.5.0 (API Gateway with consent enforcement)
  - WSO2 Identity Server 7.1.0 (3rd-party Key Manager with CIBA support)
  - OpenFGC (Open Financial Grade Consent management server)
  - Mock KYC Backend (returns person data by National ID)

  Flow:
  1. Create application in APIM DevPortal
  2. Subscribe to KYC API
  3. Generate OAuth keys via IS (3rd-party KM) → auto-creates app in IS
  4. Configure IS app (CIBA, auth sequence, JWKS endpoint)
  5. Create consent in OpenFGC with mandatory + optional elements
  6. Initiate CIBA auth request → user opens web auth link
  7. User logs in → consent page shows mandatory (auto-checked) + optional items
  8. User approves → token issued with consent_id scope
  9. Invoke KYC API → only approved attributes returned
===================================================================================
"""

import jwt
import json
import time
import sys
import os
import requests
import urllib3
from pathlib import Path

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ===== Configuration =====
IS_BASE_URL = "https://localhost:9446"
APIM_BASE_URL = "https://localhost:9443"
APIM_GW_URL = "https://localhost:8243"
OPENFGC_URL = "http://localhost:3000"
IS_AUTH = ("admin", "admin")
APIM_AUTH = ("admin", "admin")
ORG_ID = "DEMO-ORG-001"
LOGIN_HINT = "john123"
REDIRECT_URI = "https://oidcdebugger.com/debug"
PRIVATE_KEY_PATH = os.path.join(os.path.dirname(__file__), "ciba-test-key.pem")
CONDITIONAL_SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "is-conditional-script.js")
IS_KM_NAME = "WSO2 Identity Server"
KYC_API_NAME = "KYCAPI"
SAMPLE_NIC = "NIN-1234567890"

# Will be populated during setup
CLIENT_ID = None
CLIENT_SECRET = None
IS_APP_ID = None
CONSENT_ID = None
PURPOSE_ID = None
TPP_CLIENT_ID = None

# ===== Styling =====
BLUE = "\033[94m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
CYAN = "\033[96m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def banner(text):
    print(f"\n{BOLD}{BLUE}{'='*80}{RESET}")
    print(f"{BOLD}{BLUE}  {text}{RESET}")
    print(f"{BOLD}{BLUE}{'='*80}{RESET}\n")


def step(num, text):
    print(f"\n{BOLD}{CYAN}[Step {num}]{RESET} {BOLD}{text}{RESET}")
    print(f"{DIM}{'─'*70}{RESET}")


def info(text):
    print(f"  {DIM}→{RESET} {text}")


def success(text):
    print(f"  {GREEN}✓{RESET} {text}")


def warn(text):
    print(f"  {YELLOW}⚠{RESET} {text}")


def error(text):
    print(f"  {RED}✗{RESET} {text}")


def explain(text):
    print(f"  {DIM}{text}{RESET}")


def pause(msg="Press Enter to continue..."):
    input(f"\n  {YELLOW}▶{RESET} {msg}")


def load_private_key():
    with open(PRIVATE_KEY_PATH, "r") as f:
        return f.read()


def load_conditional_script():
    with open(CONDITIONAL_SCRIPT_PATH, "r") as f:
        return f.read()


# ===================================================================
# PHASE 1: APIM Setup
# ===================================================================

def find_kyc_api():
    """Find the KYC API in APIM publisher."""
    r = requests.get(f"{APIM_BASE_URL}/api/am/publisher/v4/apis?limit=50",
                     auth=APIM_AUTH, verify=False)
    for api in r.json().get("list", []):
        if api["name"] == KYC_API_NAME:
            return api["id"]
    return None


def create_apim_app(app_name):
    """Create an application in APIM DevPortal."""
    step(1, "Create Application in APIM DevPortal")
    explain("This creates an OAuth2 application in APIM. When keys are generated")
    explain("through the IS Key Manager, it triggers DCR to auto-create the app in IS.")

    # Check if app already exists
    r = requests.get(f"{APIM_BASE_URL}/api/am/devportal/v3/applications?limit=50",
                     auth=APIM_AUTH, verify=False)
    for app in r.json().get("list", []):
        if app["name"] == app_name:
            app_id = app["applicationId"]
            # Check if keys are usable — if stale key mappings exist but no actual
            # keys, delete the app and recreate to avoid 409 on generate-keys.
            kr = requests.get(
                f"{APIM_BASE_URL}/api/am/devportal/v3/applications/{app_id}/oauth-keys",
                auth=APIM_AUTH, verify=False)
            keys_list = kr.json().get("list", []) if kr.status_code == 200 else []
            has_usable_keys = any(k.get("consumerKey") for k in keys_list)
            if has_usable_keys:
                info(f"Application '{app_name}' already exists with valid keys (ID: {app_id})")
                return app_id
            else:
                warn(f"Application '{app_name}' exists but has stale/no keys — recreating...")
                requests.delete(
                    f"{APIM_BASE_URL}/api/am/devportal/v3/applications/{app_id}",
                    auth=APIM_AUTH, verify=False)
                info("Deleted stale application")

    payload = {
        "name": app_name,
        "throttlingPolicy": "Unlimited",
        "description": "Consent-based KYC API Access Demo Application",
        "tokenType": "JWT"
    }
    r = requests.post(f"{APIM_BASE_URL}/api/am/devportal/v3/applications",
                      json=payload, auth=APIM_AUTH, verify=False)
    if r.status_code in (200, 201):
        app_id = r.json()["applicationId"]
        success(f"Application created: {app_name} (ID: {app_id})")
        return app_id
    else:
        error(f"Failed to create application: {r.status_code} {r.text}")
        return None


def subscribe_to_api(app_id, api_id):
    """Subscribe the APIM app to the KYC API."""
    step(2, "Subscribe Application to KYC API")
    explain("Subscribing links the application to the KYC API so tokens issued")
    explain("for this app can access the API through the gateway.")

    # Check existing subscriptions
    r = requests.get(f"{APIM_BASE_URL}/api/am/devportal/v3/subscriptions?applicationId={app_id}",
                     auth=APIM_AUTH, verify=False)
    for sub in r.json().get("list", []):
        if sub.get("apiId") == api_id:
            info(f"Already subscribed to {KYC_API_NAME}")
            return sub["subscriptionId"]

    payload = {
        "applicationId": app_id,
        "apiId": api_id,
        "throttlingPolicy": "Unlimited"
    }
    r = requests.post(f"{APIM_BASE_URL}/api/am/devportal/v3/subscriptions",
                      json=payload, auth=APIM_AUTH, verify=False)
    if r.status_code in (200, 201):
        sub_id = r.json()["subscriptionId"]
        success(f"Subscribed to {KYC_API_NAME} (Subscription: {sub_id})")
        return sub_id
    else:
        error(f"Failed to subscribe: {r.status_code} {r.text}")
        return None


def generate_keys_via_is(app_id):
    """Generate OAuth keys via IS Key Manager (triggers DCR in IS)."""
    global CLIENT_ID, CLIENT_SECRET
    step(3, "Generate OAuth Keys via IS Key Manager")
    explain("This triggers Dynamic Client Registration (DCR) in WSO2 Identity Server.")
    explain("IS creates the OAuth application and returns client_id/client_secret.")
    explain("The app is now managed by IS for authentication and token issuance.")

    # Check if keys already exist for IS KM
    r = requests.get(f"{APIM_BASE_URL}/api/am/devportal/v3/applications/{app_id}/oauth-keys",
                     auth=APIM_AUTH, verify=False)
    if r.status_code == 200:
        keys_list = r.json().get("list", [])
        for key in keys_list:
            if key.get("consumerKey"):
                CLIENT_ID = key["consumerKey"]
                CLIENT_SECRET = key["consumerSecret"]
                info(f"Keys already exist via {key.get('keyManager', 'unknown')} KM")
                success(f"Client ID: {CLIENT_ID}")
                success(f"Client Secret: {CLIENT_SECRET[:20]}...")
                return key["keyMappingId"]

    # Generate new keys
    payload = {
        "keyType": "PRODUCTION",
        "keyManager": IS_KM_NAME,
        "grantTypesToBeSupported": [
            "authorization_code",
            "implicit",
            "refresh_token",
            "urn:openid:params:grant-type:ciba"
        ],
        "callbackUrl": REDIRECT_URI,
        "scopes": ["openid", "gov"],
        "validityTime": 3600,
        "additionalProperties": {
            "application_access_token_expiry_time": "3600",
            "user_access_token_expiry_time": "3600",
            "refresh_token_expiry_time": "86400",
            "id_token_expiry_time": "3600",
            "pkceMandatory": "false",
            "pkceSupportPlain": "false",
            "bypassClientCredentials": "false"
        }
    }
    r = requests.post(
        f"{APIM_BASE_URL}/api/am/devportal/v3/applications/{app_id}/generate-keys",
        json=payload, auth=APIM_AUTH, verify=False)

    if r.status_code in (200, 201):
        keys = r.json()
        CLIENT_ID = keys["consumerKey"]
        CLIENT_SECRET = keys["consumerSecret"]
        success(f"Keys generated via IS Key Manager")
        success(f"Client ID:     {CLIENT_ID}")
        success(f"Client Secret: {CLIENT_SECRET[:20]}...")
        return keys.get("keyMappingId")
    else:
        error(f"Failed to generate keys: {r.status_code} {r.text}")
        return None


# ===================================================================
# PHASE 2: IS App Configuration
# ===================================================================

def find_is_app():
    """Find the IS application created by DCR via APIM."""
    global IS_APP_ID
    r = requests.get(f"{IS_BASE_URL}/api/server/v1/applications?limit=50",
                     auth=IS_AUTH, verify=False)
    if r.status_code == 200:
        for app in r.json().get("applications", []):
            # Check if this app's OIDC client_id matches our CLIENT_ID
            try:
                oidc_r = requests.get(
                    f"{IS_BASE_URL}/api/server/v1/applications/{app['id']}/inbound-protocols/oidc",
                    auth=IS_AUTH, verify=False)
                if oidc_r.status_code == 200:
                    oidc = oidc_r.json()
                    if oidc.get("clientId") == CLIENT_ID:
                        IS_APP_ID = app["id"]
                        return app["id"], app["name"]
            except Exception:
                continue
    return None, None


def configure_is_app():
    """Configure the IS app with CIBA, auth sequence, and JWKS endpoint."""
    step(4, "Configure IS Application (Auth Sequence + CIBA + JWKS)")
    explain("The app created by DCR needs customization for the consent flow:")
    explain("  • Authentication sequence with conditional script (CIBA vs normal flow)")
    explain("  • CIBA grant type enabled")
    explain("  • JWKS endpoint for JWT request object verification (PS256)")
    explain("  • Callback URLs including the consent webapp callback")

    app_id, app_name = find_is_app()
    if not app_id:
        error("Could not find IS app matching client_id")
        return False

    info(f"Found IS app: {app_name} (ID: {app_id})")

    # Load conditional auth script
    script = load_conditional_script()

    # Verify OIDC config from DCR (grant types + callback URL already set correctly)
    r = requests.get(
        f"{IS_BASE_URL}/api/server/v1/applications/{app_id}/inbound-protocols/oidc",
        auth=IS_AUTH, verify=False)
    if r.status_code == 200:
        oidc = r.json()
        grant_types = oidc.get("grantTypes", [])
        has_ciba = "urn:openid:params:grant-type:ciba" in grant_types
        callback = oidc.get("callbackURLs", [])
        success(f"OIDC config verified (CIBA grant: {has_ciba}, callback: {callback})")
        if not has_ciba:
            warn("CIBA grant type missing - ensure it was included during key generation")
    else:
        warn(f"Could not verify OIDC config: {r.status_code}")

    # Set authentication sequence with conditional script
    auth_payload = {
        "authenticationSequence": {
            "type": "USER_DEFINED",
            "steps": [
                {"id": 1, "options": [{"idp": "LOCAL", "authenticator": "BasicAuthenticator"}]},
                {"id": 2, "options": [{"idp": "LOCAL", "authenticator": "SampleLocalAuthenticator"}]}
            ],
            "script": script
        }
    }
    r = requests.patch(f"{IS_BASE_URL}/api/server/v1/applications/{app_id}",
                       json=auth_payload, auth=IS_AUTH, verify=False)
    if r.status_code == 200:
        success("Auth sequence set (conditional script for CIBA routing)")
    else:
        warn(f"Auth sequence update: {r.status_code} {r.text[:200]}")

    # Set JWKS URI for JWT request object verification
    jwks_payload = {
        "advancedConfigurations": {
            "certificate": {
                "type": "JWKS",
                "value": "http://host.docker.internal:8899/jwks.json"
            }
        }
    }
    r = requests.patch(f"{IS_BASE_URL}/api/server/v1/applications/{app_id}",
                       json=jwks_payload, auth=IS_AUTH, verify=False)
    if r.status_code == 200:
        success("JWKS endpoint set (http://host.docker.internal:8899/jwks.json)")
    else:
        warn(f"JWKS update: {r.status_code} {r.text[:200]}")

    explain("")
    explain(f"The IS app is now configured to:")
    explain(f"  1. Route CIBA web link requests through BasicAuthenticator (Step 1)")
    explain(f"  2. Route CIBA backchannel requests through SampleLocalAuthenticator (Step 2)")
    explain(f"  3. Verify PS256-signed JWT request objects using the JWKS endpoint")
    return True


# ===================================================================
# PHASE 3: Consent Setup in OpenFGC
# ===================================================================

def ensure_consent_purpose():
    """Create the KYC data access purpose with elements in OpenFGC."""
    global PURPOSE_ID, TPP_CLIENT_ID
    step(5, "Setup Consent Purpose in OpenFGC")
    explain("A consent purpose defines what data elements a TPP can request access to.")
    explain("Each element can be marked as mandatory (always required) or optional.")
    explain("")
    explain("Elements configured:")
    explain(f"  {GREEN}★{RESET} {BOLD}date_of_birth{RESET}  → mandatory (auto-checked, user cannot uncheck)")
    explain(f"  {GREEN}★{RESET} {BOLD}first_name{RESET}     → mandatory (auto-checked, user cannot uncheck)")
    explain(f"  {GREEN}★{RESET} {BOLD}last_name{RESET}      → mandatory (auto-checked, user cannot uncheck)")
    explain(f"  {DIM}○{RESET} nationality    → optional (user chooses)")
    explain(f"  {DIM}○{RESET} gender         → optional (user chooses)")
    explain(f"  {DIM}○{RESET} contact        → optional (user chooses)")

    # Use the same client_id that IS uses (CONSENT_CLIENT_ID env var) so that
    # when IS calls OpenFGC to read/update the consent, the TPP-client-id matches.
    import subprocess
    try:
        result = subprocess.run(["docker", "exec", "consent-is", "printenv", "CONSENT_CLIENT_ID"],
                                capture_output=True, text=True, timeout=5)
        TPP_CLIENT_ID = result.stdout.strip()
    except Exception:
        TPP_CLIENT_ID = CLIENT_ID  # fallback
    if not TPP_CLIENT_ID:
        TPP_CLIENT_ID = CLIENT_ID
    info(f"Using TPP Client ID (from IS env): {TPP_CLIENT_ID}")
    headers = {"org-id": ORG_ID, "TPP-client-id": TPP_CLIENT_ID}

    # Check if purpose already exists
    r = requests.get(f"{OPENFGC_URL}/api/v1/consent-purposes", headers=headers)
    if r.status_code == 200:
        for p in r.json().get("data", []):
            if p["name"] == "kyc_data_access" and p.get("clientId") == TPP_CLIENT_ID:
                PURPOSE_ID = p["id"]
                info(f"Purpose already exists: {PURPOSE_ID}")
                return PURPOSE_ID

    # Create consent elements first
    elements = [
        {"name": "nationality", "type": "resource-field", "description": "Access to the persons nationality",
         "properties": {"jsonPath": "$.person.nationality", "resourcePath": "/user/{nic}"}},
        {"name": "gender", "type": "resource-field", "description": "Access to the persons gender",
         "properties": {"jsonPath": "$.person.gender", "resourcePath": "/user/{nic}"}},
        {"name": "date_of_birth", "type": "resource-field", "description": "Access to the persons date of birth",
         "properties": {"jsonPath": "$.person.date_of_birth", "resourcePath": "/user/{nic}"}},
        {"name": "first_name", "type": "resource-field", "description": "Access to the persons first name",
         "properties": {"jsonPath": "$.person.first_name", "resourcePath": "/user/{nic}"}},
        {"name": "last_name", "type": "resource-field", "description": "Access to the persons last name",
         "properties": {"jsonPath": "$.person.last_name", "resourcePath": "/user/{nic}"}},
        {"name": "contact", "type": "resource-field", "description": "Access to the persons contact details",
         "properties": {"jsonPath": "$.person.contact", "resourcePath": "/user/{nic}"}},
    ]

    element_ids = []
    for elem in elements:
        r = requests.post(f"{OPENFGC_URL}/api/v1/consent-elements",
                          json=elem, headers=headers)
        if r.status_code in (200, 201):
            eid = r.json().get("id")
            element_ids.append(eid)
        elif r.status_code == 409:
            # Already exists, find it
            r2 = requests.get(f"{OPENFGC_URL}/api/v1/consent-elements",
                              headers=headers)
            for e in r2.json().get("data", []):
                if e["name"] == elem["name"]:
                    element_ids.append(e["id"])
                    break

    # Create purpose with mandatory/optional elements
    purpose_payload = {
        "name": "kyc_data_access",
        "description": "Purpose for KYC data access",
        "clientId": TPP_CLIENT_ID,
        "elements": [
            {"name": "nationality", "isMandatory": False},
            {"name": "gender", "isMandatory": False},
            {"name": "date_of_birth", "isMandatory": True},
            {"name": "first_name", "isMandatory": True},
            {"name": "last_name", "isMandatory": True},
            {"name": "contact", "isMandatory": False},
        ]
    }
    r = requests.post(f"{OPENFGC_URL}/api/v1/consent-purposes",
                      json=purpose_payload, headers=headers)
    if r.status_code in (200, 201):
        PURPOSE_ID = r.json().get("id")
        success(f"Purpose created: {PURPOSE_ID}")
    else:
        warn(f"Purpose creation: {r.status_code} {r.text[:200]}")

    return PURPOSE_ID


def create_consent():
    """Create a new consent record in OpenFGC."""
    global CONSENT_ID
    step(6, "Create Consent Record in OpenFGC")
    explain("The TPP (Third Party Provider) creates a consent record before initiating")
    explain("the authorization flow. This consent is in AWAITING_AUTHORIZATION status")
    explain("until the user approves it during the CIBA flow.")

    headers = {
        "org-id": ORG_ID,
        "TPP-client-id": TPP_CLIENT_ID,
        "Content-Type": "application/json"
    }

    consent_payload = {
        "type": "kyc",
        "clientId": TPP_CLIENT_ID,
        "recurringIndicator": False,
        "validityTime": 0,
        "frequency": 0,
        "dataAccessValidityDuration": 0,
        "purposes": [
            {
                "name": "kyc_data_access",
                "elements": [
                    {"name": "nationality", "isUserApproved": False},
                    {"name": "gender", "isUserApproved": False},
                    {"name": "date_of_birth", "isUserApproved": False},
                    {"name": "first_name", "isUserApproved": False},
                    {"name": "last_name", "isUserApproved": False},
                    {"name": "contact", "isUserApproved": False},
                ]
            }
        ],
        "authorizations": [],
        "attributes": {}
    }

    r = requests.post(f"{OPENFGC_URL}/api/v1/consents",
                      json=consent_payload, headers=headers)
    if r.status_code in (200, 201):
        consent = r.json()
        CONSENT_ID = consent.get("id") or consent.get("_id")
        success(f"Consent created: {CONSENT_ID}")
        info(f"Status: AWAITING_AUTHORIZATION")
        info(f"Elements: nationality, gender, date_of_birth, first_name, last_name, contact")
        info(f"All isUserApproved=false (pending user approval)")
        return CONSENT_ID
    else:
        error(f"Failed to create consent: {r.status_code} {r.text[:200]}")
        return None


# ===================================================================
# PHASE 4: CIBA Authorization Flow
# ===================================================================

def create_request_jwt():
    """Create PS256-signed JWT request object for CIBA."""
    private_key = load_private_key()
    now = int(time.time())
    payload = {
        "iss": CLIENT_ID,
        "iat": now,
        "exp": now + 1500,
        "aud": f"{IS_BASE_URL}/oauth2/token",
        "binding_message": "KYCAccess",
        "login_hint": LOGIN_HINT,
        "scope": "openid gov",
        "nbf": now - 2000,
        "jti": f"jti{now}",
        "claims": {
            "id_token": {
                "intent_id": {
                    "value": CONSENT_ID,
                    "essential": True
                }
            }
        },
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
    }
    headers = {"kid": "ciba-test-key-1", "alg": "PS256"}
    return jwt.encode(payload, private_key, algorithm="PS256", headers=headers)


def ciba_authorize():
    """Step 7: Initiate CIBA backchannel authorization."""
    step(7, "Initiate CIBA Backchannel Authorization")
    explain("CIBA (Client-Initiated Backchannel Authentication) allows a TPP to")
    explain("initiate authentication without the user being present at the TPP app.")
    explain("")
    explain("The TPP sends a signed JWT containing:")
    explain(f"  • login_hint: '{LOGIN_HINT}' (identifies the user)")
    explain(f"  • intent_id/consent_id: '{CONSENT_ID}' (links to the consent)")
    explain(f"  • scope: 'openid gov' (requested scopes)")
    explain(f"  • Signed with PS256 using the TPP's private key")

    request_jwt = create_request_jwt()
    info(f"Request JWT created (PS256 signed, kid=ciba-test-key-1)")

    data = {"request": request_jwt}
    r = requests.post(f"{IS_BASE_URL}/oauth2/ciba",
                      data=data,
                      auth=(CLIENT_ID, CLIENT_SECRET),
                      verify=False)

    if r.status_code == 200:
        result = r.json()
        auth_req_id = result.get("auth_req_id")
        expires_in = result.get("expires_in")
        success(f"CIBA authorize successful!")
        success(f"auth_req_id: {auth_req_id}")
        info(f"expires_in: {expires_in}s")
        return auth_req_id
    else:
        error(f"CIBA authorize failed: {r.status_code}")
        error(f"Response: {r.text}")
        return None


def show_web_auth_link(auth_req_id):
    """Step 8: Display web auth link for user."""
    step(8, "User Authentication & Consent")
    explain("IS is now waiting for the user to authenticate. A web auth link is sent")
    explain("to the user (e.g., via SMS, push notification, or email).")
    explain("")
    explain("When the user opens the link:")
    explain("  1. Login page appears → user enters credentials")
    explain("  2. Consent page shows the requested data elements:")
    explain(f"     {GREEN}☑{RESET} date_of_birth  {RED}*{RESET} (mandatory - auto-checked, cannot uncheck)")
    explain(f"     {GREEN}☑{RESET} first_name     {RED}*{RESET} (mandatory - auto-checked, cannot uncheck)")
    explain(f"     {GREEN}☑{RESET} last_name      {RED}*{RESET} (mandatory - auto-checked, cannot uncheck)")
    explain(f"     ☐ nationality    (optional - user chooses)")
    explain(f"     ☐ gender         (optional - user chooses)")
    explain(f"     ☐ contact        (optional - user chooses)")
    explain("")
    explain("  3. User clicks 'Confirm' to approve the selected elements")
    explain("  4. IS completes the CIBA flow and makes the token available")

    # Get web link from IS logs
    print(f"\n  {BOLD}{YELLOW}╔══════════════════════════════════════════════════════════════╗{RESET}")
    print(f"  {BOLD}{YELLOW}║  Open this link in your browser to login and give consent:  ║{RESET}")
    print(f"  {BOLD}{YELLOW}╚══════════════════════════════════════════════════════════════╝{RESET}")
    print(f"\n  Check the IS container logs for the web auth link:")
    print(f"  {DIM}docker logs consent-is 2>&1 | grep 'web_auth_link' | tail -1{RESET}")
    print()

    # Try to extract from logs
    import subprocess
    try:
        result = subprocess.run(
            ["docker", "logs", "consent-is", "--tail", "200"],
            capture_output=True, text=True, timeout=10
        )
        log_output = result.stderr + result.stdout
        web_link = None
        for line in reversed(log_output.split("\n")):
            if "web_auth_link" in line:
                # Extract URL from the log line
                import re
                urls = re.findall(r'https?://[^\s"]+web_auth_link[^\s"]*', line)
                if urls:
                    web_link = urls[0]
                    break
        if web_link:
            print(f"  {BOLD}{GREEN}Web Auth Link:{RESET}")
            print(f"  {web_link}")
        else:
            print(f"  {YELLOW}Could not auto-extract link from logs.{RESET}")
            print(f"  {YELLOW}Run: docker logs consent-is 2>&1 | grep -i 'web_auth' | tail -5{RESET}")
    except Exception:
        print(f"  {YELLOW}Check IS logs manually for the web auth link{RESET}")

    print(f"\n  {DIM}Login with: {LOGIN_HINT} / John@123{RESET}")
    pause("Press Enter after completing browser authentication (login + consent approval)...")


def poll_for_token(auth_req_id, max_attempts=30, interval=3):
    """Step 9: Poll for access token."""
    step(9, "Poll for Access Token (CIBA Grant)")
    explain("After user approves consent, IS makes the token available.")
    explain("The TPP polls the token endpoint using the auth_req_id.")

    for attempt in range(1, max_attempts + 1):
        data = {
            "client_id": CLIENT_ID,
            "grant_type": "urn:openid:params:grant-type:ciba",
            "auth_req_id": auth_req_id,
        }
        r = requests.post(f"{IS_BASE_URL}/oauth2/token",
                          data=data,
                          auth=(CLIENT_ID, CLIENT_SECRET),
                          verify=False)

        if r.status_code == 200:
            result = r.json()
            access_token = result.get("access_token")
            scope = result.get("scope", "")
            success(f"Access token received!")
            info(f"Token Type: {result.get('token_type')}")
            info(f"Expires In: {result.get('expires_in')}s")
            info(f"Scope: {scope}")
            info(f"Access Token: {access_token[:60]}...")

            # Decode JWT to show consent_id claim
            try:
                decoded = jwt.decode(access_token, options={"verify_signature": False})
                consent_scope = [s for s in scope.split() if s.startswith("consent_id")]
                if consent_scope:
                    explain(f"\n  The token scope includes: {consent_scope[0]}")
                    explain("  This links the token to the approved consent in OpenFGC.")
                if "consent_id" in decoded:
                    explain(f"  JWT claim consent_id: {decoded['consent_id']}")
            except Exception:
                pass

            return result
        elif r.status_code == 400:
            result = r.json()
            err = result.get("error")
            if err in ("authorization_pending", "slow_down"):
                info(f"Attempt {attempt}/{max_attempts}: {err} (waiting {interval}s...)")
                time.sleep(interval)
            else:
                error(f"Token error: {err} - {result.get('error_description')}")
                return None
        else:
            error(f"Token request failed: {r.status_code} {r.text}")
            return None

    error("Timeout waiting for token")
    return None


# ===================================================================
# PHASE 5: API Invocation with Consent Enforcement
# ===================================================================

def invoke_kyc_api(access_token):
    """Step 10: Invoke the KYC API through APIM gateway."""
    step(10, "Invoke KYC API Through APIM Gateway")
    explain("Now we call the KYC API with the access token containing the consent_id.")
    explain("")
    explain("What happens at the APIM gateway:")
    explain("  1. Consent Enforcement Policy (Request Flow):")
    explain("     • Extracts consent_id from the JWT access token")
    explain("     • Calls OpenFGC /validate to check consent status")
    explain("     • Verifies consent is ACTIVE and mandatory elements are approved")
    explain("     • Collects approved jsonPaths (e.g., $.person.first_name)")
    explain("     • Checks resource path matches the API endpoint")
    explain("")
    explain("  2. Mock Backend returns full person data (all fields)")
    explain("")
    explain("  3. Consent Response Filter Policy (Response Flow):")
    explain("     • Filters the backend response using approved jsonPaths")
    explain("     • Returns ONLY the fields the user consented to")
    explain(f"\n  Calling: GET {APIM_GW_URL}/kyc/1.0.0/user/{SAMPLE_NIC}")

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json"
    }
    r = requests.get(f"{APIM_GW_URL}/kyc/1.0.0/user/{SAMPLE_NIC}",
                     headers=headers, verify=False)

    print(f"\n  {BOLD}HTTP Status: {r.status_code}{RESET}")

    if r.status_code == 200:
        try:
            data = r.json()
            print(f"\n  {BOLD}{GREEN}Filtered API Response (only consented fields):{RESET}")
            print(f"  {json.dumps(data, indent=4)}")

            # Show what was filtered
            explain("\n  The response contains ONLY the data elements the user approved.")
            explain("  Any fields the user did NOT consent to are filtered out by the gateway.")

            # Compare with full data
            print(f"\n  {DIM}For comparison, the full backend response would include:{RESET}")
            r2 = requests.get(f"http://localhost:3002/user/{SAMPLE_NIC}")
            if r2.status_code == 200:
                full_data = r2.json()
                all_fields = []
                person = full_data.get("person", {})
                for k in person:
                    if k not in ("identifiers", "employment"):
                        all_fields.append(k)
                print(f"  {DIM}All fields: {', '.join(all_fields)}{RESET}")

                # Calculate what was filtered
                returned_person = data.get("person", {})
                returned_fields = list(returned_person.keys())
                filtered_fields = [f for f in all_fields if f not in returned_fields]
                if filtered_fields:
                    print(f"  {DIM}Filtered out: {', '.join(filtered_fields)}{RESET}")

        except Exception as e:
            print(f"  Response body: {r.text[:500]}")
    elif r.status_code == 401:
        error("Consent validation failed")
        print(f"  {r.text[:500]}")
    elif r.status_code == 403:
        error("Insufficient consent permissions")
        print(f"  {r.text[:500]}")
    else:
        error(f"API call failed")
        print(f"  {r.text[:500]}")

    return r


# ===================================================================
# MAIN DEMO FLOW
# ===================================================================

def main():
    banner("CONSENT-BASED KYC API ACCESS DEMO")

    print(f"  {DIM}Infrastructure:{RESET}")
    print(f"  • WSO2 API Manager 4.5.0    → {APIM_BASE_URL}")
    print(f"  • WSO2 Identity Server 7.1.0 → {IS_BASE_URL}")
    print(f"  • OpenFGC Consent Server     → {OPENFGC_URL}")
    print(f"  • Mock KYC Backend           → http://localhost:3002")
    print(f"  • APIM Gateway               → {APIM_GW_URL}")

    # Verify infrastructure
    info("Checking infrastructure...")
    checks = [
        ("APIM", f"{APIM_BASE_URL}/services/Version", True),
        ("IS", f"{IS_BASE_URL}/carbon/admin/login.jsp", True),
        ("OpenFGC", f"{OPENFGC_URL}/health", False),
        ("Mock Backend", "http://localhost:3002/health", False),
    ]
    for name, url, use_ssl in checks:
        try:
            r = requests.get(url, verify=False, timeout=5)
            if r.status_code < 500:
                success(f"{name} is running")
            else:
                warn(f"{name} returned {r.status_code}")
        except Exception as e:
            error(f"{name} is not reachable: {e}")
            if name in ("IS", "APIM"):
                print(f"\n  Please ensure all containers are running:")
                print(f"  docker compose up -d")
                return

    pause("Press Enter to begin the demo...")

    # ---- PHASE 1: APIM App Setup ----
    banner("PHASE 1: APPLICATION SETUP IN APIM")

    api_id = find_kyc_api()
    if not api_id:
        error(f"KYC API not found in APIM. Please publish the API first.")
        return
    info(f"Found KYC API: {api_id}")

    app_name = "ConsentDemoApp"
    app_id = create_apim_app(app_name)
    if not app_id:
        return

    sub_id = subscribe_to_api(app_id, api_id)
    if not sub_id:
        return

    km_id = generate_keys_via_is(app_id)
    if not km_id:
        return

    pause("Press Enter to continue to IS app configuration...")

    # ---- PHASE 2: IS Configuration ----
    banner("PHASE 2: IDENTITY SERVER CONFIGURATION")

    if not configure_is_app():
        return

    pause("Press Enter to continue to consent setup...")

    # ---- PHASE 3: Consent Setup ----
    banner("PHASE 3: CONSENT SETUP IN OpenFGC")

    ensure_consent_purpose()
    if not create_consent():
        return

    pause("Press Enter to initiate the CIBA authorization flow...")

    # ---- PHASE 4: CIBA Flow ----
    banner("PHASE 4: CIBA AUTHORIZATION FLOW")

    auth_req_id = ciba_authorize()
    if not auth_req_id:
        return

    show_web_auth_link(auth_req_id)

    token_result = poll_for_token(auth_req_id)
    if not token_result:
        return

    access_token = token_result["access_token"]
    pause("Press Enter to invoke the KYC API with the consent-bound token...")

    # ---- PHASE 5: API Invocation ----
    banner("PHASE 5: CONSENT-ENFORCED API INVOCATION")

    invoke_kyc_api(access_token)

    # ---- Summary ----
    banner("DEMO COMPLETE")
    print(f"  {GREEN}The complete consent flow has been demonstrated:{RESET}")
    print(f"  1. ✓ Application created in APIM DevPortal")
    print(f"  2. ✓ OAuth keys generated via IS (3rd-party Key Manager)")
    print(f"  3. ✓ IS app configured with CIBA + conditional auth + JWKS")
    print(f"  4. ✓ Consent purpose + record created in OpenFGC")
    print(f"  5. ✓ CIBA authorization initiated → user authenticated + consented")
    print(f"  6. ✓ Access token issued with consent_id scope")
    print(f"  7. ✓ KYC API invoked → only consented attributes returned")
    print()
    print(f"  {DIM}Key IDs:{RESET}")
    print(f"  • Client ID:  {CLIENT_ID}")
    print(f"  • Consent ID: {CONSENT_ID}")
    print(f"  • IS App ID:  {IS_APP_ID}")
    print()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "token" and len(sys.argv) > 2:
            # Quick token poll mode
            CLIENT_ID = input("Client ID: ") if not CLIENT_ID else CLIENT_ID
            CLIENT_SECRET = input("Client Secret: ") if not CLIENT_SECRET else CLIENT_SECRET
            poll_for_token(sys.argv[2])
        elif cmd == "invoke" and len(sys.argv) > 2:
            # Quick API invoke mode
            invoke_kyc_api(sys.argv[2])
        elif cmd == "help":
            print("Usage:")
            print("  python3 demo.py              # Run full demo")
            print("  python3 demo.py token <id>   # Poll for token with auth_req_id")
            print("  python3 demo.py invoke <tok> # Invoke KYC API with access token")
        else:
            print(f"Unknown command: {cmd}. Use 'help' for usage.")
    else:
        main()
