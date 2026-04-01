<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>

<div class="select-group">
    <label for="consentExpiry">Consent Valid For</label>
    <select id="consentExpiry" name="consentExpiry">
        <option value="1">1 Day</option>
        <option value="7">1 Week</option>
        <option value="30" selected>1 Month</option>
        <option value="90">3 Months</option>
        <option value="180">6 Months</option>
        <option value="365">1 Year</option>
    </select>
    <div class="hint">How long this consent remains valid</div>
</div>

<div class="select-group">
    <label for="dataAccessDuration">Historical Data Access</label>
    <select id="dataAccessDuration" name="dataAccessDuration">
        <option value="1">Previous 1 Day</option>
        <option value="7">Previous 1 Week</option>
        <option value="30" selected>Previous 1 Month</option>
        <option value="90">Previous 3 Months</option>
        <option value="180">Previous 6 Months</option>
        <option value="365">Previous 1 Year</option>
    </select>
    <div class="hint">How far back data can be accessed</div>
</div>