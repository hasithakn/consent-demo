<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authorization Complete - Government Consent Portal</title>
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #1e3a5f 0%, #2d5986 50%, #1a5276 100%);
            min-height: 100vh;
            display: flex; align-items: center; justify-content: center;
            padding: 20px;
        }
        .wrapper { width: 100%; max-width: 480px; text-align: center; }
        .header { color: #fff; margin-bottom: 28px; }
        .header .icon { font-size: 44px; display: block; margin-bottom: 12px; }
        .header h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
        .header p { font-size: 14px; color: rgba(255,255,255,0.7); margin-top: 6px; }
        .card {
            background: #fff; border-radius: 16px;
            box-shadow: 0 25px 50px rgba(0,0,0,0.25);
            padding: 48px 36px;
        }
        .success-icon { font-size: 64px; margin-bottom: 20px; display: block; }
        .card h2 { font-size: 22px; color: #059669; font-weight: 700; margin-bottom: 12px; }
        .card p { font-size: 15px; color: #6b7280; line-height: 1.6; margin-bottom: 8px; }
        .btn-close {
            display: inline-block; margin-top: 24px;
            padding: 12px 32px; border: none; border-radius: 10px;
            font-size: 15px; font-weight: 600; cursor: pointer;
            color: #fff; background: linear-gradient(135deg, #1e3a5f, #2d5986);
            transition: opacity 0.2s;
        }
        .btn-close:hover { opacity: 0.85; }
        .footer {
            text-align: center; margin-top: 24px;
            font-size: 12px; color: rgba(255,255,255,0.5);
        }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="header">
            <span class="icon">&#x1F6E1;&#xFE0F;</span>
            <h1>Government Consent Portal</h1>
            <p>Secure Data Authorization</p>
        </div>
        <div class="card">
            <span class="success-icon">&#x2705;</span>
            <h2>Authorization Complete</h2>
            <p>You have successfully responded to the consent request.</p>
            <p>The requesting application has been notified.</p>
            <button class="btn-close" onclick="window.close()">Close this window</button>
        </div>
        <div class="footer">
            &copy; Government Consent Portal <script>document.write(new Date().getFullYear());</script>
        </div>
    </div>
</body>
</html>
