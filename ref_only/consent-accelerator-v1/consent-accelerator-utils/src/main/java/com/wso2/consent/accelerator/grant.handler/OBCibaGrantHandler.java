/*
 * Copyright (c) 2021, WSO2 Inc. (http://www.wso2.com). All Rights Reserved.
 *
 * This software is the property of WSO2 Inc. and its suppliers, if any.
 * Dissemination of any information or reproduction of any material contained
 * herein is strictly forbidden, unless permitted by WSO2 in accordance with
 * the WSO2 Commercial License available at http://wso2.com/licenses. For specific
 * language governing the permissions and limitations under this license,
 * please see the license as well as any agreement you’ve entered into with
 * WSO2 governing the purchase of this software and any associated services.
 */

package com.wso2.consent.accelerator.grant.handler;

import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.apache.http.HttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.json.JSONArray;
import org.json.JSONObject;
import org.wso2.carbon.identity.oauth.ciba.grant.CibaGrantHandler;
import org.wso2.carbon.identity.oauth2.IdentityOAuth2Exception;
import org.wso2.carbon.identity.oauth2.authz.OAuthAuthzReqMessageContext;
import org.wso2.carbon.identity.oauth2.token.OAuthTokenReqMessageContext;

import javax.servlet.http.Cookie;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;

/**
 * OB specific CIBA grant handler
 */
public class OBCibaGrantHandler extends CibaGrantHandler {

    private static Log log = LogFactory.getLog(CibaGrantHandler.class);
    private static final String COMMON_AUTH_ID = "commonAuthId";


    public void setConsentIdScope(OAuthTokenReqMessageContext tokReqMsgCtx, String authReqId)
            throws IdentityOAuth2Exception {
        String[] scopesArray;
        String[] tokenRequestMessageContextArray = tokReqMsgCtx.getScope();
        if (tokenRequestMessageContextArray != null) {
            scopesArray = Arrays.copyOf(tokenRequestMessageContextArray, tokenRequestMessageContextArray.length + 1);
        } else {
            throw new IdentityOAuth2Exception("OAuth Token Request Message Context is empty");
        }
        scopesArray[scopesArray.length - 1] = "consent_id_" + extractConsentIdFromAuthReqId(authReqId);

        tokReqMsgCtx.setScope(scopesArray);

    }

    @Override
    public boolean validateGrant(OAuthTokenReqMessageContext tokReqMsgCtx) throws IdentityOAuth2Exception {
        if (!super.validateGrant(tokReqMsgCtx)) {
            log.error("Successful in validating grant.Validation failed for the token request made by client: "
                    + tokReqMsgCtx.getOauth2AccessTokenReqDTO()
                    .getClientId().replaceAll("[\r\n]", ""));
            return false;
        } else {
            setConsentIdScope(tokReqMsgCtx, getAuthReqId(tokReqMsgCtx));
            return true;
        }
    }

    /**
     * Extract consent ID from commonAuthId by querying the consent API.
     *
     * @param authReqId OAuth authorization context
     * @return consent ID if found, empty string otherwise
     */
    private static String extractConsentIdFromAuthReqId(String authReqId) {

        if (StringUtils.isEmpty(authReqId)) {
            log.warn("commonAuthId is empty, cannot extract consent ID");
            return StringUtils.EMPTY;
        }

        try {
            // Build the API URL with query parameters (configurable via environment variables)
            String consentApiBaseURL = System.getenv().getOrDefault("OPENFGC_BASE_URL", "http://openfgc:3000")
                    + "/api/v1/consents/attributes";
            String queryParams = String.format("?key=auth_req_id&value=%s",
                    URLEncoder.encode(authReqId, "UTF-8"));
            String apiUrl = consentApiBaseURL + queryParams;

            // Create HTTP client
            CloseableHttpClient client = HttpClientBuilder.create().build();
            HttpGet getRequest = new HttpGet(apiUrl);

            // Add required headers
            getRequest.addHeader("org-id", System.getenv().getOrDefault("CONSENT_ORG_ID", "DEMO-ORG-001"));
            getRequest.addHeader("client-id", System.getenv().getOrDefault("CONSENT_CLIENT_ID", ""));
            getRequest.addHeader("Accept", "application/json");

            if (log.isDebugEnabled()) {
                log.debug("Fetching consent ID from API: " + apiUrl);
            }

            // Execute request
            HttpResponse response = client.execute(getRequest);
            int statusCode = response.getStatusLine().getStatusCode();

            if (statusCode == 200) {
                // Read response body
                String responseBody = IOUtils.toString(
                        response.getEntity().getContent(),
                        StandardCharsets.UTF_8);

                if (log.isDebugEnabled()) {
                    log.debug("API response: " + responseBody);
                }

                // Parse JSON response - expecting format: {"consentIds": ["CONSENT-xxx"], "count": 1}
                JSONObject responseJson = new JSONObject(responseBody);

                if (responseJson.has("consentIds")) {
                    JSONArray consentIds = responseJson.getJSONArray("consentIds");

                    if (consentIds.length() > 0) {
                        String consentId = consentIds.getString(0);

                        if (consentId != null && !consentId.isEmpty()) {
                            if (log.isDebugEnabled()) {
                                log.debug("Successfully extracted consent ID: " + consentId +
                                        " for authReqId: " + authReqId);
                            }
                            return consentId;
                        }
                    } else {
                        log.warn("No consent IDs found in response for authReqId: " + authReqId);
                    }
                } else {
                    log.warn("Response does not contain 'consentIds' field");
                }
            } else {
                log.error("Failed to fetch consent by authReqId. Status: " + statusCode +
                        ", Reason: " + response.getStatusLine().getReasonPhrase());
            }

            client.close();

        } catch (Exception e) {
            log.error("Error extracting consent ID from authReqId: " + authReqId, e);
        }

        return StringUtils.EMPTY;
    }
}
