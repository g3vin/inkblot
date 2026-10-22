"""
Regenerate tests/unit/voice-reference.json: what misaki itself says for each sentence.

The `voice` suite checks the port in src/lib/g2p against these answers, so the
reference comes from the original rather than from memory. Run it in a virtualenv
with misaki's English extra and the spaCy model it uses:

    python3 -m venv /tmp/misaki && /tmp/misaki/bin/pip install "misaki[en]==0.9.4"
    /tmp/misaki/bin/python -m spacy download en_core_web_sm
    /tmp/misaki/bin/python scripts/dev/misaki-reference.py

It runs misaki the way the port is built: the gold dictionary only (the silver
dictionaries are eSpeak NG output and aren't shipped) and no fallback, so a word
neither knows reads as nothing in both.
"""
import json
import pathlib

from misaki import en

PATH = pathlib.Path(__file__).resolve().parents[2] / 'tests' / 'unit' / 'voice-reference.json'

reference = json.loads(PATH.read_text(encoding='utf-8'))
for dialect, british in (('us', False), ('gb', True)):
    g2p = en.G2P(trf=False, british=british, fallback=None, unk='')
    g2p.lexicon.silvers = {}
    for case in reference['cases']:
        case[dialect] = g2p(case['text'])[0]

PATH.write_text(json.dumps(reference, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(f'wrote {PATH.relative_to(PATH.parents[2])}')
