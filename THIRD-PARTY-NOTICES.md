# Third-party notices

Inkblot is licensed under the [Apache License 2.0](LICENSE). It includes, or downloads
on first use, the components below, which keep their own licences. Every other
JavaScript and Rust dependency is under a permissive licence (MIT, BSD, ISC, Apache
2.0, Zlib, Unicode or similar) or MPL 2.0, and its licence ships with it in
`node_modules/` or the Cargo registry.

## Models

| Component | Licence | How it reaches you |
|---|---|---|
| [Pocket TTS](https://huggingface.co/kyutai/pocket-tts), Copyright Kyutai, English model `english_2026-04` (ONNX export by [KevinAHM](https://huggingface.co/KevinAHM/pocket-tts-onnx)) and its tokenizer | CC BY 4.0 | Downloaded when you choose Download voices |
| Pocket TTS voices, precomputed by Kyutai ([pocket-tts-without-voice-cloning](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning)) from the recordings in [tts-voices](https://huggingface.co/kyutai/tts-voices): Alba (Alba Mackenna, CC BY 4.0); Azelma, George, Mary ([VCTK](https://datashare.ed.ac.uk/handle/10283/3443), CC BY 4.0); Peter (Peter Yearsley), Stuart (Stuart Bell) (LibriVox recordings, CC0) | CC BY 4.0 / CC0 | Downloaded with the model |
| [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) tokenizer (`src-tauri/resources/minilm-tokenizer.json`) | Apache 2.0 | Bundled |
| Synonym model (`synonym.onnx`, from [inkblot-nlp-models](https://github.com/g3vin/inkblot-nlp-models)), built on all-MiniLM-L6-v2 | Apache 2.0 (base model). The licence of the Kaggle synonym and antonym training set is unconfirmed. | Downloaded on first use |
| [Whisper](https://github.com/openai/whisper) `small.en` (ggml build) | MIT | Not bundled; installed by the user |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | Compiled in |

## Read Aloud's code

| Component | Licence | Notes |
|---|---|---|
| [pocket-tts](https://github.com/kyutai-labs/pocket-tts), Copyright Kyutai | MIT | `src-tauri/crates/inkblot-core/src/pocket_tts.rs` ports its prompt preparation, sentence splitting and end-of-speech rule from `rust/src/text.rs` and `rust/src/model.rs`. |

## Fonts

[Inter](https://github.com/rsms/inter), [Literata](https://github.com/googlefonts/literata)
and [Courier Prime](https://github.com/quoteunquoteapps/CourierPrime) are licensed under
the [SIL Open Font License 1.1](https://openfontlicense.org/). They're bundled through
`@fontsource`.

## Media

| Work | Licence | Notes |
|---|---|---|
| [*Leaves in summer*](https://commons.wikimedia.org/wiki/File:Leaves_in_summer.webm), by Joaquim Baeta | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | The landing page's backdrop (`public/media/landing/`). Changed: a 14-second excerpt, slowed to 0.7×, cropped to 16:9, looped with a 1.5-second crossfade (as on the website), then scaled to 480×270 and blurred. Credited on the landing page. |

## Copyleft components

| Component | Licence | Notes |
|---|---|---|
| [citeproc-js](https://github.com/Juris-M/citeproc-js), Copyright (c) 2009-2019 Frank Bennett | CPAL 1.0 or AGPL 3.0, at the recipient's choice. Inkblot uses it under CPAL 1.0. | Formats citations. Used unmodified. Changes to its files must be published under the CPAL. |
