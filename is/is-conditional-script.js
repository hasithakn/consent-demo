var isCiba;
var isCibaWebLink;

function onLoginRequest(context) {
    var responseType = context.request.params.response_type[0];
    var CIBAWebLinkParam = context.request.params.ciba_web_auth_link;

    if (responseType.indexOf("cibaAuthCode") >= 0) {
        isCiba = true;
    } else {
        isCiba = false;
    }

    if (CIBAWebLinkParam != null) {
        isCibaWebLink = true;
    } else {
        isCibaWebLink = false;
    }

    if (!isCiba) {
        executeStep(1);
    } else {
        if (isCibaWebLink) {
            executeStep(1);
        } else {
            executeStep(2);
        }
    }
}
