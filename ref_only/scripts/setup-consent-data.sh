#!/bin/bash
# Setup consent data in OpenFGC for the consent demo
# This script creates:
#   1. Consent Elements (resource-field type with resource paths and JSON paths)
#   2. Consent Purposes (grouping elements)
#   3. A Consent (linking purposes, ready for authorization)

set -e

OPENFGC_BASE="http://localhost:3000/api/v1"
ORG_ID="DEMO-ORG-001"
TPP_CLIENT_ID="TPP-CLIENT-001"  # Will be replaced with actual IS client ID after IS setup

echo "============================================"
echo "Setting up consent data in OpenFGC"
echo "============================================"

# -------------------------------------------------------
# Step 1: Create Consent Elements
# These represent individual data fields from the KYC API
# with resource paths (API path) and JSON paths (data location)
# -------------------------------------------------------
echo ""
echo "Step 1: Creating consent elements..."

ELEMENTS_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${OPENFGC_BASE}/consent-elements" \
  -H "Content-Type: application/json" \
  -H "org-id: ${ORG_ID}" \
  -d '[
    {
      "name": "first_name",
      "description": "Access to the persons first name",
      "type": "resource-field",
      "properties": {
        "resourcePath": "/user/{nic}",
        "jsonPath": "$.person.first_name"
      }
    },
    {
      "name": "last_name",
      "description": "Access to the persons last name",
      "type": "resource-field",
      "properties": {
        "resourcePath": "/user/{nic}",
        "jsonPath": "$.person.last_name"
      }
    },
    {
      "name": "date_of_birth",
      "description": "Access to the persons date of birth",
      "type": "resource-field",
      "properties": {
        "resourcePath": "/user/{nic}",
        "jsonPath": "$.person.date_of_birth"
      }
    },
    {
      "name": "gender",
      "description": "Access to the persons gender",
      "type": "resource-field",
      "properties": {
        "resourcePath": "/user/{nic}",
        "jsonPath": "$.person.gender"
      }
    },
    {
      "name": "nationality",
      "description": "Access to the persons nationality",
      "type": "resource-field",
      "properties": {
        "resourcePath": "/user/{nic}",
        "jsonPath": "$.person.nationality"
      }
    },
    {
      "name": "identifiers",
      "description": "Access to the persons identification documents",
      "type": "resource-field",
      "properties": {
        "resourcePath": "/user/{nic}",
        "jsonPath": "$.person.identifiers"
      }
    },
    {
      "name": "contact",
      "description": "Access to the persons contact details",
      "type": "resource-field",
      "properties": {
        "resourcePath": "/user/{nic}",
        "jsonPath": "$.person.contact"
      }
    },
    {
      "name": "employment",
      "description": "Access to the persons employment details",
      "type": "resource-field",
      "properties": {
        "resourcePath": "/user/{nic}",
        "jsonPath": "$.person.employment"
      }
    }
  ]')

HTTP_CODE=$(echo "$ELEMENTS_RESPONSE" | tail -1)
BODY=$(echo "$ELEMENTS_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo "✅ Consent elements created successfully"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
  echo "❌ Failed to create elements (HTTP $HTTP_CODE)"
  echo "$BODY"
fi

# -------------------------------------------------------
# Step 2: Create Consent Purpose
# Groups KYC elements into a meaningful purpose
# -------------------------------------------------------
echo ""
echo "Step 2: Creating consent purpose..."

PURPOSE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${OPENFGC_BASE}/consent-purposes" \
  -H "Content-Type: application/json" \
  -H "org-id: ${ORG_ID}" \
  -H "TPP-client-id: ${TPP_CLIENT_ID}" \
  -d '{
    "name": "kyc_personal_data",
    "description": "Access to personal KYC data for identity verification",
    "elements": [
      { "name": "first_name", "isMandatory": true },
      { "name": "last_name", "isMandatory": true },
      { "name": "date_of_birth", "isMandatory": true },
      { "name": "gender", "isMandatory": false },
      { "name": "nationality", "isMandatory": false },
      { "name": "identifiers", "isMandatory": true },
      { "name": "contact", "isMandatory": false },
      { "name": "employment", "isMandatory": false }
    ]
  }')

HTTP_CODE=$(echo "$PURPOSE_RESPONSE" | tail -1)
BODY=$(echo "$PURPOSE_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo "✅ Consent purpose created successfully"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
  echo "❌ Failed to create purpose (HTTP $HTTP_CODE)"
  echo "$BODY"
fi

# -------------------------------------------------------
# Step 3: Create Consent
# Initiates a consent linking the purpose
# The user will later approve/reject during auth flow
# IGNORE value under elements as per instructions
# -------------------------------------------------------
echo ""
echo "Step 3: Creating consent..."

CONSENT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${OPENFGC_BASE}/consents" \
  -H "Content-Type: application/json" \
  -H "org-id: ${ORG_ID}" \
  -H "TPP-client-id: ${TPP_CLIENT_ID}" \
  -d '{
    "type": "kyc_verification",
    "validityTime": 0,
    "recurringIndicator": false,
    "dataAccessValidityDuration": 0,
    "frequency": 0,
    "purposes": [
      {
        "name": "kyc_personal_data",
        "elements": [
          { "name": "first_name", "isUserApproved": false },
          { "name": "last_name", "isUserApproved": false },
          { "name": "date_of_birth", "isUserApproved": false },
          { "name": "gender", "isUserApproved": false },
          { "name": "nationality", "isUserApproved": false },
          { "name": "identifiers", "isUserApproved": false },
          { "name": "contact", "isUserApproved": false },
          { "name": "employment", "isUserApproved": false }
        ]
      }
    ]
  }')

HTTP_CODE=$(echo "$CONSENT_RESPONSE" | tail -1)
BODY=$(echo "$CONSENT_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  CONSENT_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
  echo "✅ Consent created successfully"
  echo "   Consent ID: ${CONSENT_ID}"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
  
  # Save consent ID for later use
  echo "$CONSENT_ID" > /tmp/consent_demo_consent_id.txt
  echo ""
  echo "Consent ID saved to /tmp/consent_demo_consent_id.txt"
else
  echo "❌ Failed to create consent (HTTP $HTTP_CODE)"
  echo "$BODY"
fi

echo ""
echo "============================================"
echo "Consent data setup complete!"
echo "============================================"
