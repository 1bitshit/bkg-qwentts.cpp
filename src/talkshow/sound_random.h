#pragma once

#include "audio-io.h"
#include "yyjson.h"
#include "../vendor/cpp-httplib/httplib.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <random>
#include <string>
#include <vector>

class tts_sound_designer {
public:
    static void handle_http(const httplib::Request & req, httplib::Response & res) {
        std::string scene;
        float intensity = 0.8f;
        uint32_t seed = 1997u;
        if (!parse_request(req.body, scene, intensity, seed)) {
            res.status = 400;
            res.set_content("{\"error\":{\"message\":\"invalid sound scene request\",\"type\":\"invalid_request_error\"}}", "application/json");
            return;
        }
        std::vector<float> pcm;
        if (!render(scene, intensity, seed, pcm)) {
            res.status = 400;
            res.set_content("{\"error\":{\"message\":\"unknown sound scene\",\"type\":\"invalid_request_error\"}}", "application/json");
            return;
        }
        std::string wav = audio_encode_wav(pcm.data(), (int) pcm.size(), sample_rate, WAV_S16);
        res.set_content(std::move(wav), "audio/wav");
    }

    static bool render(const std::string & scene, float intensity, uint32_t seed, std::vector<float> & out) {
        intensity = std::clamp(intensity, 0.0f, 1.5f);
        const float duration = scene == "studio_shutdown" ? 4.2f : 3.0f;
        out.assign((size_t) (duration * sample_rate), 0.0f);
        std::mt19937 rng(seed);

        if (scene == "applause") {
            std::uniform_real_distribution<float> at(0.0f, duration - 0.08f);
            for (int i = 0; i < 72; ++i) mix_noise(out, at(rng), 0.045f, 0.08f * intensity, rng);
        } else if (scene == "studio_booing") {
            for (int i = 0; i < 24; ++i) mix_noise(out, 0.04f + i * 0.11f, 0.30f, 0.05f * intensity, rng);
        } else if (scene == "studio_walkout") {
            for (int i = 0; i < 5; ++i) mix_impact(out, 0.2f + i * 0.24f, 110.0f, 0.12f, 0.28f * intensity);
            mix_impact(out, 1.65f, 72.0f, 0.38f, 0.55f * intensity);
            for (int i = 0; i < 12; ++i) mix_noise(out, 0.4f + i * 0.16f, 0.2f, 0.035f * intensity, rng);
        } else if (scene == "studio_return") {
            mix_impact(out, 0.0f, 68.0f, 0.35f, 0.55f * intensity);
            for (int i = 0; i < 4; ++i) mix_impact(out, 0.25f + i * 0.18f, 115.0f, 0.1f, 0.26f * intensity);
            for (int i = 0; i < 16; ++i) mix_noise(out, 0.45f + i * 0.12f, 0.24f, 0.04f * intensity, rng);
        } else if (scene == "studio_shutdown") {
            for (int i = 0; i < 28; ++i) mix_noise(out, 0.1f + i * 0.12f, 0.3f, 0.045f * intensity, rng);
            mix_impact(out, 0.55f, 82.0f, 0.3f, 0.58f * intensity);
            mix_impact(out, 1.35f, 55.0f, 0.48f, 0.72f * intensity);
            mix_impact(out, 2.15f, 96.0f, 0.25f, 0.48f * intensity);
            mix_impact(out, 3.1f, 44.0f, 0.6f, 0.8f * intensity);
        } else if (scene == "scifi_alarm") {
            for (int i = 0; i < 6; ++i) mix_impact(out, i * 0.48f, 760.0f, 0.2f, 0.3f * intensity);
        } else if (scene == "scifi_airlock") {
            mix_noise(out, 0.0f, 2.3f, 0.12f * intensity, rng);
            mix_impact(out, 1.85f, 52.0f, 0.6f, 0.75f * intensity);
        } else {
            return false;
        }

        for (float & sample : out) sample = std::tanh(sample);
        return true;
    }

private:
    static constexpr int sample_rate = 24000;

    static bool parse_request(const std::string & body, std::string & scene, float & intensity, uint32_t & seed) {
        yyjson_doc * doc = yyjson_read(body.c_str(), body.size(), 0);
        if (!doc) return false;
        yyjson_val * root = yyjson_doc_get_root(doc);
        yyjson_val * scene_val = yyjson_obj_get(root, "scene");
        if (!yyjson_is_str(scene_val)) {
            yyjson_doc_free(doc);
            return false;
        }
        scene = yyjson_get_str(scene_val);
        yyjson_val * intensity_val = yyjson_obj_get(root, "intensity");
        if (yyjson_is_num(intensity_val)) intensity = (float) yyjson_get_num(intensity_val);
        yyjson_val * seed_val = yyjson_obj_get(root, "seed");
        if (yyjson_is_uint(seed_val)) seed = (uint32_t) yyjson_get_uint(seed_val);
        yyjson_doc_free(doc);
        return true;
    }

    static void mix_impact(std::vector<float> & out, float at, float freq, float dur, float gain) {
        const int begin = std::max(0, (int) (at * sample_rate));
        const int count = std::max(1, (int) (dur * sample_rate));
        for (int i = 0; i < count && begin + i < (int) out.size(); ++i) {
            const float t = (float) i / sample_rate;
            const float env = std::exp(-6.0f * t / dur);
            const float f = freq * std::pow(0.35f, t / dur);
            out[begin + i] += std::sin(2.0f * 3.14159265f * f * t) * env * gain;
        }
    }

    static void mix_noise(std::vector<float> & out, float at, float dur, float gain, std::mt19937 & rng) {
        std::uniform_real_distribution<float> dist(-1.0f, 1.0f);
        const int begin = std::max(0, (int) (at * sample_rate));
        const int count = std::max(1, (int) (dur * sample_rate));
        float prev = 0.0f;
        for (int i = 0; i < count && begin + i < (int) out.size(); ++i) {
            const float env = std::exp(-5.0f * i / (float) count);
            prev = prev * 0.35f + dist(rng) * 0.65f;
            out[begin + i] += prev * env * gain;
        }
    }
};
