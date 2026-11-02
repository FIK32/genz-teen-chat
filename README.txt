GENZ TEEN CHAT — UPGRADED FILES

FILES TO REPLACE ON GITHUB
1. index.html
2. script.js
3. style.css

Keep your existing style-upgrade.css file. This package does not replace it.
Keep your Appwrite project and database; the Appwrite project ID, endpoint, database ID, message table ID and private function URL from your existing script.js have been preserved.

FEATURES ADDED
- Profile username colour, profile text colour, accent colour and five profile appearances (Classic, Rounded, Glass, Gradient, Neon). Settings save in this browser only; they are not synced to other devices.
- Online users panel with a 30-second heartbeat and a two-minute active window.
- YouTube button opens YouTube in a new tab. Choose a video, copy its URL, paste it into the field, then Share video. The video link is posted to public chat and rendered as a clickable link. It does not automatically import a selection from YouTube.
- Existing signup/sign-in, public chat, private-message function connection, friends demo, notifications, block/report tools and light/dark mode are retained.

APPWRITE SETUP REQUIRED FOR ONLINE USERS
Create a table in database genz-chat-db with table ID exactly: online_users
Create these columns (all required):
- userId: String, 36 characters
- displayName: String, 30 characters
- lastSeen: Datetime
Enable Row Security. Give authenticated users permission to read rows. Give authenticated users permission to create rows. For row-level permissions, each created row is readable by authenticated users and update/delete is restricted to its owner. The code creates rows with read access for authenticated users and owner-only update/delete permissions. Make sure the table allows authenticated row creation.

If the online users panel reports a permissions/table error, verify the table ID, columns and permissions above.

IMPORTANT
- Profile colours and appearances are currently stored in local browser storage, not Appwrite.
- Friends, notifications and local block display are still browser-local where the existing app indicates this.
- Private messaging and reports still depend on your existing Appwrite Function deployment; this package does not repair a failed function deployment.
- Never put an Appwrite API key in browser JavaScript.
- Test with two accounts in separate browsers before announcing the site.
