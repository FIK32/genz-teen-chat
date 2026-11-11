GENZ TEEN CHAT — website update

Files:
- index.html
- script.js

Installation:
1. Back up your current website folder.
2. Replace index.html and script.js with these two files.
3. KEEP your existing style.css (the stylesheet you supplied). Do not replace it with an older stylesheet.
4. Deploy the updated website to the same GitHub Pages repository.
5. Deploy the separate Appwrite function TAR.GZ package using its README.

This site is configured for your existing Appwrite project:
- Endpoint: https://nyc.cloud.appwrite.io/v1
- Project ID: 6ada4252003150fd4cdd
- Database: genz-chat-db
- Public messages table: messages
- Private messaging function: private-messaging-api

Public chat reads messages from the messages table and sends them through the function.
Private chat sends and loads through the function.

The private conversation field expects the other member's Appwrite User ID. The receiver must have an account in the same Appwrite project.

Do not put an Appwrite API key in this folder or in browser JavaScript.
