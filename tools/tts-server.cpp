// tts-server.cpp: OpenAI-compatible HTTP server backed by the qwentts
// ABI. Loads a talker + codec once, GPU resident, and serves synthesis over
// POST /v1/audio/speech. The shared core lives in src/tts-server.h ; this
// file only wires the qt_* ABI into the generic adapter.

#include "tts-server.h"

#include "qwen.h"
#include "rvq-file.h"
#include "voicereg/voice_registry.h"
#include "version.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

// Packed .rvq code width, fixed by the Qwen3-TTS 12 Hz codec (2048
// entries per codebook).
static const int RVQ_CODE_BITS = 11;

static void print_usage(const char * prog) {
    fprintf(stderr, "qwentts.cpp %s\n\n", QWEN_VERSION);
    fprintf(stderr,
            "Usage: %s --model <gguf> --codec <gguf> [options]\n\n"
            "Required:\n"
            "  --model <gguf>          Talker LM GGUF (qwen-talker-*.gguf)\n"
            "  --codec <gguf>          Codec GGUF (qwen-tokenizer-*.gguf)\n\n"
            "Optional:\n"
            "  --host <ip>             Listen address (default: 127.0.0.1)\n"
            "  --port <n>              Listen port (default: 8080)\n"
            "  --lang <name>           Language label (default: auto)\n"
            "  --voice-dir <path>      Persistent cloned voice registry\n"
            "  --no-fa                 Disable flash attention\n"
            "  --clamp-fp16            Clamp hidden states to FP16 range\n",
            prog);
}

// Trim a path down to its file name for the reported model id.
static std::string basename_of(const char * path) {
    std::string s = path;
    size_t      p = s.find_last_of("/\\");
    return p == std::string::npos ? s : s.substr(p + 1);
}

int main(int argc, char ** argv) {
    const char *  talker_path = NULL;
    const char *  codec_path  = NULL;
    std::string   lang        = "auto";
    std::string   voice_dir   = std::getenv("QWENTTS_VOICE_DIR") ? std::getenv("QWENTTS_VOICE_DIR") : "data/voices";
    server_config cfg;
    bool          use_fa     = true;
    bool          clamp_fp16 = false;

    for (int i = 1; i < argc; i++) {
        const char * arg = argv[i];
        if (!std::strcmp(arg, "--model") && i + 1 < argc) {
            talker_path = argv[++i];
        } else if (!std::strcmp(arg, "--codec") && i + 1 < argc) {
            codec_path = argv[++i];
        } else if (!std::strcmp(arg, "--host") && i + 1 < argc) {
            cfg.host = argv[++i];
        } else if (!std::strcmp(arg, "--port") && i + 1 < argc) {
            cfg.port = std::atoi(argv[++i]);
        } else if (!std::strcmp(arg, "--lang") && i + 1 < argc) {
            lang = argv[++i];
        } else if (!std::strcmp(arg, "--voice-dir") && i + 1 < argc) {
            voice_dir = argv[++i];
        } else if (!std::strcmp(arg, "--no-fa")) {
            use_fa = false;
        } else if (!std::strcmp(arg, "--clamp-fp16")) {
            clamp_fp16 = true;
        } else if (!std::strcmp(arg, "--help") || !std::strcmp(arg, "-h")) {
            print_usage(argv[0]);
            return 0;
        } else {
            fprintf(stderr, "[CLI] ERROR: unknown arg: %s\n", arg);
            print_usage(argv[0]);
            return 1;
        }
    }

    if (!talker_path || !codec_path) {
        print_usage(argv[0]);
        return 0;
    }

    struct qt_init_params iparams;
    qt_init_default_params(&iparams);
    iparams.talker_path = talker_path;
    iparams.codec_path  = codec_path;
    iparams.use_fa      = use_fa;
    iparams.clamp_fp16  = clamp_fp16;

    struct qt_context * q = qt_init(&iparams);
    if (!q) {
        fprintf(stderr, "[Server] FATAL: %s\n", qt_last_error());
        return 1;
    }

    voicereg::voice_registry voice_registry(voice_dir);
    std::string registry_warning;
    voice_registry.reload(registry_warning);
    if (!registry_warning.empty()) {
        fprintf(stderr, "[VoiceReg] WARN: %s\n", registry_warning.c_str());
    }
    fprintf(stderr, "[VoiceReg] loaded %zu persistent voices from %s\n",
            voice_registry.size(), voice_registry.store().root().string().c_str());

    tts_backend be;
    be.model_id = basename_of(talker_path);
    int n       = qt_n_speakers(q);
    for (int i = 0; i < n; i++) {
        be.voices.push_back(qt_speaker_name(q, i));
    }

    // Native persistent voice registry shared by Talkshow and Story.
    be.register_voice = [q, &voice_registry](const tts_voice_upload & up, std::string & err) -> bool {
        voicereg::voice_profile entry;
        entry.id           = up.name;
        entry.display_name = up.display_name.empty() ? up.name : up.display_name;
        entry.description  = up.description;
        entry.domain       = up.domain.empty() ? "shared" : up.domain;
        entry.ref_text     = up.ref_text;

        if (!up.wav.empty()) {
            int sample_count = 0;
            float * pcm = audio_read_mono_buf(
                (const uint8_t *) up.wav.data(), up.wav.size(), 24000, &sample_count);
            if (!pcm) {
                err = "cannot decode the WAV payload";
                return false;
            }
            enum qt_status rc;
            {
                std::lock_guard<std::mutex> lock(g_synth_mutex);
                rc = qt_extract_voice_ref(q, pcm, sample_count, &entry.ref);
            }
            free(pcm);
            if (rc != QT_STATUS_OK) {
                err = qt_last_error();
                return false;
            }
        } else {
            if (up.spk.size() % sizeof(float) != 0 || up.spk.empty()) {
                err = "'spk_b64' must decode to a positive multiple of 4 bytes";
                return false;
            }
            std::vector<int32_t> codes;
            int ref_T = 0;
            const int K = qt_num_codebooks(q);
            if (!rvq_read_buf((const uint8_t *) up.rvq.data(), up.rvq.size(),
                              K, RVQ_CODE_BITS, codes, &ref_T)) {
                err = "'rvq_b64' does not decode to a valid packed code stream";
                return false;
            }
            entry.ref.ref_spk_dim = (int) (up.spk.size() / sizeof(float));
            entry.ref.ref_spk_emb = (float *) malloc(up.spk.size());
            entry.ref.ref_codes = (int32_t *) malloc(codes.size() * sizeof(int32_t));
            if (!entry.ref.ref_spk_emb || !entry.ref.ref_codes) {
                err = "out of memory while registering voice";
                return false;
            }
            std::memcpy(entry.ref.ref_spk_emb, up.spk.data(), up.spk.size());
            std::memcpy(entry.ref.ref_codes, codes.data(), codes.size() * sizeof(int32_t));
            entry.ref.ref_T = ref_T;
            entry.ref.num_codebooks = K;
        }

        const int ref_T = entry.ref.ref_T;
        if (!voice_registry.put(std::move(entry), err)) {
            return false;
        }
        fprintf(stderr, "[VoiceReg] voice '%s' persisted (T=%d, domain=%s)\n",
                up.name.c_str(), ref_T, up.domain.empty() ? "shared" : up.domain.c_str());
        return true;
    };

    be.remove_voice = [&voice_registry](const std::string & name) -> bool {
        if (!voice_registry.find(name)) {
            return false;
        }
        std::string error;
        if (!voice_registry.remove(name, error)) {
            fprintf(stderr, "[VoiceReg] remove '%s' failed: %s\n", name.c_str(), error.c_str());
            return false;
        }
        return true;
    };

    be.registered_voices = [&voice_registry]() -> std::vector<std::string> {
        return voice_registry.ids();
    };

    be.voice_details = [&voice_registry]() -> std::vector<tts_voice_info> {
        std::vector<tts_voice_info> result;
        for (const auto & voice : voice_registry.summaries()) {
            result.push_back({ voice.id, "registered", voice.display_name, voice.description, voice.domain });
        }
        return result;
    };

    // pcm drives the streaming pipeline : on_chunk routes each decoded
    // frame to the shared sink for lowest latency. wav leaves on_chunk
    // unset so the pipeline runs the buffered chunked codec path (batch
    // decode, talker uninterrupted) and the whole utterance pushes to
    // the sink once. A registered voice wins over a model speaker of
    // the same name and injects the pre-extracted reference latents. A
    // name matching neither is rejected instead of silently generating
    // voiceless.
    be.synthesize = [q, &lang, &voice_registry](const tts_request & req, const tts_sink & sink, std::string & err) -> int {
        struct qt_tts_params p;
        qt_tts_default_params(&p);
        p.text = req.input.c_str();
        p.lang = lang.c_str();

        auto voice = req.voice.empty() ? nullptr : voice_registry.find(req.voice);
        if (voice) {
            p.ref_spk_emb = voice->ref.ref_spk_emb;
            p.ref_spk_dim = voice->ref.ref_spk_dim;
            if (!voice->ref_text.empty() && voice->ref.ref_codes) {
                p.ref_codes = voice->ref.ref_codes;
                p.ref_T     = voice->ref.ref_T;
                p.ref_text  = voice->ref_text.c_str();
            }
        } else if (!req.voice.empty() && qt_n_speakers(q) > 0) {
            p.speaker = req.voice.c_str();
        } else if (!req.voice.empty()) {
            err = "unknown voice '" + req.voice + "'";
            return (int) QT_STATUS_INVALID_PARAMS;
        }
        if (!req.instructions.empty()) {
            p.instruct = req.instructions.c_str();
        }

        // Sampling overrides ride straight into the ABI; the subtalker
        // mirrors the talker knobs so the HTTP surface stays a single
        // coherent set. A temperature of zero selects greedy decoding
        // on both.
        p.seed = req.seed;
        if (req.max_new_tokens != -1) {
            p.max_new_tokens = req.max_new_tokens;
        }
        if (req.top_k != -1) {
            p.top_k           = req.top_k;
            p.subtalker_top_k = req.top_k;
        }
        if (!std::isnan(req.temperature)) {
            if (req.temperature == 0.0f) {
                p.do_sample           = false;
                p.subtalker_do_sample = false;
            } else {
                p.temperature           = req.temperature;
                p.subtalker_temperature = req.temperature;
            }
        }
        if (!std::isnan(req.top_p)) {
            p.top_p           = req.top_p;
            p.subtalker_top_p = req.top_p;
        }
        if (!std::isnan(req.repetition_penalty)) {
            p.repetition_penalty = req.repetition_penalty;
        }

        // Trampoline : the C ABI on_chunk forwards to the C++ sink.
        const tts_sink * sink_ptr = &sink;
        if (req.format == "pcm") {
            p.on_chunk = [](const float * s, int ns, void * u) -> bool {
                return (*static_cast<const tts_sink *>(u))(s, ns);
            };
            p.on_chunk_user_data = (void *) sink_ptr;
        }

        struct qt_audio out = {};
        enum qt_status  rc  = qt_synthesize(q, &p, &out);
        if (rc == QT_STATUS_OK && p.on_chunk == NULL && out.n_samples > 0) {
            sink(out.samples, out.n_samples);
        }
        qt_audio_free(&out);
        if (rc != QT_STATUS_OK) {
            err = qt_last_error();
            return (int) rc;
        }
        return 0;
    };

    int rc = tts_server_run(be, cfg);
    qt_free(q);
    return rc;
}
