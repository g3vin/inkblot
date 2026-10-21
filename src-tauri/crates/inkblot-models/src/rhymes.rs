//! Rhymes, from the CMU Pronouncing Dictionary.
//!
//! A lookup, not a model. Two words rhyme perfectly when their pronunciations agree
//! from the last stressed vowel to the end — `tiger` /T AY1 G ER0/ and `Geiger`
//! /G AY1 G ER0/ share `AY G ER`. The dictionary gives every word its phonemes with
//! stress marked, so the rhyme is read straight off it.
//!
//! The dictionary is 3.6 MB and BSD-licensed. It downloads on first use into
//! `<AppData>/models/`, pinned to one commit so every install indexes the same words.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::download;
use crate::MODEL_NOT_INSTALLED;

const DICTIONARY_FILE: &str = "cmudict.dict";
const DICTIONARY_URL: &str = "https://raw.githubusercontent.com/cmusphinx/cmudict/74790861f652b15e4ac49015a90074ad62a27690/cmudict.dict";

/// How many rhymes are offered. A tile is a handful of chips, not a rhyming dictionary.
const MAX_RHYMES: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RhymeDictionaryStatus {
    pub installed: bool,
    pub loaded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RhymeDownloadProgress {
    pub received: u64,
    /// 0 when the server sends no content-length.
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RhymeResponse {
    pub rhymes: Vec<String>,
}

/// The dictionary, indexed by rhyme.
#[derive(Default)]
pub struct RhymeIndex {
    /// Word → the rhyme part of each of its pronunciations, with its syllable count.
    words: HashMap<String, Vec<(String, usize)>>,
    /// Rhyme part → every word with a pronunciation ending that way.
    by_rhyme: HashMap<String, Vec<String>>,
}

fn is_vowel(phoneme: &str) -> bool {
    phoneme.ends_with(|c: char| c.is_ascii_digit())
}

/// From the last primary-stressed vowel to the end, stress marks removed — or from the
/// last secondary stress, or the last vowel, for a word with none (`the`, `'em`).
fn rhyme_part(phonemes: &[&str]) -> Option<String> {
    let start = phonemes
        .iter()
        .rposition(|p| p.ends_with('1'))
        .or_else(|| phonemes.iter().rposition(|p| p.ends_with('2')))
        .or_else(|| phonemes.iter().rposition(|p| is_vowel(p)))?;
    Some(
        phonemes[start..]
            .iter()
            .map(|p| p.trim_end_matches(|c: char| c.is_ascii_digit()))
            .collect::<Vec<_>>()
            .join(" "),
    )
}

impl RhymeIndex {
    /// Parse `cmudict.dict`: `word PH ON EMES`, variants as `word(2) …`, and an
    /// optional `# comment` after.
    pub fn parse(source: &str) -> Self {
        let mut index = RhymeIndex::default();
        for line in source.lines() {
            let line = line.split('#').next().unwrap_or("").trim();
            let mut parts = line.split_whitespace();
            let Some(head) = parts.next() else { continue };
            let word = head.split('(').next().unwrap_or(head);
            // Abbreviations and possessives are real entries but poor suggestions.
            if !word.chars().all(|c| c.is_ascii_lowercase() || c == '-') {
                continue;
            }
            let phonemes: Vec<&str> = parts.collect();
            let Some(rhyme) = rhyme_part(&phonemes) else {
                continue;
            };
            let syllables = phonemes.iter().filter(|p| is_vowel(p)).count();

            let entry = index.words.entry(word.to_string()).or_default();
            if !entry.iter().any(|(existing, _)| existing == &rhyme) {
                entry.push((rhyme.clone(), syllables));
                index
                    .by_rhyme
                    .entry(rhyme)
                    .or_default()
                    .push(word.to_string());
            }
        }
        index
    }

    /// Perfect rhymes for `word`. `None` if the dictionary does not know the word.
    ///
    /// The pronouncing dictionary is mostly surnames by count — `fire` has `eir`, `gyr`
    /// and `iyer` before `tire` — so `known` (ordinary words; see [`system_words`])
    /// ranks first when there is one. Then nearer syllable counts, then shorter words.
    pub fn rhymes_ranked(
        &self,
        word: &str,
        known: Option<&HashSet<String>>,
    ) -> Option<Vec<String>> {
        let mut found = self.candidates(word)?;
        let unknown = |candidate: &String| known.is_some_and(|known| !known.contains(candidate));
        found.sort_by(|(a_distance, a), (b_distance, b)| {
            unknown(a)
                .cmp(&unknown(b))
                .then(a_distance.cmp(b_distance))
                .then(a.len().cmp(&b.len()))
                .then(a.cmp(b))
        });
        Some(
            found
                .into_iter()
                .take(MAX_RHYMES)
                .map(|(_, word)| word)
                .collect(),
        )
    }

    /// [`Self::rhymes_ranked`] with no ordinary-word list; `None` for a word the
    /// dictionary does not know.
    pub fn rhymes(&self, word: &str) -> Option<Vec<String>> {
        self.rhymes_ranked(word, None)
    }

    /// Every rhyme, with how far its syllable count is from the word's.
    fn candidates(&self, word: &str) -> Option<Vec<(usize, String)>> {
        let word = word.trim().to_lowercase();
        let pronunciations = self.words.get(&word)?;

        let mut found: Vec<(usize, String)> = Vec::new();
        for (rhyme, syllables) in pronunciations {
            for candidate in self.by_rhyme.get(rhyme).into_iter().flatten() {
                // The word itself, and words that merely contain it (`night` for
                // `tonight`), are not what anyone is looking for.
                if candidate == &word
                    || candidate.ends_with(&word)
                    || word.ends_with(candidate.as_str())
                {
                    continue;
                }
                if found.iter().any(|(_, existing)| existing == candidate) {
                    continue;
                }
                let theirs = self.words[candidate]
                    .iter()
                    .filter(|(r, _)| r == rhyme)
                    .map(|(_, s)| *s)
                    .min()
                    .unwrap_or(*syllables);
                found.push((theirs.abs_diff(*syllables), candidate.clone()));
            }
        }
        Some(found)
    }
}

/// The system's word list, lowercase entries only — ordinary words, where the
/// capitalized ones are names. Webster's Second on macOS (public domain); absent on
/// iOS, where rhymes are simply ranked without it.
pub fn system_words() -> Option<HashSet<String>> {
    let source = std::fs::read_to_string("/usr/share/dict/words").ok()?;
    let words: HashSet<String> = source
        .lines()
        .filter(|line| !line.is_empty() && line.chars().all(|c| c.is_ascii_lowercase()))
        .map(str::to_string)
        .collect();
    (!words.is_empty()).then_some(words)
}

/// The dictionary, downloaded on first use and indexed once.
pub struct RhymeEngine {
    models_dir: PathBuf,
    /// The index, and the system's word list for ranking, loaded together on first use.
    index: Mutex<Option<(RhymeIndex, Option<HashSet<String>>)>>,
}

impl RhymeEngine {
    /// `models_dir` is `<AppData>/models`.
    pub fn new(models_dir: impl Into<PathBuf>) -> Self {
        Self {
            models_dir: models_dir.into(),
            index: Mutex::new(None),
        }
    }

    fn path(&self) -> Result<PathBuf, String> {
        std::fs::create_dir_all(&self.models_dir)
            .map_err(|e| format!("could not create {:?}: {e}", self.models_dir))?;
        Ok(self.models_dir.join(DICTIONARY_FILE))
    }

    pub fn status(&self) -> Result<RhymeDictionaryStatus, String> {
        Ok(RhymeDictionaryStatus {
            installed: self.path()?.is_file(),
            loaded: self.index.lock().is_some(),
        })
    }

    /// Fetch the pronouncing dictionary unless it is already on disk, reporting
    /// `progress`, and return the new status.
    pub async fn download(
        &self,
        progress: &(dyn Fn(RhymeDownloadProgress) + Send + Sync),
    ) -> Result<RhymeDictionaryStatus, String> {
        let path = self.path()?;
        if !path.is_file() {
            let client = download::client()?;
            download::fetch_to(
                &client,
                DICTIONARY_URL,
                &path,
                DICTIONARY_FILE,
                &|received, total| progress(RhymeDownloadProgress { received, total }),
            )
            .await?;
        }
        self.status()
    }

    /// Rhymes for `word`; empty for a word the dictionary does not know.
    pub fn rhymes(&self, word: &str) -> Result<RhymeResponse, String> {
        let mut guard = self.index.lock();
        if guard.is_none() {
            let path = self.path()?;
            if !path.is_file() {
                return Err(MODEL_NOT_INSTALLED.into());
            }
            let source =
                std::fs::read_to_string(&path).map_err(|e| format!("reading {path:?}: {e}"))?;
            *guard = Some((RhymeIndex::parse(&source), system_words()));
        }
        let (index, known) = guard.as_ref().expect("index just loaded");
        Ok(RhymeResponse {
            rhymes: index
                .rhymes_ranked(word, known.as_ref())
                .unwrap_or_default(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
tiger T AY1 G ER0
geiger G AY1 G ER0
liger L AY1 G ER0
tigers T AY1 G ER0 Z
night N AY1 T
light L AY1 T
tonight T AH0 N AY1 T
delight D IH0 L AY1 T
recondite R EH1 K AH0 N D AY2 T
read R EH1 D
read(2) R IY1 D
bed B EH1 D
seed S IY1 D
aalborg AO1 L B AO0 R G # place, danish
a's EY1 Z
the DH AH0
";

    #[test]
    fn a_rhyme_is_everything_from_the_last_stressed_vowel() {
        assert_eq!(rhyme_part(&["T", "AY1", "G", "ER0"]).unwrap(), "AY G ER");
        assert_eq!(
            rhyme_part(&["R", "EH1", "K", "AH0", "N", "D", "AY2", "T"]).unwrap(),
            "EH K AH N D AY T"
        );
        // No stress at all: the last vowel.
        assert_eq!(rhyme_part(&["DH", "AH0"]).unwrap(), "AH");
        assert!(rhyme_part(&["HH"]).is_none());
    }

    #[test]
    fn perfect_rhymes_are_found_and_the_word_itself_is_not() {
        let index = RhymeIndex::parse(SAMPLE);
        let rhymes = index.rhymes("tiger").unwrap();
        assert_eq!(rhymes, vec!["liger", "geiger"]);
        assert!(!rhymes.contains(&"tigers".to_string()));
    }

    #[test]
    fn nearer_syllable_counts_come_first_and_containing_words_are_skipped() {
        let index = RhymeIndex::parse(SAMPLE);
        let rhymes = index.rhymes("Night").unwrap();
        // `tonight` ends with `night`; `recondite` is stressed elsewhere.
        assert_eq!(rhymes, vec!["light", "delight"]);
    }

    #[test]
    fn known_words_rank_before_names() {
        let index = RhymeIndex::parse(SAMPLE);
        let known: HashSet<String> = ["geiger"].iter().map(|s| s.to_string()).collect();
        assert_eq!(
            index.rhymes_ranked("tiger", Some(&known)).unwrap(),
            vec!["geiger", "liger"]
        );
    }

    #[test]
    fn every_pronunciation_counts() {
        let index = RhymeIndex::parse(SAMPLE);
        let rhymes = index.rhymes("read").unwrap();
        assert!(rhymes.contains(&"bed".to_string()) && rhymes.contains(&"seed".to_string()));
    }

    #[test]
    fn comments_and_non_words_are_ignored() {
        let index = RhymeIndex::parse(SAMPLE);
        assert!(index.rhymes("aalborg").is_some());
        assert!(index.rhymes("a's").is_none());
        assert!(index.rhymes("unheardof").is_none());
    }

    /// Against the real dictionary: `INKBLOT_CMUDICT=/path/to/cmudict.dict cargo test
    /// -p inkblot-models -- --ignored`.
    #[test]
    #[ignore]
    fn the_real_dictionary_rhymes() {
        let path = std::env::var("INKBLOT_CMUDICT").expect("INKBLOT_CMUDICT");
        let index = RhymeIndex::parse(&std::fs::read_to_string(path).unwrap());
        let known = system_words();
        for (word, expected) in [
            ("cat", "hat"),
            ("love", "dove"),
            ("fire", "tire"),
            ("Tiger", "geiger"),
        ] {
            let rhymes = index
                .rhymes_ranked(word, known.as_ref())
                .unwrap_or_default();
            println!("{word}: {rhymes:?}");
            assert!(
                rhymes.contains(&expected.to_string()),
                "{word} → {rhymes:?}"
            );
        }
        // Orange famously has no perfect rhyme, and saying so is the right answer.
        assert!(index.rhymes("orange").unwrap().is_empty());
    }

    #[test]
    fn a_missing_dictionary_is_the_sentinel() {
        let dir = std::env::temp_dir().join(format!("inkblot-rhymes-{}", std::process::id()));
        let engine = RhymeEngine::new(&dir);
        assert_eq!(engine.rhymes("night").unwrap_err(), MODEL_NOT_INSTALLED);
        assert!(!engine.status().unwrap().installed);
        let _ = std::fs::remove_dir_all(dir);
    }
}
