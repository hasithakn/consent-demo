"""
Runs at Docker build time (python:3-slim stage) to produce /setup/is-app-payload.json.
Embeds the conditional script so no python3 is needed inside the IS container at runtime.
"""
import json

with open('/src/is-conditional-script.js') as f:
    script = f.read()

payload = {
    "name": "National Bank KYC Portal",
    "description": "National Bank Branch Portal – KYC Consent Demo",
    "inboundProtocolConfiguration": {
        "oidc": {
            "grantTypes": [
                "authorization_code",
                "implicit",
                "refresh_token",
                "urn:openid:params:grant-type:ciba"
            ],
            "callbackURLs": ["http://localhost:3011/auth-callback.html"],
            "publicClient": False,
            "scopeValidators": [],
            "accessToken": {
                "type": "JWT",
                "userAccessTokenExpiryInSeconds": 3600,
                "applicationAccessTokenExpiryInSeconds": 3600
            }
        }
    },
    "authenticationSequence": {
        "type": "USER_DEFINED",
        "steps": [
            {"id": 1, "options": [{"idp": "LOCAL", "authenticator": "BasicAuthenticator"}]},
            {"id": 2, "options": [{"idp": "LOCAL", "authenticator": "SampleLocalAuthenticator"}]}
        ],
        "script": script
    },
    "claimConfiguration": {
        "dialect": "LOCAL",
        "claimMappings": [
            {
                "applicationClaim": "http://wso2.org/claims/username",
                "localClaim": {"uri": "http://wso2.org/claims/username"}
            }
        ],
        "requestedClaims": [
            {
                "claim": {"uri": "http://wso2.org/claims/username"},
                "mandatory": True
            }
        ],
        "subject": {
            "claim": {"uri": "http://wso2.org/claims/username"},
            "includeUserDomain": False,
            "includeTenantDomain": False,
            "useMappedLocalSubject": False
        }
    },
    "advancedConfigurations": {
        "certificate": {
            # JWKS endpoint used by IS to verify signed JWT request objects (CIBA) from the bank portal.
            "type": "JWKS",
            "value": "https://keystore.openbankingtest.org.uk/0015800001HQQrZAAX/0015800001HQQrZAAX.jwks"
        }
    }
}

print(json.dumps(payload))
