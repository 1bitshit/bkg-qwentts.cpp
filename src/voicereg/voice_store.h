#pragma once

#include "voice_profile.h"
#include "../rvq-file.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace voicereg {

class voice_store {
public:
    static constexpr int rvq_code_bits = 11;

    explicit voice_store(std::filesystem::path root)
        : root_(std::move(root)) {
        std::filesystem::create_directories(root_);
    }

    const std::filesystem::path & root() const {
        return root_;
    }
    bool save(const voice_profile & voice, std::string & error) const {
        if (!voice.valid()) {
            error = "voice profile is incomplete";
            return false;
        }
        const auto dir = directory_for(voice.id);
        std::error_code ec;
        std::filesystem::create_directories(dir, ec);
        if (ec) {
            error = "cannot create voice directory: " + ec.message();
            return false;
        }

        if (!write_binary(dir / "speaker.spk", voice.ref.ref_spk_emb,
                          (size_t) voice.ref.ref_spk_dim * sizeof(float), error)) {
            return false;
        }
        std::vector<int32_t> codes(
            voice.ref.ref_codes,
            voice.ref.ref_codes + (size_t) voice.ref.num_codebooks * voice.ref.ref_T);
        const auto packed = rvq_pack_codes(codes, rvq_code_bits);
        if (!write_binary(dir / "reference.rvq", packed.data(), packed.size(), error)) {
            return false;
        }
        std::ofstream meta(dir / "meta.txt", std::ios::trunc);
        if (!meta) {
            error = "cannot write voice metadata";
            return false;
        }
        meta << "id=" << one_line(voice.id) << '\n';
        meta << "display_name=" << one_line(voice.display_name) << '\n';
        meta << "description=" << one_line(voice.description) << '\n';
        meta << "ref_text=" << one_line(voice.ref_text) << '\n';
        meta << "domain=" << one_line(voice.domain) << '\n';
        meta << "spk_dim=" << voice.ref.ref_spk_dim << '\n';
        meta << "ref_T=" << voice.ref.ref_T << '\n';
        meta << "num_codebooks=" << voice.ref.num_codebooks << '\n';
        if (!meta.good()) {
            error = "cannot finish voice metadata";
            return false;
        }
        return true;
    }

    std::vector<std::shared_ptr<voice_profile>> load_all(std::string & error) const {
        std::vector<std::shared_ptr<voice_profile>> result;
        error.clear();
        std::error_code ec;
        if (!std::filesystem::exists(root_, ec)) {
            return result;
        }
        for (const auto & entry : std::filesystem::directory_iterator(root_, ec)) {
            if (ec) {
                error = "cannot enumerate voice store: " + ec.message();
                return {};
            }
            if (!entry.is_directory()) {
                continue;
            }
            std::string item_error;
            auto voice = load_one(entry.path(), item_error);
            if (voice) {
                result.push_back(std::move(voice));
            } else if (error.empty()) {
                error = entry.path().filename().string() + ": " + item_error;
            }
        }
        std::sort(result.begin(), result.end(), [](const auto & a, const auto & b) {
            return a->id < b->id;
        });
        return result;
    }

    bool remove(const std::string & id, std::string & error) const {
        std::error_code ec;
        std::filesystem::remove_all(directory_for(id), ec);
        if (ec) {
            error = "cannot remove voice: " + ec.message();
            return false;
        }
        return true;
    }

private:
    std::filesystem::path root_;

    std::filesystem::path directory_for(const std::string & id) const {
        return root_ / safe_id(id);
    }
    static std::string safe_id(const std::string & value) {
        std::string out;
        out.reserve(value.size());
        for (unsigned char c : value) {
            out.push_back(std::isalnum(c) || c == '-' || c == '_' || c == '.' ? (char) c : '_');
        }
        return out.empty() ? "voice" : out;
    }

    static std::string one_line(std::string value) {
        for (char & c : value) {
            if (c == '\n' || c == '\r') {
                c = ' ';
            }
        }
        return value;
    }

    static bool write_binary(const std::filesystem::path & path,
                             const void * data,
                             size_t size,
                             std::string & error) {
        std::ofstream out(path, std::ios::binary | std::ios::trunc);
        if (!out) {
            error = "cannot open " + path.string() + " for writing";
            return false;
        }
        out.write(static_cast<const char *>(data), (std::streamsize) size);
        if (!out.good()) {
            error = "cannot write " + path.string();
            return false;
        }
        return true;
    }

    static std::unordered_map<std::string, std::string> read_meta(const std::filesystem::path & path) {
        std::unordered_map<std::string, std::string> values;
        std::ifstream in(path);
        std::string line;
        while (std::getline(in, line)) {
            const auto split = line.find('=');
            if (split != std::string::npos) {
                values[line.substr(0, split)] = line.substr(split + 1);
            }
        }
        return values;
    }
    static bool read_binary(const std::filesystem::path & path,
                            std::vector<uint8_t> & bytes,
                            std::string & error) {
        std::ifstream in(path, std::ios::binary | std::ios::ate);
        if (!in) {
            error = "cannot open " + path.string();
            return false;
        }
        const auto size = in.tellg();
        if (size <= 0) {
            error = path.string() + " is empty";
            return false;
        }
        bytes.resize((size_t) size);
        in.seekg(0);
        in.read(reinterpret_cast<char *>(bytes.data()), size);
        if (!in.good()) {
            error = "cannot read " + path.string();
            return false;
        }
        return true;
    }

    static std::shared_ptr<voice_profile> load_one(const std::filesystem::path & dir,
                                                    std::string & error) {
        try {
            const auto meta = read_meta(dir / "meta.txt");
            auto required = [&meta](const char * key) -> std::string {
                const auto it = meta.find(key);
                return it == meta.end() ? std::string{} : it->second;
            };
            auto voice = std::make_shared<voice_profile>();
            voice->id = required("id");
            voice->display_name = required("display_name");
            voice->description = required("description");
            voice->ref_text = required("ref_text");
            voice->domain = required("domain");
            voice->ref.ref_spk_dim = std::stoi(required("spk_dim"));
            voice->ref.ref_T = std::stoi(required("ref_T"));
            voice->ref.num_codebooks = std::stoi(required("num_codebooks"));
            if (voice->id.empty() || voice->ref.ref_spk_dim <= 0 ||
                voice->ref.ref_T <= 0 || voice->ref.num_codebooks <= 0) {
                error = "invalid metadata";
                return {};
            }
            std::vector<uint8_t> speaker_bytes;
            if (!read_binary(dir / "speaker.spk", speaker_bytes, error)) {
                return {};
            }
            const size_t expected_spk = (size_t) voice->ref.ref_spk_dim * sizeof(float);
            if (speaker_bytes.size() != expected_spk) {
                error = "speaker embedding size mismatch";
                return {};
            }
            voice->ref.ref_spk_emb = static_cast<float *>(std::malloc(expected_spk));
            if (!voice->ref.ref_spk_emb) {
                error = "out of memory loading speaker embedding";
                return {};
            }
            std::memcpy(voice->ref.ref_spk_emb, speaker_bytes.data(), expected_spk);

            std::vector<uint8_t> rvq_bytes;
            if (!read_binary(dir / "reference.rvq", rvq_bytes, error)) {
                return {};
            }
            std::vector<int32_t> codes;
            int loaded_T = 0;
            if (!rvq_read_buf(rvq_bytes.data(), rvq_bytes.size(),
                              voice->ref.num_codebooks, rvq_code_bits, codes, &loaded_T)) {
                error = "cannot decode stored RVQ reference";
                return {};
            }
            if (loaded_T != voice->ref.ref_T) {
                error = "RVQ frame count mismatch";
                return {};
            }
            const size_t code_bytes = codes.size() * sizeof(int32_t);
            voice->ref.ref_codes = static_cast<int32_t *>(std::malloc(code_bytes));
            if (!voice->ref.ref_codes) {
                error = "out of memory loading RVQ reference";
                return {};
            }
            std::memcpy(voice->ref.ref_codes, codes.data(), code_bytes);
            return voice;
        } catch (const std::exception & exception) {
            error = exception.what();
            return {};
        }
    }
};

} // namespace voicereg
