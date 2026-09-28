# Public website access

The Worker configuration sets PUBLIC_SITE="true". This allows anonymous chat
through the website while retaining the backend service token. Only the exact
string "true" enables this mode; otherwise visitor Access JWTs are required.

Deploy this Worker first. Then in Zero Trust > Access controls > Applications,
configure the application for buddha.koanzone.net. Attach a new policy named
Public website with Action Bypass and Include Everyone. Save the application.
Do not change the application for api.koanzone.net or its Service Auth policy.
Do not edit a shared reusable policy to make it public.

The Worker still requires CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.
CF_ACCESS_AUD and CF_ACCESS_TEAM_DOMAIN are used only in private mode and can
remain saved for future use. Keep service-token secrets only in Cloudflare.

Verify using a private browser window: no login, /api/health works, and a full
conversation receives a response after the two opening questions. The API
hostname itself should still require Access authentication.

Anyone who reaches the website may now send model requests. The backend runs
one generation at a time; other requests receive the existing busy response.
There are no per-visitor quotas or rate limits implemented by this change.

To return to private access, remove the website Bypass policy, keep the email
Allow policy, and deploy PUBLIC_SITE="false" with the website AUD/team values.
