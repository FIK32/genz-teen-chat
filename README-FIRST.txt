GENZ TEEN CHAT UPDATED FILES

Replace these three files in your existing GitHub project: index.html, script.js, style.css. Upload style-upgrade.css too (the HTML already links to it). Keep a backup of your old files first.

Appwrite values are already set for your project. This update uses profiles table ID `profiles` and Storage bucket ID `genz-chat-media`. Your messages table needs the four optional columns countryCode, avatarFileId, mediaFileId, mediaType.

IMPORTANT: profiles table Row Security must be ON. Table-level Read and Create should be All Users; no table-level Update/Delete role. The script creates profile rows with per-user update/delete permissions. Confirm your Appwrite Storage bucket permits authenticated users to create and read files.

Features in this code: cloud profile details, country label, profile image upload, public image/video upload, YouTube embed for standard video links, five color themes, online count/list using lastSeen heartbeat, and own-message-right alignment. Online status updates about every 30 seconds and considers a profile online for 90 seconds.

Upload limits: profile image 5 MB; public media 25 MB. Allowed formats: JPG/JPEG/PNG/GIF/WEBP and MP4/WEBM.

Still local/demo in the existing starter: friends list, notification list, and reactions. Private messaging still depends on your separate Appwrite function and has not been changed or verified here.

Test in a second browser/account: create or sign in, save profile, check online count, send text, send an image, and send a permitted YouTube URL. If Appwrite returns an error, note the exact message; do not share API keys or passwords.
