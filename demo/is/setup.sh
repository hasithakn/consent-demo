#!/bin/sh
# IS one-time setup: create "National Bank KYC Portal" app with auth sequence,
# conditional script, JWKS config, and provision test user john123.
# JSON payload is pre-generated at Docker build time — no python3 at runtime.

IS_BASE="https://localhost:9446"

echo "[is-setup] Waiting for IS to be ready..."
until curl -sk -o /dev/null -w "%{http_code}" "${IS_BASE}/carbon/admin/login.jsp" | grep -q "200"; do
  sleep 5
done
echo "[is-setup] IS is ready."

# ── 1. Provision test user ───────────────────────────────────────────────────
echo "[is-setup] Provisioning test user john..."
if curl -sk -u admin:admin "${IS_BASE}/scim2/Users?filter=userName+eq+john" \
    -H "Accept: application/json" | grep -q '"totalResults":0'; then
  RESP=$(curl -sk -u admin:admin -X POST "${IS_BASE}/scim2/Users" \
    -H "Content-Type: application/json" \
    -d '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"john","password":"John@123","name":{"familyName":"Doe","givenName":"John"},"emails":[{"value":"john@example.com","primary":true}],"urn:scim:wso2:schema":{"forcePasswordReset":"false","accountLocked":"false","accountDisabled":"false"}}')
  echo "[is-setup] User create response: $RESP"
  # IS 7.1.0 puts admin-created SCIM users in a pending password state.
  # PATCH the password immediately to activate it.
  JOHN_CREATE_ID=$(echo "$RESP" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
  if [ -n "$JOHN_CREATE_ID" ]; then
    curl -sk -u admin:admin -X PATCH "${IS_BASE}/scim2/Users/${JOHN_CREATE_ID}" \
      -H "Content-Type: application/json" \
      -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],"Operations":[{"op":"replace","value":{"password":"John@123"}}]}' \
      -o /dev/null
    echo "[is-setup] Password activated for john."
  fi
else
  echo "[is-setup] Test user john123 already exists."
fi

# ── 2. Create / configure IS application ────────────────────────────────────
echo "[is-setup] Checking for existing 'National Bank KYC Portal' app..."
if curl -sk -u admin:admin "${IS_BASE}/api/server/v1/applications?limit=50" \
    | grep -q '"National Bank KYC Portal"'; then
  echo "[is-setup] Application already exists, skipping creation."
else
  echo "[is-setup] Creating application..."
  HTTP_CODE=$(curl -sk -u admin:admin -X POST \
    "${IS_BASE}/api/server/v1/applications" \
    -H "Content-Type: application/json" \
    -d @/setup/is-app-payload.json \
    -o /dev/null -w "%{http_code}")
  echo "[is-setup] App create HTTP status: $HTTP_CODE"
  if [ "$HTTP_CODE" != "201" ] && [ "$HTTP_CODE" != "200" ]; then
    echo "[is-setup] ERROR: Failed to create application (HTTP $HTTP_CODE)."
    exit 1
  fi
fi

# ── 2b. Set subject claim (Alternate Subject Identifier = username) ───────────
echo "[is-setup] Configuring subject claim to use username..."
HTTP_CODE=$(curl -sk -u admin:admin -X PATCH \
  "${IS_BASE}/api/server/v1/applications/${APP_ID}" \
  -H "Content-Type: application/json" \
  -d '{"claimConfiguration":{"dialect":"LOCAL","claimMappings":[{"applicationClaim":"http://wso2.org/claims/username","localClaim":{"uri":"http://wso2.org/claims/username"}}],"requestedClaims":[{"claim":{"uri":"http://wso2.org/claims/username"},"mandatory":true}],"subject":{"claim":{"uri":"http://wso2.org/claims/username"},"includeUserDomain":false,"includeTenantDomain":false,"useMappedLocalSubject":false}}}' \
  -o /dev/null -w "%{http_code}")
echo "[is-setup] Subject claim (alternate subject identifier): HTTP $HTTP_CODE"

# ── 3. Log OAuth client credentials ──────────────────────────────────────────
# Always resolve APP_ID by querying the list — IS returns 201 with empty body
APP_ID=$(curl -sk -u admin:admin "${IS_BASE}/api/server/v1/applications?limit=50" \
  | grep -o '"id":"[^"]*","name":"National Bank KYC Portal"' \
  | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"//')

if [ -n "$APP_ID" ]; then
  OIDC=$(curl -sk -u admin:admin \
    "${IS_BASE}/api/server/v1/applications/${APP_ID}/inbound-protocols/oidc")
  CLIENT_ID=$(echo "$OIDC" | grep -o '"clientId":"[^"]*"' | sed 's/"clientId":"//;s/"//')
  CLIENT_SECRET=$(echo "$OIDC" | grep -o '"clientSecret":"[^"]*"' | sed 's/"clientSecret":"//;s/"//')
  echo "[is-setup] ┌─ National Bank KYC Portal credentials ──────"
  echo "[is-setup] │  CLIENT_ID     = ${CLIENT_ID}"
  echo "[is-setup] │  CLIENT_SECRET = ${CLIENT_SECRET}"
  echo "[is-setup] └──────────────────────────────────────────────"
fi

# ── 4. Create 'user:data' API resource ───────────────────────────────────────
echo "[is-setup] Checking for API resource 'user:data'..."
# Use name filter to avoid matching 130+ built-in resources
API_RESOURCE_ID=$(curl -sk -u admin:admin \
  "${IS_BASE}/api/server/v1/api-resources?filter=name+eq+KYC+User+Data" \
  | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')

if [ -z "$API_RESOURCE_ID" ]; then
  echo "[is-setup] Creating API resource..."
  HTTP_CODE=$(curl -sk -u admin:admin -X POST \
    "${IS_BASE}/api/server/v1/api-resources" \
    -H "Content-Type: application/json" \
    -d '{"name":"KYC User Data","identifier":"user:data","requiresAuthorization":true,"scopes":[{"name":"user:data","displayName":"User Data","description":"Access to KYC user data"}]}' \
    -o /dev/null -w "%{http_code}")
  echo "[is-setup] API resource create: HTTP $HTTP_CODE"
  API_RESOURCE_ID=$(curl -sk -u admin:admin \
    "${IS_BASE}/api/server/v1/api-resources?filter=name+eq+KYC+User+Data" \
    | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
else
  echo "[is-setup] API resource already exists."
fi
echo "[is-setup] API resource ID: $API_RESOURCE_ID"

# ── 5. Set application role audience to ORGANIZATION ─────────────────────────
echo "[is-setup] Setting application role audience to ORGANIZATION..."
HTTP_CODE=$(curl -sk -u admin:admin -X PATCH \
  "${IS_BASE}/api/server/v1/applications/${APP_ID}" \
  -H "Content-Type: application/json" \
  -d '{"associatedRoles":{"allowedAudience":"ORGANIZATION"}}' \
  -o /dev/null -w "%{http_code}")
echo "[is-setup] Role audience update: HTTP $HTTP_CODE"

# ── 6. Authorize API resource in application ──────────────────────────────────
echo "[is-setup] Checking if API resource is authorized in application..."
if curl -sk -u admin:admin \
    "${IS_BASE}/api/server/v1/applications/${APP_ID}/authorized-apis" \
    | grep -q '"user:data"'; then
  echo "[is-setup] API resource already authorized in application."
else
  echo "[is-setup] Authorizing API resource in application..."
  HTTP_CODE=$(curl -sk -u admin:admin -X POST \
    "${IS_BASE}/api/server/v1/applications/${APP_ID}/authorized-apis" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"${API_RESOURCE_ID}\",\"policyIdentifier\":\"RBAC\",\"scopes\":[\"user:data\"]}" \
    -o /dev/null -w "%{http_code}")
  echo "[is-setup] API authorized in app: HTTP $HTTP_CODE"
fi

# ── 7. Resolve org ID (from john's membership in the 'everyone' org role) ──
ORG_ID=$(curl -sk -u admin:admin \
  "${IS_BASE}/scim2/Users?filter=userName+eq+john" \
  -H "Accept: application/json" \
  | grep -o '"audienceValue":"[^"]*"' | head -1 \
  | sed 's/"audienceValue":"//;s/"//')
echo "[is-setup] Org ID: $ORG_ID"

# ── 8. Create 'consumer' role (org-level) ────────────────────────────────────
echo "[is-setup] Checking for 'consumer' role..."
if curl -sk -u admin:admin \
    "${IS_BASE}/scim2/v2/Roles?filter=displayName+eq+consumer" \
    | grep -q '"consumer"'; then
  echo "[is-setup] 'consumer' role already exists."
else
  echo "[is-setup] Creating 'consumer' role..."
  HTTP_CODE=$(curl -sk -u admin:admin -X POST \
    "${IS_BASE}/scim2/v2/Roles" \
    -H "Content-Type: application/json" \
    -d "{\"schemas\":[\"urn:ietf:params:scim:schemas:extension:2.0:Role\"],\"displayName\":\"consumer\",\"audience\":{\"value\":\"${ORG_ID}\",\"type\":\"organization\"}}" \
    -o /dev/null -w "%{http_code}")
  echo "[is-setup] Role create: HTTP $HTTP_CODE"
fi

ROLE_ID=$(curl -sk -u admin:admin \
  "${IS_BASE}/scim2/v2/Roles?filter=displayName+eq+consumer" \
  | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
echo "[is-setup] Consumer role ID: $ROLE_ID"

# ── 9. Assign 'user:data' permission to 'consumer' role ──────────────────────
echo "[is-setup] Assigning user:data permission to consumer role..."
HTTP_CODE=$(curl -sk -u admin:admin -X PATCH \
  "${IS_BASE}/scim2/v2/Roles/${ROLE_ID}" \
  -H "Content-Type: application/json" \
  -d '{"schemas":["urn:ietf:params:scim:schemas:extension:2.0:Role"],"Operations":[{"op":"add","path":"permissions","value":[{"value":"user:data"}]}]}' \
  -o /dev/null -w "%{http_code}")
echo "[is-setup] Permission assign: HTTP $HTTP_CODE"

# ── 10. Assign 'consumer' role to admin and john123 ──────────────────────────
echo "[is-setup] Resolving user IDs..."
JOHN_ID=$(curl -sk -u admin:admin \
  "${IS_BASE}/scim2/Users?filter=userName+eq+john" \
  -H "Accept: application/json" \
  | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
ADMIN_ID=$(curl -sk -u admin:admin \
  "${IS_BASE}/scim2/Users?filter=userName+eq+admin" \
  -H "Accept: application/json" \
  | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
echo "[is-setup] john ID: $JOHN_ID  admin ID: $ADMIN_ID"

echo "[is-setup] Assigning consumer role to admin and john123..."
HTTP_CODE=$(curl -sk -u admin:admin -X PATCH \
  "${IS_BASE}/scim2/v2/Roles/${ROLE_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"schemas\":[\"urn:ietf:params:scim:schemas:extension:2.0:Role\"],\"Operations\":[{\"op\":\"add\",\"path\":\"users\",\"value\":[{\"value\":\"${JOHN_ID}\"},{\"value\":\"${ADMIN_ID}\"}]}]}" \
  -o /dev/null -w "%{http_code}")
echo "[is-setup] Role assign to users: HTTP $HTTP_CODE"

# ── 11. Apply Digital Locker branding ────────────────────────────────────────
echo "[is-setup] Applying Digital Locker branding..."
BRANDING_PAYLOAD=$(cat <<'BEOF'
{
  "type": "ORG",
  "name": "super",
  "locale": "en-US",
  "preference": {
    "configs": {
      "isBrandingEnabled": true,
      "removeDefaultBranding": false
    },
    "organizationDetails": {
      "displayName": "Digital Locker",
      "copyrightText": "© Digital Locker — Citizen Consent Portal",
      "siteTitle": "Digital Locker | Login",
      "supportEmail": "support@digitallocker.gov"
    },
    "images": {
      "logo": {
        "imgURL": "",
        "altText": "Digital Locker"
      },
      "favicon": {
        "imgURL": ""
      },
      "myAccountLogo": {
        "imgURL": "",
        "altText": "Digital Locker"
      }
    },
    "theme": {
      "activeTheme": "LIGHT",
      "LIGHT": {
        "colors": {
          "primary": {
            "main": "#1565c0",
            "contrastText": "#ffffff"
          },
          "secondary": {
            "main": "#0d47a1",
            "contrastText": "#ffffff"
          },
          "background": {
            "body": {
              "main": "#f5f5f5"
            },
            "surface": {
              "main": "#ffffff",
              "light": "#f5f5f5",
              "dark": "#e0e0e0",
              "inverted": "#1565c0"
            }
          },
          "text": {
            "primary": "#212121",
            "secondary": "#757575"
          },
          "alerts": {
            "error": { "main": "#c62828" },
            "info": { "main": "#1565c0" },
            "warning": { "main": "#ef6c00" },
            "neutral": { "main": "#757575" }
          },
          "illustrations": {
            "primary": { "main": "#1565c0" },
            "secondary": { "main": "#0d47a1" },
            "accent1": { "main": "#e3f2fd" },
            "accent2": { "main": "#bbdefb" },
            "accent3": { "main": "#64b5f6" }
          }
        },
        "buttons": {
          "primary": {
            "base": {
              "font": { "color": "#ffffff" },
              "background": { "backgroundColor": "#1565c0" },
              "border": { "borderRadius": "8px", "borderColor": "#1565c0" }
            }
          },
          "secondary": {
            "base": {
              "font": { "color": "#1565c0" },
              "background": { "backgroundColor": "#ffffff" },
              "border": { "borderRadius": "8px", "borderColor": "#1565c0", "borderWidth": "2px" }
            }
          },
          "externalConnection": {
            "base": {
              "background": { "backgroundColor": "#ffffff" },
              "font": { "color": "#212121" },
              "border": { "borderRadius": "8px" }
            }
          }
        },
        "header": {
          "background": { "backgroundColor": "#0d47a1" },
          "font": { "color": "#ffffff" },
          "border": { "borderBottomWidth": "0", "borderColor": "transparent" }
        },
        "footer": {
          "background": { "backgroundColor": "#0d47a1" },
          "font": { "color": "rgba(255,255,255,0.7)" },
          "border": { "borderTopWidth": "0", "borderColor": "transparent" }
        },
        "loginBox": {
          "background": { "backgroundColor": "#ffffff" },
          "font": { "color": "#212121" },
          "border": {
            "borderColor": "#e0e0e0",
            "borderRadius": "12px",
            "borderWidth": "1px"
          },
          "inputs": {
            "base": {
              "background": { "backgroundColor": "#ffffff" },
              "font": { "color": "#212121" },
              "border": { "borderRadius": "6px", "borderColor": "#e0e0e0" },
              "labels": { "font": { "color": "#212121" } }
            }
          }
        },
        "page": {
          "background": { "backgroundColor": "#f5f5f5", "backgroundImage": "" },
          "font": { "color": "#212121" }
        },
        "typography": {
          "font": {
            "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            "importURL": ""
          },
          "heading": {
            "font": { "color": "#1565c0" }
          }
        }
      }
    }
  }
}
BEOF
)

# Try POST first (create), fall back to PUT (update if already exists)
HTTP_CODE=$(curl -sk -u admin:admin -X POST \
  "${IS_BASE}/api/server/v1/branding-preference" \
  -H "Content-Type: application/json" \
  -d "$BRANDING_PAYLOAD" \
  -o /tmp/branding-resp.json -w "%{http_code}")

if [ "$HTTP_CODE" = "409" ]; then
  echo "[is-setup] Branding already exists, updating..."
  HTTP_CODE=$(curl -sk -u admin:admin -X PUT \
    "${IS_BASE}/api/server/v1/branding-preference" \
    -H "Content-Type: application/json" \
    -d "$BRANDING_PAYLOAD" \
    -o /tmp/branding-resp.json -w "%{http_code}")
fi
echo "[is-setup] Branding preference: HTTP $HTTP_CODE"
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "[is-setup] Branding response: $(cat /tmp/branding-resp.json 2>/dev/null)"
fi

echo "[is-setup] IS setup complete."