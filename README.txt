GENZ TEEN CHAT – PROFILE PERSISTENCE & FAVICON UPDATE

Files: index.html, script.js, style.css, favicon.svg, README.txt

Changes:
- Profile preferences are saved under each signed-in Appwrite user ID in this browser, so another account does not inherit them. They remain after sign-out/sign-in on the same browser.
- Profile picture file IDs, display name and bio are saved to the Appwrite `profiles` table so the picture can be restored across sign-ins and devices.
- Added a colourful GENZ favicon.

APPWRITE REQUIREMENTS:
The `profiles` table should contain userId (String 36 required), displayName (String 30 required), bio (String 120 optional), countryCode (String 10 optional), avatarFileId (String 36 optional). Enable Row Security. At table level, allow authenticated All Users to Read and Create. Do NOT grant All Users table-level Update or Delete. The code creates each row with public-to-authenticated Read and owner-only Update/Delete permissions.

The `genz-chat-media` bucket needs authenticated Create and Read permissions. Do not enable Guest/Any access.

If profile row saving fails, local profile settings still persist in that browser and the app displays a sync warning. Visual theme preferences are browser-local and account-scoped; they are not synced to other devices because the existing profiles table has no theme columns.

INSTALL: Replace index.html, script.js and style.css in GitHub and ADD favicon.svg. Keep other project files.
