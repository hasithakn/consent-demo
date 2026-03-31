/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 * <p>
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 * <p>
 *     http://www.apache.org/licenses/LICENSE-2.0
 * <p>
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

package org.wso2.financial.services.apim.mediation.policies.consent.enforcement.utils;

import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.apache.synapse.MessageContext;
import org.json.JSONException;
import org.json.JSONObject;
import org.wso2.financial.services.apim.mediation.policies.consent.enforcement.constants.ConsentEnforcementConstants;

/**
 * Utility class for the Consent Enforcement Policy.
 */
public class ConsentEnforcementUtils {

    private static final Log log = LogFactory.getLog(ConsentEnforcementUtils.class);

    /**
     * Method to construct resource parameter map to invoke the validation service.
     *
     * @param messageContext request context object
     * @return A Map containing resource path(ex: /aisp/accounts/{AccountId}?queryParam=urlEncodedQueryParamValue),
     * http method and context(ex: /open-banking/v3.1/aisp)
     */
    public static Map<String, String> getResourceParamMap(MessageContext messageContext) {

        Map<String, String> resourceMap = new HashMap<>();
        resourceMap.put(ConsentEnforcementConstants.RESOURCE_TAG, (String)
                messageContext.getProperty(ConsentEnforcementConstants.REST_FULL_REQUEST_PATH));
        resourceMap.put(ConsentEnforcementConstants.HTTP_METHOD_TAG, (String)
                messageContext.getProperty(ConsentEnforcementConstants.REST_METHOD));
        resourceMap.put(ConsentEnforcementConstants.CONTEXT_TAG, (String)
                messageContext.getProperty(ConsentEnforcementConstants.REST_API_CONTEXT));
        return resourceMap;
    }

    /**
     * Method to extract the consent ID from the JWT token present in the request headers.
     *
     * @param headers Transport headers from the Axis2 message context
     * @param consentIdClaimName Name of the claim that contains the consent ID
     * @return Consent ID if present in the JWT token, null otherwise
     * @throws UnsupportedEncodingException When encoding is not UTF-8
     */
    public static String extractConsentIdFromJwtToken(Map<String, String> headers, String consentIdClaimName)
            throws UnsupportedEncodingException {

        // Try Authorization header first, then X-JWT-Assertion (APIM backend JWT)
        String jwtToken = null;
        String authHeader = headers.get(ConsentEnforcementConstants.AUTH_HEADER);
        if (authHeader != null && !authHeader.isEmpty() && !authHeader.contains(ConsentEnforcementConstants.BASIC_TAG)) {
            jwtToken = authHeader.replace(ConsentEnforcementConstants.BEARER_TAG, "");
        }
        if (jwtToken == null || !isValidJWTToken(jwtToken)) {
            String xJwtAssertion = headers.get("X-JWT-Assertion");
            if (xJwtAssertion != null && !xJwtAssertion.isEmpty()) {
                jwtToken = xJwtAssertion;
            }
        }
        if (jwtToken != null && isValidJWTToken(jwtToken)) {
            JSONObject jwtClaims = decodeBase64(jwtToken.split("\\.")[1]);
            if (!jwtClaims.isNull(consentIdClaimName) && !jwtClaims.getString(consentIdClaimName).isEmpty()) {
                return jwtClaims.getString(consentIdClaimName);
            }
        }
        return null;
    }

    /**
     * Method to create the validation request payload.
     *
     * @param jsonPayload JSON payload as a string to be included in the request body
     * @param requestHeaders Transport headers from the Axis2 message context
     * @param additionalParams Additional parameters to be included in the request payload
     * @return JSONObject representing the validation request payload
     */
    public static JSONObject createValidationRequestPayload(String jsonPayload,
                                                            Map<String, String> requestHeaders,
                                                            Map<String, Object> additionalParams) throws JSONException {

        JSONObject validationRequest = new JSONObject();
        JSONObject headers = new JSONObject();

        requestHeaders.forEach(headers::put);
        validationRequest.put(ConsentEnforcementConstants.HEADERS_TAG, headers);

        JSONObject requestPayload = new JSONObject(jsonPayload);
        validationRequest.put(ConsentEnforcementConstants.BODY_TAG, requestPayload);

        additionalParams.forEach(validationRequest::put);
        return validationRequest;
    }
    /**
     * Method to check whether the given string is a valid JWT token.
     *
     * @param jwtString JWT token string
     * @return true if the given string is a valid JWT token, false otherwise
     */
    private static boolean isValidJWTToken(String jwtString) {

        String[] jwtPart = jwtString.split("\\.");
        if (jwtPart.length != 3) {
            return false;
        }
        try {
            decodeBase64(jwtPart[0]);
            decodeBase64(jwtPart[1]);
        } catch (UnsupportedEncodingException | JSONException | IllegalArgumentException e) {
            log.error("Failed to decode the JWT token. %s", e);
            return false;
        }
        return true;
    }

    /**
     * Method to decode the base64 encoded JSON payload.
     *
     * @param payload base64 encoded payload
     * @return Decoded JSON Object
     * @throws UnsupportedEncodingException When encoding is not UTF-8
     */
    private static JSONObject decodeBase64(String payload) throws UnsupportedEncodingException {

        return new JSONObject(new String(java.util.Base64.getUrlDecoder().decode(payload),
                String.valueOf(StandardCharsets.UTF_8)));
    }
}
