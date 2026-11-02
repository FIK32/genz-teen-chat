GENZ TEEN CHAT — CHAT ALIGNMENT + DEVICE PROFILE PHOTO UPDATE

Files: index.html, script.js, style.css

WHAT CHANGED
1. Your own public chat messages appear on the RIGHT.
2. Messages from other members appear on the LEFT.
3. The Edit Profile form now lets a member choose an image file from their device. It no longer asks for an image URL.
4. The selected picture is previewed before saving.
5. Profile pictures are uploaded to the Appwrite Storage bucket and attached to new public chat messages, so other members can see them.
6. Supported image types: JPG/JPEG, PNG, WEBP and GIF. Maximum file size: 5 MB.

APPWRITE REQUIREMENTS
- Storage bucket ID must be exactly: genz-chat-media
- In Appwrite Storage > genz-chat-media > Settings/Permissions, allow authenticated All Users to Create and Read files.
- Do not grant Guests or Any public access. Do not grant broad Update/Delete permissions.
- The messages table must have the optional String column avatarFileId (maximum 36 characters). The existing setup described for this project already includes it.
- The browser uses the Appwrite project endpoint and project ID already configured in script.js. Never add an Appwrite API key to frontend code.

IMPORTANT
- Existing messages without avatarFileId will continue to show the sender's initial.
- A user's uploaded picture is stored in Appwrite Storage; profile settings such as display name and colours remain browser-local in this version.
- Test with two accounts after deploying. If upload fails, check the bucket permissions and exact bucket ID.
