Set up vanilla IS 7.1.0 Docker- It Has CIBA endpoint but not marketed
Use product APIs from docs-is/en/identity-server/7.1.0/docs/apis/restapis to do changes 
Build and add the CIBAWebLinkAuthenticator JAR to the IS Dropins - https://github.com/hasithakn/consent-accelerator-v1/tree/ciba_flow - this is cloned locally but switch to ciba_flow branch. 
In case Java version needs to be changed, we have sdkman installed, however, avoid changing Java version if possible. 
Later must Create App and generate keys for it using WSO2 IS 7 key manager, it should create the App in IS after the IS as KM configurtation is done, to this app we Set CIBAWebLinkAuthenticator as an authenticator (step 2) along with username/password (step 1) 
Create a test user in IS with credentials john123/John@123.
Include a SCRIPT that will switch to the authenticators based on the incoming request param - given in `./is-conditional-script.js`
Build and add the Consent accelerator utils jar to Dropins. It correlates the CIBA authId with the consentId via a scope and then removes it when responding. Here some calls to the OpenFGC Consent API have some hardcoded elements. Check and adjust. Don’t worry about the rest.  - https://github.com/hasithakn/consent-accelerator-v1/tree/ciba_flow -this is cloned locally and available in `ciba_flow` branch
Consent Authentication Webapp is the customized consent IS page. Build and put it in serverapps (<IS-HOME>/repository/deployment/server/webapps/) WAR file. But there are some hard coded elements, correlation with commonauth, callout to the Base URL of IS which is hardcoded, there is commonAuthID setting via cookie which is used later in CIBA response flow etc. After the user approves or rejects consent, uses PUT to update Consent with Authorizations. It’s very important to analyze it and make sure we understand everything it’s doing, especially as we may need to port to React later. https://github.com/hasithakn/consent-accelerator-v1/tree/ciba_flow - this is cloned locally and available in ciba_flow branch
Make changes to DEPLOYMENT TOML to include the above customizations in the appropriate place. `./deployment.toml` is provided here, mostly can use as is, but thoroughly check it. 
Please parametrize the changing data like URLs, client IDs, and other environment-specific values as per best practices so we don't have to waste time rebuilding and restarting each time. 

Set up APIM 4.5.0 vanilla docker
Use product APIs from docs-apim/en/docs/reference/product-apis to do changes (first change to 4.5.0 branch)
Add the policy for consent from the Github repo - https://github.com/hasithakn/consent-accelerator-v1/tree/ciba_flow - this is cloned locally and available in `ciba_flow` branch. Add it to the mock API. Add the right things to the request and response flows respectively. It calls out to the OpenFGC Consent Validate API to validate the consent (request flow), then based on what the user had approved filters the response (response flow). No need to use the dynamic endpoint used in the github, can just use the direct backend endpoint to the mock backend API created earlier. 

Configure IS as Key Manager for APIM. Instructions will be in docs-apim. After this when we create an app in APIM and generate keys for it using WSO2 IS 7 key manager, it should create the App in IS as well. Make sure to import APIM cert to IS truststore and vice versa to avoid SSL issues. 

Set up OpenFGC - https://github.com/wso2/openfgc/tree/main - this has been cloned locally
Consent Elements with Resource paths (JSON Paths like $.person.name, $.person.address) as per backend API. Create simple light mock backend API that returns typical person info for Bank KYC given the person’s NIN (National Identification Number)
Using Elements create Consent Purpose
Using Purpose initiate Consent, IGNORE Value under elements which is optional and used in OB
ORG ID is the Tenant ID but for demo just use a mock ORG ID, must be used consistently everywhere including the Java files, parametrize it. 
TPP Client ID is the IS Client ID

Make sure entire thing in Docker so that can be easily brought up and down. 

Must test everything iteratively to make sure it’s working step after step. This is a complex setup and failure to test after each step will lead to frustration and getting lost. Keep a track of progress along with issues faced and resolution in an MD file. This will be a complete log of all steps done, tried, success, fail, backtrack everything. At any point anyone should see what has worked and not and use it to set up everything in working state later on. 

If you are creating any temp files, use the current workspace (/tmp), don't use /tmp or any other location. Otherwise these don't get auto-approved. 