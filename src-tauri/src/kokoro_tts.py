import base64
import json
import os
import sys
import traceback

KOKORO_REPO_ID = "hexgrad/Kokoro-82M"


class KokoroEngine:
    def __init__(self):
        self.model = None
        self.pipelines = {}
        self.cached_files_loader = None
        self.english_transformer_available = None

    def _load_cached_file(self, filename):
        if self.cached_files_loader is None:
            from huggingface_hub import try_to_load_from_cache

            self.cached_files_loader = try_to_load_from_cache

        path = self.cached_files_loader(KOKORO_REPO_ID, filename)
        return path if isinstance(path, str) and os.path.exists(path) else None

    def _get_model(self):
        if self.model is not None:
            return self.model

        from kokoro import KModel

        config_path = self._load_cached_file("config.json")
        model_name = KModel.MODEL_NAMES.get(KOKORO_REPO_ID, "kokoro-v1_0.pth")
        model_path = self._load_cached_file(model_name)

        if config_path and model_path:
            self.model = KModel(repo_id=KOKORO_REPO_ID, config=config_path, model=model_path).to("cpu").eval()
        else:
            self.model = KModel(repo_id=KOKORO_REPO_ID).to("cpu").eval()

        return self.model

    def _get_pipeline(self, lang_code):
        if lang_code not in self.pipelines:
            from kokoro import KPipeline

            self.pipelines[lang_code] = KPipeline(
                lang_code=lang_code,
                repo_id=KOKORO_REPO_ID,
                model=self._get_model(),
                trf=self._should_use_transformer_g2p(lang_code),
            )

        return self.pipelines[lang_code]

    def _should_use_transformer_g2p(self, lang_code):
        if lang_code not in ("a", "b"):
            return False

        if self.english_transformer_available is None:
            try:
                import spacy.util

                self.english_transformer_available = spacy.util.is_package("en_core_web_trf")
            except Exception:
                self.english_transformer_available = False

        return self.english_transformer_available

    def _voice_ref(self, voice):
        return self._load_cached_file(f"voices/{voice}.pt") or voice

    def prewarm(self, voice):
        lang_code = _lang_code_for_voice(voice)
        pipeline = self._get_pipeline(lang_code)
        pipeline.load_voice(self._voice_ref(voice))

    def generate(self, payload):
        import numpy as np

        text = str(payload.get("text") or "").strip()
        voice = str(payload.get("voice") or "af_heart").strip() or "af_heart"
        speed = float(payload.get("speed") or 1.0)

        if not text:
            raise ValueError("No text was provided for Kokoro.")

        pipeline = self._get_pipeline(_lang_code_for_voice(voice))
        generator = pipeline(text, voice=self._voice_ref(voice), speed=speed, split_pattern=r"\n+")

        audio_chunks = []
        graphemes = []
        phonemes = []

        for gs, ps, audio in generator:
            graphemes.append(str(gs))
            phonemes.append(str(ps))
            audio_chunks.append(_to_float32_array(audio))

        if audio_chunks:
            audio = np.concatenate(audio_chunks).astype("<f4", copy=False)
        else:
            audio = np.zeros(0, dtype="<f4")

        encoded_audio = base64.b64encode(audio.tobytes()).decode("ascii")

        return {
            "audioBase64": encoded_audio,
            "sampleRate": 24000,
            "engine": "kokoro-python",
            "graphemes": graphemes,
            "phonemes": phonemes,
        }


def _to_float32_array(audio):
    import numpy as np

    if hasattr(audio, "detach"):
        audio = audio.detach().cpu().numpy()

    return np.asarray(audio, dtype="<f4").reshape(-1)


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    response = KokoroEngine().generate(payload)
    print(json.dumps(response))


def run_server():
    engine = KokoroEngine()

    for line in sys.stdin:
        try:
            payload = json.loads(line)
            action = payload.get("action") or "generate"

            if action == "prewarm":
                voice = str(payload.get("voice") or "af_heart").strip() or "af_heart"
                engine.prewarm(voice)
                response = {
                    "audioBase64": "",
                    "sampleRate": 24000,
                    "engine": "kokoro-python",
                    "graphemes": [],
                    "phonemes": [],
                }
            else:
                response = engine.generate(payload)

            response["ok"] = True
            print(json.dumps(response), flush=True)
        except Exception as error:
            print(json.dumps({
                "ok": False,
                "error": "".join(traceback.format_exception_only(type(error), error)).strip(),
            }), flush=True)


def _lang_code_for_voice(voice):
    lang_code = voice[0] if voice else "a"
    if lang_code not in {"a", "b", "e", "f", "h", "i", "j", "p", "z"}:
        lang_code = "a"
    return lang_code


if __name__ == "__main__":
    try:
        if "--server" in sys.argv:
            run_server()
        else:
            main()
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
