# Security Policy

Inkblot is a local-first app: your writing lives in files on your device, and there are
no Inkblot accounts or servers. The things worth protecting are those files, your
device, and the few network requests the app makes (see [PRIVACY.md](PRIVACY.md)).

## Supported versions

Inkblot is before 1.0, so only the latest release gets security fixes. Please check
that a problem still happens there before reporting it.

| Version          | Supported |
| ---------------- | --------- |
| Latest release   | Yes       |
| Anything earlier | No        |

## Reporting a vulnerability

**Please don't open a public issue, pull request or discussion for a security problem.**

Email **security@inkblotwriting.studio** with:

- what the problem is and what an attacker could do with it;
- the steps to reproduce it, ideally with a sample project or file;
- the Inkblot version and your operating system (macOS, iPadOS or iOS, and its version);
- whether the problem is already public, or known to anyone else.

What to expect:

- **Within 3 working days:** a reply to say your report has arrived.
- **Within 10 working days:** an assessment, including whether we can reproduce it and
  how serious we think it is.
- **Until it's fixed:** updates at least every two weeks. We aim to ship a fix within
  90 days, sooner for anything serious.

When the fix is out, it's noted in [CHANGELOG.md](CHANGELOG.md), and we'll credit you
there if you'd like.

Please give us a reasonable chance to fix the problem before you talk about it publicly,
and only test against your own devices and data.

## Scope

In scope: anything in this repository, and the apps built from it. For example:

- a document, canvas, map or project file that runs code, reads or writes files outside
  its project, or crashes the app when opened;
- the page reaching Tauri commands or file system access it shouldn't have;
- script injection through pasted content, imported files, Pinterest embeds or the
  details fetched for a citation;
- exported HTML, EPUB or PDF files that carry something harmful from the source;
- model or resource downloads that could be swapped or tampered with;
- your writing, notes, voice memos or clipboard history leaving the device in a way
  [PRIVACY.md](PRIVACY.md) doesn't describe.

Out of scope:

- problems in third-party services the app contacts (Pinterest, dictionaryapi.dev,
  Crossref and the rest): please report those to the service;
- attacks that need someone already in control of your unlocked device or account;
- problems that only affect unsupported versions or operating systems;
- reports from automated scanners with no demonstrated impact.

Vulnerabilities in a dependency are welcome if they affect Inkblot; please say how.
