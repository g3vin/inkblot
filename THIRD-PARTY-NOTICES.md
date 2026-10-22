# Third-party notices

Inkblot is licensed under the [Apache License 2.0](LICENSE). It includes, or downloads
on first use, the components below, which keep their own licences. Every other
JavaScript and Rust dependency is under a permissive licence (MIT, BSD, ISC, Apache
2.0, Zlib, Unicode or similar) or MPL 2.0, and its licence ships with it in
`node_modules/` or the Cargo registry.

## Models

| Component | Licence | How it reaches you |
|---|---|---|
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (ONNX build by [onnx-community](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)) and its voices | Apache 2.0 | Model downloaded on first use; voices bundled, copied from the `kokoro-js` package at build time |
| [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) tokenizer (`src-tauri/resources/minilm-tokenizer.json`) | Apache 2.0 | Bundled |
| Synonym model (`synonym.onnx`, from [inkblot-nlp-models](https://github.com/g3vin/inkblot-nlp-models)), built on all-MiniLM-L6-v2 | Apache 2.0 (base model). The licence of the Kaggle synonym and antonym training set is unconfirmed. | Downloaded on first use |
| [Whisper](https://github.com/openai/whisper) `small.en` (ggml build) | MIT | Not bundled; installed by the user |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | Compiled in |

## Read Aloud's pronunciation

| Component | Licence | Notes |
|---|---|---|
| [misaki](https://github.com/hexgrad/misaki), Copyright hexgrad | Apache 2.0 | `src/lib/g2p` is a port of its English G2P (`misaki/en.py`), changed to run without spaCy. Its gold dictionaries (`us_gold.json`, `gb_gold.json`) are bundled unmodified from commit `fba1236`. The author describes them as built from IPA datasets with the author's own heuristics ([misaki#51](https://github.com/hexgrad/misaki/issues/51)); which datasets is an open question ([misaki#107](https://github.com/hexgrad/misaki/issues/107)). misaki's silver dictionaries are eSpeak NG output and are not used. |
| [phonemize](https://github.com/hans00/phonemize), Copyright (c) 2025 Hans | MIT | Guesses words the dictionary doesn't have. Its data is built from ipa-dict (MIT) and CMUdict (BSD). |

## Fonts

[Inter](https://github.com/rsms/inter), [Literata](https://github.com/googlefonts/literata)
and [Courier Prime](https://github.com/quoteunquoteapps/CourierPrime) are licensed under
the [SIL Open Font License 1.1](https://openfontlicense.org/). They're bundled through
`@fontsource`.

## Copyleft components

| Component | Licence | Notes |
|---|---|---|
| [citeproc-js](https://github.com/Juris-M/citeproc-js), Copyright (c) 2009-2019 Frank Bennett | CPAL 1.0 or AGPL 3.0, at the recipient's choice. Inkblot uses it under CPAL 1.0. | Formats citations. Used unmodified. Changes to its files must be published under the CPAL. |
