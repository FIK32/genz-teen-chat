GENZ TEEN CHAT — ALL-ORIGINAL PROFILE THEMES + PUBLIC CHAT BACKGROUNDS

FILES INCLUDED
- index.html
- script.js
- style.css
- README.txt

PROFILE THEMES
The profile appearance selector now contains the original five themes plus 15 additional themes (20 total):
1. Classic
2. Rounded
3. Glass
4. Gradient
5. Neon
6. Pink Paradise
7. Golden Hour
8. Tropical Vibe
9. Galaxy Dream
10. Sakura Bloom
11. Cyber Pulse
12. Sunset Rush
13. Nature Fresh
14. Midnight Luxe
15. Arctic Wave
16. Candy Pop
17. Coffee Mood
18. Cosmic Blue
19. Emerald Glow
20. Bubblegum

PUBLIC CHAT BACKGROUND THEMES
A new Public chat background selector adds 15 backgrounds, in addition to the Original option:
1. Aurora Lights
2. Ocean Waves
3. Sunset Glow
4. Lavender Fields
5. Sakura Garden
6. Deep Galaxy
7. Neon City
8. Candy Clouds
9. Enchanted Forest
10. Tropical Beach
11. Midnight Stars
12. Pastel Dream
13. Rainbow Flow
14. Rose Marble
15. Pixel Arcade

The selected public-chat background is saved in local storage on that device/browser. It does not change other members' chat backgrounds.

EXTRA EFFECTS
- Animated profile backgrounds
- Glowing usernames
- Custom profile borders
- Decorative profile frames
- Moving gradient effects
- Custom colours for your own chat bubbles and the other messages as shown on your device

EXISTING FEATURES PRESERVED IN THE SOURCE PACKAGE
- Appwrite account sign-up/sign-in and sign-out
- Public chat and left/right message alignment
- Device photo selection and Appwrite Storage upload for profile pictures
- Online users feature (requires the online_users table and its permissions)
- Embedded YouTube player flow in public chat (videos must allow embedding)
- Friends, local notifications, block/report interface
- Private messaging integration (requires the existing Appwrite Function to be deployed and working)
- Light/dark mode

INSTALLATION
1. Download and extract this ZIP.
2. In your GitHub repository, replace index.html, script.js and style.css with these files.
3. Keep any existing style-upgrade.css file if your repository already has one. The main style.css in this package contains the new theme styles too.
4. Commit the changes and wait for GitHub Pages to redeploy.

IMPORTANT LIMITATIONS / SETUP
- Profile preferences, selected theme/effects, friends, and notifications are saved in this browser's local storage in this version. They are not automatically synced to another device/account.
- Chat bubble colour preferences affect the current user's view; other members do not automatically inherit them.
- Profile pictures require the Appwrite Storage bucket ID `genz-chat-media`, with authenticated users allowed to Create and Read files. Do not enable Guest/Any public access.
- Online presence requires an Appwrite `online_users` table with columns `userId` (String), `displayName` (String), and `lastSeen` (Datetime), plus appropriate row security. Table-level permissions alone do not replace per-row ownership permissions.
- Private messaging will work only if the configured Appwrite Function URL is valid and the function itself is deployed correctly.
- YouTube embeds may be unavailable for videos whose owners disable embedding. The app embeds YouTube's player; it does not download or copy the video file.
- Do not put an Appwrite API key in frontend JavaScript.
- Test with two accounts before inviting other people. Check moderation, blocking, reporting, privacy and permissions first.


PUBLIC CHAT MESSAGE DESIGN UPDATE
- Public chat messages now use compact, rounded WhatsApp-inspired bubbles.
- Your messages remain on the right; other members' messages remain on the left.
- Message-level Report and Delete buttons have been removed from the public message display.
- The separate Safety Centre/reporting options and account-level blocking/reporting features elsewhere in the app are unchanged.
- This is a visual layout change; it does not alter Appwrite message records or permissions.
