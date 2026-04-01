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

package com.wso2.consent.accelerator.claims;

import com.nimbusds.jwt.JWTClaimsSet;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.wso2.carbon.identity.oauth2.IdentityOAuth2Exception;
import org.wso2.carbon.identity.oauth2.token.OAuthTokenReqMessageContext;
import org.wso2.carbon.identity.openidconnect.DefaultOIDCClaimsCallbackHandler;

import java.util.*;

/**
 * This call back handler adds FS specific additional claims to the self-contained JWT access token.
 */
public class FSDefaultOIDCClaimsCallbackHandler extends DefaultOIDCClaimsCallbackHandler {

    private static Log log = LogFactory.getLog(FSDefaultOIDCClaimsCallbackHandler.class);

    @Override
    public JWTClaimsSet handleCustomClaims(JWTClaimsSet.Builder jwtClaimsSetBuilder, OAuthTokenReqMessageContext
            tokenReqMessageContext) throws IdentityOAuth2Exception {
        try {

            Map<String, Object> claimsInJwtToken = new HashMap<>();
            JWTClaimsSet jwtClaimsSet = super.handleCustomClaims(jwtClaimsSetBuilder, tokenReqMessageContext);
            if (jwtClaimsSet != null) {
                claimsInJwtToken.putAll(jwtClaimsSet.getClaims());
            }
            addConsentIDClaim(tokenReqMessageContext, claimsInJwtToken);
            removeConsentIdScope(jwtClaimsSetBuilder, claimsInJwtToken);
            return jwtClaimsSetBuilder.build();
        } catch (Exception e) {
            log.error("Error while handling custom claims", e);
            throw new IdentityOAuth2Exception(e.getMessage(), e);
        }

    }

    void removeConsentIdScope(JWTClaimsSet.Builder jwtClaimsSetBuilder,
                              Map<String, Object> claimsInJwtToken) {

        for (Map.Entry<String, Object> claimEntry : claimsInJwtToken.entrySet()) {
            if ("scope".equals(claimEntry.getKey())) {
                String[] nonInternalScopes = removeInternalScopes(claimEntry.getValue().toString()
                        .split(" "));
                jwtClaimsSetBuilder.claim("scope", StringUtils.join(nonInternalScopes, " "));
            } else {
                jwtClaimsSetBuilder.claim(claimEntry.getKey(), claimEntry.getValue());
            }
        }
    }

    /**
     * Remove the internal scopes from the scopes array.
     *
     * @param scopes Authorized scopes of the token
     * @return scopes array after removing the internal scopes
     */
    public static String[] removeInternalScopes(String[] scopes) {

        String consentIdClaim = "consent_id";

        if (scopes != null && scopes.length > 0) {
            List<String> scopesList = new LinkedList<>(Arrays.asList(scopes));
            scopesList.removeIf(s -> s.startsWith(consentIdClaim));
            scopesList.removeIf(s -> s.startsWith("consent_id_"));
            return scopesList.toArray(new String[scopesList.size()]);
        }
        return scopes;
    }


    /**
     * This method adds the consent ID claim to the JWT token.
     *
     * @param tokenReqMessageContext OAuthTokenReqMessageContext
     * @param claimsInJwtToken       Claims in the JWT token
     */
    void addConsentIDClaim(OAuthTokenReqMessageContext tokenReqMessageContext,
                           Map<String, Object> claimsInJwtToken) {

        String consentIdClaimName = "consent_id";
        String consentID = Arrays.stream(tokenReqMessageContext.getScope())
                .filter(scope -> scope.contains("consent_id_")).findFirst().orElse(null);
        if (StringUtils.isEmpty(consentID)) {
            consentID = Arrays.stream(tokenReqMessageContext.getScope())
                    .filter(scope -> scope.contains(consentIdClaimName))
                    .findFirst().orElse(StringUtils.EMPTY)
                    .replaceAll(consentIdClaimName, StringUtils.EMPTY);
        } else {
            consentID = consentID.replace("consent_id_", StringUtils.EMPTY);
        }

        if (StringUtils.isNotEmpty(consentID)) {
            claimsInJwtToken.put(consentIdClaimName, consentID);
        }
    }
}
