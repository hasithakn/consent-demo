/**
 * Copyright (c) 2024, WSO2 LLC. (https://www.wso2.com).
 * <p>
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 * <p>
 * http://www.apache.org/licenses/LICENSE-2.0
 * <p>
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

package com.wso2.consent.accelerator.grant.handler;

import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.wso2.carbon.identity.oauth2.IdentityOAuth2Exception;
import org.wso2.carbon.identity.oauth2.dto.OAuth2AccessTokenRespDTO;
import org.wso2.carbon.identity.oauth2.token.OAuthTokenReqMessageContext;
import org.wso2.carbon.identity.oauth2.token.handlers.grant.AuthorizationCodeGrantHandler;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * FS specific authorization code grant handler.
 * main usage of extending is to handle the refresh token issuance and setting the refresh token validity period.
 */
public class FSAuthorizationCodeGrantHandler extends AuthorizationCodeGrantHandler {

    private static final Log log = LogFactory.getLog(FSAuthorizationCodeGrantHandler.class);

    @Override
    public OAuth2AccessTokenRespDTO issue(OAuthTokenReqMessageContext tokReqMsgCtx) throws IdentityOAuth2Exception {

        try {
            OAuth2AccessTokenRespDTO oAuth2AccessTokenRespDTO = super.issue(tokReqMsgCtx);
            addConsentIdToTokenResponse(oAuth2AccessTokenRespDTO);
            return oAuth2AccessTokenRespDTO;

        } catch (Exception e) {
            log.error(e.getMessage().replaceAll("[\r\n]", ""), e);
            throw new IdentityOAuth2Exception(e.getMessage());
        }
    }

    /**
     * Add consent ID to the token response.
     *
     * @param oAuth2AccessTokenRespDTO OAuth2 access token response DTO
     */
    public static void addConsentIdToTokenResponse(OAuth2AccessTokenRespDTO oAuth2AccessTokenRespDTO) {

        String consentId = getConsentIdFromScopesArray(oAuth2AccessTokenRespDTO.getAuthorizedScopes()
                .split(" "));
        String consentIdClaimName = "consent_id";
        oAuth2AccessTokenRespDTO.addParameterObject(consentIdClaimName, consentId);
        List<String> collect = Arrays.stream(oAuth2AccessTokenRespDTO.getAuthorizedScopes().split(" "))
                .collect(Collectors.toList());
        collect.removeIf(e->e.startsWith("consent_id"));
        oAuth2AccessTokenRespDTO.setAuthorizedScopes(String.join(" ", collect));
        oAuth2AccessTokenRespDTO.addParameterObject("scope", String.join(" ", collect));

    }

    /**
     * Get consent id from the scopes.
     *
     * @param scopes Scopes
     * @return Consent ID
     */
    public static String getConsentIdFromScopesArray(String[] scopes) {

        String consentIdClaim = "consent_id_";

        for (String scope : scopes) {
            if (scope.startsWith(consentIdClaim)) {
                return scope.substring(consentIdClaim.length());
            }
        }

        return null;
    }

}
