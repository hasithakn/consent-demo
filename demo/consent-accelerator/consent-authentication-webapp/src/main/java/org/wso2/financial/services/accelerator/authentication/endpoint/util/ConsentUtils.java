package org.wso2.financial.services.accelerator.authentication.endpoint.util;

import java.io.IOException;
import java.net.HttpURLConnection;

import java.nio.charset.StandardCharsets;

import javax.servlet.ServletContext;

import org.apache.commons.io.IOUtils;
import org.apache.http.HttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPut;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ConsentUtils {

    private static Logger log = LoggerFactory.getLogger(ConsentUtils.class);
    // Configuration from environment variables (set via docker-compose.yml)
    private static final String OPENFGC_BASE_URL = System.getenv().getOrDefault("OPENFGC_BASE_URL", "http://openfgc:3000");
    private static final String CONSENT_API_BASE_URL = OPENFGC_BASE_URL + "/api/v1/consents/";
    private static final String CONSENT_PURPOSES_API_BASE_URL = OPENFGC_BASE_URL + "/api/v1/consent-purposes";
    private static final String ORG_ID = System.getenv().getOrDefault("CONSENT_ORG_ID", "DEMO-ORG-001");
    private static final String CLIENT_ID = System.getenv().getOrDefault("CONSENT_CLIENT_ID", "");

    /**
     * GET consent details from external API.
     *
     * @param consentId      the consent ID to fetch details for
     * @param servletContext servlet context
     * @return consent details JSON object
     * @throws IOException if an error occurs while fetching consent details
     */
    public static JSONObject getConsentDetails(String consentId, ServletContext servletContext) throws IOException {

        // Construct the consent API URL
        String consentApiUrl = CONSENT_API_BASE_URL + consentId;
        CloseableHttpClient client = HttpClientBuilder.create().build();
        HttpGet consentRequest = new HttpGet(consentApiUrl);
        consentRequest.addHeader("org-id", ORG_ID);
        consentRequest.addHeader("client-id", CLIENT_ID);
        consentRequest.addHeader("Accept", Constants.JSON);
        HttpResponse consentResponse = client.execute(consentRequest);
        // Parse and return the response
        if (consentResponse.getStatusLine().getStatusCode() == HttpURLConnection.HTTP_OK) {
            String responseBody = IOUtils.toString(consentResponse.getEntity().getContent(),
                    String.valueOf(StandardCharsets.UTF_8));
            JSONObject consent = new JSONObject(responseBody);
            return consent;
        } else {
            log.error("Failed to fetch consent details. Status code: " +
                    consentResponse.getStatusLine().getStatusCode());
            return null;
        }
    }



    /**
     * Update consent details via external API.
     *
     * @param consentId      the consent ID to update
     * @param updatedConsent the updated consent data
     * @param servletContext servlet context
     * @return true if update was successful, false otherwise
     */
    public static JSONObject updateConsent(String consentId, JSONObject updatedConsent,
                                              String clientId, ServletContext servletContext) {

        // Construct the consent API URL
        String consentApiUrl = CONSENT_API_BASE_URL + consentId;
        // Use provided clientId, fall back to env var
        String resolvedClientId = (clientId != null && !clientId.isEmpty()) ? clientId : CLIENT_ID;
        try (CloseableHttpClient client = HttpClientBuilder.create().build()) {
            HttpPut updateRequest = new HttpPut(consentApiUrl);

            // Add required headers
            updateRequest.addHeader("org-id", ORG_ID);
            updateRequest.addHeader("TPP-client-id", resolvedClientId);
            updateRequest.addHeader("Content-Type", Constants.JSON);
            updateRequest.addHeader("Accept", Constants.JSON);

            // Set the request body
            StringEntity body = new StringEntity(updatedConsent.toString(), ContentType.APPLICATION_JSON);
            updateRequest.setEntity(body);

            // Execute the request
            HttpResponse consentResponse = client.execute(updateRequest);
            int statusCode = consentResponse.getStatusLine().getStatusCode();

            if (statusCode == HttpURLConnection.HTTP_OK || statusCode == HttpURLConnection.HTTP_CREATED) {
                String responseBody = IOUtils.toString(consentResponse.getEntity().getContent(),
                        String.valueOf(StandardCharsets.UTF_8));
                log.debug("Update consent response: {}", responseBody);
                return new JSONObject(responseBody);
            } else {
                log.error("Failed to update consent. Status code: {}", statusCode);
                String errorBody = IOUtils.toString(consentResponse.getEntity().getContent(),
                        String.valueOf(StandardCharsets.UTF_8));
                log.error("Error response: {}", errorBody);
                return null;
            }
        } catch (IOException e) {
            log.error("Error updating consent for consent_id: {}", consentId, e);
            return null;
        }
    }

    /**
     * Resolves whether an element is mandatory for a given purpose.
     * Calls the consent purposes API to retrieve the purpose details
     * and determines the mandatory status of the specified element.
     *
     * @param purposeName the name of the consent purpose
     * @param elementName the name of the specific element
     * @param servletContext servlet context
     * @return Boolean true if mandatory, false if not mandatory, null if not found or error occurred
     */
    public static Boolean resolvePurposeMandatory(String purposeName, String elementName,
                                                  String clientId, ServletContext servletContext) {
        if (purposeName == null || purposeName.trim().isEmpty() ||
            elementName == null || elementName.trim().isEmpty()) {
            log.warn("Purpose name or element name is null or empty");
            return null;
        }

        try (CloseableHttpClient client = HttpClientBuilder.create().build()) {
            String apiUrl = CONSENT_PURPOSES_API_BASE_URL;

            log.debug("Calling consent purposes API: {}", apiUrl);

            HttpGet request = new HttpGet(apiUrl);
            // Use provided clientId, fall back to env var
            String resolvedClientId = (clientId != null && !clientId.isEmpty()) ? clientId : CLIENT_ID;
            request.addHeader("org-id", ORG_ID);
            request.addHeader("TPP-client-id", resolvedClientId);
            request.addHeader("Accept", Constants.JSON);

            HttpResponse response = client.execute(request);
            int statusCode = response.getStatusLine().getStatusCode();

            if (statusCode != HttpURLConnection.HTTP_OK) {
                log.error("Failed to fetch consent purposes. Status code: {}", statusCode);
                String errorBody = IOUtils.toString(response.getEntity().getContent(),
                        String.valueOf(StandardCharsets.UTF_8));
                log.error("Error response: {}", errorBody);
                return null;
            }

            String responseBody = IOUtils.toString(response.getEntity().getContent(),
                                                   String.valueOf(StandardCharsets.UTF_8));
            JSONObject responseJson = new JSONObject(responseBody);

            if (!responseJson.has("data")) {
                log.warn("No 'data' field in response from consent purposes API");
                return null;
            }

            JSONArray dataArray = responseJson.getJSONArray("data");

            // Find the purpose matching by name and clientId
            for (int i = 0; i < dataArray.length(); i++) {
                JSONObject purpose = dataArray.getJSONObject(i);

                if (purposeName.equals(purpose.getString("name")) &&
                    resolvedClientId.equals(purpose.optString("clientId", ""))) {
                    // Found the matching purpose, now find the element
                    if (purpose.has("elements")) {
                        JSONArray elements = purpose.getJSONArray("elements");

                        for (int j = 0; j < elements.length(); j++) {
                            JSONObject element = elements.getJSONObject(j);

                            if (elementName.equals(element.getString("name"))) {
                                boolean isMandatory = element.getBoolean("isMandatory");
                                log.info("Found element '{}' in purpose '{}', isMandatory: {}",
                                        elementName, purposeName, isMandatory);
                                return isMandatory;
                            }
                        }
                    }

                    log.warn("Element '{}' not found in purpose '{}'", elementName, purposeName);
                    return null;
                }
            }

            log.warn("Purpose '{}' with clientId '{}' not found", purposeName, resolvedClientId);
            return null;

        } catch (IOException e) {
            log.error("Error calling consent purposes API", e);
            return null;
        } catch (JSONException e) {
            log.error("Error parsing JSON response from consent purposes API", e);
            return null;
        }
    }

}
