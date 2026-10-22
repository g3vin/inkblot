# Inkblot Privacy Policy

Last updated: October 14, 2026

Inkblot is a local-first writing application. This Privacy Policy explains what information Inkblot handles, where that information is stored, and when information may be sent to third-party services as part of features you choose to use.

For purposes of this policy, "Inkblot," "we," "us," and "our" refer to the developer or publisher of Inkblot. This policy covers every edition of Inkblot: the desktop app for macOS and the app for macOS, iPadOS and iOS.

## Summary

Inkblot is designed so your writing stays on your device by default. We do not operate user accounts, advertising systems, analytics trackers, or cloud synchronization servers for Inkblot. We do not sell your personal information.

Some optional features may contact third-party services to provide the feature you requested, such as dictionary lookups, looking up the details of a source you cite, online maps (satellite pictures, street detail, terrain and place search), Pinterest previews and searches, or downloading local machine-learning model files. Those third-party services may receive technical information such as your IP address and request details, and their own privacy policies apply.

## Information Inkblot Stores Locally

Inkblot stores the following information on your device:

- Documents, canvases, maps, projects, folders, notes, note images, voice memos, formatting, embedded Pinterest board URLs, and document version history.
- The sources you cite (titles, authors, identifiers such as DOIs or ISBNs, and web addresses) and your citation style settings.
- App preferences such as theme, accent color, read-aloud voice, open document/session state, split-view state, file tree order, and expanded folders.
- Clipboard history entries created when you copy or drag selected text into Inkblot's clipboard panel.
- Temporary app state needed to support editing, searching, drag-and-drop, read-aloud highlighting, and dictation previews.

Projects are stored as ordinary files in the folder you choose, or in Inkblot's application data folder. Preferences are stored as files in that application data folder. We do not receive this local data unless you separately choose to send it to us outside the app, such as by email or support request.

## Documents, Notes, Images, and Version History

Inkblot saves your writing and related project data locally so you can reopen and edit it later. Notes and pasted images may be saved inside your local document files. Version history may include prior text and document content so that history and restore features work.

You are responsible for the content you enter into Inkblot. Because Inkblot allows free-form text, notes, images, and voice dictation, you may choose to store personal information, sensitive information, or third-party information in your local documents.

## Clipboard Features

Inkblot may read or write clipboard content when you use clipboard-related features, including copy tracking, paste-as-plain-text, copying a Pinterest link, or moving snippets between the editor and the clipboard panel.

Clipboard history is stored locally in the app. You can clear Inkblot's clipboard history from the clipboard panel. Inkblot does not upload clipboard history to us.

## Microphone and Dictation

Inkblot uses your microphone only when you start dictation. Dictation is intended to run offline using a local speech-recognition model. While dictation is active, Inkblot processes microphone audio to produce partial and final text and to show an audio level indicator.

Dictation does not store raw microphone recordings, and dictation audio is never sent to us. Final dictated text is inserted into your document and may then be saved locally as part of that document and its version history.

Inkblot also lets you record voice memos and attach them to notes or place them on a canvas. A voice memo is recorded only when you start it, and it is saved as an audio file inside your project on your device. It is not sent to us.

Your operating system may ask for microphone permission. You can revoke microphone access through your operating system settings.

## Read Aloud and Speech Features

Inkblot's read-aloud feature converts selected text or document text into speech. It generates speech on your device with the Kokoro speech model, and falls back to your operating system's built-in voices when that model is not available. Text you have read aloud is processed on your device and is not sent to us.

Inkblot may download speech model files from third-party model hosts, such as Hugging Face, when local model files are not already available. These model downloads are for enabling local speech generation and do not require sending your document text to us. Depending on your operating system and installed voices, system speech features may be governed by your operating system's speech and privacy settings.

## Writing Assistance Tools

Inkblot includes writing tools such as synonyms, antonyms, rhymes, parts-of-speech analysis, definitions, search, and replace.

Most writing assistance runs locally in the app using local JavaScript, WebAssembly, or ONNX models. The dictionary feature sends the word you ask to define to `dictionaryapi.dev` so that it can return a definition. Model files used for local features, such as the synonym, rhyme, speech and dictation models, may be downloaded from GitHub or Hugging Face the first time you use the feature. These downloads send no document text.

If you choose "Search Web" from the right-click menu, the selected text is opened as a Google search in your web browser, and Google's privacy policy applies.

We do not use your writing assistance queries for advertising or tracking.

## References and Citations

When you add a source by pasting a DOI, ISBN, arXiv or PubMed identifier, or a web address, Inkblot looks up that source's details so you do not have to type them. To do this it sends the identifier or address you entered to the matching service: `doi.org` and Crossref for DOIs, Open Library and Google Books for ISBNs, arXiv, PubMed (the U.S. National Library of Medicine), YouTube or Vimeo for video links, or the web page itself to read its title and author. Only the identifier or address you entered is sent, never your document text.

Citation and bibliography formatting runs on your device.

## Online Maps

Maps work offline: the Earth's coastlines and borders are bundled with the app, and planets, star systems and galaxies are drawn on your device. Online maps are off until you turn them on, either when Inkblot asks the first time you choose satellite pictures, street detail or terrain, or in Settings › Maps.

When online maps are on and an Earth map shows them, Inkblot downloads map tiles for the part of the world you are looking at:

- Satellite pictures from EOX (Sentinel-2 cloudless, `tiles.maps.eox.at`), or from the provider you choose in Settings › Maps (MapTiler, Mapbox, Google Maps Platform, or a tile address you enter). If a provider needs an API key, the key is stored in Inkblot's preferences on your device, never in a project, and is sent only to that provider.
- Street detail and place names from OpenFreeMap (`tiles.openfreemap.org`), built from OpenStreetMap data.
- Terrain heights from the Terrain Tiles dataset hosted on Amazon Web Services (`s3.amazonaws.com`).

When you search a map for a real place, the words you type are sent to Photon (`photon.komoot.io`), run by komoot, which returns matching places.

These services receive which tiles are requested (and so roughly which part of the world you are viewing and at what zoom), your search words when you search, your IP address and normal request metadata. Nothing from your project — the places, routes, regions or notes you add to a map — is sent. Turn online maps off in Settings › Maps to stop all of these requests.

## Pinterest Features

Inkblot can open Pinterest searches and embed or preview Pinterest boards when you paste or use Pinterest URLs. When you use these features, Inkblot may contact Pinterest domains, Pinterest widget services, Pinterest image CDNs, or open Pinterest in a separate app webview.

Pinterest may receive information such as the Pinterest URL or search query, your IP address, cookies or login session information inside the Pinterest webview, and normal browser request metadata. Inkblot does not collect your Pinterest password, and Pinterest login is handled by Pinterest inside the Pinterest webview.

Pinterest's privacy practices are governed by Pinterest's own terms and privacy policy.

## Third-Party Services

Depending on the features you use, Inkblot may interact with:

- Pinterest, for Pinterest search, login webviews, board previews, widgets, and pin images.
- `dictionaryapi.dev`, for dictionary definitions.
- `doi.org`, Crossref, Open Library, Google Books, arXiv, PubMed, YouTube and Vimeo, and the web pages you cite, for looking up source details.
- Google, when you choose to search the web for selected text.
- EOX, OpenFreeMap, Amazon Web Services and Photon (komoot), and the satellite provider you choose (MapTiler, Mapbox, Google Maps Platform, or your own), for online maps when you turn them on.
- GitHub, for downloading local model files the first time a feature needs them.
- Hugging Face or model-library infrastructure, for downloading local speech, dictation or tokenizer model files when needed.
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
- User content stored on device: documents, notes, images, voice memos, cited sources, clipboard history, dictation output, and version history.
- Third-party requests: optional feature requests to Pinterest, `dictionaryapi.dev`, the source lookup services listed above, the online map services listed above, Google web search, GitHub, Hugging Face/model hosts, and operating-system services as described in this policy.

Confirm these disclosures before submission if you add analytics, accounts, crash reporting, cloud sync, payments, or other networked features.

## Changes to This Policy

We may update this Privacy Policy when Inkblot's features, privacy practices, or legal requirements change. The "Last updated" date at the top shows when the policy was last revised.

## Contact

If you have questions about this Privacy Policy or Inkblot's privacy practices, contact:

Developer/Publisher: `[Soupy Orange Cats Co-op]`
Email: `[privacy@inkblotwriting.studio]`
Website: `[https://inkblotwriting.studio]`
