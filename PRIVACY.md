# Inkblot Privacy Policy

Last updated: May 8, 2026

Inkblot is a local-first writing application. This Privacy Policy explains what information Inkblot handles, where that information is stored, and when information may be sent to third-party services as part of features you choose to use.

For purposes of this policy, "Inkblot," "we," "us," and "our" refer to the developer or publisher of Inkblot. Before publishing this policy, replace the contact placeholders below with your official legal name and contact information.

## Summary

Inkblot is designed so your writing stays on your device by default. We do not operate user accounts, advertising systems, analytics trackers, or cloud synchronization servers for Inkblot. We do not sell your personal information.

Some optional features may contact third-party services to provide the feature you requested, such as dictionary lookups, Pinterest previews/searches, or downloading local machine-learning model files. Those third-party services may receive technical information such as your IP address and request details, and their own privacy policies apply.

## Information Inkblot Stores Locally

Inkblot stores the following information on your device:

- Documents, projects, folders, notes, note images, formatting, embedded Pinterest board URLs, and document version history.
- App preferences such as theme, accent color, read-aloud voice, open document/session state, split-view state, file tree order, and expanded folders.
- Clipboard history entries created when you copy or drag selected text into Inkblot's clipboard panel.
- Temporary app state needed to support editing, searching, drag-and-drop, read-aloud highlighting, and dictation previews.

This local information is stored using your operating system's application data storage and browser-style local storage inside the Tauri app webview. We do not receive this local data unless you separately choose to send it to us outside the app, such as by email or support request.

## Documents, Notes, Images, and Version History

Inkblot saves your writing and related project data locally so you can reopen and edit it later. Notes and pasted images may be saved inside your local document files. Version history may include prior text and document content so that history and restore features work.

You are responsible for the content you enter into Inkblot. Because Inkblot allows free-form text, notes, images, and voice dictation, you may choose to store personal information, sensitive information, or third-party information in your local documents.

## Clipboard Features

Inkblot may read or write clipboard content when you use clipboard-related features, including copy tracking, paste-as-plain-text, copying a Pinterest link, or moving snippets between the editor and the clipboard panel.

Clipboard history is stored locally in the app. You can clear Inkblot's clipboard history from the clipboard panel. Inkblot does not upload clipboard history to us.

## Microphone and Dictation

Inkblot uses your microphone only when you start dictation. Dictation is intended to run offline using a local speech-recognition model. While dictation is active, Inkblot processes microphone audio to produce partial and final text and to show an audio level indicator.

Inkblot does not intentionally store raw microphone recordings or send dictation audio to us. Final dictated text is inserted into your document and may then be saved locally as part of that document and its version history.

Your operating system may ask for microphone permission. You can revoke microphone access through your operating system settings.

## Read Aloud and Speech Features

Inkblot's read-aloud feature converts selected text or document text into speech. The app prefers local speech generation using Kokoro or local/system speech tools. Text selected for read-aloud may be processed by local app code, a local Python speech worker, or your operating system's speech engine.

Inkblot may download speech model files from third-party model hosts, such as Hugging Face, when local model files are not already available. These model downloads are for enabling local speech generation and do not require sending your document text to us. Depending on your operating system and installed voices, system speech features may be governed by your operating system's speech and privacy settings.

## Writing Assistance Tools

Inkblot includes writing tools such as synonyms, antonyms, rhymes, parts-of-speech analysis, definitions, search, and replace.

Most writing assistance runs locally in the app using local JavaScript, WebAssembly, or ONNX models. The dictionary feature sends the word you ask to define to `dictionaryapi.dev` so that it can return a definition. Model files used for local features may be downloaded from third-party hosting services, such as GitHub or Hugging Face, during setup, build, or first use.

We do not use your writing assistance queries for advertising or tracking.

## Pinterest Features

Inkblot can open Pinterest searches and embed or preview Pinterest boards when you paste or use Pinterest URLs. When you use these features, Inkblot may contact Pinterest domains, Pinterest widget services, Pinterest image CDNs, or open Pinterest in a separate app webview.

Pinterest may receive information such as the Pinterest URL or search query, your IP address, cookies or login session information inside the Pinterest webview, and normal browser request metadata. Inkblot does not collect your Pinterest password, and Pinterest login is handled by Pinterest inside the Pinterest webview.

Pinterest's privacy practices are governed by Pinterest's own terms and privacy policy.

## Third-Party Services

Depending on the features you use, Inkblot may interact with:

- Pinterest, for Pinterest search, login webviews, board previews, widgets, and pin images.
- `dictionaryapi.dev`, for dictionary definitions.
- GitHub, for downloading local model assets during setup or build.
- Hugging Face or model-library infrastructure, for downloading local speech or tokenizer/model files when needed.
- Your operating system, for microphone permission, clipboard access, file storage, audio playback, and system speech.

We do not control third-party services. Information those services receive is handled according to their privacy policies.

## Information We Do Not Collect

Inkblot does not currently provide:

- User accounts managed by us.
- Cloud synchronization managed by us.
- In-app advertising.
- Third-party analytics tracking.
- Payment processing inside the app.
- Location tracking.
- Sale of personal information.

If these practices change, we will update this policy.

## Data Sharing

We do not sell your personal information. We do not share your local documents, notes, images, dictation text, clipboard history, or project data with advertisers or data brokers.

Information may be shared only when:

- You use a feature that contacts a third-party service, as described above.
- You choose to export, copy, share, upload, or otherwise send your content outside Inkblot.
- We are required to comply with applicable law, legal process, or a valid government request.
- It is necessary to protect the rights, safety, or security of users, the public, the app, or the developer.

## Data Retention and Deletion

Inkblot stores app data locally until you delete it. You can delete documents, projects, notes, images, version history, and clipboard history using app features where available, or by deleting Inkblot's local application data from your device.

Uninstalling the app may not remove all application data on every operating system. If you want to remove all local data, use your operating system's app data controls or manually delete Inkblot's app data folder.

Because we do not operate an Inkblot account system or cloud storage service, we generally cannot access, restore, or delete local data on your device for you.

## Security

Inkblot relies on your device, operating system, and local file permissions to protect locally stored data. You should protect your device with appropriate security measures, such as device encryption, a strong login password, and regular backups.

No method of storage or transmission is perfectly secure. Third-party network requests are subject to the security practices of the third-party services involved.

## Children's Privacy

Inkblot is not directed to children under 13, and we do not knowingly collect personal information from children. Because Inkblot is local-first and does not use developer-operated accounts or analytics, we generally do not know the age of users.

If you believe a child has provided personal information to us directly outside the app, contact us so we can review and delete it where required.

## International Users

Inkblot stores your app data locally on your device by default. If you use features that contact third-party services, those services may process request information in countries where they operate.

## App Store Privacy Summary

For App Store privacy disclosures, Inkblot's current intended posture is:

- Data collected by the developer: none, unless the user separately contacts the developer for support.
- Data used for tracking: none.
- Data linked to the user by the developer: none.
- User content stored on device: documents, notes, images, clipboard history, dictation output, and version history.
- Third-party requests: optional feature requests to Pinterest, `dictionaryapi.dev`, GitHub, Hugging Face/model hosts, and operating-system services as described in this policy.

Confirm these disclosures before submission if you add analytics, accounts, crash reporting, cloud sync, payments, or other networked features.

## Changes to This Policy

We may update this Privacy Policy when Inkblot's features, privacy practices, or legal requirements change. The "Last updated" date at the top shows when the policy was last revised.

## Contact

If you have questions about this Privacy Policy or Inkblot's privacy practices, contact:

Developer/Publisher: `[Soupy Orange Cats Co-op]`
Email: `[privacy@inkblotwriting.studio]`
Website: `[https://inkblotwriting.studio]`
