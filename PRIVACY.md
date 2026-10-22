# Inkblot Privacy Policy

Last updated: October 17, 2026

Inkblot is a local-first writing application. This Privacy Policy explains what information Inkblot handles, where it is stored, and when information leaves your device, either because you use a feature that we run (such as your account and the marketplace) or a feature that contacts a third-party service.

For purposes of this policy, "Inkblot," "we," "us," and "our" refer to the developer or publisher of Inkblot. This policy covers every edition of Inkblot: macOS, Windows, Linux, iOS, iPadOS and Android.

> Items in `[OWNER: …]` brackets are decisions that must be made, and the text completed, before this policy is published.

## Summary

- **Your writing stays on your device by default.** Inkblot works fully offline without an account. Documents, canvases, maps and projects are ordinary files in a folder you choose.
- **Accounts are optional.** You only need one for your public profile, the marketplace, and sharing work with other Inkblot users. When you use those features, the information they need is sent to servers we operate (described below).
- **Your work is never used to train AI.** We do not use your writing, reviews, or anything you post to train, fine-tune or evaluate any artificial intelligence model, and we do not let anyone else do so.
- **We do not sell your personal information**, show ads, or use third-party analytics or tracking.
- Some optional features contact third-party services, such as online maps, dictionary lookups, source lookups, embedded videos and music, publishing to other sites, and downloading on-device model files. Those services receive request information such as your IP address, and their own privacy policies apply.

## Our Commitment on AI

Inkblot contains no generative AI. Nothing in Inkblot drafts, rewrites, continues or summarises your words, or generates images for you.

We will never use your documents, marketplace posts, reviews, comments or profile to train, fine-tune or evaluate an AI model, and we will never sell or license them to anyone who would. This applies to work stored on your device and to anything you choose to share through Inkblot's services.

Some features use small models that run **on your device** for tasks that do not create content: synonyms and antonyms, rhymes, parts of speech, dictation, read-aloud, recognising the names of your characters, places and other entries, and removing the background from an image. These models process your text, audio or images locally and do not send them to us.

## Information Inkblot Stores on Your Device

Inkblot stores the following information on your device:

- Documents, canvases, maps, brainstorm boards, projects, folders, notes, note images, voice memos, formatting, and document and typesetting version history.
- The sources you cite (titles, authors, identifiers such as DOIs or ISBNs, and web addresses) and your citation style settings.
- Character, location and other entries you create, with their names and aliases.
- App preferences such as theme, accent colour, read-aloud voice, open document and session state, split-view state, file tree order, and expanded folders.
- Clipboard history entries created when you copy or drag selected text into Inkblot's clipboard panel.
- If you sign in, a session token that keeps you signed in. `[OWNER: confirm it is stored in the operating system's secure storage (Keychain, Credential Manager, Secret Service, Android Keystore).]`
- If you connect publishing sites, the credentials or tokens for those sites (see "Publishing to Other Sites").
- Temporary app state needed to support editing, searching, drag-and-drop, read-aloud highlighting, and dictation previews.

Projects are stored as ordinary files in the folder you choose, or in Inkblot's application data folder. We do not receive this local data unless you choose to share it through a feature described below, or send it to us outside the app (for example, by email or a bug report).

## Accounts and Profiles

You can use Inkblot without an account. If you create one, we collect and store:

- **Account information:** your email address, a unique username, and your password. `[OWNER: confirm the password is stored only as a salted hash by the authentication provider.]`
- **Profile information you choose to add:** a profile picture, banner, bio, background colour, and links to your published works or website.
- **Connected accounts you choose to link:** Discord, Instagram, Facebook, Bluesky and/or Pinterest. When you link one, we receive and display the username or profile link that service provides. `[OWNER: list exactly which fields are requested from each service.]`
- **Your review reputation:** the ratings writers give your marketplace reviews, which appear on your profile.

Your username, profile information, linked accounts and review rating are **public** to other Inkblot users. Your email address is not shown to other users.

## The Marketplace

The marketplace lets writers post work for review by other writers. It requires an account.

**When you post work**, we store what you post (a folder, file, chapter or section), with:
- the summary, preview, deadline and visibility setting you choose;
- the kinds of edits you ask for, and the minimum reviewer rating;
- any link to an earlier post.

Who sees what:
- Other users who can see your post see its summary and preview.
- **Only reviewers who accept and take on your work can read all of it.**
- You choose whether a post is open to anyone, by request only, or limited to people who have reviewed for you before.

**When you review work**, we store:
- your inline comments and final review report;
- the deadline you accepted;
- whether you finished on time.

The writer can see your review and rate it. They can also like individual comments.

**Coins and reputation.** We keep a record of your coin balance and how it changed: coins earned for finished reviews and bonuses, and coins spent on posting and spotlighting. We also keep the ratings used to calculate reviewers' reputation scores. Coins cannot be bought or exchanged for money.

**Discovery.** We use your profile, the formats you review (for example scripts, novels or short stories), and your review history to recommend work to you. Posts you spotlight with coins are shown more prominently to other users. We do not use this information for advertising.

`[OWNER: state how long posts, reviews and coin records are kept after a post's deadline passes or a post is withdrawn.]`

## Watermarks, Copy Protection and Leak Tracing

To discourage leaks and scraping of work shared through the marketplace, Inkblot protects shared work in the review view:

- **Visible watermark:** your username is shown over work you are reviewing.
- **Hidden watermark:** each copy of shared work carries an invisible watermark that identifies the account that viewed it. We keep a record linking each watermark to the viewing account, so that a leaked copy can be traced.
- **Screenshot and copy prevention:** where the operating system allows, Inkblot prevents screenshots and screen recording of the review view, and blocks copying and pasting from it. This protection is best-effort and cannot stop every method of capture, such as photographing a screen.

`[OWNER: state how long watermark records are kept.]`

## Reports and Moderation

You can report a reviewer or a review for inappropriate comments, suspected automated or AI-generated reviewing, or spam. You can also report a leak by submitting an image of protected work you have found elsewhere.

When you report, we receive:
- the report;
- your account details;
- anything you attach, such as the image of a leak.

We use reports to keep the marketplace safe. When the hidden watermark identifies the account that leaked a work, we may suspend or ban that account and reward the reporter with coins. You cannot earn coins by reporting a leak of your own work. We may share leak evidence with the platform where it was posted, to request removal.

## Sharing and Co-Writing

You can send a document or a whole project to another Inkblot user, and write with others in real time.

- **On the same local network,** devices connect to each other directly, and the content does not pass through our servers.
- **Over the internet,** connections go through a relay and signalling server `[OWNER: operated by us / by PROVIDER]`. The server sees connection information such as your IP address and account, and it relays the content you share. `[OWNER: state whether shared content is end-to-end encrypted. If it is not, say whether the relay stores any of it, and for how long.]`

The people you share with receive a copy of what you send, and you cannot recall it from their devices.

## Publishing to Other Sites

If you choose to publish a finished document, Inkblot sends it to the sites you pick: Archive of Our Own (AO3), WordPress, Ghost, Substack, GitHub Pages, or a folder or repository you choose.

To do this, Inkblot uses the sign-in details or access tokens you provide for those sites. `[OWNER: confirm they are stored only on your device, in its secure storage, and never sent to us.]` Content you publish is governed by each site's own terms and privacy policy.

## Bug Reports and Update Notes

**Bug reports** are sent only when you choose to send one. A report includes:
- what you write;
- the app version and operating system;
- recent errors and logs;
- a screenshot of the window, if you choose to attach one.

You can see a preview of everything in the report before you send it. Reports are posted to our Discord channel through a webhook, and a matching issue is created in our GitHub issue tracker. Discord's and GitHub's privacy policies apply. `[OWNER: state who can see that channel and tracker.]`

**Update notes:** after an update, Inkblot downloads that version's release notes from GitHub to show you what changed. GitHub receives your IP address and normal request information.

## Microphone and Dictation

Inkblot uses your microphone only when you start dictation or record a voice memo. Dictation runs offline using a local speech-recognition model. While dictation is active, Inkblot processes microphone audio to produce text and to show an audio level indicator.

Dictation does not store raw microphone recordings, and dictation audio is never sent to us. Final dictated text is inserted into your document and saved locally with it.

Voice memos are recorded only when you start them, and are saved as audio files inside your project on your device. They are not sent to us unless you share the project.

Your operating system may ask for microphone permission. You can revoke it in your operating system settings.

## Read Aloud and Speech Features

Inkblot's read-aloud feature converts text into speech on your device with the Kokoro speech model. It falls back to your operating system's built-in voices when that model is not available. Text you have read aloud is not sent to us.

Inkblot may download speech model files from third-party model hosts, such as Hugging Face, when they are not already on your device. These downloads do not send your document text.

## Writing Assistance and On-Device Models

Inkblot includes writing tools such as synonyms, antonyms, rhymes, parts-of-speech analysis, definitions, search, replace, recognition of the names of your characters, places and other entries, and image background removal.

These tools run locally in the app, using local code and on-device models. Two exceptions:
- The dictionary feature sends the word you ask to define to `dictionaryapi.dev`.
- If you choose "Search Web" from the right-click menu, the selected text is opened as a Google search in your web browser, and Google's privacy policy applies.

Model files (for synonyms, rhymes, speech, dictation, name recognition and background removal) may be downloaded from GitHub or Hugging Face the first time you use a feature. These downloads send no document text or images.

## References and Citations

When you add a source by pasting a DOI, ISBN, arXiv or PubMed identifier, or a web address, Inkblot looks up the source's details for you. It sends only the identifier or address you entered to the matching service:

| You enter | Inkblot asks |
|---|---|
| A DOI | `doi.org` and Crossref |
| An ISBN | Open Library and Google Books |
| An arXiv identifier | arXiv |
| A PubMed identifier | PubMed (the U.S. National Library of Medicine) |
| A video link | YouTube or Vimeo |
| A web address | The web page itself, to read its title and author |

Your document text is never sent. Citation and bibliography formatting runs on your device.

## Online Maps

Maps work offline: the Earth's coastlines and borders are bundled with the app, and planets, star systems and galaxies are drawn on your device. Online maps are off until you turn them on, either when Inkblot asks the first time you choose satellite pictures, street detail or terrain, or in Settings › Maps.

When online maps are on and an Earth map shows them, Inkblot downloads map tiles for the part of the world you are looking at:

- **Satellite pictures** come from EOX (Sentinel-2 cloudless, `tiles.maps.eox.at`), or from the provider you choose in Settings › Maps: MapTiler, Mapbox, Google Maps Platform, or a tile address you enter. If a provider needs an API key, the key is stored in Inkblot's preferences on your device, never in a project, and is sent only to that provider.
- **Street detail and place names** come from OpenFreeMap (`tiles.openfreemap.org`), built from OpenStreetMap data.
- **Terrain heights** come from the Terrain Tiles dataset hosted on Amazon Web Services (`s3.amazonaws.com`).

When you search a map for a real place, the words you type are sent to Photon (`photon.komoot.io`), run by komoot, which returns matching places.

These services receive which tiles are requested (and so roughly which part of the world you are viewing, and at what zoom), your search words when you search, your IP address and normal request metadata. Nothing from your project, such as the places, routes, regions or notes you add to a map, is sent. Turn online maps off in Settings › Maps to stop all of these requests.

## Embedded Media

When you paste a YouTube or Spotify link and Inkblot turns it into a player, the player loads from YouTube or Spotify when it is shown. Those services may receive your IP address, request information, and cookies or sign-in information from their own players. Their privacy policies apply.

When you are offline, Inkblot shows a title card instead.

## Pinterest Features

Inkblot can open Pinterest searches, and embed or preview Pinterest boards, when you paste or use Pinterest URLs. When you use these features, Inkblot may contact:
- Pinterest domains;
- Pinterest widget services;
- Pinterest image CDNs.

It may also open Pinterest in a separate app webview.

Pinterest may receive:
- the Pinterest URL or search query;
- your IP address;
- cookies or login session information inside the Pinterest webview;
- normal browser request metadata.

Inkblot does not collect your Pinterest password; Pinterest login is handled by Pinterest inside its webview. If you link Pinterest to your Inkblot profile, see "Accounts and Profiles".

## Services We Operate, and Providers We Use

Accounts, profiles, the marketplace, watermark records, reports, and sharing over the internet run on servers operated by us or by our hosting provider `[OWNER: name the backend provider (for example Supabase, Firebase, or self-hosted) and where it stores data]`. Providers that process data for us may do so only to run these services, and may not use it for their own purposes.

## Third-Party Services

Depending on the features you use, Inkblot may interact with:

| Service | Used for |
|---|---|
| Our account and marketplace provider `[OWNER: name]` | Accounts, profiles, the marketplace and sharing |
| Discord, Instagram, Facebook, Bluesky and Pinterest | Linking accounts to your profile |
| Pinterest | Pinterest search, login webviews, board previews, widgets and pin images |
| `dictionaryapi.dev` | Dictionary definitions |
| `doi.org`, Crossref, Open Library, Google Books, arXiv, PubMed, YouTube, Vimeo, and the web pages you cite | Looking up source details |
| YouTube and Spotify | Embedded players |
| Google | Searching the web for selected text |
| EOX, OpenFreeMap, Amazon Web Services, Photon (komoot), and the satellite provider you choose | Online maps, when you turn them on |
| AO3, WordPress, Ghost, Substack and GitHub | Publishing, when you choose to |
| Discord and GitHub | Bug reports, when you send one |
| GitHub | Release notes |
| GitHub and Hugging Face | Downloading on-device model files |
| Your operating system | Microphone permission, clipboard access, secure credential storage, file storage, screenshot prevention, audio playback and system speech |

We do not control third-party services. Information they receive is handled according to their privacy policies.

## What We Do Not Do

Inkblot does not:

- Use your work to train AI, or allow anyone else to.
- Show in-app advertising.
- Use third-party analytics or tracking.
- Sell personal information.
- Track your location.
- Process payments inside the app. Coins cannot be bought.
- Back up your documents to our servers. Only what you choose to share or post leaves your device.

If these practices change, we will update this policy.

## Data Sharing

We do not sell your personal information. We do not share your local documents, notes, images, dictation text, clipboard history, or project data with advertisers or data brokers.

Information may be shared only:

- With other Inkblot users, as described above: your public profile, your posts within the visibility you choose, your reviews with the writers you review for, and what you send when sharing.
- With providers that run our services for us.
- When you use a feature that contacts a third-party service.
- When you choose to export, copy, publish, upload, or otherwise send your content outside Inkblot.
- With a platform hosting leaked work, to request its removal.
- When required to comply with applicable law, legal process, or a valid government request.
- When necessary to protect the rights, safety, or security of users, the public, the app, or the developer.

## Data Retention and Deletion

**On your device:** Inkblot keeps app data until you delete it. You can delete documents, projects, notes, images, version history and clipboard history in the app, or delete Inkblot's application data folder. Uninstalling the app may not remove all application data on every operating system.

**Account data:** we keep your account, profile, posts, reviews and coin records for as long as your account exists, and as described in the sections above.

You can delete your account `[OWNER: in Settings › Account / by contacting us]`. When you do, we delete your account, profile and posts. `[OWNER: decide what happens to reviews you wrote for others (deleted, or kept without your name), and say so here.]` We also delete any backups within `[OWNER: period]`.

We may keep limited records longer where needed to prevent abuse or to meet legal obligations. These include watermark records and records of bans for leaking.

## Your Rights

Depending on where you live, you may have the right to:
- access the personal information we hold about you;
- correct it;
- delete it;
- receive a copy of it;
- object to or restrict how we use it.

You can view and edit your profile in the app. For anything else, contact us at the address below. We will not discriminate against you for exercising these rights.

`[OWNER: if you serve users in the EU or UK, add the legal bases for processing (contract for accounts and the marketplace; legitimate interests for moderation, leak tracing and abuse prevention), your contact details as controller, and the right to complain to a supervisory authority.]`

## Security

Inkblot relies on your device, operating system and local file permissions to protect locally stored data. You should protect your device with device encryption, a strong login password, and regular backups.

Information sent to our services is encrypted in transit. `[OWNER: confirm TLS everywhere, and describe encryption at rest if your provider offers it.]`

No method of storage or transmission is perfectly secure. Requests to third parties are subject to those services' security practices.

## Children's Privacy

Inkblot is not directed to children under 13, and we do not knowingly collect personal information from children under 13. Accounts, the marketplace and sharing require you to be at least `[OWNER: minimum age, for example 13, or 16 in the EEA and UK]`.

If you believe a child has created an account or provided personal information to us, contact us so we can review and delete it.

## International Users

Inkblot stores app data on your device by default. Information you send to our services is stored in `[OWNER: country/region]`. Third-party services may process request information in the countries where they operate.

## App Store and Google Play Privacy Summary

For store privacy disclosures, Inkblot's intended posture is:

- **Data collected and linked to you, only if you create an account:**
  - contact info (email address);
  - identifiers (user ID, username);
  - user content (profile, marketplace posts, reviews and comments, reports, and leak report images);
  - other data (coin balance and history, reputation ratings, watermark records).
- **Data collected and not linked to you:** none by default. Bug reports are sent only when you choose to send one.
- **Data used for tracking:** none.
- **Data used for advertising or third-party marketing:** none.
- **Data used to train AI:** none.
- **User content stored on device:**
  - documents, notes, images, voice memos and cited sources;
  - entries, clipboard history and dictation output;
  - version history.
- **Third-party requests:** the optional services listed in "Third-Party Services".

Confirm these disclosures before each submission. Also confirm them if you add analytics, crash reporting, cloud backup, payments, or other networked features.

## Changes to This Policy

We may update this Privacy Policy when Inkblot's features, privacy practices, or legal requirements change. The "Last updated" date at the top shows when the policy was last revised. If a change materially affects how we handle account data, we will tell signed-in users in the app before it takes effect.

## Contact

If you have questions about this Privacy Policy or Inkblot's privacy practices, contact:

Developer/Publisher: `[Soupy Orange Cats Co-op]`
Email: `[privacy@inkblotwriting.studio]`
Website: `[https://inkblotwriting.studio]`
