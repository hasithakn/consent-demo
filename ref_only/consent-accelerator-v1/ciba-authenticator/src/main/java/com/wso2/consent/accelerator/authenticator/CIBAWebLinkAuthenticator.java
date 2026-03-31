/*
 * Copyright (c)  2021, WSO2 Inc. (http://www.wso2.org) All Rights Reserved.
 *
 * WSO2 Inc. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

package com.wso2.consent.accelerator.authenticator;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.wso2.carbon.identity.application.authentication.framework.AbstractApplicationAuthenticator;
import org.wso2.carbon.identity.application.authentication.framework.LocalApplicationAuthenticator;
import org.wso2.carbon.identity.application.authentication.framework.context.AuthenticationContext;
import org.wso2.carbon.identity.application.authentication.framework.exception.AuthenticationFailedException;
import org.wso2.carbon.identity.application.authentication.framework.inbound.InboundConstants;
import org.wso2.carbon.identity.application.authentication.framework.model.AuthenticatedUser;
import org.wso2.carbon.identity.core.util.IdentityUtil;

import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * CIBA Web Link Authenticator for sending auth web links to authentication device / devices
 */
public class CIBAWebLinkAuthenticator extends AbstractApplicationAuthenticator implements
        LocalApplicationAuthenticator {

    private static final Log log = LogFactory.getLog(CIBAWebLinkAuthenticator.class);

    @Override
    protected void initiateAuthenticationRequest(HttpServletRequest request, HttpServletResponse response,
                                                 AuthenticationContext context) throws AuthenticationFailedException {

        AuthenticatedUser authenticatedUser = getAuthenticatedUser(request);
        String webAuthLink = generateWebAuthLink(context, authenticatedUser);
        triggerNotificationEvent(authenticatedUser.getUserName(), webAuthLink);
    }

    /**
     * Method to trigger the notification event in IS.
     */
    protected void triggerNotificationEvent(String userName, String webLink) throws AuthenticationFailedException {

        log.info("CIBAWebLinkAuthenticator triggering notification event for user: " + userName);
        log.info(webLink);
    }

    /**
     * Method to identify the user/users involved in the authentication.
     *
     * @param request HttpServletRequest
     * @return list of users
     */
    protected AuthenticatedUser getAuthenticatedUser(HttpServletRequest request)
            throws AuthenticationFailedException {

        if (request.getParameter(CIBAWebLinkAuthenticatorConstants.LOGIN_HINT) == null ||
                request.getParameter(CIBAWebLinkAuthenticatorConstants.LOGIN_HINT).isEmpty()) {
            log.error("Login hint is not present in the authentication request");
            throw new AuthenticationFailedException("Login hint is not present in the authentication request");
        }
        return AuthenticatedUser.createLocalAuthenticatedUserFromSubjectIdentifier(
                request.getParameter(CIBAWebLinkAuthenticatorConstants.LOGIN_HINT).trim());
    }


    /**
     * Method to generate web auth links for given user.
     *
     * @param context authentication context.
     * @param user    authenticated user.
     * @return Auth web link for authenticated user.
     */
    protected String generateWebAuthLink(AuthenticationContext context, AuthenticatedUser user)
            throws AuthenticationFailedException {

        List<String> allowedParams =
                List.of("client_id", "scope", "response_type", "nonce", "binding_message");
        List<String> paramList = Arrays.stream(context.getQueryParams().split("&")).filter(e -> {
            for (String allowedParam : allowedParams) {
                if (e.startsWith(allowedParam + "=")) {
                    return true;
                }
            }
            return false;
        }).collect(Collectors.toList());

        // Extract intent_id from the JWT request object and pass as a plain query param.
        // We cannot pass the full JWT as request= because IS validates it as an OAuth2 Request Object
        // and it will fail (redirect_uri mismatch, etc). Instead, decode the JWT payload and extract
        // claims.id_token.intent_id.value, then pass as intent_id= for FSConsentServlet to read.
        String intentId = extractIntentIdFromRequestObject(context.getQueryParams());
        if (intentId != null) {
            paramList.add("intent_id=" + intentId);
        }

        // Extract redirect_uri separately and fix regexp patterns.
        String redirectUri = null;
        for (String param : context.getQueryParams().split("&")) {
            if (param.startsWith("redirect_uri=")) {
                redirectUri = param.substring("redirect_uri=".length());
                break;
            }
        }
        if (redirectUri != null) {
            try {
                redirectUri = java.net.URLDecoder.decode(redirectUri, "UTF-8");
            } catch (java.io.UnsupportedEncodingException e) {
                // UTF-8 is always supported
            }
            if (redirectUri.startsWith("regexp=")) {
                // Extract the first URL from the regexp pattern
                String pattern = redirectUri.substring("regexp=(".length());
                int pipeIdx = pattern.indexOf('|');
                if (pipeIdx > 0) {
                    redirectUri = pattern.substring(0, pipeIdx);
                } else {
                    redirectUri = pattern.replace(")", "");
                }
            }
            try {
                paramList.add("redirect_uri=" + java.net.URLEncoder.encode(redirectUri, "UTF-8"));
            } catch (java.io.UnsupportedEncodingException e) {
                paramList.add("redirect_uri=" + redirectUri);
            }
        }

        paramList.add(CIBAWebLinkAuthenticatorConstants.CIBA_WEB_AUTH_LINK_PARAM + "=true");
        paramList.add("login_hint=" + user.getUserName());
        paramList.add("prompt=consent");

        StringBuilder builder = new StringBuilder();
        builder.append(IdentityUtil.getServerURL(
                CIBAWebLinkAuthenticatorConstants.AUTHORIZE_URL_PATH, false, true));
        for (String param : paramList) {
            builder.append(param).append("&");
        }
        if (log.isDebugEnabled()) {
            log.debug(builder.toString());
        }
        return builder.toString();
    }

    /**
     * Extracts intent_id from the JWT request object in the query params.
     * Looks for request_object= or request= param, decodes the JWT payload,
     * and extracts claims.id_token.intent_id.value via string parsing (no JSON lib needed).
     */
    private String extractIntentIdFromRequestObject(String queryParams) {
        if (queryParams == null) return null;
        String jwt = null;
        for (String param : queryParams.split("&")) {
            if (param.startsWith("request_object=") || param.startsWith("request=")) {
                int eqIdx = param.indexOf('=');
                jwt = param.substring(eqIdx + 1);
                try {
                    jwt = java.net.URLDecoder.decode(jwt, "UTF-8");
                } catch (java.io.UnsupportedEncodingException e) { /* UTF-8 always supported */ }
                break;
            }
        }
        if (jwt == null) return null;
        String[] parts = jwt.split("\\.");
        if (parts.length < 2) return null;
        try {
            byte[] decoded = java.util.Base64.getUrlDecoder().decode(parts[1]);
            String payload = new String(decoded, java.nio.charset.StandardCharsets.UTF_8);
            // Extract intent_id value using string parsing: find "intent_id" then "value":"<id>"
            int intentIdx = payload.indexOf("\"intent_id\"");
            if (intentIdx < 0) return null;
            int valueIdx = payload.indexOf("\"value\"", intentIdx);
            if (valueIdx < 0) return null;
            int colonIdx = payload.indexOf(":", valueIdx + 7);
            if (colonIdx < 0) return null;
            int quoteStart = payload.indexOf("\"", colonIdx + 1);
            if (quoteStart < 0) return null;
            int quoteEnd = payload.indexOf("\"", quoteStart + 1);
            if (quoteEnd < 0) return null;
            String intentId = payload.substring(quoteStart + 1, quoteEnd);
            log.info("Extracted intent_id from JWT: " + intentId);
            return intentId;
        } catch (Exception e) {
            log.warn("Could not extract intent_id from JWT request object: " + e.getMessage());
            return null;
        }
    }


    @Override
    protected void processAuthenticationResponse(HttpServletRequest request, HttpServletResponse response,
                                                 AuthenticationContext context) throws AuthenticationFailedException {
        // This authenticator is used only to send the web-auth links, And it does not expect to process the response.
    }

    @Override
    public boolean canHandle(HttpServletRequest request) {
        // CIBA web link Authenticator is used only to send the web-auth links, And it does not expect to handle it.
        return false;
    }

    @Override
    public String getContextIdentifier(HttpServletRequest request) {
        return request.getParameter(InboundConstants.RequestProcessor.CONTEXT_KEY);
    }

    @Override
    public String getName() {

        return "SampleLocalAuthenticator";
    }

    @Override
    public String getFriendlyName() {

        return "ciba-authenticator";
    }
}
